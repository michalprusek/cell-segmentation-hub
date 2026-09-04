/**
 * Performance Tests for Universal Cancel Functionality
 * Measures response time, memory usage, and throughput for cancel operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
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

  startMeasurement(_testName: string) {
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
  let _mockOperationManager: any;

  beforeEach(() => {
    profiler = new PerformanceProfiler();
    stressRunner = new StressTestRunner();
    _mockOperationManager = cancelTestUtils.createMockOperationManager();

    profiler.captureMemoryBaseline();
    vi.clearAllMocks();
  });

  afterEach(() => {
    profiler.reset();
  });

  describe('Response Time Performance', () => {
    it('should cancel upload operations within performance threshold', async () => {
      const manager = cancelTestUtils.createMockOperationManager();

      for (let i = 0; i < PERFORMANCE_CONFIG.iterations.medium; i++) {
        await act(async () => {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .uploadOperation({
              id: `upload-perf-${i}`,
            });

          const operationId = manager.registerOperation(operation);

          const startTime = profiler.startMeasurement('upload-cancel');
          await manager.cancelOperation(operationId);
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
      const manager = cancelTestUtils.createMockOperationManager();

      for (let i = 0; i < PERFORMANCE_CONFIG.iterations.medium; i++) {
        await act(async () => {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .segmentationOperation({
              id: `segmentation-perf-${i}`,
            });

          const operationId = manager.registerOperation(operation);

          const startTime = profiler.startMeasurement('segmentation-cancel');
          await manager.cancelOperation(operationId);
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
      const manager = cancelTestUtils.createMockOperationManager();

      for (let i = 0; i < PERFORMANCE_CONFIG.iterations.medium; i++) {
        await act(async () => {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .exportOperation({
              id: `export-perf-${i}`,
            });

          const operationId = manager.registerOperation(operation);

          const startTime = profiler.startMeasurement('export-cancel');
          await manager.cancelOperation(operationId);
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
      const manager = cancelTestUtils.createMockOperationManager();
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
          operationIds.push(manager.registerOperation(operation));
        }

        // Cancel all at once
        const startTime = profiler.startMeasurement('batch-cancel');
        await manager.cancelAllOperations();
        profiler.endMeasurement('batch-cancel', startTime);
      });

      const stats = profiler.getStatistics('batch-cancel');
      expect(stats).toBeTruthy();
      expect(stats!.average).toBeLessThan(2000); // Should complete batch cancel in less than 2 seconds
    });
  });

  describe('Memory Usage Performance', () => {
    it('should not leak memory during frequent cancellations', async () => {
      const manager = cancelTestUtils.createMockOperationManager();

      const initialMemory = profiler.getMemoryUsage();

      for (let i = 0; i < PERFORMANCE_CONFIG.iterations.heavy; i++) {
        await act(async () => {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .uploadOperation({
              id: `memory-test-${i}`,
            });

          const operationId = manager.registerOperation(operation);
          await manager.cancelOperation(operationId);

          // Force cleanup
          manager.removeOperation(operationId);
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
      const manager = cancelTestUtils.createMockOperationManager();

      // Create many operations
      const operationIds: string[] = [];
      await act(async () => {
        for (let i = 0; i < 1000; i++) {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .mixedOperations(1)[0];
          operation.id = `cleanup-test-${i}`;
          operationIds.push(manager.registerOperation(operation));
        }
      });

      expect(manager.stats.total).toBe(1000);

      // Cancel and cleanup all operations
      await act(async () => {
        await manager.cancelAllOperations();
        manager.cleanup();
      });

      expect(manager.stats.total).toBe(0);

      const memoryAfterCleanup = profiler.getMemoryUsage();
      if (memoryAfterCleanup) {
        expect(memoryAfterCleanup.increase).toBeLessThan(5 * 1024 * 1024); // Less than 5MB increase
      }
    });

    it('should handle large operation metadata efficiently', async () => {
      const manager = cancelTestUtils.createMockOperationManager();

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

          const operationId = manager.registerOperation(operation);

          const startTime = profiler.startMeasurement('large-metadata-cancel');
          await manager.cancelOperation(operationId);
          profiler.endMeasurement('large-metadata-cancel', startTime);

          manager.removeOperation(operationId);
        }
      });

      const stats = profiler.getStatistics('large-metadata-cancel');
      expect(stats).toBeTruthy();
      expect(stats!.average).toBeLessThan(500); // Should handle large metadata efficiently
    });
  });

  describe('Throughput Performance', () => {
    it('should handle high-frequency cancel operations', async () => {
      const manager = cancelTestUtils.createMockOperationManager();

      const operationFactory = async () => {
        const operation = cancelTestUtils
          .createTestDataFactories()
          .uploadOperation();
        const operationId = manager.registerOperation(operation);
        await manager.cancelOperation(operationId);
        manager.removeOperation(operationId);
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
      const manager = cancelTestUtils.createMockOperationManager();

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

          const operationId = manager.registerOperation(operation);
          await manager.cancelOperation(operationId);
        });

        operationPromises.push(operationPromise);
      }

      await Promise.all(operationPromises);
      const totalTime = profiler.endMeasurement('concurrent-load', startTime);

      const operationsPerSecond = (concurrentOperations / totalTime) * 1000;
      expect(operationsPerSecond).toBeGreaterThan(20); // At least 20 concurrent ops/sec
    });

    it('cancels every operation at increasing volumes, without hanging', async () => {
      const manager = cancelTestUtils.createMockOperationManager();

      // THIS TEST NO LONGER ASSERTS ON WALL-CLOCK TIME. Three attempts were
      // measured and all three are unsound here; the numbers are recorded so
      // nobody spends the afternoon again.
      //
      // 1. The original ratio ("ops/sec must not fall by more than 50% between
      //    volumes") was FLAKY: `performance.now()` is quantised to a whole
      //    MILLISECOND under vitest/jsdom — over 2000 consecutive samples the
      //    only distinct delta is exactly 1, while bare node resolves
      //    microseconds, so it is the environment and not the machine. A pass
      //    took 0-2 ms, so the ratio was built from small integers: 1 ms then
      //    7 ms gives 0.29, and 1 ms then 4 ms gives exactly 0.5 — the reported
      //    `expected 0.5 to be greater than 0.5`. Under CPU contention it
      //    failed about 1 run in 6.
      //
      // 2. Repeating each volume for a 25 ms budget fixed the resolution and
      //    was still VACUOUS: making `cancelAllOperations` genuinely O(n^2) did
      //    not fail it. Per-operation cost is dominated by fixed per-pass
      //    overhead and FALLS as volume rises — 2.37 / 1.56 / 1.42 us at
      //    50 / 100 / 200 clean, and 2.56 / 1.94 / 1.20 us with the quadratic
      //    mutation. At volume 4000 the signal appears (1.25 vs 3.00 us) but
      //    the clean run's own volume-to-volume scatter is +-40%.
      //
      // 3. An absolute ceiling per operation cannot separate them either.
      //    Measured under a 10-core load: clean runs span 3.5-62.5 us/op and a
      //    2000x-work regression spans 6.1-320 us/op. The distributions
      //    OVERLAP, so every threshold is either flaky or blind.
      //
      // What is left is deterministic and worth keeping: at each volume every
      // operation must actually be cancelled and removed, and the whole thing
      // must finish — a hang fails on vitest's own timeout. That catches the
      // regressions a mock manager can genuinely demonstrate (a cancel loop
      // that misses entries, an unresolved promise, leaked state) and claims
      // nothing about speed, which this harness cannot measure.
      const volumes = [10, 50, 100, 200];

      for (const volume of volumes) {
        const operations = cancelTestUtils
          .createTestDataFactories()
          .mixedOperations(volume);

        let operationIds: string[] = [];
        await act(async () => {
          operationIds = operations.map(op => manager.registerOperation(op));
        });
        expect(operationIds).toHaveLength(volume);
        expect(manager.stats.total).toBe(volume);

        await act(async () => {
          await manager.cancelAllOperations();
        });

        // Every one of them, not just some: a cancel loop that skips entries
        // is exactly the regression this can still see.
        for (const id of operationIds) {
          expect(manager.getOperation(id)?.status).toBe('cancelled');
        }

        await act(async () => {
          operationIds.forEach(id => manager.removeOperation(id));
        });
        expect(manager.stats.total).toBe(0);
      }
    });
  });

  describe('Stress Testing', () => {
    it('should survive rapid cancel/restart cycles', async () => {
      const manager = cancelTestUtils.createMockOperationManager();

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

            const operationId = manager.registerOperation(operation);

            // Immediately cancel
            await manager.cancelOperation(operationId);

            // Immediately create another
            const nextOperation = cancelTestUtils
              .createTestDataFactories()
              .uploadOperation({
                id: `stress-cycle-${i}-next`,
              });

            const nextOperationId = manager.registerOperation(nextOperation);
            await manager.cancelOperation(nextOperationId);

            // Cleanup
            manager.removeOperation(operationId);
            manager.removeOperation(nextOperationId);
          });
        } catch (error) {
          errors.push(error as Error);
        }
      }

      // Should handle rapid cycles with minimal errors
      expect(errors.length).toBeLessThan(cycles * 0.05); // Less than 5% error rate
    });

    it('should handle extreme concurrency', async () => {
      const manager = cancelTestUtils.createMockOperationManager();

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

          const operationId = manager.registerOperation(operation);

          // Add some variability in timing
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10));

          await manager.cancelOperation(operationId);
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
      const manager = cancelTestUtils.createMockOperationManager();

      // Simulate various error conditions
      const errorConditions = [
        () => Promise.reject(new Error('Network error')),
        () => Promise.reject(new Error('Timeout error')),
        () => Promise.reject(new Error('Server error')),
        () => Promise.reject(new DOMException('AbortError')),
      ];

      let successfulRecoveries = 0;

      // Inject errors on a DETERMINISTIC schedule (every 3rd iteration) rather
      // than Math.random(): a 30% random error rate over 20 trials is binomial
      // and dips below the threshold a few percent of runs — inherent test
      // flakiness. Fixed schedule → exactly 7 errors (i=0,3,...,18), 13 clean.
      for (let i = 0; i < 20; i++) {
        try {
          await act(async () => {
            const operation = cancelTestUtils
              .createTestDataFactories()
              .exportOperation({
                id: `recovery-test-${i}`,
              });

            const operationId = manager.registerOperation(operation);

            if (i % 3 === 0) {
              const errorCondition =
                errorConditions[i % errorConditions.length];
              await errorCondition();
            }

            await manager.cancelOperation(operationId);
            successfulRecoveries++;
          });
        } catch {
          // Error recovery test - continue
        }
      }

      // 20 iterations, 7 inject an error before the recovery increment → 13
      // clean recoveries. Assert the deterministic floor (well above 10).
      expect(successfulRecoveries).toBe(13);
    });
  });

  describe('Real-world Scenario Performance', () => {
    it('should handle typical user workflow efficiently', async () => {
      const manager = cancelTestUtils.createMockOperationManager();

      // Simulate typical user workflow: upload -> segment -> export -> cancel export
      const workflowStart = profiler.startMeasurement('user-workflow');

      await act(async () => {
        // Upload phase
        const uploadOp = cancelTestUtils
          .createTestDataFactories()
          .uploadOperation();
        const uploadId = manager.registerOperation(uploadOp);

        // Simulate upload completion
        manager.updateOperation(uploadId, {
          status: 'completed',
          progress: 100,
        });

        // Segmentation phase
        const segmentationOp = cancelTestUtils
          .createTestDataFactories()
          .segmentationOperation();
        const segmentationId = manager.registerOperation(segmentationOp);

        // Simulate segmentation completion
        manager.updateOperation(segmentationId, {
          status: 'completed',
          progress: 100,
        });

        // Export phase
        const exportOp = cancelTestUtils
          .createTestDataFactories()
          .exportOperation();
        const exportId = manager.registerOperation(exportOp);

        // User cancels export
        await manager.cancelOperation(exportId);
      });

      const workflowTime = profiler.endMeasurement(
        'user-workflow',
        workflowStart
      );

      // Typical workflow should complete quickly
      expect(workflowTime).toBeLessThan(1000); // Less than 1 second
    });

    it('should handle high-volume batch processing', async () => {
      const manager = cancelTestUtils.createMockOperationManager();
      const { operations } = segmentationScenarios.highVolumeSegmentation;

      const batchStart = profiler.startMeasurement('high-volume-batch');

      await act(async () => {
        // Register large batch
        const _operationIds = operations.slice(0, 100).map(op =>
          manager.registerOperation({
            id: op.id,
            type: op.type,
            status: op.status as any,
            progress: op.progress,
            startTime: op.startTime,
            endTime: op.endTime,
          })
        );

        // Cancel entire batch
        await manager.cancelAllOperations();
      });

      const batchTime = profiler.endMeasurement(
        'high-volume-batch',
        batchStart
      );

      // High volume batch should complete within reasonable time
      expect(batchTime).toBeLessThan(5000); // Less than 5 seconds for 100 operations
    });

    it('should maintain performance during extended usage', async () => {
      const manager = cancelTestUtils.createMockOperationManager();

      const sessionDuration = 3000; // 3 seconds (reduced from 30s to stay within test timeout)
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
            manager.registerOperation(op)
          );

          // Cancel some operations
          const operationsToCancel = operationIds.slice(0, 3);
          for (const opId of operationsToCancel) {
            await manager.cancelOperation(opId);
          }

          // Complete others
          const operationsToComplete = operationIds.slice(3);
          operationsToComplete.forEach(opId => {
            manager.updateOperation(opId, {
              status: 'completed',
              progress: 100,
            });
          });

          // Cleanup
          manager.cleanup();
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
      // Populate the profiler with synthetic measurements so getStatistics returns data.
      // Each `beforeEach` creates a fresh profiler, so we must seed it here.
      const start = profiler.startMeasurement('upload-cancel');
      profiler.endMeasurement('upload-cancel', start);
      const start2 = profiler.startMeasurement('segmentation-cancel');
      profiler.endMeasurement('segmentation-cancel', start2);
      const start3 = profiler.startMeasurement('export-cancel');
      profiler.endMeasurement('export-cancel', start3);

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
      const manager = cancelTestUtils.createMockOperationManager();

      // Run baseline performance test
      const baselineIterations = 20;
      for (let i = 0; i < baselineIterations; i++) {
        await act(async () => {
          const operation = cancelTestUtils
            .createTestDataFactories()
            .uploadOperation({
              id: `baseline-${i}`,
            });

          const operationId = manager.registerOperation(operation);

          const startTime = profiler.startMeasurement('baseline-cancel');
          await manager.cancelOperation(operationId);
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
