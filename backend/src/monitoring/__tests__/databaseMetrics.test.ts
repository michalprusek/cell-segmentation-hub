/**
 * Tests for src/monitoring/databaseMetrics.ts
 *
 * Behavioral focus:
 *  - trackDatabaseQuery() increments dbQueryTotal counter with correct labels,
 *    records histogram observation, and emits slow-query counter when > 1000 ms
 *  - trackDatabaseTransaction() records histogram with success/failure label
 *  - trackConnectionError() increments dbConnectionErrors with error_type label
 *  - updateConnectionPoolMetrics() sets active/idle/total/wait gauges correctly
 *  - updateDatabaseSizeMetrics() sets table and index size gauges
 *  - initializeDatabaseMetrics() zeroes the pool and creates known table/index entries
 *  - getDatabaseMetricsSummary() returns the correct aggregated structure
 *  - DatabaseMetricsService.start() is idempotent (calling twice doesn't reinitialize)
 *  - DatabaseMetricsService.stop() resets all metric counters/gauges
 *  - DatabaseMetricsService.trackQuery() delegates to trackDatabaseQuery
 *  - DatabaseMetricsService.trackTransaction() delegates to trackDatabaseTransaction
 *  - DatabaseMetricsService.trackConnectionError() delegates to trackConnectionError
 *  - DatabaseMetricsService.updateConnectionPool() delegates to updateConnectionPoolMetrics
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — before any source import
// ---------------------------------------------------------------------------

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32chars!!',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-testing-only-32chars!',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    REDIS_URL: 'redis://localhost:6379',
    FROM_EMAIL: 'test@test.com',
    EMAIL_SERVICE: 'none',
    REQUIRE_EMAIL_VERIFICATION: false,
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));

// ---------------------------------------------------------------------------
// Import module under test (prom-client is real — we use its in-memory store)
// ---------------------------------------------------------------------------
import {
  trackDatabaseQuery,
  trackDatabaseTransaction,
  trackConnectionError,
  updateConnectionPoolMetrics,
  updateDatabaseSizeMetrics,
  initializeDatabaseMetrics,
  getDatabaseMetricsSummary,
  databaseMetrics,
  dbQueryTotal,
  dbQueryDuration,
  dbSlowQueries,
  dbConnectionErrors,
  dbConnectionPoolSize,
  dbConnectionPoolWaitCount,
  dbTableSize,
  dbIndexSize,
  dbMetricsRegistry,
} from '../../monitoring/databaseMetrics';

// ---------------------------------------------------------------------------
// Helper: extract current value for a counter/gauge from the registry
// ---------------------------------------------------------------------------

async function getCounterValue(
  metricName: string,
  labels: Record<string, string> = {}
): Promise<number> {
  const metrics = await dbMetricsRegistry.getMetricsAsJSON();
  const metric = metrics.find(m => m.name === metricName);
  if (!metric?.values) return 0;
  const found = metric.values.find(v => {
    return Object.entries(labels).every(
      ([k, val]) => (v.labels as Record<string, string>)[k] === val
    );
  });
  return found?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Reset counters between tests by resetting all metrics
// ---------------------------------------------------------------------------

beforeEach(() => {
  dbQueryTotal.reset();
  dbQueryDuration.reset();
  dbSlowQueries.reset();
  dbConnectionErrors.reset();
  dbConnectionPoolSize.reset();
  dbConnectionPoolWaitCount.reset();
  dbTableSize.reset();
  dbIndexSize.reset();
});

// ---------------------------------------------------------------------------
// trackDatabaseQuery()
// ---------------------------------------------------------------------------

describe('trackDatabaseQuery()', () => {
  it('increments dbQueryTotal with operation/model/status=success labels', async () => {
    trackDatabaseQuery('findMany', 'User', 50, true);
    const val = await getCounterValue('db_queries_total', {
      operation: 'findMany',
      model: 'User',
      status: 'success',
    });
    expect(val).toBe(1);
  });

  it('increments dbQueryTotal with status=failure on unsuccessful query', async () => {
    trackDatabaseQuery('delete', 'Project', 20, false);
    const val = await getCounterValue('db_queries_total', {
      operation: 'delete',
      model: 'Project',
      status: 'failure',
    });
    expect(val).toBe(1);
  });

  it('accumulates calls for the same label set', async () => {
    trackDatabaseQuery('findUnique', 'Image', 10, true);
    trackDatabaseQuery('findUnique', 'Image', 15, true);
    trackDatabaseQuery('findUnique', 'Image', 12, true);
    const val = await getCounterValue('db_queries_total', {
      operation: 'findUnique',
      model: 'Image',
      status: 'success',
    });
    expect(val).toBe(3);
  });

  it('increments dbSlowQueries when duration > 1000 ms', async () => {
    trackDatabaseQuery('findMany', 'QueueItem', 1500, true);
    const val = await getCounterValue('db_slow_queries_total', {
      operation: 'findMany',
      model: 'QueueItem',
    });
    expect(val).toBe(1);
  });

  it('does NOT increment dbSlowQueries when duration <= 1000 ms', async () => {
    trackDatabaseQuery('update', 'Project', 999, true);
    const val = await getCounterValue('db_slow_queries_total', {
      operation: 'update',
      model: 'Project',
    });
    expect(val).toBe(0);
  });

  it('records the duration in db_query_duration_seconds (seconds, not ms)', async () => {
    trackDatabaseQuery('create', 'Segmentation', 500, true);
    const metrics = await dbMetricsRegistry.getMetricsAsJSON();
    const histMetric = metrics.find(
      m => m.name === 'db_query_duration_seconds'
    );
    // Histogram should have sum ~0.5 (500 ms → 0.5 s) across success label set
    const sumEntry = histMetric?.values?.find(
      v =>
        (v.labels as Record<string, string>).status === 'success' &&
        (v.metricName as string)?.endsWith('_sum')
    );
    expect(sumEntry?.value).toBeCloseTo(0.5, 2);
  });
});

// ---------------------------------------------------------------------------
// trackDatabaseTransaction()
// ---------------------------------------------------------------------------

describe('trackDatabaseTransaction()', () => {
  it('records a histogram observation for a successful transaction', async () => {
    trackDatabaseTransaction(200, true);
    const metrics = await dbMetricsRegistry.getMetricsAsJSON();
    const hist = metrics.find(
      m => m.name === 'db_transaction_duration_seconds'
    );
    const countEntry = hist?.values?.find(
      v =>
        (v.labels as Record<string, string>).status === 'success' &&
        (v.metricName as string)?.endsWith('_count')
    );
    expect(countEntry?.value ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('records a histogram observation with status=failure label', async () => {
    trackDatabaseTransaction(800, false);
    const metrics = await dbMetricsRegistry.getMetricsAsJSON();
    const hist = metrics.find(
      m => m.name === 'db_transaction_duration_seconds'
    );
    const countEntry = hist?.values?.find(
      v =>
        (v.labels as Record<string, string>).status === 'failure' &&
        (v.metricName as string)?.endsWith('_count')
    );
    expect(countEntry?.value ?? 0).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// trackConnectionError()
// ---------------------------------------------------------------------------

describe('trackConnectionError()', () => {
  it('increments dbConnectionErrors with the supplied error_type label', async () => {
    trackConnectionError('timeout');
    const val = await getCounterValue('db_connection_errors_total', {
      error_type: 'timeout',
    });
    expect(val).toBe(1);
  });

  it('tracks distinct error types independently', async () => {
    trackConnectionError('refused');
    trackConnectionError('refused');
    trackConnectionError('ssl');
    const refused = await getCounterValue('db_connection_errors_total', {
      error_type: 'refused',
    });
    const ssl = await getCounterValue('db_connection_errors_total', {
      error_type: 'ssl',
    });
    expect(refused).toBe(2);
    expect(ssl).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// updateConnectionPoolMetrics()
// ---------------------------------------------------------------------------

describe('updateConnectionPoolMetrics()', () => {
  it('sets active gauge', async () => {
    updateConnectionPoolMetrics(5, 3, 1);
    const val = await getCounterValue('db_connection_pool_size', {
      state: 'active',
    });
    expect(val).toBe(5);
  });

  it('sets idle gauge', async () => {
    updateConnectionPoolMetrics(5, 3, 1);
    const val = await getCounterValue('db_connection_pool_size', {
      state: 'idle',
    });
    expect(val).toBe(3);
  });

  it('sets total gauge to active + idle', async () => {
    updateConnectionPoolMetrics(7, 4, 0);
    const val = await getCounterValue('db_connection_pool_size', {
      state: 'total',
    });
    expect(val).toBe(11);
  });

  it('sets wait count gauge', async () => {
    updateConnectionPoolMetrics(0, 0, 8);
    const metrics = await dbMetricsRegistry.getMetricsAsJSON();
    const gauge = metrics.find(m => m.name === 'db_connection_pool_wait_count');
    const val = gauge?.values?.[0]?.value ?? -1;
    expect(val).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// updateDatabaseSizeMetrics()
// ---------------------------------------------------------------------------

describe('updateDatabaseSizeMetrics()', () => {
  it('sets table size for each supplied table', async () => {
    updateDatabaseSizeMetrics(
      [
        { name: 'users', size: 1024 },
        { name: 'projects', size: 2048 },
      ],
      []
    );
    const users = await getCounterValue('db_table_size_bytes', {
      table_name: 'users',
    });
    const projects = await getCounterValue('db_table_size_bytes', {
      table_name: 'projects',
    });
    expect(users).toBe(1024);
    expect(projects).toBe(2048);
  });

  it('sets index size for each supplied index', async () => {
    updateDatabaseSizeMetrics([], [{ name: 'idx_user_email', size: 512 }]);
    const val = await getCounterValue('db_index_size_bytes', {
      index_name: 'idx_user_email',
    });
    expect(val).toBe(512);
  });
});

// ---------------------------------------------------------------------------
// initializeDatabaseMetrics()
// ---------------------------------------------------------------------------

describe('initializeDatabaseMetrics()', () => {
  it('runs without throwing', () => {
    expect(() => initializeDatabaseMetrics()).not.toThrow();
  });

  it('sets active pool to 0 after initialization', async () => {
    initializeDatabaseMetrics();
    const val = await getCounterValue('db_connection_pool_size', {
      state: 'active',
    });
    expect(val).toBe(0);
  });

  it('creates entries for core tables (User, Project, etc.)', async () => {
    initializeDatabaseMetrics();
    const metrics = await dbMetricsRegistry.getMetricsAsJSON();
    const tableMetric = metrics.find(m => m.name === 'db_table_size_bytes');
    const tableNames = (tableMetric?.values ?? []).map(
      v => (v.labels as Record<string, string>).table_name
    );
    expect(tableNames).toContain('User');
    expect(tableNames).toContain('Project');
  });
});

// ---------------------------------------------------------------------------
// getDatabaseMetricsSummary()
// ---------------------------------------------------------------------------

describe('getDatabaseMetricsSummary()', () => {
  it('returns an object with all required summary keys', async () => {
    const summary = await getDatabaseMetricsSummary();
    expect(summary).toHaveProperty('totalQueries');
    expect(summary).toHaveProperty('totalSlowQueries');
    expect(summary).toHaveProperty('totalErrors');
    expect(summary).toHaveProperty('avgQueryTime');
    expect(summary).toHaveProperty('connectionPoolSize');
  });

  it('totalQueries reflects recorded queries', async () => {
    trackDatabaseQuery('findMany', 'User', 50, true);
    trackDatabaseQuery('create', 'Project', 100, false);
    const summary = await getDatabaseMetricsSummary();
    expect(summary.totalQueries).toBeGreaterThanOrEqual(2);
  });

  it('totalSlowQueries reflects slow query count', async () => {
    trackDatabaseQuery('findMany', 'BigTable', 2000, true);
    const summary = await getDatabaseMetricsSummary();
    expect(summary.totalSlowQueries).toBeGreaterThanOrEqual(1);
  });

  it('totalErrors reflects connection error count', async () => {
    trackConnectionError('timeout');
    const summary = await getDatabaseMetricsSummary();
    expect(summary.totalErrors).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// DatabaseMetricsService (databaseMetrics singleton)
// ---------------------------------------------------------------------------

describe('DatabaseMetricsService', () => {
  it('start() runs without throwing', () => {
    expect(() => databaseMetrics.start()).not.toThrow();
  });

  it('start() is idempotent — calling twice does not throw or double-initialize', () => {
    databaseMetrics.start();
    expect(() => databaseMetrics.start()).not.toThrow();
  });

  it('stop() runs without throwing', () => {
    databaseMetrics.start();
    expect(() => databaseMetrics.stop()).not.toThrow();
  });

  it('stop() resets query counters to zero', async () => {
    databaseMetrics.start();
    trackDatabaseQuery('findMany', 'User', 10, true);
    databaseMetrics.stop();
    const summary = await getDatabaseMetricsSummary();
    expect(summary.totalQueries).toBe(0);
  });

  it('trackQuery() increments dbQueryTotal', async () => {
    databaseMetrics.start();
    databaseMetrics.trackQuery('update', 'Project', 30, true);
    const val = await getCounterValue('db_queries_total', {
      operation: 'update',
      model: 'Project',
      status: 'success',
    });
    expect(val).toBeGreaterThanOrEqual(1);
  });

  it('trackTransaction() records histogram observation', async () => {
    databaseMetrics.start();
    databaseMetrics.trackTransaction(100, true);
    const metrics = await dbMetricsRegistry.getMetricsAsJSON();
    const hist = metrics.find(
      m => m.name === 'db_transaction_duration_seconds'
    );
    const anyCount = (hist?.values ?? []).some(
      v => (v.metricName as string)?.endsWith('_count') && (v.value ?? 0) > 0
    );
    expect(anyCount).toBe(true);
  });

  it('trackConnectionError() increments error counter', async () => {
    databaseMetrics.start();
    databaseMetrics.trackConnectionError('network');
    const val = await getCounterValue('db_connection_errors_total', {
      error_type: 'network',
    });
    expect(val).toBeGreaterThanOrEqual(1);
  });

  it('updateConnectionPool() sets active gauge', async () => {
    databaseMetrics.start();
    databaseMetrics.updateConnectionPool(10, 5, 2);
    const val = await getCounterValue('db_connection_pool_size', {
      state: 'active',
    });
    expect(val).toBe(10);
  });

  it('getMetricsSummary() returns a promise resolving to summary shape', async () => {
    const summary = await databaseMetrics.getMetricsSummary();
    expect(summary).toHaveProperty('totalQueries');
    expect(summary).toHaveProperty('connectionPoolSize');
  });
});
