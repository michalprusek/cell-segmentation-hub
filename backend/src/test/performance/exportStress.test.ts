import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../server';
import { ExportService } from '../../services/exportService';
import { WebSocketService } from '../../services/websocketService';
import { prisma } from '../../db/index';
import { SharingService } from '../../services/sharingService';
import { performance } from 'perf_hooks';

// Mock external dependencies
vi.mock('../../services/websocketService');
vi.mock('../../services/sharingService');
vi.mock('fs/promises');

const mockWebSocketService = vi.mocked(WebSocketService);
const mockSharingService = vi.mocked(SharingService);

describe('Export Cancellation - Performance Stress Tests', () => {
  let exportService: ExportService;
  let mockWsService: any;
  let authToken: string;
  let testProject: any;
  let testUser: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup WebSocket service mock
    mockWsService = {
      sendToUser: vi.fn(),
      broadcast: vi.fn(),
    };
    mockWebSocketService.getInstance = vi.fn().mockReturnValue(mockWsService);

    // Mock sharing service - allow access by default
    mockSharingService.hasProjectAccess = vi.fn().mockResolvedValue({
      hasAccess: true,
      accessType: 'owner',
    });

    // Create test user
    testUser = await prisma.user.create({
      data: {
        email: 'stress@example.com',
        username: 'stressuser',
        password: 'hashedpassword',
        isVerified: true,
      },
    });

    // Create test project
    testProject = await prisma.project.create({
      data: {
        title: 'Stress Test Project',
        description: 'Project for stress testing export cancellation',
        userId: testUser.id,
      },
    });

    authToken = 'stress-test-auth-token';

    // Setup export service
    exportService = ExportService.getInstance();
    exportService.setWebSocketService(mockWsService);

    // Clear any existing jobs
    (exportService as any).exportJobs.clear();
  });

  afterEach(async () => {
    // Cleanup test data
    await prisma.project.deleteMany({
      where: { userId: testUser.id },
    });
    await prisma.user.deleteMany({
      where: { email: 'stress@example.com' },
    });

    // Clear export jobs
    (exportService as any).exportJobs.clear();

    vi.resetAllMocks();
  });

  describe('High-Volume Cancellation Stress Tests', () => {
    it('should handle rapid cancel/restart cycles without memory leaks', async () => {
      const cycleCount = 50;
      const results: Array<{
        cycle: number;
        jobId: string;
        startTime: number;
        cancelTime: number;
        downloadTime: number;
        finalStatus: string;
        memoryUsage?: NodeJS.MemoryUsage;
      }> = [];

      const initialMemory = process.memoryUsage();

      for (let cycle = 0; cycle < cycleCount; cycle++) {
        const cycleStartTime = performance.now();

        // Start export
        const startResponse = await request(app)
          .post(`/api/projects/${testProject.id}/exports`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            options: {
              includeOriginalImages: true,
              annotationFormats: ['json'],
            },
          })
          .expect(200);

        const jobId = startResponse.body.jobId;
        const startTime = performance.now();

        // Simulate some processing
        const job = (exportService as any).exportJobs.get(jobId);
        job.status = 'processing';
        job.progress = Math.random() * 90 + 5; // 5-95%

        // Random delay before cancellation (0-50ms)
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50));

        // Cancel export
        const cancelStartTime = performance.now();
        const cancelResponse = await request(app)
          .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);
        const cancelTime = performance.now() - cancelStartTime;

        // Attempt download (should fail)
        const downloadStartTime = performance.now();
        const downloadResponse = await request(app)
          .get(`/api/projects/${testProject.id}/exports/${jobId}/download`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(410);
        const downloadTime = performance.now() - downloadStartTime;

        results.push({
          cycle,
          jobId,
          startTime: startTime - cycleStartTime,
          cancelTime,
          downloadTime,
          finalStatus: job.status,
          memoryUsage: cycle % 10 === 0 ? process.memoryUsage() : undefined, // Sample memory every 10 cycles
        });

        // Brief pause to prevent overwhelming the system
        if (cycle % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      const finalMemory = process.memoryUsage();

      // Performance assertions
      const avgCancelTime = results.reduce((sum, r) => sum + r.cancelTime, 0) / results.length;
      const avgDownloadTime = results.reduce((sum, r) => sum + r.downloadTime, 0) / results.length;

      expect(avgCancelTime).toBeLessThan(100); // Average cancellation under 100ms
      expect(avgDownloadTime).toBeLessThan(50); // Average download rejection under 50ms

      // All operations should succeed
      results.forEach(result => {
        expect(result.finalStatus).toBe('cancelled');
      });

      // Memory leak check (allow for some growth but not excessive)
      const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryGrowthPerCycle = memoryGrowth / cycleCount;
      expect(memoryGrowthPerCycle).toBeLessThan(1024 * 1024); // Less than 1MB per cycle

      console.log(`Stress test completed: ${cycleCount} cycles`);
      console.log(`Average cancellation time: ${avgCancelTime.toFixed(2)}ms`);
      console.log(`Average download rejection time: ${avgDownloadTime.toFixed(2)}ms`);
      console.log(`Memory growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)}MB total, ${(memoryGrowthPerCycle / 1024).toFixed(2)}KB per cycle`);
    });

    it('should handle concurrent cancellations without deadlocks', async () => {
      const concurrentJobs = 20;
      const jobPromises: Promise<any>[] = [];

      const overallStartTime = performance.now();

      // Start multiple exports concurrently
      for (let i = 0; i < concurrentJobs; i++) {
        const jobPromise = (async (jobIndex: number) => {
          const startTime = performance.now();

          // Start export
          const startResponse = await request(app)
            .post(`/api/projects/${testProject.id}/exports`)
            .set('Authorization', `Bearer ${authToken}`)
            .send({
              options: {
                includeOriginalImages: true,
                annotationFormats: ['json'],
              },
            });

          const jobId = startResponse.body.jobId;

          // Simulate processing
          const job = (exportService as any).exportJobs.get(jobId);
          if (job) {
            job.status = 'processing';
            job.progress = Math.random() * 80 + 10;
          }

          // Random delay before cancellation
          await new Promise(resolve => setTimeout(resolve, Math.random() * 100));

          // Cancel export
          const cancelResponse = await request(app)
            .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
            .set('Authorization', `Bearer ${authToken}`);

          // Attempt download
          const downloadResponse = await request(app)
            .get(`/api/projects/${testProject.id}/exports/${jobId}/download`)
            .set('Authorization', `Bearer ${authToken}`);

          const endTime = performance.now();

          return {
            jobIndex,
            jobId,
            duration: endTime - startTime,
            cancelStatus: cancelResponse.status,
            downloadStatus: downloadResponse.status,
            finalJobStatus: job?.status,
          };
        })(i);

        jobPromises.push(jobPromise);
      }

      // Wait for all jobs to complete
      const results = await Promise.all(jobPromises);
      const overallDuration = performance.now() - overallStartTime;

      // Verify all operations completed successfully
      results.forEach((result, index) => {
        expect(result.cancelStatus).toBe(200);
        expect(result.downloadStatus).toBe(410);
        expect(result.finalJobStatus).toBe('cancelled');
        expect(result.duration).toBeLessThan(5000); // Each job should complete within 5 seconds
      });

      // Overall operation should complete within reasonable time
      expect(overallDuration).toBeLessThan(10000); // 10 seconds for all concurrent operations

      console.log(`Concurrent stress test: ${concurrentJobs} jobs in ${overallDuration.toFixed(2)}ms`);
      console.log(`Average job duration: ${(results.reduce((sum, r) => sum + r.duration, 0) / results.length).toFixed(2)}ms`);
    });

    it('should maintain performance under high-frequency WebSocket events', async () => {
      const eventCount = 1000;
      const batchSize = 50;

      // Create test job
      const startResponse = await request(app)
        .post(`/api/projects/${testProject.id}/exports`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          options: { includeOriginalImages: true },
        })
        .expect(200);

      const jobId = startResponse.body.jobId;
      const job = (exportService as any).exportJobs.get(jobId);
      job.status = 'processing';

      const startTime = performance.now();

      // Send high-frequency WebSocket events in batches
      for (let batch = 0; batch < eventCount / batchSize; batch++) {
        const batchPromises = [];

        for (let i = 0; i < batchSize; i++) {
          const eventPromise = Promise.resolve().then(() => {
            // Simulate various events
            const eventType = ['progress', 'completed', 'failed'][i % 3];
            const eventData = {
              jobId,
              progress: Math.random() * 100,
              error: 'Test error',
            };

            // Simulate WebSocket event processing
            mockWsService.sendToUser(testUser.id, `export:${eventType}`, eventData);
          });

          batchPromises.push(eventPromise);
        }

        await Promise.all(batchPromises);

        // Brief pause between batches
        if (batch % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      }

      // Cancel export after event flood
      const cancelTime = performance.now();
      const cancelResponse = await request(app)
        .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      const cancelDuration = performance.now() - cancelTime;

      const totalDuration = performance.now() - startTime;

      // Performance assertions
      expect(cancelDuration).toBeLessThan(100); // Cancellation should still be fast
      expect(totalDuration).toBeLessThan(5000); // Total operation under 5 seconds
      expect(job.status).toBe('cancelled');

      // Verify WebSocket service was called frequently
      expect(mockWsService.sendToUser).toHaveBeenCalledTimes(eventCount);

      console.log(`WebSocket stress test: ${eventCount} events in ${totalDuration.toFixed(2)}ms`);
      console.log(`Cancellation time after event flood: ${cancelDuration.toFixed(2)}ms`);
    });
  });

  describe('Resource Exhaustion Tests', () => {
    it('should handle memory pressure during cancellation operations', async () => {
      // Create large number of jobs to simulate memory pressure
      const jobCount = 100;
      const jobs: string[] = [];

      const initialMemory = process.memoryUsage();

      // Create many jobs quickly
      for (let i = 0; i < jobCount; i++) {
        const startResponse = await request(app)
          .post(`/api/projects/${testProject.id}/exports`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            options: {
              includeOriginalImages: true,
              annotationFormats: ['json', 'coco', 'yolo'],
              metricsFormats: ['csv', 'excel', 'json'],
            },
          })
          .expect(200);

        jobs.push(startResponse.body.jobId);

        // Simulate processing with large data
        const job = (exportService as any).exportJobs.get(startResponse.body.jobId);
        job.status = 'processing';
        job.progress = Math.random() * 90;
        job.largeData = new Array(1000).fill('test data string'); // Simulate memory usage
      }

      const beforeCancelMemory = process.memoryUsage();

      // Cancel all jobs rapidly
      const cancelStartTime = performance.now();
      const cancelPromises = jobs.map(jobId =>
        request(app)
          .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
          .set('Authorization', `Bearer ${authToken}`)
      );

      const cancelResults = await Promise.all(cancelPromises);
      const cancelDuration = performance.now() - cancelStartTime;

      const afterCancelMemory = process.memoryUsage();

      // Verify all cancellations succeeded
      cancelResults.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Verify all jobs are cancelled
      jobs.forEach(jobId => {
        const job = (exportService as any).exportJobs.get(jobId);
        expect(job.status).toBe('cancelled');
      });

      // Performance under memory pressure
      const avgCancelTime = cancelDuration / jobCount;
      expect(avgCancelTime).toBeLessThan(50); // Average under 50ms even under memory pressure

      console.log(`Memory pressure test: ${jobCount} jobs cancelled in ${cancelDuration.toFixed(2)}ms`);
      console.log(`Average cancellation time under pressure: ${avgCancelTime.toFixed(2)}ms`);
      console.log(`Memory usage - Initial: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB, Before cancel: ${(beforeCancelMemory.heapUsed / 1024 / 1024).toFixed(2)}MB, After cancel: ${(afterCancelMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    });

    it('should handle CPU-intensive cancellation scenarios', async () => {
      const intensiveJobCount = 30;
      const jobs: string[] = [];

      // Create CPU-intensive export jobs
      for (let i = 0; i < intensiveJobCount; i++) {
        const startResponse = await request(app)
          .post(`/api/projects/${testProject.id}/exports`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            options: {
              includeOriginalImages: true,
              includeVisualizations: true,
              annotationFormats: ['json', 'coco', 'yolo'],
              metricsFormats: ['csv', 'excel', 'json'],
              includeDocumentation: true,
            },
          })
          .expect(200);

        jobs.push(startResponse.body.jobId);

        // Simulate CPU-intensive processing
        const job = (exportService as any).exportJobs.get(startResponse.body.jobId);
        job.status = 'processing';
        job.progress = 80 + Math.random() * 15; // Near completion (most CPU intensive)

        // Simulate CPU load with computation
        job.cpuIntensiveTask = () => {
          let result = 0;
          for (let j = 0; j < 10000; j++) {
            result += Math.sin(j) * Math.cos(j);
          }
          return result;
        };
      }

      // Add some artificial CPU load during cancellation
      const cpuLoadInterval = setInterval(() => {
        let load = 0;
        for (let i = 0; i < 50000; i++) {
          load += Math.random();
        }
      }, 1);

      const cancelStartTime = performance.now();

      // Cancel all jobs with CPU pressure
      const cancelPromises = jobs.map(async (jobId, index) => {
        // Stagger cancellations slightly to simulate real-world timing
        await new Promise(resolve => setTimeout(resolve, index * 2));

        const cancelTime = performance.now();
        const response = await request(app)
          .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
          .set('Authorization', `Bearer ${authToken}`);
        const duration = performance.now() - cancelTime;

        return { jobId, status: response.status, duration };
      });

      const results = await Promise.all(cancelPromises);
      const totalCancelDuration = performance.now() - cancelStartTime;

      clearInterval(cpuLoadInterval);

      // Verify all cancellations succeeded despite CPU pressure
      results.forEach(result => {
        expect(result.status).toBe(200);
        expect(result.duration).toBeLessThan(500); // Each cancellation under 500ms even with CPU load
      });

      const avgCancelTime = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
      expect(avgCancelTime).toBeLessThan(100); // Average under 100ms

      console.log(`CPU pressure test: ${intensiveJobCount} jobs cancelled in ${totalCancelDuration.toFixed(2)}ms`);
      console.log(`Average cancellation time under CPU load: ${avgCancelTime.toFixed(2)}ms`);
    });
  });

  describe('Edge Case Performance Tests', () => {
    it('should handle rapid state changes without performance degradation', async () => {
      const stateChangeCount = 500;
      const jobId = 'rapid-state-change-job';

      // Create job
      const job = {
        id: jobId,
        projectId: testProject.id,
        userId: testUser.id,
        status: 'pending',
        progress: 0,
        createdAt: new Date(),
        options: { format: 'json' },
      };
      (exportService as any).exportJobs.set(jobId, job);

      const startTime = performance.now();

      // Rapid state changes
      for (let i = 0; i < stateChangeCount; i++) {
        const states = ['pending', 'processing', 'completed', 'failed', 'cancelled'];
        job.status = states[i % states.length] as any;
        job.progress = (i / stateChangeCount) * 100;

        // Simulate some processing between state changes
        if (i % 10 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }

      // Final cancellation
      const cancelTime = performance.now();
      await request(app)
        .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      const cancelDuration = performance.now() - cancelTime;

      const totalDuration = performance.now() - startTime;

      // Performance should not degrade significantly
      expect(cancelDuration).toBeLessThan(50); // Cancellation still fast after rapid changes
      expect(totalDuration).toBeLessThan(1000); // Total operation under 1 second
      expect(job.status).toBe('cancelled');

      console.log(`Rapid state change test: ${stateChangeCount} changes in ${totalDuration.toFixed(2)}ms`);
      console.log(`Final cancellation time: ${cancelDuration.toFixed(2)}ms`);
    });

    it('should maintain performance with large job metadata', async () => {
      const largeMetadataJobCount = 20;
      const jobs: string[] = [];

      // Create jobs with large metadata
      for (let i = 0; i < largeMetadataJobCount; i++) {
        const startResponse = await request(app)
          .post(`/api/projects/${testProject.id}/exports`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            options: {
              includeOriginalImages: true,
              annotationFormats: ['json'],
              selectedImageIds: new Array(1000).fill(0).map((_, idx) => `image-${idx}`), // Large selection
            },
          })
          .expect(200);

        const jobId = startResponse.body.jobId;
        jobs.push(jobId);

        // Add large metadata to job
        const job = (exportService as any).exportJobs.get(jobId);
        job.status = 'processing';
        job.largeMetadata = {
          imageMetadata: new Array(1000).fill(0).map((_, idx) => ({
            id: `image-${idx}`,
            filename: `very_long_filename_with_lots_of_metadata_${idx}.jpg`,
            annotations: new Array(50).fill(0).map((_, aidx) => ({
              id: `annotation-${aidx}`,
              polygon: new Array(100).fill(0).map(() => Math.random()),
              metadata: { type: 'cell', confidence: Math.random() },
            })),
          })),
          processingLog: new Array(500).fill('Processing step with detailed information...'),
        };
      }

      const cancelStartTime = performance.now();

      // Cancel all jobs with large metadata
      const cancelPromises = jobs.map(jobId =>
        request(app)
          .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
          .set('Authorization', `Bearer ${authToken}`)
      );

      const results = await Promise.all(cancelPromises);
      const cancelDuration = performance.now() - cancelStartTime;

      // Verify cancellations succeeded
      results.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Performance should not be significantly impacted by large metadata
      const avgCancelTime = cancelDuration / largeMetadataJobCount;
      expect(avgCancelTime).toBeLessThan(100); // Under 100ms even with large metadata

      console.log(`Large metadata test: ${largeMetadataJobCount} jobs with large metadata cancelled in ${cancelDuration.toFixed(2)}ms`);
      console.log(`Average cancellation time with large metadata: ${avgCancelTime.toFixed(2)}ms`);
    });

    it('should handle timeout scenarios gracefully', async () => {
      const timeoutJobCount = 10;
      const jobs: string[] = [];

      // Create jobs
      for (let i = 0; i < timeoutJobCount; i++) {
        const startResponse = await request(app)
          .post(`/api/projects/${testProject.id}/exports`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            options: { includeOriginalImages: true },
          })
          .expect(200);

        jobs.push(startResponse.body.jobId);
      }

      // Mock slow cancellation operations
      const originalHasAccess = mockSharingService.hasProjectAccess;
      mockSharingService.hasProjectAccess = vi.fn().mockImplementation(async () => {
        // Simulate slow database operation
        await new Promise(resolve => setTimeout(resolve, 100));
        return { hasAccess: true, accessType: 'owner' };
      });

      const cancelStartTime = performance.now();

      // Cancel with simulated slowness
      const cancelPromises = jobs.map(jobId =>
        request(app)
          .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
          .set('Authorization', `Bearer ${authToken}`)
      );

      const results = await Promise.all(cancelPromises);
      const cancelDuration = performance.now() - cancelStartTime;

      // Restore original mock
      mockSharingService.hasProjectAccess = originalHasAccess;

      // Even with slow operations, cancellations should eventually succeed
      results.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Should handle timeout scenarios within reasonable time
      expect(cancelDuration).toBeLessThan(5000); // Within 5 seconds despite slowness

      console.log(`Timeout scenario test: ${timeoutJobCount} jobs with simulated slowness cancelled in ${cancelDuration.toFixed(2)}ms`);
    });
  });

  describe('Long-Running Performance Tests', () => {
    it('should maintain consistent performance over extended periods', async () => {
      const testDurationMs = 5000; // 5 second test
      const operationInterval = 100; // Operation every 100ms

      const results: Array<{
        timestamp: number;
        operation: string;
        duration: number;
        success: boolean;
      }> = [];

      const startTime = performance.now();
      let operationCount = 0;

      const performOperation = async () => {
        operationCount++;
        const opStartTime = performance.now();

        try {
          // Start export
          const startResponse = await request(app)
            .post(`/api/projects/${testProject.id}/exports`)
            .set('Authorization', `Bearer ${authToken}`)
            .send({
              options: { includeOriginalImages: true },
            });

          const jobId = startResponse.body.jobId;

          // Quick processing simulation
          const job = (exportService as any).exportJobs.get(jobId);
          job.status = 'processing';

          // Cancel immediately
          await request(app)
            .delete(`/api/projects/${testProject.id}/exports/${jobId}`)
            .set('Authorization', `Bearer ${authToken}`);

          const duration = performance.now() - opStartTime;
          results.push({
            timestamp: performance.now() - startTime,
            operation: `start-cancel-${operationCount}`,
            duration,
            success: true,
          });
        } catch (error) {
          const duration = performance.now() - opStartTime;
          results.push({
            timestamp: performance.now() - startTime,
            operation: `start-cancel-${operationCount}`,
            duration,
            success: false,
          });
        }
      };

      // Run operations at regular intervals
      const intervalId = setInterval(performOperation, operationInterval);

      // Wait for test duration
      await new Promise(resolve => setTimeout(resolve, testDurationMs));
      clearInterval(intervalId);

      // Analyze performance consistency
      const successfulOps = results.filter(r => r.success);
      const avgDuration = successfulOps.reduce((sum, r) => sum + r.duration, 0) / successfulOps.length;

      // Check for performance degradation over time
      const firstQuarterOps = successfulOps.slice(0, Math.floor(successfulOps.length / 4));
      const lastQuarterOps = successfulOps.slice(-Math.floor(successfulOps.length / 4));

      const firstQuarterAvg = firstQuarterOps.reduce((sum, r) => sum + r.duration, 0) / firstQuarterOps.length;
      const lastQuarterAvg = lastQuarterOps.reduce((sum, r) => sum + r.duration, 0) / lastQuarterOps.length;

      const performanceDegradation = (lastQuarterAvg - firstQuarterAvg) / firstQuarterAvg;

      // Assertions
      expect(successfulOps.length).toBeGreaterThan(30); // At least 30 successful operations
      expect(avgDuration).toBeLessThan(200); // Average operation under 200ms
      expect(performanceDegradation).toBeLessThan(0.5); // Less than 50% performance degradation

      const successRate = (successfulOps.length / results.length) * 100;
      expect(successRate).toBeGreaterThan(95); // At least 95% success rate

      console.log(`Extended performance test: ${results.length} operations over ${testDurationMs}ms`);
      console.log(`Success rate: ${successRate.toFixed(1)}%`);
      console.log(`Average duration: ${avgDuration.toFixed(2)}ms`);
      console.log(`Performance degradation: ${(performanceDegradation * 100).toFixed(1)}%`);
    });
  });
});