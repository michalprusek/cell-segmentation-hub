import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  performanceMonitor,
  measureThumbnailRender,
  measureApiCall,
  measureCanvasOperation,
} from '@/lib/performanceMonitor';

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('PerformanceMonitor', () => {
  let mockPerformanceNow: ReturnType<typeof vi.fn>;
  let mockDateNow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock performance.now
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
    });

    // Mock Date.now
    mockDateNow = vi.fn().mockReturnValue(1000000);
    Date.now = mockDateNow;

    // Clear any existing metrics
    performanceMonitor.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    performanceMonitor.clear();
  });

  describe('Basic Timing Operations', () => {
    test('should start and end timing successfully', () => {
      mockPerformanceNow.mockReturnValueOnce(100).mockReturnValueOnce(150);

      const id = performanceMonitor.startTiming('test-operation');
      expect(id).toMatch(/^test-operation-\d+-[a-z0-9]+$/);

      const duration = performanceMonitor.endTiming(id);
      expect(duration).toBe(50);
    });

    test('should generate unique timing IDs', () => {
      const id1 = performanceMonitor.startTiming('test');
      const id2 = performanceMonitor.startTiming('test');

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^test-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^test-\d+-[a-z0-9]+$/);
    });

    test('should handle metadata in timing operations', () => {
      const metadata = { componentName: 'TestComponent', count: 5 };

      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(100);

      const id = performanceMonitor.startTiming('test-with-metadata', metadata);
      const duration = performanceMonitor.endTiming(id);

      expect(duration).toBe(100);

      const stats = performanceMonitor.getStats('test-with-metadata');
      expect(stats).toBeTruthy();
      expect(stats!.count).toBe(1);
    });

    test('should return 0 for invalid timing ID', async () => {
      // Import the mocked logger from the already mocked module
      const { logger } = await import('@/lib/logger');

      const duration = performanceMonitor.endTiming('invalid-id');

      expect(duration).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith('Performance timing not found', {
        id: 'invalid-id',
      });
    });

    test('should clean up pending timings after ending', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(50);

      const id = performanceMonitor.startTiming('cleanup-test');
      performanceMonitor.endTiming(id);

      // Trying to end the same timing again should return 0
      const secondDuration = performanceMonitor.endTiming(id);
      expect(secondDuration).toBe(0);
    });
  });

  describe('Metric Recording and Statistics', () => {
    test('should record metrics correctly', () => {
      const metric = {
        name: 'test-metric',
        duration: 125.5,
        timestamp: Date.now(),
        metadata: { test: true },
      };

      performanceMonitor.recordMetric(metric);

      const stats = performanceMonitor.getStats('test-metric');
      expect(stats).toEqual({
        average: 125.5,
        min: 125.5,
        max: 125.5,
        count: 1,
        total: 125.5,
      });
    });

    test('should calculate statistics for multiple metrics', () => {
      const metrics = [
        { name: 'multi-test', duration: 100, timestamp: Date.now() },
        { name: 'multi-test', duration: 200, timestamp: Date.now() },
        { name: 'multi-test', duration: 300, timestamp: Date.now() },
      ];

      metrics.forEach(metric => performanceMonitor.recordMetric(metric));

      const stats = performanceMonitor.getStats('multi-test');
      expect(stats).toEqual({
        average: 200,
        min: 100,
        max: 300,
        count: 3,
        total: 600,
      });
    });

    test('should return null for non-existent metrics', () => {
      const stats = performanceMonitor.getStats('non-existent');
      expect(stats).toBeNull();
    });

    test('should limit metrics to max count per type', () => {
      // Record more than maxMetricsPerType (100) metrics
      for (let i = 0; i < 150; i++) {
        performanceMonitor.recordMetric({
          name: 'limit-test',
          duration: i,
          timestamp: Date.now() + i,
        });
      }

      const stats = performanceMonitor.getStats('limit-test');
      expect(stats!.count).toBe(100); // Should be limited to 100

      // Should keep the latest metrics (50-149)
      expect(stats!.min).toBe(50);
      expect(stats!.max).toBe(149);
    });

    test('should get all statistics', () => {
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
    test('should measure synchronous function execution', async () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(75);

      const syncFunction = () => 'result';
      const result = await performanceMonitor.measure(
        'sync-test',
        syncFunction
      );

      expect(result).toBe('result');

      const stats = performanceMonitor.getStats('sync-test');
      expect(stats!.average).toBe(75);
      expect(stats!.count).toBe(1);
    });

    test('should measure asynchronous function execution', async () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(150);

      const asyncFunction = async () => {
        return new Promise(resolve =>
          setTimeout(() => resolve('async-result'), 100)
        );
      };

      const result = await performanceMonitor.measure(
        'async-test',
        asyncFunction
      );

      expect(result).toBe('async-result');

      const stats = performanceMonitor.getStats('async-test');
      expect(stats!.average).toBe(150);
    });

    test('should handle function that throws error', async () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(50);

      const errorFunction = () => {
        throw new Error('Test error');
      };

      await expect(
        performanceMonitor.measure('error-test', errorFunction)
      ).rejects.toThrow('Test error');

      // Should still record the metric even when function throws
      const stats = performanceMonitor.getStats('error-test');
      expect(stats!.average).toBe(50);
    });

    test('should handle async function that rejects', async () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(25);

      const rejectFunction = async () => {
        throw new Error('Async error');
      };

      await expect(
        performanceMonitor.measure('reject-test', rejectFunction)
      ).rejects.toThrow('Async error');

      const stats = performanceMonitor.getStats('reject-test');
      expect(stats!.average).toBe(25);
    });

    test('should include metadata in measure operation', async () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(100);

      const metadata = { operation: 'complex-calculation', items: 1000 };
      const testFunction = () => 'done';

      await performanceMonitor.measure('metadata-test', testFunction, metadata);

      const recent = performanceMonitor.getRecentMetrics('metadata-test', 1);
      expect(recent[0].metadata).toEqual(metadata);
    });
  });

  describe('Helper Functions', () => {
    test('should measure render performance', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(10);

      const endRenderMeasurement = performanceMonitor.measureRender(
        'TestComponent',
        {
          props: 'test',
        }
      );

      endRenderMeasurement();

      const stats = performanceMonitor.getStats('render-TestComponent');
      expect(stats!.average).toBe(10);
    });

    test('should warn about slow renders', async () => {
      const { logger } = await import('@/lib/logger');
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(20); // > 16.67ms

      const endRenderMeasurement =
        performanceMonitor.measureRender('SlowComponent');
      endRenderMeasurement();

      expect(logger.warn).toHaveBeenCalledWith('Slow render detected', {
        component: 'SlowComponent',
        duration: '20.00ms',
        metadata: undefined,
      });
    });

    test('should measure canvas draw operations', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(5);

      const endCanvasMeasurement = performanceMonitor.measureCanvasDraw(
        'polygon-render',
        {
          polygonCount: 50,
        }
      );

      endCanvasMeasurement();

      const stats = performanceMonitor.getStats('canvas-polygon-render');
      expect(stats!.average).toBe(5);
    });

    test('should measure API call performance', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(250);

      const endApiMeasurement = performanceMonitor.measureApiCall(
        '/api/projects',
        {
          method: 'GET',
        }
      );

      endApiMeasurement();

      const stats = performanceMonitor.getStats('api-/api/projects');
      expect(stats!.average).toBe(250);
    });
  });

  describe('Exported Helper Functions', () => {
    test('measureThumbnailRender should work correctly', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(8);

      const endMeasurement = measureThumbnailRender(10, 500);
      endMeasurement();

      const stats = performanceMonitor.getStats('render-thumbnail');
      expect(stats!.average).toBe(8);

      const recent = performanceMonitor.getRecentMetrics('render-thumbnail', 1);
      expect(recent[0].metadata).toEqual({
        polygonCount: 10,
        pointCount: 500,
      });
    });

    test('measureApiCall should work correctly', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(120);

      const endMeasurement = measureApiCall('/users/profile', {
        userId: '123',
      });
      endMeasurement();

      const stats = performanceMonitor.getStats('api-/users/profile');
      expect(stats!.average).toBe(120);
    });

    test('measureCanvasOperation should work correctly', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(15);

      const endMeasurement = measureCanvasOperation('image-scale', {
        scale: 2.5,
      });
      endMeasurement();

      const stats = performanceMonitor.getStats('canvas-image-scale');
      expect(stats!.average).toBe(15);
    });
  });

  describe('Recent Metrics and Reporting', () => {
    test('should get recent metrics', () => {
      const timestamps = [1000, 2000, 3000, 4000, 5000];

      timestamps.forEach((timestamp, index) => {
        mockDateNow.mockReturnValueOnce(timestamp);
        performanceMonitor.recordMetric({
          name: 'recent-test',
          duration: index * 10,
          timestamp,
        });
      });

      const recent = performanceMonitor.getRecentMetrics('recent-test', 3);
      expect(recent).toHaveLength(3);
      expect(recent.map(m => m.duration)).toEqual([20, 30, 40]); // Last 3
    });

    test('should return empty array for non-existent metrics', () => {
      const recent = performanceMonitor.getRecentMetrics('non-existent');
      expect(recent).toEqual([]);
    });

    test('should generate performance report', () => {
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

    test('should handle empty performance report', () => {
      const report = performanceMonitor.getPerformanceReport();
      expect(report).toBe('Performance Report:');
    });
  });

  describe('Memory Usage', () => {
    test('should get memory usage when available', () => {
      const memory = performanceMonitor.getMemoryUsage();

      expect(memory).toEqual({
        usedJSHeapSize: 1000000,
        totalJSHeapSize: 2000000,
        jsHeapSizeLimit: 4000000,
      });
    });

    test('should return null when memory API is not available', () => {
      Object.defineProperty(global, 'performance', {
        value: { now: mockPerformanceNow },
        writable: true,
      });

      const memory = performanceMonitor.getMemoryUsage();
      expect(memory).toBeNull();
    });
  });

  describe('Warning and Logging', () => {
    test('should warn about slow operations', async () => {
      const { logger } = await import('@/lib/logger');

      performanceMonitor.recordMetric({
        name: 'slow-operation',
        duration: 1500, // > 1000ms
        timestamp: Date.now(),
        metadata: { complexity: 'high' },
      });

      expect(logger.warn).toHaveBeenCalledWith('Slow operation detected', {
        name: 'slow-operation',
        duration: '1500.00ms',
        metadata: { complexity: 'high' },
      });
    });

    test('should log performance in development mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const { logger } = await import('@/lib/logger');

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

    test('should not log performance in production mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const { logger } = await import('@/lib/logger');

      performanceMonitor.recordMetric({
        name: 'prod-test',
        duration: 50,
        timestamp: Date.now(),
      });

      expect(logger.debug).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Clear and Reset', () => {
    test('should clear all metrics and pending timings', () => {
      // Add some metrics
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

      // Start some timings
      const id1 = performanceMonitor.startTiming('pending1');
      const id2 = performanceMonitor.startTiming('pending2');

      // Verify data exists
      expect(performanceMonitor.getStats('test1')).toBeTruthy();
      expect(performanceMonitor.getStats('test2')).toBeTruthy();

      // Clear everything
      performanceMonitor.clear();

      // Verify everything is cleared
      expect(performanceMonitor.getStats('test1')).toBeNull();
      expect(performanceMonitor.getStats('test2')).toBeNull();
      expect(performanceMonitor.getAllStats()).toEqual({});

      // Pending timings should also be cleared
      expect(performanceMonitor.endTiming(id1)).toBe(0);
      expect(performanceMonitor.endTiming(id2)).toBe(0);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle very small durations', () => {
      mockPerformanceNow
        .mockReturnValueOnce(100.123)
        .mockReturnValueOnce(100.125);

      const id = performanceMonitor.startTiming('tiny-operation');
      const duration = performanceMonitor.endTiming(id);

      expect(duration).toBeCloseTo(0.002, 3);
    });

    test('should handle very large durations', () => {
      mockPerformanceNow.mockReturnValueOnce(0).mockReturnValueOnce(10000);

      const id = performanceMonitor.startTiming('large-operation');
      const duration = performanceMonitor.endTiming(id);

      expect(duration).toBe(10000);

      const stats = performanceMonitor.getStats('large-operation');
      expect(stats!.average).toBe(10000);
    });

    test('should handle concurrent timing operations', () => {
      mockPerformanceNow
        .mockReturnValueOnce(0) // start id1
        .mockReturnValueOnce(10) // start id2
        .mockReturnValueOnce(30) // end id1
        .mockReturnValueOnce(50); // end id2

      const id1 = performanceMonitor.startTiming('concurrent1');
      const id2 = performanceMonitor.startTiming('concurrent2');

      const duration1 = performanceMonitor.endTiming(id1);
      const duration2 = performanceMonitor.endTiming(id2);

      expect(duration1).toBe(30);
      expect(duration2).toBe(40);
    });

    test('should handle negative durations gracefully', () => {
      // This shouldn't happen in normal circumstances but test defensive coding
      mockPerformanceNow.mockReturnValueOnce(100).mockReturnValueOnce(50);

      const id = performanceMonitor.startTiming('negative-test');
      const duration = performanceMonitor.endTiming(id);

      expect(duration).toBe(-50);

      // Should still record the metric
      const stats = performanceMonitor.getStats('negative-test');
      expect(stats).toBeTruthy();
    });

    test('should handle special characters in metric names', () => {
      const specialName = 'test-🚀-metric/api@endpoint:port';

      performanceMonitor.recordMetric({
        name: specialName,
        duration: 100,
        timestamp: Date.now(),
      });

      const stats = performanceMonitor.getStats(specialName);
      expect(stats!.average).toBe(100);
    });

    test('should handle circular references in metadata', () => {
      const circularMetadata: any = { test: 'value' };
      circularMetadata.self = circularMetadata;

      expect(() => {
        performanceMonitor.recordMetric({
          name: 'circular-test',
          duration: 100,
          timestamp: Date.now(),
          metadata: circularMetadata,
        });
      }).not.toThrow();
    });

    test('should handle very large metadata objects', () => {
      const largeMetadata: Record<string, any> = {};
      for (let i = 0; i < 1000; i++) {
        largeMetadata[`key${i}`] = `value${i}`.repeat(100);
      }

      expect(() => {
        performanceMonitor.recordMetric({
          name: 'large-metadata-test',
          duration: 100,
          timestamp: Date.now(),
          metadata: largeMetadata,
        });
      }).not.toThrow();
    });
  });

  describe('Integration Scenarios', () => {
    test('should handle typical render measurement workflow', () => {
      mockPerformanceNow
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(5)
        .mockReturnValueOnce(10)
        .mockReturnValueOnce(18);

      // Measure fast render
      const endFastRender = performanceMonitor.measureRender('FastComponent');
      endFastRender();

      // Measure slow render
      const endSlowRender = performanceMonitor.measureRender('SlowComponent');
      endSlowRender();

      const fastStats = performanceMonitor.getStats('render-FastComponent');
      const slowStats = performanceMonitor.getStats('render-SlowComponent');

      expect(fastStats!.average).toBe(5);
      expect(slowStats!.average).toBe(8);
    });

    test('should handle typical API monitoring workflow', () => {
      mockPerformanceNow
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(150)
        .mockReturnValueOnce(200)
        .mockReturnValueOnce(500);

      // Measure fast API call
      const endFastApi = performanceMonitor.measureApiCall('/api/fast');
      endFastApi();

      // Measure slow API call
      const endSlowApi = performanceMonitor.measureApiCall('/api/slow');
      endSlowApi();

      const allStats = performanceMonitor.getAllStats();
      expect(allStats['api-/api/fast'].average).toBe(150);
      expect(allStats['api-/api/slow'].average).toBe(300);
    });

    test('should accumulate statistics over multiple operations', () => {
      const durations = [10, 20, 30, 40, 50];

      durations.forEach((duration, index) => {
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
