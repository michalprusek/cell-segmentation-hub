/**
 * databaseMetrics.gaps6.test.ts
 *
 * Targets lines not covered by databaseMetrics.test.ts:
 *   114, 133, 144, 162, 182 — catch-error branches in each tracking function
 *   214, 228, 237 — initializeDatabaseMetrics catch + getDatabaseMetricsSummary paths
 *   257, 258 — getDatabaseMetricsSummary error path
 *   287, 296 — DatabaseMetricsService.start() error path + stop() when not started
 *   314 — DatabaseMetricsService.stop() error path
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    FROM_EMAIL: 'test@test.com',
    EMAIL_SERVICE: 'none',
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
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
  dbConnectionErrors,
  dbSlowQueries,
  dbConnectionPoolSize,
  dbConnectionPoolWaitCount,
  dbTableSize,
  dbIndexSize,
  dbMetricsRegistry,
} from '../../monitoring/databaseMetrics';
import { logger } from '../../utils/logger';

const mockLogger = logger as unknown as {
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  dbQueryTotal.reset();
  dbQueryDuration.reset();
  dbTransactionDuration.reset();
  dbConnectionErrors.reset();
  dbSlowQueries.reset();
  dbConnectionPoolSize.reset();
  dbConnectionPoolWaitCount.reset();
  dbTableSize.reset();
  dbIndexSize.reset();
});

// ---------------------------------------------------------------------------
// Catch branches in each public function
// ---------------------------------------------------------------------------

describe('catch-branch coverage', () => {
  it('trackDatabaseQuery — catches when counter.inc throws', () => {
    const spy = vi.spyOn(dbQueryTotal, 'inc').mockImplementationOnce(() => {
      throw new Error('prom error');
    });
    expect(() =>
      trackDatabaseQuery('findMany', 'User', 50, true)
    ).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to track database query metric:',
      expect.any(Error)
    );
    spy.mockRestore();
  });

  it('trackDatabaseQuery — slow query branch emits dbSlowQueries when > 1000ms', () => {
    trackDatabaseQuery('findMany', 'HeavyTable', 1500, true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Slow query')
    );
  });

  it('trackDatabaseTransaction — catches when histogram.observe throws', () => {
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

  it('trackConnectionError — catches when counter.inc throws', () => {
    const spy = vi
      .spyOn(dbConnectionErrors, 'inc')
      .mockImplementationOnce(() => {
        throw new Error('prom error');
      });
    expect(() => trackConnectionError('ECONNREFUSED')).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to track connection error metric:',
      expect.any(Error)
    );
    spy.mockRestore();
  });

  it('updateConnectionPoolMetrics — catches when gauge.set throws', () => {
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

  it('updateDatabaseSizeMetrics — catches when table gauge.set throws', () => {
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
// getDatabaseMetricsSummary — error path
// ---------------------------------------------------------------------------

describe('getDatabaseMetricsSummary() error path', () => {
  it('returns zeroed summary when registry throws', async () => {
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
// initializeDatabaseMetrics — error path
// ---------------------------------------------------------------------------

describe('initializeDatabaseMetrics() error path', () => {
  it('catches when inner gauge.set throws', () => {
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
// DatabaseMetricsService start / stop edge cases
// ---------------------------------------------------------------------------

describe('DatabaseMetricsService', () => {
  it('start() — error path: catches when initializeDatabaseMetrics throws', () => {
    // Force the service into "not started" state first by stopping
    databaseMetrics.stop(); // may or may not be started; OK either way

    const spy = vi
      .spyOn(dbConnectionPoolSize, 'set')
      .mockImplementationOnce(() => {
        throw new Error('start error');
      });

    // Reset internal state by accessing private via cast
    (databaseMetrics as unknown as { isStarted: boolean }).isStarted = false;

    expect(() => databaseMetrics.start()).not.toThrow();
    spy.mockRestore();
  });

  it('stop() — no-op when not started', () => {
    (databaseMetrics as unknown as { isStarted: boolean }).isStarted = false;
    expect(() => databaseMetrics.stop()).not.toThrow();
    // Should not log "stopped"
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      'Database metrics service stopped'
    );
  });

  it('stop() — catches error from metric.reset()', () => {
    (databaseMetrics as unknown as { isStarted: boolean }).isStarted = true;
    const spy = vi
      .spyOn(dbQueryTotal, 'reset')
      .mockImplementationOnce(() => {
        throw new Error('reset error');
      });
    expect(() => databaseMetrics.stop()).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to stop database metrics service:',
      expect.any(Error)
    );
    spy.mockRestore();
    // restore isStarted
    (databaseMetrics as unknown as { isStarted: boolean }).isStarted = false;
  });
});
