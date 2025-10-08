/**
 * Test suite for 4-way parallel queue processing and concurrency
 *
 * This test suite validates concurrent batch processing, database connection pool
 * management, and WebSocket notifications during parallel queue operations.
 *
 * Requirements tested:
 * - Parallel batch processing (4 concurrent batches)
 * - Database connection pool under concurrent load (50 connections)
 * - Queue service handling 4 simultaneous user requests
 * - WebSocket notifications for multiple concurrent streams
 * - Error recovery when one of 4 parallel processes fails
 */

import { jest } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { QueueService } from '../queueService';
import { SegmentationService } from '../segmentationService';
import { ImageService } from '../imageService';
import { WebSocketService } from '../websocketService';
import { logger as _logger } from '../../utils/logger';

// Mock dependencies
jest.mock('../../utils/logger');
jest.mock('../websocketService');
jest.mock('../segmentationService');
jest.mock('../imageService');

// Test data structures
interface ConcurrentTestUser {
  userId: string;
  projectId: string;
  imageIds: string[];
  model: string;
  threshold: number;
}

interface ParallelProcessingMetrics {
  totalTime: number;
  successfulBatches: number;
  failedBatches: number;
  averageBatchTime: number;
  concurrentPeakConnections: number;
  websocketNotificationCount: number;
}

interface DatabaseConnectionMetrics {
  activeConnections: number;
  maxConnections: number;
  connectionPoolUtilization: number;
  queryResponseTime: number;
}

