/**
 * Performance Tests for Universal Cancel Functionality
 * Measures response time, memory usage, and throughput for cancel operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { performance } from 'perf_hooks';

import { cancelTestUtils } from '@/test-utils/cancelTestHelpers';
import {
  segmentationScenarios,
  performanceBenchmarks,
} from '@/test-fixtures/cancelScenarios';

// Performance test configuration
const PERFORMANCE_CONFIG = {
  iterations: {
    light: 10,
    medium: 50,
    heavy: 100,
  },
  thresholds: {
    cancelResponseTime: {
      upload: 200, // ms
      segmentation: 500, // ms
      export: 1000, // ms
    },
    memoryUsage: {
      maxIncrease: 10 * 1024 * 1024, // 10MB
      cleanupEfficiency: 95, // 95%
    },
    throughput: {
      operationsPerSecond: 100,
      concurrentOperations: 50,
    },
  },
  testSuites: {
    smoke: 'Quick performance validation',
    load: 'Normal load performance testing',
    stress: 'High load stress testing',
    endurance: 'Long-running endurance testing',
  },
};

// Performance measurement utilities
class PerformanceProfiler {
  private measurements: Map<string, number[]> = new Map();
  private memoryBaseline: number = 0;

  startMeasurement(testName: string) {
    if (typeof performance !== 'undefined' && performance.now) {
      return performance.now();
    }
    return Date.now();
  }

  endMeasurement(testName: string, startTime: number) {
    const endTime =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
    const duration = endTime - startTime;

    if (!this.measurements.has(testName)) {
      this.measurements.set(testName, []);
    }
    this.measurements.get(testName)!.push(duration);

    return duration;
  }

  getStatistics(testName: string) {
    const measurements = this.measurements.get(testName) || [];
    if (measurements.length === 0) {
      return null;
    }

    const sorted = [...measurements].sort((a, b) => a - b);
    return {
      count: measurements.length,
      min: Math.min(...measurements),
      max: Math.max(...measurements),
      average:
        measurements.reduce((sum, val) => sum + val, 0) / measurements.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  captureMemoryBaseline() {
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      this.memoryBaseline = (performance as any).memory.usedJSHeapSize;
    }
  }

  getMemoryUsage() {
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      const current = (performance as any).memory.usedJSHeapSize;
      return {
        current,
        baseline: this.memoryBaseline,
        increase: current - this.memoryBaseline,
        total: (performance as any).memory.totalJSHeapSize,
      };
    }
    return null;
  }

  reset() {
    this.measurements.clear();
    this.memoryBaseline = 0;
  }
}

// Stress testing utilities
class StressTestRunner {
  async runConcurrentOperations(
    operationFactory: () => Promise<void>,
    concurrency: number,
    duration: number
  ) {
    const startTime = Date.now();
    const endTime = startTime + duration;
    const results: Array<{
      success: boolean;
      duration: number;
      error?: Error;
    }> = [];

    const workers: Promise<void>[] = [];

    for (let i = 0; i < concurrency; i++) {
      workers.push(this.worker(operationFactory, endTime, results));
    }

    await Promise.all(workers);

    const successCount = results.filter(r => r.success).length;
    const averageDuration =
      results.length > 0
        ? results.reduce((sum, r) => sum + r.duration, 0) / results.length
        : 0;

    return {
      totalOperations: results.length,
      successfulOperations: successCount,
      failedOperations: results.length - successCount,
      successRate: (successCount / results.length) * 100,
      averageDuration,
      operationsPerSecond: results.length / (duration / 1000),
    };
  }

  private async worker(
    operationFactory: () => Promise<void>,
    endTime: number,
    results: Array<{ success: boolean; duration: number; error?: Error }>
  ) {
    while (Date.now() < endTime) {
      const startTime = Date.now();
      try {
        await operationFactory();
        results.push({
          success: true,
          duration: Date.now() - startTime,
        });
      } catch (error) {
        results.push({
          success: false,
          duration: Date.now() - startTime,
          error: error as Error,
        });
      }

      // Small delay to prevent overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }
}

describe('Cancel Performance Tests', () => {
  let profiler: PerformanceProfiler;
  let stressRunner: StressTestRunner;
  let mockOperationManager: any;

  beforeEach(() => {
    profiler = new PerformanceProfiler();
    stressRunner = new StressTestRunner();
    mockOperationManager = cancelTestUtils.createMockOperationManager();

    profiler.captureMemoryBaseline();
    vi.clearAllMocks();
  });

  afterEach(() => {
    profiler.reset();
  });

  describe('Response Time Performance', () => {
    it('should cancel upload operations within performance threshold', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );

      for (let i = 0; i < PERFORMANCE_CONFIG.iterations.medium; i++) {
        await act(async () => {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .uploadOperation({
              id: `upload-perf-${i}`,
            });

          const operationId = result.current.registerOperation(operation);

          const startTime = profiler.startMeasurement('upload-cancel');
          await result.current.cancelOperation(operationId);
          profiler.endMeasurement('upload-cancel', startTime);
        });
      }

      const stats = profiler.getStatistics('upload-cancel');
      expect(stats).toBeTruthy();
      expect(stats!.average).toBeLessThan(
        PERFORMANCE_CONFIG.thresholds.cancelResponseTime.upload
      );
      expect(stats!.p95).toBeLessThan(
        PERFORMANCE_CONFIG.thresholds.cancelResponseTime.upload * 2
      );
    });

    it('should cancel segmentation operations within performance threshold', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );

      for (let i = 0; i < PERFORMANCE_CONFIG.iterations.medium; i++) {
        await act(async () => {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .segmentationOperation({
              id: `segmentation-perf-${i}`,
            });

          const operationId = result.current.registerOperation(operation);

          const startTime = profiler.startMeasurement('segmentation-cancel');
          await result.current.cancelOperation(operationId);
          profiler.endMeasurement('segmentation-cancel', startTime);
        });
      }

      const stats = profiler.getStatistics('segmentation-cancel');
      expect(stats).toBeTruthy();
      expect(stats!.average).toBeLessThan(
        PERFORMANCE_CONFIG.thresholds.cancelResponseTime.segmentation
      );
      expect(stats!.p95).toBeLessThan(
        PERFORMANCE_CONFIG.thresholds.cancelResponseTime.segmentation * 2
      );
    });

    it('should cancel export operations within performance threshold', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );

      for (let i = 0; i < PERFORMANCE_CONFIG.iterations.medium; i++) {
        await act(async () => {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .exportOperation({
              id: `export-perf-${i}`,
            });

          const operationId = result.current.registerOperation(operation);

          const startTime = profiler.startMeasurement('export-cancel');
          await result.current.cancelOperation(operationId);
          profiler.endMeasurement('export-cancel', startTime);
        });
      }

      const stats = profiler.getStatistics('export-cancel');
      expect(stats).toBeTruthy();
      expect(stats!.average).toBeLessThan(
        PERFORMANCE_CONFIG.thresholds.cancelResponseTime.export
      );
      expect(stats!.p95).toBeLessThan(
        PERFORMANCE_CONFIG.thresholds.cancelResponseTime.export * 2
      );
    });

    it('should handle batch cancellation efficiently', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );
      const batchSize = 50;

      await act(async () => {
        // Register batch operations
        const operationIds: string[] = [];
        for (let i = 0; i < batchSize; i++) {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .segmentationOperation({
              id: `batch-perf-${i}`,
            });
          operationIds.push(result.current.registerOperation(operation));
        }

        // Cancel all at once
        const startTime = profiler.startMeasurement('batch-cancel');
        await result.current.cancelAllOperations();
        profiler.endMeasurement('batch-cancel', startTime);
      });

      const stats = profiler.getStatistics('batch-cancel');
      expect(stats).toBeTruthy();
      expect(stats!.average).toBeLessThan(2000); // Should complete batch cancel in less than 2 seconds
    });
  });

  describe('Memory Usage Performance', () => {
    it('should not leak memory during frequent cancellations', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );

      const initialMemory = profiler.getMemoryUsage();

      for (let i = 0; i < PERFORMANCE_CONFIG.iterations.heavy; i++) {
        await act(async () => {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .uploadOperation({
              id: `memory-test-${i}`,
            });

          const operationId = result.current.registerOperation(operation);
          await result.current.cancelOperation(operationId);

          // Force cleanup
          result.current.removeOperation(operationId);
        });

        // Periodic garbage collection hint
        if (i % 20 === 0 && global.gc) {
          global.gc();
        }
      }

      const finalMemory = profiler.getMemoryUsage();

      if (initialMemory && finalMemory) {
        const memoryIncrease = finalMemory.increase;
        expect(memoryIncrease).toBeLessThan(
          PERFORMANCE_CONFIG.thresholds.memoryUsage.maxIncrease
        );
      }
    });

    it('should efficiently clean up operation data', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );

      // Create many operations
      const operationIds: string[] = [];
      await act(async () => {
        for (let i = 0; i < 1000; i++) {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .mixedOperations(1)[0];
          operation.id = `cleanup-test-${i}`;
          operationIds.push(result.current.registerOperation(operation));
        }
      });

      expect(result.current.stats.total).toBe(1000);

      // Cancel and cleanup all operations
      await act(async () => {
        await result.current.cancelAllOperations();
        result.current.cleanup();
      });

      expect(result.current.stats.total).toBe(0);

      const memoryAfterCleanup = profiler.getMemoryUsage();
      if (memoryAfterCleanup) {
        expect(memoryAfterCleanup.increase).toBeLessThan(5 * 1024 * 1024); // Less than 5MB increase
      }
    });

    it('should handle large operation metadata efficiently', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );

      const largeMetadata = {
        largeArray: new Array(10000)
          .fill(0)
          .map((_, i) => ({ id: i, data: `data-${i}` })),
        largeString: 'x'.repeat(100000),
        deepObject: {
          level1: {
            level2: {
              level3: new Array(1000).fill({
                key: 'value',
                data: 'test'.repeat(100),
              }),
            },
          },
        },
      };

      await act(async () => {
        for (let i = 0; i < 10; i++) {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .uploadOperation({
              id: `large-metadata-${i}`,
              metadata: largeMetadata,
            });

          const operationId = result.current.registerOperation(operation);

          const startTime = profiler.startMeasurement('large-metadata-cancel');
          await result.current.cancelOperation(operationId);
          profiler.endMeasurement('large-metadata-cancel', startTime);

          result.current.removeOperation(operationId);
        }
      });

      const stats = profiler.getStatistics('large-metadata-cancel');
      expect(stats).toBeTruthy();
      expect(stats!.average).toBeLessThan(500); // Should handle large metadata efficiently
    });
  });

  describe('Throughput Performance', () => {
    it('should handle high-frequency cancel operations', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );

      const operationFactory = async () => {
        const operation = cancelTestUtils
          .createTestDataFactories()
          .uploadOperation();
        const operationId = result.current.registerOperation(operation);
        await result.current.cancelOperation(operationId);
        result.current.removeOperation(operationId);
      };

      const results = await stressRunner.runConcurrentOperations(
        operationFactory,
        10, // 10 concurrent workers
        5000 // 5 seconds
      );

      expect(results.successRate).toBeGreaterThan(95); // 95% success rate
      expect(results.operationsPerSecond).toBeGreaterThan(50); // At least 50 ops/sec
    });

    it('should maintain performance under concurrent load', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );

      const concurrentOperations =
        PERFORMANCE_CONFIG.thresholds.throughput.concurrentOperations;
      const operationPromises: Promise<void>[] = [];

      const startTime = profiler.startMeasurement('concurrent-load');

      // Start many operations concurrently
      for (let i = 0; i < concurrentOperations; i++) {
        const operationPromise = act(async () => {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .segmentationOperation({
              id: `concurrent-${i}`,
            });

          const operationId = result.current.registerOperation(operation);
          await result.current.cancelOperation(operationId);
        });

        operationPromises.push(operationPromise);
      }

      await Promise.all(operationPromises);
      const totalTime = profiler.endMeasurement('concurrent-load', startTime);

      const operationsPerSecond = (concurrentOperations / totalTime) * 1000;
      expect(operationsPerSecond).toBeGreaterThan(20); // At least 20 concurrent ops/sec
    });

    it('should scale with operation volume', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );

      const volumes = [10, 50, 100, 200];
      const performanceResults: { volume: number; opsPerSecond: number }[] = [];

      for (const volume of volumes) {
        const startTime = profiler.startMeasurement(`volume-${volume}`);

        await act(async () => {
          const operations = cancelTestUtils
            .createTestDataFactories()
            .mixedOperations(volume);
          const operationIds = operations.map(op =>
            result.current.registerOperation(op)
          );
          await result.current.cancelAllOperations();

          // Cleanup
          operationIds.forEach(id => result.current.removeOperation(id));
        });

        const duration = profiler.endMeasurement(`volume-${volume}`, startTime);
        const opsPerSecond = (volume / duration) * 1000;

        performanceResults.push({ volume, opsPerSecond });
      }

      // Performance should not degrade significantly with volume
      for (let i = 1; i < performanceResults.length; i++) {
        const current = performanceResults[i];
        const previous = performanceResults[i - 1];

        // Performance degradation should be less than 50%
        const performanceRatio = current.opsPerSecond / previous.opsPerSecond;
        expect(performanceRatio).toBeGreaterThan(0.5);
      }
    });
  });

  describe('Stress Testing', () => {
    it('should survive rapid cancel/restart cycles', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );

      const cycles = 100;
      const errors: Error[] = [];

      for (let i = 0; i < cycles; i++) {
        try {
          await act(async () => {
            // Create operation
            const operation = cancelTestUtils
              .createTestDataFactories()
              .uploadOperation({
                id: `stress-cycle-${i}`,
              });

            const operationId = result.current.registerOperation(operation);

            // Immediately cancel
            await result.current.cancelOperation(operationId);

            // Immediately create another
            const nextOperation = cancelTestUtils
              .createTestDataFactories()
              .uploadOperation({
                id: `stress-cycle-${i}-next`,
              });

            const nextOperationId =
              result.current.registerOperation(nextOperation);
            await result.current.cancelOperation(nextOperationId);

            // Cleanup
            result.current.removeOperation(operationId);
            result.current.removeOperation(nextOperationId);
          });
        } catch (error) {
          errors.push(error as Error);
        }
      }

      // Should handle rapid cycles with minimal errors
      expect(errors.length).toBeLessThan(cycles * 0.05); // Less than 5% error rate
    });

    it('should handle extreme concurrency', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );

      const extremeConcurrency = 200;
      const promises: Promise<void>[] = [];

      const startTime = Date.now();

      for (let i = 0; i < extremeConcurrency; i++) {
        const promise = act(async () => {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .segmentationOperation({
              id: `extreme-${i}`,
            });

          const operationId = result.current.registerOperation(operation);

          // Add some variability in timing
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10));

          await result.current.cancelOperation(operationId);
        });

        promises.push(promise);
      }

      const settledResults = await Promise.allSettled(promises);
      const successCount = settledResults.filter(
        r => r.status === 'fulfilled'
      ).length;
      const totalTime = Date.now() - startTime;

      // Should handle extreme concurrency with reasonable success rate
      expect(successCount / extremeConcurrency).toBeGreaterThan(0.8); // 80% success rate
      expect(totalTime).toBeLessThan(10000); // Complete in less than 10 seconds
    });

    it('should recover from error conditions', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );

      // Simulate various error conditions
      const errorConditions = [
        () => Promise.reject(new Error('Network error')),
        () => Promise.reject(new Error('Timeout error')),
        () => Promise.reject(new Error('Server error')),
        () => Promise.reject(new DOMException('AbortError')),
      ];

      let successfulRecoveries = 0;

      for (let i = 0; i < 20; i++) {
        try {
          await act(async () => {
            const operation = cancelTestUtils
              .createTestDataFactories()
              .exportOperation({
                id: `recovery-test-${i}`,
              });

            const operationId = result.current.registerOperation(operation);

            // Randomly inject errors
            if (Math.random() < 0.3) {
              const errorCondition =
                errorConditions[
                  Math.floor(Math.random() * errorConditions.length)
                ];
              await errorCondition();
            }

            await result.current.cancelOperation(operationId);
            successfulRecoveries++;
          });
        } catch (error) {
          // Error recovery test - continue
        }
      }

      // Should recover from most error conditions
      expect(successfulRecoveries).toBeGreaterThan(10);
    });
  });

  describe('Real-world Scenario Performance', () => {
    it('should handle typical user workflow efficiently', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );

      // Simulate typical user workflow: upload -> segment -> export -> cancel export
      const workflowStart = profiler.startMeasurement('user-workflow');

      await act(async () => {
        // Upload phase
        const uploadOp = cancelTestUtils
          .createTestDataFactories()
          .uploadOperation();
        const uploadId = result.current.registerOperation(uploadOp);

        // Simulate upload completion
        result.current.updateOperation(uploadId, {
          status: 'completed',
          progress: 100,
        });

        // Segmentation phase
        const segmentationOp = cancelTestUtils
          .createTestDataFactories()
          .segmentationOperation();
        const segmentationId = result.current.registerOperation(segmentationOp);

        // Simulate segmentation completion
        result.current.updateOperation(segmentationId, {
          status: 'completed',
          progress: 100,
        });

        // Export phase
        const exportOp = cancelTestUtils
          .createTestDataFactories()
          .exportOperation();
        const exportId = result.current.registerOperation(exportOp);

        // User cancels export
        await result.current.cancelOperation(exportId);
      });

      const workflowTime = profiler.endMeasurement(
        'user-workflow',
        workflowStart
      );

      // Typical workflow should complete quickly
      expect(workflowTime).toBeLessThan(1000); // Less than 1 second
    });

    it('should handle high-volume batch processing', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );
      const { operations } = segmentationScenarios.highVolumeSegmentation;

      const batchStart = profiler.startMeasurement('high-volume-batch');

      await act(async () => {
        // Register large batch
        const operationIds = operations.slice(0, 100).map(op =>
          result.current.registerOperation({
            id: op.id,
            type: op.type,
            status: op.status as any,
            progress: op.progress,
            startTime: op.startTime,
            endTime: op.endTime,
          })
        );

        // Cancel entire batch
        await result.current.cancelAllOperations();
      });

      const batchTime = profiler.endMeasurement(
        'high-volume-batch',
        batchStart
      );

      // High volume batch should complete within reasonable time
      expect(batchTime).toBeLessThan(5000); // Less than 5 seconds for 100 operations
    });

    it('should maintain performance during extended usage', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );

      const sessionDuration = 30000; // 30 seconds
      const sessionStart = Date.now();
      const performanceSamples: number[] = [];

      while (Date.now() - sessionStart < sessionDuration) {
        const operationStart = profiler.startMeasurement('extended-session');

        await act(async () => {
          // Simulate mixed operations
          const operations = cancelTestUtils
            .createTestDataFactories()
            .mixedOperations(5);
          const operationIds = operations.map(op =>
            result.current.registerOperation(op)
          );

          // Cancel some operations
          const operationsToCancel = operationIds.slice(0, 3);
          for (const opId of operationsToCancel) {
            await result.current.cancelOperation(opId);
          }

          // Complete others
          const operationsToComplete = operationIds.slice(3);
          operationsToComplete.forEach(opId => {
            result.current.updateOperation(opId, {
              status: 'completed',
              progress: 100,
            });
          });

          // Cleanup
          result.current.cleanup();
        });

        const operationTime = profiler.endMeasurement(
          'extended-session',
          operationStart
        );
        performanceSamples.push(operationTime);

        // Small delay between operations
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Performance should remain stable over time
      const firstHalf = performanceSamples.slice(
        0,
        Math.floor(performanceSamples.length / 2)
      );
      const secondHalf = performanceSamples.slice(
        Math.floor(performanceSamples.length / 2)
      );

      const firstHalfAvg =
        firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
      const secondHalfAvg =
        secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;

      // Performance degradation should be minimal
      expect(secondHalfAvg / firstHalfAvg).toBeLessThan(2); // Less than 2x degradation
    });
  });

  describe('Performance Monitoring and Reporting', () => {
    it('should provide performance metrics', () => {
      const testResults = {
        upload: profiler.getStatistics('upload-cancel'),
        segmentation: profiler.getStatistics('segmentation-cancel'),
        export: profiler.getStatistics('export-cancel'),
      };

      // Each operation type should have performance data
      expect(testResults.upload).toBeTruthy();
      expect(testResults.segmentation).toBeTruthy();
      expect(testResults.export).toBeTruthy();
    });

    it('should track performance regression', async () => {
      const { result } = renderHook(() =>
        cancelTestUtils.createMockOperationManager()
      );

      // Run baseline performance test
      const baselineIterations = 20;
      for (let i = 0; i < baselineIterations; i++) {
        await act(async () => {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .uploadOperation({
              id: `baseline-${i}`,
            });

          const operationId = result.current.registerOperation(operation);

          const startTime = profiler.startMeasurement('baseline-cancel');
          await result.current.cancelOperation(operationId);
          profiler.endMeasurement('baseline-cancel', startTime);
        });
      }

      const baselineStats = profiler.getStatistics('baseline-cancel');

      // Compare against performance benchmarks
      expect(baselineStats!.average).toBeLessThan(
        performanceBenchmarks.cancelResponseTime.upload.max
      );
      expect(baselineStats!.p95).toBeLessThan(
        performanceBenchmarks.cancelResponseTime.upload.max * 1.5
      );
    });
  });
});
