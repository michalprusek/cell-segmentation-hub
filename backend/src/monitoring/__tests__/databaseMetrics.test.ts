/**
 * Tests for src/monitoring/databaseMetrics.ts
 *
 * Behavioral focus:
 *  - trackDatabaseQuery()        counter/histogram/slow-query counter + warn log,
 *                                and the catch branch swallows prom errors.
 *  - trackDatabaseTransaction()  success/failure histogram + catch branch.
 *  - trackConnectionError()      error_type counter + catch branch.
 *  - updateConnectionPoolMetrics active/idle/total/wait gauges + catch branch.
 *  - updateDatabaseSizeMetrics() table/index gauges + catch branch.
 *  - initializeDatabaseMetrics() zeroes pool, seeds known tables, swallows errors.
 *  - getDatabaseMetricsSummary() aggregated shape + zeroed error fallback.
 *  - DatabaseMetricsService       start/stop lifecycle (idempotent, reset,
 *                                no-op-when-stopped, error handling) + delegation.
 *
 * prom-client is real — assertions read back from its in-memory registry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — before any source import. databaseMetrics.ts imports only
// prom-client + logger, so logger is the sole dependency worth mocking.
// ---------------------------------------------------------------------------

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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
  dbTransactionDuration,
  dbSlowQueries,
  dbConnectionErrors,
  dbConnectionPoolSize,
  dbConnectionPoolWaitCount,
  dbTableSize,
  dbIndexSize,
  dbMetricsRegistry,
} from '../../monitoring/databaseMetrics';
import { logger } from '../../utils/logger';

const mockLogger = logger as unknown as {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

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
  const found = metric.values.find(v =>
    Object.entries(labels).every(
      ([k, val]) => (v.labels as Record<string, string>)[k] === val
    )
  );
  return found?.value ?? 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbQueryTotal.reset();
  dbQueryDuration.reset();
  dbTransactionDuration.reset();
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

  it('increments dbSlowQueries and warns when duration > 1000 ms', async () => {
    trackDatabaseQuery('findMany', 'QueueItem', 1500, true);
    const val = await getCounterValue('db_slow_queries_total', {
      operation: 'findMany',
      model: 'QueueItem',
    });
    expect(val).toBe(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Slow query')
    );
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

  it('swallows and logs prom errors when the counter throws', () => {
    const spy = vi.spyOn(dbQueryTotal, 'inc').mockImplementationOnce(() => {
      throw new Error('prom error');
    });
    expect(() => trackDatabaseQuery('findMany', 'User', 50, true)).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to track database query metric:',
      expect.any(Error)
    );
    spy.mockRestore();
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

  it('swallows and logs prom errors when the histogram throws', () => {
    const spy = vi
      .spyOn(dbTransactionDuration, 'observe')
      .mockImplementationOnce(() => {
        throw new Error('prom error');
      });
    expect(() => trackDatabaseTransaction(100, true)).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to track database transaction metric:',
      expect.any(Error)
    );
    spy.mockRestore();
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

  it('swallows and logs prom errors when the counter throws', () => {
    const spy = vi.spyOn(dbConnectionErrors, 'inc').mockImplementationOnce(() => {
      throw new Error('prom error');
    });
    expect(() => trackConnectionError('ECONNREFUSED')).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to track connection error metric:',
      expect.any(Error)
    );
    spy.mockRestore();
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

  it('swallows and logs prom errors when a gauge throws', () => {
    const spy = vi
      .spyOn(dbConnectionPoolSize, 'set')
      .mockImplementationOnce(() => {
        throw new Error('prom error');
      });
    expect(() => updateConnectionPoolMetrics(5, 3, 2)).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to update connection pool metrics:',
      expect.any(Error)
    );
    spy.mockRestore();
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

  it('swallows and logs prom errors when a gauge throws', () => {
    const spy = vi.spyOn(dbTableSize, 'set').mockImplementationOnce(() => {
      throw new Error('prom error');
    });
    expect(() =>
      updateDatabaseSizeMetrics(
        [{ name: 'User', size: 100 }],
        [{ name: 'idx', size: 50 }]
      )
    ).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to update database size metrics:',
      expect.any(Error)
    );
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// initializeDatabaseMetrics()
// ---------------------------------------------------------------------------

describe('initializeDatabaseMetrics()', () => {
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

  it('swallows errors when an inner gauge throws', () => {
    const spy = vi
      .spyOn(dbConnectionPoolSize, 'set')
      .mockImplementationOnce(() => {
        throw new Error('init error');
      });
    expect(() => initializeDatabaseMetrics()).not.toThrow();
    spy.mockRestore();
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

  it('returns a zeroed summary and logs when the registry throws', async () => {
    const spy = vi
      .spyOn(dbMetricsRegistry, 'getMetricsAsJSON')
      .mockRejectedValueOnce(new Error('registry down'));

    const result = await getDatabaseMetricsSummary();

    expect(result).toEqual({
      totalQueries: 0,
      totalSlowQueries: 0,
      totalErrors: 0,
      avgQueryTime: 0,
      connectionPoolSize: 0,
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to get database metrics summary:',
      expect.any(Error)
    );
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// DatabaseMetricsService (databaseMetrics singleton)
// ---------------------------------------------------------------------------

describe('DatabaseMetricsService', () => {
  it('start() is idempotent — calling twice does not throw or double-initialize', () => {
    databaseMetrics.start();
    expect(() => databaseMetrics.start()).not.toThrow();
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

  it('getMetricsSummary() resolves to the summary shape', async () => {
    const summary = await databaseMetrics.getMetricsSummary();
    expect(summary).toHaveProperty('totalQueries');
    expect(summary).toHaveProperty('connectionPoolSize');
  });

  it('start() stays resilient when initialization internals throw', () => {
    databaseMetrics.stop();
    const spy = vi
      .spyOn(dbConnectionPoolSize, 'set')
      .mockImplementationOnce(() => {
        throw new Error('start error');
      });
    (databaseMetrics as unknown as { isStarted: boolean }).isStarted = false;

    expect(() => databaseMetrics.start()).not.toThrow();
    spy.mockRestore();
  });

  it('stop() is a no-op when the service was never started', () => {
    (databaseMetrics as unknown as { isStarted: boolean }).isStarted = false;
    expect(() => databaseMetrics.stop()).not.toThrow();
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      'Database metrics service stopped'
    );
  });

  it('stop() swallows and logs errors from metric.reset()', () => {
    (databaseMetrics as unknown as { isStarted: boolean }).isStarted = true;
    const spy = vi.spyOn(dbQueryTotal, 'reset').mockImplementationOnce(() => {
      throw new Error('reset error');
    });
    expect(() => databaseMetrics.stop()).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to stop database metrics service:',
      expect.any(Error)
    );
    spy.mockRestore();
    (databaseMetrics as unknown as { isStarted: boolean }).isStarted = false;
  });
});
