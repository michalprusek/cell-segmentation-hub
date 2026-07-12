import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  performanceMonitor,
  measureThumbnailRender,
  measureApiCall,
  measureCanvasOperation,
} from '@/lib/performanceMonitor';
import { logger } from '@/lib/logger';

// Mock logger (module-under-test only uses warn + debug)
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('PerformanceMonitor', () => {
  let mockPerformanceNow: ReturnType<typeof vi.fn>;
  let mockDateNow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // performance.now defaults to 0; tests override per-call via mockReturnValueOnce
    mockPerformanceNow = vi.fn().mockReturnValue(0);
    Object.defineProperty(global, 'performance', {
      value: {
        now: mockPerformanceNow,
        memory: {
          usedJSHeapSize: 1000000,
          totalJSHeapSize: 2000000,
          jsHeapSizeLimit: 4000000,
        },
      },
      writable: true,
      configurable: true,
    });

    mockDateNow = vi.fn().mockReturnValue(1000000);
    Date.now = mockDateNow;

    performanceMonitor.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    performanceMonitor.clear();
  });

  describe('Basic Timing Operations', () => {
    it('starts and ends timing successfully', () => {
      mockPerformanceNow.mockReturnValueOnce(100).mockReturnValueOnce(150);

      const id = performanceMonitor.startTiming('test-operation');
      expect(id).toMatch(/^test-operation-\d+-[a-z0-9]+$/);

      const duration = performanceMonitor.endTiming(id);
      expect(duration).toBe(50);
    });

    it('generates unique timing IDs', () => {
      const id1 = performanceMonitor.startTiming('test');
      const id2 = performanceMonitor.startTiming('test');

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^test-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^test-\d+-[a-z0-9]+$/);
    });

    it('returns 0 and warns for an invalid timing ID', () => {
      const duration = performanceMonitor.endTiming('invalid-id');

      expect(duration).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith('Performance timing not found', {
        id: 'invalid-id',
      });
    });

    it('cleans up pending timings after ending (double-end returns 0)', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(50);

      const id = performanceMonitor.startTiming('cleanup-test');
      performanceMonitor.endTiming(id);

      // Trying to end the same timing again should return 0
      expect(performanceMonitor.endTiming(id)).toBe(0);
    });
  });

  describe('Metric Recording and Statistics', () => {
    it('records a single metric correctly', () => {
      performanceMonitor.recordMetric({
        name: 'test-metric',
        duration: 125.5,
        timestamp: Date.now(),
        metadata: { test: true },
      });

      expect(performanceMonitor.getStats('test-metric')).toEqual({
        average: 125.5,
        min: 125.5,
        max: 125.5,
        count: 1,
        total: 125.5,
      });
    });

    it('calculates statistics across multiple metrics', () => {
      [100, 200, 300].forEach(duration =>
        performanceMonitor.recordMetric({
          name: 'multi-test',
          duration,
          timestamp: Date.now(),
        })
      );

      expect(performanceMonitor.getStats('multi-test')).toEqual({
        average: 200,
        min: 100,
        max: 300,
        count: 3,
        total: 600,
      });
    });

    it('returns null for non-existent metrics', () => {
      expect(performanceMonitor.getStats('non-existent')).toBeNull();
    });

    it('limits metrics to max count per type, keeping the latest', () => {
      // Record more than maxMetricsPerType (100) metrics
      for (let i = 0; i < 150; i++) {
        performanceMonitor.recordMetric({
          name: 'limit-test',
          duration: i,
          timestamp: Date.now() + i,
        });
      }

      const stats = performanceMonitor.getStats('limit-test');
      expect(stats!.count).toBe(100); // capped at 100
      // Should keep the latest metrics (50-149)
      expect(stats!.min).toBe(50);
      expect(stats!.max).toBe(149);
    });

    it('aggregates all statistics across metric types', () => {
      performanceMonitor.recordMetric({
        name: 'metric1',
        duration: 100,
        timestamp: Date.now(),
      });
      performanceMonitor.recordMetric({
        name: 'metric2',
        duration: 200,
        timestamp: Date.now(),
      });

      const allStats = performanceMonitor.getAllStats();
      expect(Object.keys(allStats)).toEqual(['metric1', 'metric2']);
      expect(allStats.metric1.average).toBe(100);
      expect(allStats.metric2.average).toBe(200);
    });
  });

  describe('Measure Function', () => {
    it('measures synchronous function execution', async () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(75);

      const result = await performanceMonitor.measure(
        'sync-test',
        () => 'result'
      );

      expect(result).toBe('result');
      const stats = performanceMonitor.getStats('sync-test');
      expect(stats!.average).toBe(75);
      expect(stats!.count).toBe(1);
    });

    it('measures asynchronous function execution', async () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(150);

      const result = await performanceMonitor.measure(
        'async-test',
        async () =>
          new Promise(resolve => setTimeout(() => resolve('async-result'), 100))
      );

      expect(result).toBe('async-result');
      expect(performanceMonitor.getStats('async-test')!.average).toBe(150);
    });

    it('re-throws sync errors but still records the metric', async () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(50);

      await expect(
        performanceMonitor.measure('error-test', () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      expect(performanceMonitor.getStats('error-test')!.average).toBe(50);
    });

    it('re-throws async rejections but still records the metric', async () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(25);

      await expect(
        performanceMonitor.measure('reject-test', async () => {
          throw new Error('Async error');
        })
      ).rejects.toThrow('Async error');

      expect(performanceMonitor.getStats('reject-test')!.average).toBe(25);
    });

    it('passes metadata through to the recorded metric', async () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(100);

      const metadata = { operation: 'complex-calculation', items: 1000 };
      await performanceMonitor.measure('metadata-test', () => 'done', metadata);

      const recent = performanceMonitor.getRecentMetrics('metadata-test', 1);
      expect(recent[0].metadata).toEqual(metadata);
    });
  });

  describe('Helper Functions', () => {
    it('measures render performance', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(10);

      performanceMonitor.measureRender('TestComponent', { props: 'test' })();

      expect(performanceMonitor.getStats('render-TestComponent')!.average).toBe(
        10
      );
    });

    it('warns about slow renders (> 16.67ms)', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(20);

      performanceMonitor.measureRender('SlowComponent')();

      expect(logger.warn).toHaveBeenCalledWith('Slow render detected', {
        component: 'SlowComponent',
        duration: '20.00ms',
        metadata: undefined,
      });
    });

    it('does NOT warn about fast renders (< 16.67ms)', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(10);

      performanceMonitor.measureRender('FastComp')();

      const slowWarns = vi
        .mocked(logger.warn)
        .mock.calls.filter(args => String(args[0]).includes('Slow render'));
      expect(slowWarns).toHaveLength(0);
      expect(performanceMonitor.getStats('render-FastComp')!.average).toBe(10);
    });

    it('measures canvas draw operations under a canvas- prefix', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(5);

      performanceMonitor.measureCanvasDraw('polygon-render', {
        polygonCount: 50,
      })();

      expect(
        performanceMonitor.getStats('canvas-polygon-render')!.average
      ).toBe(5);
    });

    it('measures API call performance under an api- prefix', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(250);

      performanceMonitor.measureApiCall('/api/projects', { method: 'GET' })();

      expect(performanceMonitor.getStats('api-/api/projects')!.average).toBe(
        250
      );
    });
  });

  describe('Exported Helper Functions', () => {
    it('measureThumbnailRender records render-thumbnail with metadata', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(8);

      measureThumbnailRender(10, 500)();

      expect(performanceMonitor.getStats('render-thumbnail')!.average).toBe(8);
      const recent = performanceMonitor.getRecentMetrics('render-thumbnail', 1);
      expect(recent[0].metadata).toEqual({ polygonCount: 10, pointCount: 500 });
    });

    it('measureApiCall records under an api- prefix', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(120);

      measureApiCall('/users/profile', { userId: '123' })();

      expect(performanceMonitor.getStats('api-/users/profile')!.average).toBe(
        120
      );
    });

    it('measureCanvasOperation records under a canvas- prefix', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(15);

      measureCanvasOperation('image-scale', { scale: 2.5 })();

      expect(performanceMonitor.getStats('canvas-image-scale')!.average).toBe(
        15
      );
    });
  });

  describe('Recent Metrics and Reporting', () => {
    it('returns the last N recent metrics', () => {
      [1000, 2000, 3000, 4000, 5000].forEach((timestamp, index) => {
        mockDateNow.mockReturnValueOnce(timestamp);
        performanceMonitor.recordMetric({
          name: 'recent-test',
          duration: index * 10,
          timestamp,
        });
      });

      const recent = performanceMonitor.getRecentMetrics('recent-test', 3);
      expect(recent).toHaveLength(3);
      expect(recent.map(m => m.duration)).toEqual([20, 30, 40]); // last 3
    });

    it('returns an empty array of recent metrics for an unknown name', () => {
      expect(performanceMonitor.getRecentMetrics('non-existent')).toEqual([]);
    });

    it('generates a performance report of recorded metrics', () => {
      performanceMonitor.recordMetric({
        name: 'test1',
        duration: 100,
        timestamp: Date.now(),
      });
      performanceMonitor.recordMetric({
        name: 'test2',
        duration: 200,
        timestamp: Date.now(),
      });

      const report = performanceMonitor.getPerformanceReport();
      expect(report).toContain('Performance Report:');
      expect(report).toContain(
        'test1: avg=100.00ms, min=100.00ms, max=100.00ms, count=1'
      );
      expect(report).toContain(
        'test2: avg=200.00ms, min=200.00ms, max=200.00ms, count=1'
      );
    });

    it('generates an empty performance report when there are no metrics', () => {
      expect(performanceMonitor.getPerformanceReport()).toBe(
        'Performance Report:'
      );
    });
  });

  describe('Memory Usage', () => {
    it('returns memory usage when the memory API is available', () => {
      expect(performanceMonitor.getMemoryUsage()).toEqual({
        usedJSHeapSize: 1000000,
        totalJSHeapSize: 2000000,
        jsHeapSizeLimit: 4000000,
      });
    });

    it('returns null when the memory API is not available', () => {
      Object.defineProperty(global, 'performance', {
        value: { now: mockPerformanceNow },
        writable: true,
        configurable: true,
      });

      expect(performanceMonitor.getMemoryUsage()).toBeNull();
    });
  });

  describe('Warning and Logging', () => {
    it('warns about slow operations (> 1000ms)', () => {
      performanceMonitor.recordMetric({
        name: 'slow-operation',
        duration: 1500,
        timestamp: Date.now(),
        metadata: { complexity: 'high' },
      });

      expect(logger.warn).toHaveBeenCalledWith('Slow operation detected', {
        name: 'slow-operation',
        duration: '1500.00ms',
        metadata: { complexity: 'high' },
      });
    });

    it('does NOT warn about operations at or below 1000ms', () => {
      performanceMonitor.recordMetric({
        name: 'fast-op',
        duration: 999,
        timestamp: Date.now(),
      });

      const slowWarns = vi
        .mocked(logger.warn)
        .mock.calls.filter(args => String(args[0]).includes('Slow operation'));
      expect(slowWarns).toHaveLength(0);
    });

    it('logs performance in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      performanceMonitor.recordMetric({
        name: 'dev-test',
        duration: 50,
        timestamp: Date.now(),
        metadata: { env: 'development' },
      });

      expect(logger.debug).toHaveBeenCalledWith('⏱️ Performance: dev-test', {
        duration: '50.00ms',
        metadata: { env: 'development' },
      });

      process.env.NODE_ENV = originalEnv;
    });

    it('does NOT log performance in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      performanceMonitor.recordMetric({
        name: 'prod-test',
        duration: 50,
        timestamp: Date.now(),
      });

      expect(logger.debug).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('WebSocket Updates and Race Conditions', () => {
    it('records a WebSocket update with a zero-duration metric', () => {
      mockDateNow.mockReturnValue(1_500_000);
      performanceMonitor.recordWebSocketUpdate('img-abc', { extra: 'meta' });

      const stats = performanceMonitor.getStats('websocket_update');
      expect(stats!.count).toBe(1);
      expect(stats!.average).toBe(0); // duration is always 0 for WS updates
    });

    it('records a DB fetch metric but no race when there is no prior WS timing', () => {
      mockDateNow.mockReturnValue(2_000_000);
      performanceMonitor.recordDatabaseFetch('img-xyz', 120, true, 0);

      expect(performanceMonitor.getStats('database_fetch')!.count).toBe(1);
      expect(performanceMonitor.getRaceConditionStats().total).toBe(0);
    });

    it('records a race condition when the DB fetch is within 1s of the WS update', () => {
      mockDateNow.mockReturnValueOnce(1_000);
      performanceMonitor.recordWebSocketUpdate('img-race');

      mockDateNow.mockReturnValueOnce(1_500); // 500ms later — inside the window
      performanceMonitor.recordDatabaseFetch('img-race', 50, true, 0);

      const raceStats = performanceMonitor.getRaceConditionStats();
      expect(raceStats.total).toBe(1);
      expect(raceStats.averageTimeDiff).toBe(500);
    });

    it('does NOT record a race condition when the DB fetch is > 1s after the WS update', () => {
      mockDateNow.mockReturnValueOnce(0);
      performanceMonitor.recordWebSocketUpdate('img-norace');

      mockDateNow.mockReturnValueOnce(2_000); // > 1000ms — outside the window
      performanceMonitor.recordDatabaseFetch('img-norace', 200, true, 0);

      expect(performanceMonitor.getRaceConditionStats().total).toBe(0);
    });

    it('warns for a race condition with timeDiff < 100ms', () => {
      mockDateNow.mockReturnValueOnce(1_000);
      performanceMonitor.recordWebSocketUpdate('img-warn');

      mockDateNow.mockReturnValueOnce(1_050); // timeDiff = 50ms (< 100)
      performanceMonitor.recordDatabaseFetch('img-warn', 50, false, 2);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Race condition detected'),
        expect.objectContaining({ timeDiff: '50ms', retryCount: 2 })
      );
    });

    it('does NOT warn for a race condition with timeDiff >= 100ms', () => {
      mockDateNow.mockReturnValueOnce(1_000);
      performanceMonitor.recordWebSocketUpdate('img-nowarn');

      mockDateNow.mockReturnValueOnce(1_150); // timeDiff = 150ms (>= 100, < 1000)
      performanceMonitor.recordDatabaseFetch('img-nowarn', 150, true, 0);

      expect(performanceMonitor.getRaceConditionStats().total).toBe(1);
      const raceWarns = vi
        .mocked(logger.warn)
        .mock.calls.filter(args => String(args[0]).includes('Race condition'));
      expect(raceWarns).toHaveLength(0);
    });

    it('returns zeroed race-condition stats when none are recorded', () => {
      expect(performanceMonitor.getRaceConditionStats()).toEqual({
        total: 0,
        resolved: 0,
        unresolved: 0,
        averageTimeDiff: 0,
        averageRetries: 0,
      });
    });

    it('counts a resolved race condition and averages retries', () => {
      mockDateNow.mockReturnValueOnce(1_000);
      performanceMonitor.recordWebSocketUpdate('img-resolved');

      mockDateNow.mockReturnValueOnce(1_500); // diff=500 (<1000), resolved=true
      performanceMonitor.recordDatabaseFetch('img-resolved', 500, true, 2);

      const stats = performanceMonitor.getRaceConditionStats();
      expect(stats.total).toBe(1);
      expect(stats.resolved).toBe(1);
      expect(stats.unresolved).toBe(0);
      expect(stats.averageRetries).toBe(2);
    });

    it('counts an unresolved race condition', () => {
      mockDateNow.mockReturnValueOnce(2_000);
      performanceMonitor.recordWebSocketUpdate('img-unresolved');

      mockDateNow.mockReturnValueOnce(2_400); // diff=400 (<1000), resolved=false
      performanceMonitor.recordDatabaseFetch('img-unresolved', 400, false, 3);

      const stats = performanceMonitor.getRaceConditionStats();
      expect(stats.total).toBe(1);
      expect(stats.resolved).toBe(0);
      expect(stats.unresolved).toBe(1);
      expect(stats.averageRetries).toBe(3);
    });

    it('caps the raceConditions array at 100 entries (oldest evicted)', () => {
      for (let i = 0; i < 101; i++) {
        // WS at i*2, DB at i*2+50 (all within the 1000ms window)
        mockDateNow.mockReturnValueOnce(i * 2).mockReturnValueOnce(i * 2 + 50);
        performanceMonitor.recordWebSocketUpdate(`img-cap-${i}`);
        performanceMonitor.recordDatabaseFetch(`img-cap-${i}`, 50, true, 0);
      }

      expect(performanceMonitor.getRaceConditionStats().total).toBe(100);
    });

    it('clears the WS timing after race detection so a second DB fetch has no race', () => {
      mockDateNow.mockReturnValueOnce(1_000);
      performanceMonitor.recordWebSocketUpdate('img-onceonly');

      mockDateNow.mockReturnValueOnce(1_200);
      performanceMonitor.recordDatabaseFetch('img-onceonly', 200, true, 0);
      expect(performanceMonitor.getRaceConditionStats().total).toBe(1);

      // Second DB fetch for the same image — WS timing was deleted, so no new race
      mockDateNow.mockReturnValueOnce(1_300);
      performanceMonitor.recordDatabaseFetch('img-onceonly', 100, true, 0);
      expect(performanceMonitor.getRaceConditionStats().total).toBe(1);
    });

    it('forwards retryCount into the DB fetch metric metadata', () => {
      mockDateNow.mockReturnValue(9_500_000);
      performanceMonitor.recordDatabaseFetch('img-retry', 200, true, 3);

      const recent = performanceMonitor.getRecentMetrics('database_fetch', 1);
      expect(recent[0].metadata).toMatchObject({ retryCount: 3 });
    });

    it('includes the race-condition section in the performance report when races exist', () => {
      mockDateNow.mockReturnValueOnce(5_000);
      performanceMonitor.recordWebSocketUpdate('img-report');

      mockDateNow.mockReturnValueOnce(5_300); // diff=300 (<1000)
      performanceMonitor.recordDatabaseFetch('img-report', 300, true, 1);
      expect(performanceMonitor.getRaceConditionStats().total).toBe(1);

      const report = performanceMonitor.getPerformanceReport();
      expect(report).toContain('Race Condition Statistics:');
      expect(report).toContain('Total: 1');
      expect(report).toContain('Resolved: 1');
      expect(report).toContain('Unresolved: 0');
    });

    it('omits the race-condition section when none exist', () => {
      expect(performanceMonitor.getPerformanceReport()).not.toContain(
        'Race Condition Statistics:'
      );
    });
  });

  describe('Clear and Reset', () => {
    it('clears all metrics, pending timings, and race conditions', () => {
      performanceMonitor.recordMetric({
        name: 'test1',
        duration: 100,
        timestamp: Date.now(),
      });
      performanceMonitor.recordMetric({
        name: 'test2',
        duration: 200,
        timestamp: Date.now(),
      });

      const id1 = performanceMonitor.startTiming('pending1');
      const id2 = performanceMonitor.startTiming('pending2');

      // Record a race condition too
      mockDateNow.mockReturnValueOnce(1_000);
      performanceMonitor.recordWebSocketUpdate('clear-img');
      mockDateNow.mockReturnValueOnce(1_200);
      performanceMonitor.recordDatabaseFetch('clear-img', 200, true, 0);

      expect(performanceMonitor.getStats('test1')).toBeTruthy();
      expect(performanceMonitor.getRaceConditionStats().total).toBe(1);

      performanceMonitor.clear();

      expect(performanceMonitor.getStats('test1')).toBeNull();
      expect(performanceMonitor.getStats('test2')).toBeNull();
      expect(performanceMonitor.getAllStats()).toEqual({});
      expect(performanceMonitor.getRaceConditionStats().total).toBe(0);
      // Pending timings are cleared too
      expect(performanceMonitor.endTiming(id1)).toBe(0);
      expect(performanceMonitor.endTiming(id2)).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('handles very small durations', () => {
      mockPerformanceNow
        .mockReturnValueOnce(100.123)
        .mockReturnValueOnce(100.125);

      const id = performanceMonitor.startTiming('tiny-operation');
      expect(performanceMonitor.endTiming(id)).toBeCloseTo(0.002, 3);
    });

    it('handles very large durations', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(10000);

      const id = performanceMonitor.startTiming('large-operation');
      expect(performanceMonitor.endTiming(id)).toBe(10000);
      expect(performanceMonitor.getStats('large-operation')!.average).toBe(
        10000
      );
    });

    it('handles concurrent (interleaved) timing operations', () => {
      mockPerformanceNow
        .mockReturnValueOnce(0) // start id1
        .mockReturnValueOnce(10) // start id2
        .mockReturnValueOnce(30) // end id1
        .mockReturnValueOnce(50); // end id2

      const id1 = performanceMonitor.startTiming('concurrent1');
      const id2 = performanceMonitor.startTiming('concurrent2');

      expect(performanceMonitor.endTiming(id1)).toBe(30);
      expect(performanceMonitor.endTiming(id2)).toBe(40);
    });

    it('handles negative durations without dropping the metric', () => {
      // Shouldn't happen normally, but exercise defensive coding
      mockPerformanceNow.mockReturnValueOnce(100).mockReturnValueOnce(50);

      const id = performanceMonitor.startTiming('negative-test');
      expect(performanceMonitor.endTiming(id)).toBe(-50);
      expect(performanceMonitor.getStats('negative-test')).toBeTruthy();
    });

    it('accumulates statistics over multiple start/end operations', () => {
      [10, 20, 30, 40, 50].forEach((duration, index) => {
        mockPerformanceNow
          .mockReturnValueOnce(index * 100)
          .mockReturnValueOnce(index * 100 + duration);

        const id = performanceMonitor.startTiming('accumulated-test');
        performanceMonitor.endTiming(id);
      });

      const stats = performanceMonitor.getStats('accumulated-test');
      expect(stats!.count).toBe(5);
      expect(stats!.average).toBe(30);
      expect(stats!.min).toBe(10);
      expect(stats!.max).toBe(50);
      expect(stats!.total).toBe(150);
    });
  });
});