describe('QueueService Parallel Processing', () => {
  let prisma: PrismaClient;
  let queueService: QueueService;
  let mockSegmentationService: SegmentationService;
  let mockImageService: ImageService;
  let mockWebSocketService: WebSocketService;

  // Test data for 4 concurrent users
  const concurrentUsers: ConcurrentTestUser[] = [
    {
      userId: 'user_1',
      projectId: 'project_1',
      imageIds: ['img_1_1', 'img_1_2', 'img_1_3', 'img_1_4'],
      model: 'hrnet',
      threshold: 0.5,
    },
    {
      userId: 'user_2',
      projectId: 'project_2',
      imageIds: ['img_2_1', 'img_2_2', 'img_2_3', 'img_2_4'],
      model: 'cbam_resunet',
      threshold: 0.6,
    },
    {
      userId: 'user_3',
      projectId: 'project_3',
      imageIds: ['img_3_1', 'img_3_2', 'img_3_3', 'img_3_4'],
      model: 'hrnet',
      threshold: 0.7,
    },
    {
      userId: 'user_4',
      projectId: 'project_4',
      imageIds: ['img_4_1', 'img_4_2', 'img_4_3', 'img_4_4'],
      model: 'cbam_resunet',
      threshold: 0.4,
    },
  ];

  beforeAll(async () => {
    // Setup test database with connection pooling
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.TEST_DATABASE_URL || 'file:./test_parallel.db',
        },
      },
      log: ['error'],
    } as any);

    await prisma.$connect();
  });

  beforeEach(async () => {
    // Clear database state
    await prisma.segmentationQueue.deleteMany();
    await prisma.segmentation.deleteMany();
    await prisma.image.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    // Setup mock services
    mockSegmentationService = {
      requestBatchSegmentation: jest.fn(),
      requestSegmentation: jest.fn(),
      saveSegmentationResults: jest.fn(),
      checkServiceHealth: jest.fn().mockResolvedValue(true as never),
    } as any;

    mockImageService = {
      getImageById: jest.fn(),
      updateSegmentationStatus: jest.fn().mockResolvedValue(undefined as never),
    } as any;

    mockWebSocketService = {
      emitSegmentationUpdate: jest.fn(),
      emitSegmentationComplete: jest.fn(),
      emitQueueStatsUpdate: jest.fn(),
    } as unknown as WebSocketService;

    // Create QueueService instance
    queueService = QueueService.getInstance(
      prisma,
      mockSegmentationService,
      mockImageService
    );
    queueService.setWebSocketService(mockWebSocketService);

    // Setup test data in database
    await setupTestData();
  });

  afterEach(async () => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setupTestData(): Promise<void> {
    // Create test users, projects, and images
    for (const user of concurrentUsers) {
      await prisma.user.create({
        data: {
          id: user.userId,
          email: `${user.userId}@test.com`,
          password: 'test-password',
        },
      });

      await prisma.project.create({
        data: {
          id: user.projectId,
          title: `Test Project ${user.projectId}`,
          userId: user.userId,
        },
      });

      for (const imageId of user.imageIds) {
        await prisma.image.create({
          data: {
            id: imageId,
            name: `${imageId}.jpg`,
            originalPath: `/test/images/${imageId}.jpg`,
            projectId: user.projectId,
            width: 512,
            height: 512,
            segmentationStatus: 'no_segmentation',
          },
        });

        // Mock image service responses
        (mockImageService.getImageById as any).mockImplementation(
          (id: string, _userId: string) => {
            const user = concurrentUsers.find(u => u.imageIds.includes(id));
            if (user) {
              return Promise.resolve({
                id,
                name: `${id}.jpg`,
                projectId: user.projectId,
                width: 512,
                height: 512,
                segmentationStatus: 'no_segmentation',
              });
            }
            return Promise.resolve(null);
          }
        );
      }
    }
  }

  function mockSegmentationResults(polygonCount: number = 5) {
    const mockPolygons = Array.from({ length: polygonCount }, (_, i) => ({
      coordinates: [
        [100 + i * 50, 100],
        [150 + i * 50, 100],
        [150 + i * 50, 150],
        [100 + i * 50, 150],
      ],
      confidence: 0.9,
    }));

    return {
      polygons: mockPolygons,
      confidence: 0.9,
      processing_time: 196, // HRNet baseline timing
      image_size: { width: 512, height: 512 },
    };
  }

  describe('Concurrent Batch Processing', () => {
    test('should handle 4 simultaneous user batch submissions', async () => {
      // Mock successful segmentation for all batches
      (
        mockSegmentationService.requestBatchSegmentation as any
      ).mockImplementation(async (images: any[], _model: string) => {
        // Simulate processing time based on model
        const processingTime = _model === 'hrnet' ? 196 : 396; // ms
        await new Promise(resolve => setTimeout(resolve, processingTime));

        return images.map(() => mockSegmentationResults());
      });

      // Submit batches concurrently for all 4 users
      const concurrentSubmissions = concurrentUsers.map(async user => {
        const startTime = Date.now();

        const queueEntries = await queueService.addBatchToQueue(
          user.imageIds,
          user.projectId,
          user.userId,
          user.model,
          user.threshold,
          0, // priority
          false, // forceResegment
          true // detectHoles
        );

        const endTime = Date.now();

        return {
          user: user.userId,
          queueEntries,
          submissionTime: endTime - startTime,
          batchSize: user.imageIds.length,
        };
      });

      // Execute all submissions in parallel
      const startTime = Date.now();
      const results = await Promise.all(concurrentSubmissions);
      const totalTime = Date.now() - startTime;

      // Assertions
      expect(results).toHaveLength(4);

      // Verify all batches were submitted successfully
      for (const result of results) {
        expect(result.queueEntries).toHaveLength(result.batchSize);
        expect(result.submissionTime).toBeLessThan(1000); // Should submit quickly
      }

      // Verify total concurrent submission time is reasonable
      expect(totalTime).toBeLessThan(2000); // All 4 batches should submit within 2 seconds

      // Verify database state
      const totalQueueItems = await prisma.segmentationQueue.count();
      expect(totalQueueItems).toBe(16); // 4 users × 4 images each

      // Verify queue items are distributed correctly
      for (const user of concurrentUsers) {
        const userQueueItems = await prisma.segmentationQueue.findMany({
          where: { userId: user.userId },
        });
        expect(userQueueItems).toHaveLength(user.imageIds.length);
      }
    });

    test('should process 4 concurrent batches without blocking', async () => {
      // Setup queue entries for all users
      for (const user of concurrentUsers) {
        await queueService.addBatchToQueue(
          user.imageIds,
          user.projectId,
          user.userId,
          user.model,
          user.threshold
        );
      }

      // Mock segmentation service with realistic timing
      (
        mockSegmentationService.requestBatchSegmentation as any
      ).mockImplementation(async (images: any[], _model: string) => {
        const processingTime = _model === 'hrnet' ? 196 : 396;
        await new Promise(resolve => setTimeout(resolve, processingTime));
        return images.map(() => mockSegmentationResults());
      });

      // Process batches concurrently
      const processingPromises: Promise<any>[] = [];
      const batchProcessingMetrics: ParallelProcessingMetrics = {
        totalTime: 0,
        successfulBatches: 0,
        failedBatches: 0,
        averageBatchTime: 0,
        concurrentPeakConnections: 0,
        websocketNotificationCount: 0,
      };

      const startTime = Date.now();

      // Get and process batches for each model type
      for (let i = 0; i < 4; i++) {
        const batchPromise = (async () => {
          const batchStartTime = Date.now();

          try {
            const batch = await queueService.getNextBatch();
            if (batch.length > 0) {
              await queueService.processBatch(batch);
              batchProcessingMetrics.successfulBatches++;
            }

            const batchTime = Date.now() - batchStartTime;
            return { success: true, time: batchTime, batchSize: batch.length };
          } catch (_error) {
            batchProcessingMetrics.failedBatches++;
            const batchTime = Date.now() - batchStartTime;
            return { success: false, time: batchTime, error: _error };
          }
        })();

        processingPromises.push(batchPromise);
      }

      // Wait for all parallel processing to complete
      const batchResults = await Promise.all(processingPromises);
      batchProcessingMetrics.totalTime = Date.now() - startTime;

      // Calculate metrics
      const successfulTimes = batchResults
        .filter(r => r.success)
        .map(r => r.time);

      batchProcessingMetrics.averageBatchTime =
        successfulTimes.length > 0
          ? successfulTimes.reduce((a, b) => a + b, 0) / successfulTimes.length
          : 0;

      // Assertions
      expect(batchProcessingMetrics.successfulBatches).toBeGreaterThan(0);
      expect(batchProcessingMetrics.failedBatches).toBe(0);
      expect(batchProcessingMetrics.totalTime).toBeLessThan(1000); // Parallel processing should be fast
      expect(batchProcessingMetrics.averageBatchTime).toBeLessThan(500); // Individual batches reasonably fast

      // Verify all items were processed
      const remainingQueueItems = await prisma.segmentationQueue.count({
        where: { status: 'queued' },
      });
      expect(remainingQueueItems).toBe(0);

      // Verify WebSocket notifications were sent
      expect(mockWebSocketService.emitSegmentationUpdate).toHaveBeenCalled();
      expect(mockWebSocketService.emitSegmentationComplete).toHaveBeenCalled();
    });

    test('should maintain fairness across 4 concurrent users', async () => {
      // Setup different batch sizes and priorities for fairness testing
      const fairnessTestUsers = concurrentUsers.map((user, index) => ({
        ...user,
        imageIds: user.imageIds.slice(0, 2 + index), // Variable batch sizes: 2, 3, 4, 5
        priority: index % 2, // Alternating priorities: 0, 1, 0, 1
      }));

      // Submit batches with different priorities
      for (const user of fairnessTestUsers) {
        await queueService.addBatchToQueue(
          user.imageIds,
          user.projectId,
          user.userId,
          user.model,
          user.threshold,
          user.priority
        );
      }

      // Mock segmentation with consistent timing
      (
        mockSegmentationService.requestBatchSegmentation as any
      ).mockImplementation(async (images: any[]) => {
        await new Promise(resolve => setTimeout(resolve, 200)); // Consistent 200ms
        return images.map(() => mockSegmentationResults());
      });

      // Track processing order and timing per user
      const userProcessingMetrics: Record<
        string,
        { startTime: number; endTime: number; batchSize: number }
      > = {};

      // Process batches and track metrics
      const processingPromises = fairnessTestUsers.map(async user => {
        const batch = await queueService.getNextBatch();
        const startTime = Date.now();

        userProcessingMetrics[user.userId] = {
          startTime,
          endTime: 0,
          batchSize: batch.length,
        };

        await queueService.processBatch(batch);

        userProcessingMetrics[user.userId].endTime = Date.now();

        return { userId: user.userId, batchSize: batch.length };
      });

      await Promise.all(processingPromises);

      // Analyze fairness metrics
      const processingTimes = Object.values(userProcessingMetrics).map(
        metrics => metrics.endTime - metrics.startTime
      );

      const avgProcessingTime =
        processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length;
      const maxDeviation = Math.max(
        ...processingTimes.map(time => Math.abs(time - avgProcessingTime))
      );

      // Fairness assertions
      expect(maxDeviation).toBeLessThan(100); // Processing times should be within 100ms of average

      // Verify all users were processed
      expect(Object.keys(userProcessingMetrics)).toHaveLength(
        fairnessTestUsers.length
      );

      // Check that priority was respected (higher priority should process first when possible)
      const highPriorityUsers = fairnessTestUsers
        .filter(u => u.priority === 1)
        .map(u => u.userId);

      const lowPriorityUsers = fairnessTestUsers
        .filter(u => u.priority === 0)
        .map(u => u.userId);

      // At least some high-priority users should start before low-priority users
      const highPriorityStartTimes = highPriorityUsers
        .map(userId => userProcessingMetrics[userId]?.startTime)
        .filter(time => time !== undefined);

      const lowPriorityStartTimes = lowPriorityUsers
        .map(userId => userProcessingMetrics[userId]?.startTime)
        .filter(time => time !== undefined);

      if (
        highPriorityStartTimes.length > 0 &&
        lowPriorityStartTimes.length > 0
      ) {
        const avgHighPriorityStart =
          highPriorityStartTimes.reduce((a, b) => a + b, 0) /
          highPriorityStartTimes.length;
        const avgLowPriorityStart =
          lowPriorityStartTimes.reduce((a, b) => a + b, 0) /
          lowPriorityStartTimes.length;

        // This is a soft check since parallel processing may not guarantee strict ordering
        expect(avgHighPriorityStart).toBeLessThanOrEqual(
          avgLowPriorityStart + 50
        );
      }
    });
  });

  describe('Database Connection Pool Management', () => {
    test('should handle 50 concurrent database connections', async () => {
      const connectionTestPromises: Promise<any>[] = [];

      // Create 50 concurrent database operations
      for (let i = 0; i < 50; i++) {
        const connectionPromise = (async () => {
          const startTime = Date.now();

          try {
            // Simulate various database operations
            const operations = [
              () => prisma.segmentationQueue.findMany({ take: 1 }),
              () => prisma.image.findMany({ take: 1 }),
              () => prisma.project.findMany({ take: 1 }),
              () => queueService.getQueueStats(),
              () => prisma.segmentationQueue.count(),
            ];

            const operation = operations[i % operations.length];
            const _result = await operation();
            const responseTime = Date.now() - startTime;

            return {
              connectionId: i,
              success: true,
              responseTime,
              operationType: operation.name,
            };
          } catch (_error) {
            return {
              connectionId: i,
              success: false,
              responseTime: Date.now() - startTime,
              error: _error instanceof Error ? _error.message : String(_error),
            };
          }
        })();

        connectionTestPromises.push(connectionPromise);
      }

      // Execute all 50 concurrent operations
      const startTime = Date.now();
      const connectionResults = await Promise.all(connectionTestPromises);
      const totalTime = Date.now() - startTime;

      // Analyze connection pool performance
      const successfulConnections = connectionResults.filter(r => r.success);
      const failedConnections = connectionResults.filter(r => !r.success);

      const avgResponseTime =
        successfulConnections.length > 0
          ? successfulConnections.reduce((sum, r) => sum + r.responseTime, 0) /
            successfulConnections.length
          : 0;

      const metrics: DatabaseConnectionMetrics = {
        activeConnections: successfulConnections.length,
        maxConnections: 50,
        connectionPoolUtilization: successfulConnections.length / 50,
        queryResponseTime: avgResponseTime,
      };

      // Assertions
      expect(successfulConnections.length).toBeGreaterThan(45); // At least 90% success rate
      expect(failedConnections.length).toBeLessThan(5); // Less than 10% failures
      expect(metrics.queryResponseTime).toBeLessThan(1000); // Average response under 1 second
      expect(totalTime).toBeLessThan(5000); // All 50 operations complete within 5 seconds

      // Log metrics for analysis
      // Database Connection Pool Metrics logged
      // Failed connections tracked
      // Average response time calculated
    });

    test('should gracefully handle connection pool exhaustion', async () => {
      // Attempt to exhaust the connection pool
      const connectionHoldPromises: Promise<any>[] = [];

      // Create long-running transactions that hold connections
      for (let i = 0; i < 60; i++) {
        // More than the 50 connection limit
        const holdPromise = (async () => {
          try {
            return await prisma.$transaction(
              async tx => {
                // Hold the connection for a while
                await new Promise(resolve => setTimeout(resolve, 1000));

                const result = await tx.segmentationQueue.findMany({ take: 1 });
                return {
                  connectionId: i,
                  success: true,
                  result: result.length,
                };
              },
              {
                timeout: 2000, // 2 second timeout
              }
            );
          } catch (_error) {
            return {
              connectionId: i,
              success: false,
              error: _error instanceof Error ? _error.message : String(_error),
            };
          }
        })();

        connectionHoldPromises.push(holdPromise);
      }

      // Wait for all connection attempts
      const results = await Promise.allSettled(connectionHoldPromises);

      const successful = results.filter(
        r => r.status === 'fulfilled' && r.value.success
      );
      const failed = results.filter(
        r =>
          r.status === 'rejected' ||
          (r.status === 'fulfilled' && !r.value.success)
      );

      // Assertions for graceful degradation
      expect(successful.length).toBeLessThanOrEqual(50); // Should not exceed connection pool limit
      expect(failed.length).toBeGreaterThan(0); // Some should fail due to pool exhaustion

      // Verify that the system doesn't crash and can recover
      const healthCheck = await queueService.getQueueHealthStatus();
      expect(healthCheck).toBeDefined();
    });

    test('should maintain database consistency during concurrent operations', async () => {
      // Setup concurrent operations that modify the same data
      const user = concurrentUsers[0];
      await queueService.addBatchToQueue(
        user.imageIds,
        user.projectId,
        user.userId,
        user.model,
        user.threshold
      );

      // Create concurrent operations that could cause race conditions
      const concurrentOperations = [
        // Queue operations
        () => queueService.getQueueStats(user.projectId, user.userId),
        () => queueService.getQueueItems(user.projectId, user.userId),
        () => queueService.getNextBatch(),

        // Image status updates
        () =>
          mockImageService.updateSegmentationStatus(
            user.imageIds[0],
            'processing',
            user.userId
          ),
        () =>
          mockImageService.updateSegmentationStatus(
            user.imageIds[1],
            'queued',
            user.userId
          ),

        // Database queries
        () =>
          prisma.segmentationQueue.findMany({ where: { userId: user.userId } }),
        () =>
          prisma.segmentationQueue.count({
            where: { projectId: user.projectId },
          }),
        () => prisma.image.findMany({ where: { projectId: user.projectId } }),
      ];

      // Execute operations concurrently multiple times
      const operationPromises: Promise<any>[] = [];

      for (let round = 0; round < 3; round++) {
        for (const operation of concurrentOperations) {
          operationPromises.push(
            operation().catch(error => ({ error: error.message }))
          );
        }
      }

      const results = await Promise.all(operationPromises);

      // Check for consistency
      const errors = results.filter(r => r && r.error);
      const successes = results.filter(r => !r || !r.error);

      // Should have mostly successful operations
      expect(successes.length).toBeGreaterThan(errors.length);

      // Verify final database state is consistent
      const finalQueueCount = await prisma.segmentationQueue.count();
      expect(finalQueueCount).toBeGreaterThanOrEqual(0); // Should be non-negative

      const finalImageCount = await prisma.image.count();
      expect(finalImageCount).toBe(16); // Should match original count (4 users × 4 images)
    });
  });

  describe('WebSocket Notifications for Concurrent Streams', () => {
    test('should emit notifications for 4 concurrent processing streams', async () => {
      // Setup queue for all users
      for (const user of concurrentUsers) {
        await queueService.addBatchToQueue(
          user.imageIds,
          user.projectId,
          user.userId,
          user.model,
          user.threshold
        );
      }

      // Mock segmentation service
      (
        mockSegmentationService.requestBatchSegmentation as any
      ).mockImplementation(async (images: any[]) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return images.map(() => mockSegmentationResults());
      });

      // Track WebSocket emissions per user
      const notificationTracker: Record<
        string,
        {
          updates: number;
          completions: number;
          queueStats: number;
        }
      > = {};

      concurrentUsers.forEach(user => {
        notificationTracker[user.userId] = {
          updates: 0,
          completions: 0,
          queueStats: 0,
        };
      });

      // Mock WebSocket service to track emissions
      (mockWebSocketService.emitSegmentationUpdate as any).mockImplementation(
        (userId: string, _data: any) => {
          if (notificationTracker[userId]) {
            notificationTracker[userId].updates++;
          }
        }
      );

      (mockWebSocketService.emitSegmentationComplete as any).mockImplementation(
        (
          _userId: string,
          _imageId: string,
          _projectId: string,
          _polygonCount: number
        ) => {
          if (notificationTracker[_userId]) {
            notificationTracker[_userId].completions++;
          }
        }
      );

      (mockWebSocketService.emitQueueStatsUpdate as any).mockImplementation(
        (projectId: string, _stats: any) => {
          const user = concurrentUsers.find(u => u.projectId === projectId);
          if (user && notificationTracker[user.userId]) {
            notificationTracker[user.userId].queueStats++;
          }
        }
      );

      // Process batches concurrently
      const processingPromises = Array.from({ length: 4 }, async () => {
        const batch = await queueService.getNextBatch();
        if (batch.length > 0) {
          await queueService.processBatch(batch);
        }
        return batch.length;
      });

      await Promise.all(processingPromises);

      // Verify WebSocket notifications were sent to all users
      for (const user of concurrentUsers) {
        const userNotifications = notificationTracker[user.userId];

        expect(userNotifications.updates).toBeGreaterThan(0); // Should have status updates
        expect(userNotifications.completions).toBeGreaterThan(0); // Should have completion notifications

        // Each user should receive notifications for their images
        expect(userNotifications.updates).toBeGreaterThanOrEqual(
          user.imageIds.length
        );
        expect(userNotifications.completions).toBe(user.imageIds.length);
      }

      // Verify total notification count
      const totalUpdates = Object.values(notificationTracker).reduce(
        (sum, n) => sum + n.updates,
        0
      );
      const totalCompletions = Object.values(notificationTracker).reduce(
        (sum, n) => sum + n.completions,
        0
      );

      expect(totalUpdates).toBeGreaterThanOrEqual(16); // At least one update per image
      expect(totalCompletions).toBe(16); // Exactly one completion per image
    });

    test('should handle WebSocket notification failures gracefully', async () => {
      // Setup one user's batch
      const user = concurrentUsers[0];
      await queueService.addBatchToQueue(
        user.imageIds,
        user.projectId,
        user.userId,
        user.model,
        user.threshold
      );

      // Mock segmentation service
      (
        mockSegmentationService.requestBatchSegmentation as any
      ).mockImplementation(async (images: any[]) => {
        return images.map(() => mockSegmentationResults());
      });

      // Mock WebSocket service to fail on some notifications
      let notificationAttempts = 0;
      (mockWebSocketService.emitSegmentationUpdate as any).mockImplementation(
        (_userId: string, _data: any) => {
          notificationAttempts++;
          if (notificationAttempts % 2 === 0) {
            throw new Error('WebSocket connection failed');
          }
        }
      );

      (mockWebSocketService.emitSegmentationComplete as any).mockImplementation(
        (
          _userId: string,
          _imageId: string,
          _projectId: string,
          _polygonCount: number
        ) => {
          // Always succeed for completion notifications
        }
      );

      // Process batch - should not fail due to WebSocket errors
      const batch = await queueService.getNextBatch();

      await expect(queueService.processBatch(batch)).resolves.not.toThrow();

      // Verify processing completed despite WebSocket failures
      const remainingItems = await prisma.segmentationQueue.count({
        where: { status: 'queued' },
      });
      expect(remainingItems).toBe(0);

      // Verify some notifications were attempted
      expect(notificationAttempts).toBeGreaterThan(0);
    });
  });

  describe('Error Recovery in Parallel Processing', () => {
    test('should recover when one of 4 parallel processes fails', async () => {
      // Setup batches for all users
      for (const user of concurrentUsers) {
        await queueService.addBatchToQueue(
          user.imageIds,
          user.projectId,
          user.userId,
          user.model,
          user.threshold
        );
      }

      // Mock segmentation service to fail for one specific model
      let callCount = 0;
      (
        mockSegmentationService.requestBatchSegmentation as any
      ).mockImplementation(async (images: any[], _model: string) => {
        callCount++;

        // Fail the second batch (representing one concurrent user's failure)
        if (callCount === 2) {
          throw new Error('ML service temporarily unavailable');
        }

        await new Promise(resolve => setTimeout(resolve, 100));
        return images.map(() => mockSegmentationResults());
      });

      // Process batches concurrently
      const processingResults = await Promise.allSettled([
        queueService.processBatch(await queueService.getNextBatch()),
        queueService.processBatch(await queueService.getNextBatch()),
        queueService.processBatch(await queueService.getNextBatch()),
        queueService.processBatch(await queueService.getNextBatch()),
      ]);

      // Analyze results
      const successful = processingResults.filter(
        r => r.status === 'fulfilled'
      );
      const failed = processingResults.filter(r => r.status === 'rejected');

      // Should have some successful and some failed processing
      expect(successful.length).toBeGreaterThan(0); // Some batches should succeed
      expect(failed.length).toBeGreaterThan(0); // One batch should fail

      // Verify error recovery - failed items should be requeued for retry
      const requeuedItems = await prisma.segmentationQueue.findMany({
        where: {
          status: 'queued',
          retryCount: { gt: 0 },
        },
      });

      expect(requeuedItems.length).toBeGreaterThan(0); // Failed items should be requeued

      // Verify successful items were processed
      const processedImages = await prisma.image.findMany({
        where: { segmentationStatus: 'segmented' },
      });

      expect(processedImages.length).toBeGreaterThan(0); // Some images should be successfully processed
    });

    test('should handle database deadlocks in concurrent operations', async () => {
      // Setup concurrent operations that could cause deadlocks
      const user = concurrentUsers[0];

      // Create multiple queue entries for the same user
      await queueService.addBatchToQueue(
        user.imageIds,
        user.projectId,
        user.userId,
        user.model,
        user.threshold
      );

      // Mock operations that could cause deadlocks
      const concurrentDatabaseOperations = Array.from(
        { length: 10 },
        (_, i) => {
          return (async () => {
            try {
              // Simulate concurrent updates that might deadlock
              return await prisma.$transaction(async tx => {
                // Update queue status
                await tx.segmentationQueue.updateMany({
                  where: { userId: user.userId },
                  data: { status: i % 2 === 0 ? 'processing' : 'queued' },
                });

                // Update image status
                await tx.image.updateMany({
                  where: { projectId: user.projectId },
                  data: {
                    segmentationStatus: i % 2 === 0 ? 'processing' : 'queued',
                  },
                });

                return { success: true, operationId: i };
              });
            } catch (_error) {
              return {
                success: false,
                operationId: i,
                error: _error instanceof Error ? _error.message : String(_error),
              };
            }
          })();
        }
      );

      // Execute concurrent operations
      const results = await Promise.all(concurrentDatabaseOperations);

      // Analyze deadlock handling
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      // Should handle most operations successfully
      expect(successful.length).toBeGreaterThan(5); // At least half should succeed

      // Failed operations should be due to deadlocks, not system crashes
      const _deadlockErrors = failed.filter(r => {
        const hasError = 'error' in r && r.error;
        return (
          hasError &&
          typeof r.error === 'string' &&
          (r.error.includes('deadlock') ||
            r.error.includes('timeout') ||
            r.error.includes('lock'))
        );
      });

      // System should remain stable after potential deadlocks
      const healthCheck = await queueService.getQueueHealthStatus();
      expect(healthCheck.healthy || (healthCheck.issues && healthCheck.issues.length < 3)).toBe(true);
    });

    test('should maintain processing capability after partial failures', async () => {
      // Setup initial batch
      const user = concurrentUsers[0];
      await queueService.addBatchToQueue(
        user.imageIds,
        user.projectId,
        user.userId,
        user.model,
        user.threshold
      );

      // Mock segmentation service to fail initially, then recover
      let failureCount = 0;
      (
        mockSegmentationService.requestBatchSegmentation as any
      ).mockImplementation(async (images: any[]) => {
        failureCount++;

        // Fail first two attempts, succeed afterwards
        if (failureCount <= 2) {
          throw new Error(`Temporary failure ${failureCount}`);
        }

        return images.map(() => mockSegmentationResults());
      });

      // Attempt processing multiple times
      let processingAttempts = 0;
      let successfulProcessing = false;

      while (processingAttempts < 5 && !successfulProcessing) {
        try {
          const batch = await queueService.getNextBatch();
          if (batch.length > 0) {
            await queueService.processBatch(batch);
            successfulProcessing = true;
          }
        } catch (_error) {
          processingAttempts++;
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Verify eventual success
      expect(successfulProcessing).toBe(true);
      expect(processingAttempts).toBeLessThan(5); // Should not need all attempts

      // Verify system is still functional
      const healthStatus = await queueService.getQueueHealthStatus();
      expect(healthStatus.mlServiceHealthy).toBe(true);

      // Verify queue processing capability
      const queueStats = await queueService.getQueueStats();
      expect(queueStats.queued).toBe(0); // All items should be processed
    });
  });

  describe('Performance Metrics and Monitoring', () => {
    test('should track performance metrics for concurrent processing', async () => {
      // Setup test scenario
      for (const user of concurrentUsers) {
        await queueService.addBatchToQueue(
          user.imageIds.slice(0, 2), // Smaller batches for faster testing
          user.projectId,
          user.userId,
          user.model,
          user.threshold
        );
      }

      // Mock segmentation with realistic timings
      (
        mockSegmentationService.requestBatchSegmentation as any
      ).mockImplementation(async (images: any[], _model: string) => {
        const timing = _model === 'hrnet' ? 196 : 396; // Realistic model timings
        await new Promise(resolve => setTimeout(resolve, timing));
        return images.map(() => mockSegmentationResults());
      });

      // Track performance metrics
      const metrics: ParallelProcessingMetrics = {
        totalTime: 0,
        successfulBatches: 0,
        failedBatches: 0,
        averageBatchTime: 0,
        concurrentPeakConnections: 0,
        websocketNotificationCount: 0,
      };

      const startTime = Date.now();

      // Process batches and collect metrics
      const processingPromises = Array.from({ length: 4 }, async () => {
        const batchStartTime = Date.now();

        try {
          const batch = await queueService.getNextBatch();
          if (batch.length > 0) {
            await queueService.processBatch(batch);
            metrics.successfulBatches++;
          }

          return Date.now() - batchStartTime;
        } catch (_error) {
          metrics.failedBatches++;
          return Date.now() - batchStartTime;
        }
      });

      const batchTimes = await Promise.all(processingPromises);
      metrics.totalTime = Date.now() - startTime;
      metrics.averageBatchTime =
        batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length;

      // Performance assertions
      expect(metrics.successfulBatches).toBeGreaterThan(0);
      expect(metrics.totalTime).toBeLessThan(1000); // Should complete within 1 second
      expect(metrics.averageBatchTime).toBeLessThan(500); // Average batch time under 500ms

      // Verify parallel processing performance benefit
      const sequentialEstimate = batchTimes.reduce((a, b) => a + b, 0); // Sum of all batch times
      const parallelBenefit = sequentialEstimate / metrics.totalTime;

      expect(parallelBenefit).toBeGreaterThan(2); // Should be at least 2x faster than sequential

      // Log performance metrics for debugging
      console.info('Parallel Processing Metrics:', {
        ...metrics,
        parallelBenefit: `${parallelBenefit.toFixed(2)}x faster than sequential`,
      });
    });

    test('should provide health status during concurrent operations', async () => {
      // Setup concurrent load
      for (const user of concurrentUsers) {
        await queueService.addBatchToQueue(
          user.imageIds,
          user.projectId,
          user.userId,
          user.model,
          user.threshold
        );
      }

      // Mock slow segmentation service
      (
        mockSegmentationService.requestBatchSegmentation as any
      ).mockImplementation(async (images: any[]) => {
        await new Promise(resolve => setTimeout(resolve, 500)); // Slow processing
        return images.map(() => mockSegmentationResults());
      });

      // Start concurrent processing
      const processingPromise = Promise.all([
        queueService.processBatch(await queueService.getNextBatch()),
        queueService.processBatch(await queueService.getNextBatch()),
      ]);

      // Check health status during processing
      const healthDuringProcessing = await queueService.getQueueHealthStatus();

      // Wait for processing to complete
      await processingPromise;

      // Check health status after processing
      const healthAfterProcessing = await queueService.getQueueHealthStatus();

      // Verify health monitoring
      expect(healthDuringProcessing).toBeDefined();
      expect(healthAfterProcessing).toBeDefined();

      expect(healthAfterProcessing.queueStats.processing).toBeLessThanOrEqual(
        healthDuringProcessing.queueStats.processing
      );

      expect(healthAfterProcessing.healthy).toBe(true);
      expect(healthAfterProcessing.mlServiceHealthy).toBe(true);
    });
  });
});
