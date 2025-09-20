import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueueService } from '../../services/queueService';
import { WebSocketService } from '../../services/websocketService';
import { prisma } from '../../db';
import { performance } from 'perf_hooks';

// Mock dependencies
vi.mock('../../utils/logger');

// Mock Prisma with performance tracking
const createMockPrisma = () => ({
  segmentationQueue: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn()
  },
  $transaction: vi.fn(),
  $executeRaw: vi.fn()
});

describe('Cancel Performance Tests', () => {
  let queueService: QueueService;
  let websocketService: WebSocketService;
  let mockPrisma: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = createMockPrisma();

    // Reset singletons
    (QueueService as any).instance = null;
    (WebSocketService as any).instance = null;

    queueService = QueueService.getInstance(mockPrisma, {} as any, {} as any);
    websocketService = WebSocketService.getInstance();
  });

  afterEach(() => {
    vi.resetAllMocks();
    (QueueService as any).instance = null;
    (WebSocketService as any).instance = null;
  });

  describe('Large Scale Cancellation Performance', () => {
    it('should cancel 1000+ queue items efficiently', async () => {
      const projectId = 'perf-project';
      const userId = 'perf-user';
      const itemCount = 1000;

      // Generate large dataset
      const largeQueue = Array.from({ length: itemCount }, (_, i) => ({
        id: `perf-queue-${i}`,
        imageId: `perf-img-${i}`,
        projectId,
        userId,
        status: 'queued',
        batchId: 'perf-batch'
      }));

      mockPrisma.segmentationQueue.findMany.mockResolvedValue(largeQueue);
      mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: itemCount });
      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      const startTime = performance.now();
      const startMemory = process.memoryUsage();

      const result = await queueService.cancelByProject(projectId, userId);

      const endTime = performance.now();
      const endMemory = process.memoryUsage();

      const duration = endTime - startTime;
      const memoryUsed = endMemory.heapUsed - startMemory.heapUsed;

      // Performance assertions
      expect(result).toHaveLength(itemCount);
      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
      expect(memoryUsed).toBeLessThan(50 * 1024 * 1024); // Less than 50MB memory increase

      // Verify efficient database queries
      expect(mockPrisma.segmentationQueue.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.segmentationQueue.updateMany).toHaveBeenCalledTimes(1);
    });

    it('should handle 10,000 item cancellation with chunking', async () => {
      const projectId = 'mega-project';
      const userId = 'mega-user';
      const itemCount = 10000;

      // Simulate chunked processing
      const chunkSize = 1000;
      const chunks = Math.ceil(itemCount / chunkSize);

      let findManyCallCount = 0;
      let updateManyCallCount = 0;

      mockPrisma.segmentationQueue.findMany.mockImplementation(() => {
        findManyCallCount++;
        const startIndex = (findManyCallCount - 1) * chunkSize;
        const endIndex = Math.min(startIndex + chunkSize, itemCount);

        return Promise.resolve(
          Array.from({ length: endIndex - startIndex }, (_, i) => ({
            id: `mega-queue-${startIndex + i}`,
            imageId: `mega-img-${startIndex + i}`,
            projectId,
            userId,
            status: 'queued'
          }))
        );
      });

      mockPrisma.segmentationQueue.updateMany.mockImplementation(() => {
        updateManyCallCount++;
        return Promise.resolve({ count: Math.min(chunkSize, itemCount - (updateManyCallCount - 1) * chunkSize) });
      });

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      const startTime = performance.now();

      // For this test, we'll simulate chunked cancellation
      let totalCancelled = 0;
      for (let i = 0; i < chunks; i++) {
        const chunkResult = await queueService.cancelByProject(projectId, userId);
        totalCancelled += chunkResult.length;
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(totalCancelled).toBeGreaterThanOrEqual(itemCount);
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
      expect(findManyCallCount).toBe(chunks);
      expect(updateManyCallCount).toBe(chunks);
    });

    it('should maintain response time under load', async () => {
      const concurrentUsers = 10;
      const itemsPerUser = 100;

      const performanceResults: Array<{ userId: string; duration: number; itemCount: number }> = [];

      // Setup concurrent cancellations
      const concurrentPromises = Array.from({ length: concurrentUsers }, (_, userIndex) => {
        const userId = `load-user-${userIndex}`;
        const projectId = 'load-project';

        const userQueue = Array.from({ length: itemsPerUser }, (_, i) => ({
          id: `load-queue-${userId}-${i}`,
          imageId: `load-img-${userId}-${i}`,
          projectId,
          userId,
          status: 'queued'
        }));

        mockPrisma.segmentationQueue.findMany.mockResolvedValueOnce(userQueue);
        mockPrisma.segmentationQueue.updateMany.mockResolvedValueOnce({ count: itemsPerUser });

        return (async () => {
          const startTime = performance.now();
          const result = await queueService.cancelByProject(projectId, userId);
          const endTime = performance.now();

          performanceResults.push({
            userId,
            duration: endTime - startTime,
            itemCount: result.length
          });

          return result;
        })();
      });

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      const allResults = await Promise.all(concurrentPromises);

      // Performance assertions
      expect(allResults).toHaveLength(concurrentUsers);
      allResults.forEach(result => {
        expect(result).toHaveLength(itemsPerUser);
      });

      // Check response times
      const averageResponseTime = performanceResults.reduce((sum, r) => sum + r.duration, 0) / performanceResults.length;
      const maxResponseTime = Math.max(...performanceResults.map(r => r.duration));

      expect(averageResponseTime).toBeLessThan(1000); // Average under 1 second
      expect(maxResponseTime).toBeLessThan(3000); // Max under 3 seconds

      // Performance metrics recorded for analysis
      expect(averageResponseTime).toBeLessThan(1000);
      expect(maxResponseTime).toBeLessThan(3000);
      expect(concurrentUsers * itemsPerUser).toBeGreaterThan(0);
    });
  });

  describe('Database Query Optimization', () => {
    it('should use efficient queries for large datasets', async () => {
      const projectId = 'query-project';
      const userId = 'query-user';
      const itemCount = 5000;

      const largeQueue = Array.from({ length: itemCount }, (_, i) => ({
        id: `query-${i}`,
        imageId: `img-${i}`,
        projectId,
        userId,
        status: 'queued'
      }));

      mockPrisma.segmentationQueue.findMany.mockResolvedValue(largeQueue);
      mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: itemCount });
      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      await queueService.cancelByProject(projectId, userId);

      // Verify query optimization
      expect(mockPrisma.segmentationQueue.findMany).toHaveBeenCalledWith({
        where: {
          projectId,
          userId,
          status: { in: ['queued', 'processing'] }
        },
        select: { id: true } // Only select ID for efficiency
      });

      expect(mockPrisma.segmentationQueue.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: largeQueue.map(item => item.id) }
        },
        data: {
          status: 'cancelled',
          updatedAt: expect.any(Date),
          completedAt: expect.any(Date)
        }
      });
    });

    it('should minimize transaction time', async () => {
      const projectId = 'tx-project';
      const userId = 'tx-user';

      let transactionStartTime: number;
      let transactionEndTime: number;

      mockPrisma.segmentationQueue.findMany.mockResolvedValue([
        { id: 'tx-1', imageId: 'img-tx-1', projectId, userId, status: 'queued' }
      ]);

      mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: 1 });

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        transactionStartTime = performance.now();

        let result;
        if (Array.isArray(operations)) {
          result = await Promise.all(operations.map(op => op));
        } else {
          result = await operations;
        }

        transactionEndTime = performance.now();
        return result;
      });

      await queueService.cancelByProject(projectId, userId);

      const transactionDuration = transactionEndTime! - transactionStartTime!;
      expect(transactionDuration).toBeLessThan(100); // Transaction should be very fast
    });

    it('should handle index optimization queries', async () => {
      const projectId = 'index-project';
      const userId = 'index-user';

      // Simulate query with proper indexing
      mockPrisma.segmentationQueue.findMany.mockImplementation((query) => {
        // Verify query uses indexed fields
        expect(query.where).toHaveProperty('projectId');
        expect(query.where).toHaveProperty('userId');
        expect(query.where.status).toEqual({ in: ['queued', 'processing'] });

        return Promise.resolve([
          { id: 'indexed-1', imageId: 'img-1', projectId, userId, status: 'queued' }
        ]);
      });

      mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      const startTime = performance.now();
      await queueService.cancelByProject(projectId, userId);
      const endTime = performance.now();

      // With proper indexing, query should be very fast
      expect(endTime - startTime).toBeLessThan(50);
    });
  });

  describe('Memory Management', () => {
    it('should handle large result sets without memory leaks', async () => {
      const projectId = 'memory-project';
      const userId = 'memory-user';
      const iterations = 5;
      const itemsPerIteration = 1000;

      const initialMemory = process.memoryUsage();

      for (let i = 0; i < iterations; i++) {
        const queue = Array.from({ length: itemsPerIteration }, (_, j) => ({
          id: `mem-${i}-${j}`,
          imageId: `img-${i}-${j}`,
          projectId,
          userId,
          status: 'queued'
        }));

        mockPrisma.segmentationQueue.findMany.mockResolvedValueOnce(queue);
        mockPrisma.segmentationQueue.updateMany.mockResolvedValueOnce({ count: itemsPerIteration });
        mockPrisma.$transaction.mockImplementation(async (operations) => {
          if (Array.isArray(operations)) {
            return Promise.all(operations.map(op => op));
          }
          return operations;
        });

        await queueService.cancelByProject(projectId, userId);

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory increase should be minimal
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // Less than 10MB
    });

    it('should efficiently process streaming large datasets', async () => {
      const projectId = 'stream-project';
      const userId = 'stream-user';
      const totalItems = 50000;
      const chunkSize = 1000;

      let processedItems = 0;
      const memorySnapshots: number[] = [];

      // Simulate streaming processing
      while (processedItems < totalItems) {
        const currentChunkSize = Math.min(chunkSize, totalItems - processedItems);

        const chunk = Array.from({ length: currentChunkSize }, (_, i) => ({
          id: `stream-${processedItems + i}`,
          imageId: `img-${processedItems + i}`,
          projectId,
          userId,
          status: 'queued'
        }));

        mockPrisma.segmentationQueue.findMany.mockResolvedValueOnce(chunk);
        mockPrisma.segmentationQueue.updateMany.mockResolvedValueOnce({ count: currentChunkSize });
        mockPrisma.$transaction.mockImplementation(async (operations) => {
          if (Array.isArray(operations)) {
            return Promise.all(operations.map(op => op));
          }
          return operations;
        });

        await queueService.cancelByProject(projectId, userId);

        processedItems += currentChunkSize;
        memorySnapshots.push(process.memoryUsage().heapUsed);

        // Force garbage collection periodically
        if (processedItems % (chunkSize * 5) === 0 && global.gc) {
          global.gc();
        }
      }

      // Memory usage should remain stable
      const memoryGrowth = memorySnapshots[memorySnapshots.length - 1] - memorySnapshots[0];
      const maxMemorySpike = Math.max(...memorySnapshots) - memorySnapshots[0];

      expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024); // Less than 50MB total growth
      expect(maxMemorySpike).toBeLessThan(100 * 1024 * 1024); // Less than 100MB spike
    });
  });

  describe('WebSocket Performance', () => {
    it('should handle high frequency cancel events efficiently', async () => {
      const userId = 'ws-user';
      const eventCount = 1000;

      // Mock WebSocket service
      const mockSocket = {
        emit: vi.fn()
      };

      (websocketService as any).userSockets = new Map();
      (websocketService as any).userSockets.set(userId, mockSocket);

      const startTime = performance.now();

      // Emit many events rapidly
      for (let i = 0; i < eventCount; i++) {
        websocketService.emitToUser(userId, 'queue:cancelled', {
          projectId: 'ws-project',
          cancelledCount: i + 1,
          timestamp: new Date().toISOString()
        });
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(mockSocket.emit).toHaveBeenCalledTimes(eventCount);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second

      const avgTimePerEvent = duration / eventCount;
      expect(avgTimePerEvent).toBeLessThan(1); // Less than 1ms per event
    });

    it('should handle concurrent WebSocket emissions', async () => {
      const userCount = 100;
      const eventsPerUser = 10;

      // Setup multiple users
      const userSockets = new Map();
      for (let i = 0; i < userCount; i++) {
        const userId = `concurrent-user-${i}`;
        const mockSocket = { emit: vi.fn() };
        userSockets.set(userId, mockSocket);
      }

      (websocketService as any).userSockets = userSockets;

      const startTime = performance.now();

      // Emit to all users concurrently
      const emissionPromises = [];
      for (let i = 0; i < userCount; i++) {
        const userId = `concurrent-user-${i}`;

        for (let j = 0; j < eventsPerUser; j++) {
          emissionPromises.push(
            Promise.resolve().then(() => {
              websocketService.emitToUser(userId, 'queue:cancelled', {
                projectId: `project-${i}`,
                cancelledCount: j + 1,
                timestamp: new Date().toISOString()
              });
            })
          );
        }
      }

      await Promise.all(emissionPromises);

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds

      // Verify all emissions
      for (let i = 0; i < userCount; i++) {
        const userId = `concurrent-user-${i}`;
        const socket = userSockets.get(userId);
        expect(socket.emit).toHaveBeenCalledTimes(eventsPerUser);
      }
    });
  });

  describe('Throughput Benchmarks', () => {
    it('should meet minimum cancellation throughput', async () => {
      const projectId = 'throughput-project';
      const userId = 'throughput-user';
      const targetThroughput = 1000; // items per second
      const testDuration = 5000; // 5 seconds
      const expectedItems = (targetThroughput * testDuration) / 1000;

      let totalCancelled = 0;
      const startTime = performance.now();

      // Continuous cancellation for test duration
      while (performance.now() - startTime < testDuration) {
        const batchSize = 100;
        const batch = Array.from({ length: batchSize }, (_, i) => ({
          id: `throughput-${totalCancelled + i}`,
          imageId: `img-${totalCancelled + i}`,
          projectId,
          userId,
          status: 'queued'
        }));

        mockPrisma.segmentationQueue.findMany.mockResolvedValueOnce(batch);
        mockPrisma.segmentationQueue.updateMany.mockResolvedValueOnce({ count: batchSize });
        mockPrisma.$transaction.mockImplementation(async (operations) => {
          if (Array.isArray(operations)) {
            return Promise.all(operations.map(op => op));
          }
          return operations;
        });

        const cancelled = await queueService.cancelByProject(projectId, userId);
        totalCancelled += cancelled.length;
      }

      const actualDuration = performance.now() - startTime;
      const actualThroughput = (totalCancelled / actualDuration) * 1000;

      expect(actualThroughput).toBeGreaterThanOrEqual(targetThroughput * 0.8); // 80% of target
      expect(totalCancelled).toBeGreaterThanOrEqual(expectedItems * 0.8);

      // Throughput benchmark results recorded for analysis
      expect(actualThroughput).toBeGreaterThan(0);
      expect(totalCancelled).toBeGreaterThan(0);
      expect(actualDuration).toBeGreaterThan(0);
    });

    it('should maintain performance under sustained load', async () => {
      const sustainedTestDuration = 30000; // 30 seconds
      const batchSize = 50;
      const batchInterval = 100; // 100ms between batches

      const performanceMetrics: Array<{ timestamp: number; duration: number; itemCount: number }> = [];
      const startTime = performance.now();

      let batchNumber = 0;
      const intervalId = setInterval(async () => {
        if (performance.now() - startTime >= sustainedTestDuration) {
          clearInterval(intervalId);
          return;
        }

        const projectId = 'sustained-project';
        const userId = 'sustained-user';

        const batch = Array.from({ length: batchSize }, (_, i) => ({
          id: `sustained-${batchNumber}-${i}`,
          imageId: `img-${batchNumber}-${i}`,
          projectId,
          userId,
          status: 'queued'
        }));

        mockPrisma.segmentationQueue.findMany.mockResolvedValueOnce(batch);
        mockPrisma.segmentationQueue.updateMany.mockResolvedValueOnce({ count: batchSize });
        mockPrisma.$transaction.mockImplementation(async (operations) => {
          if (Array.isArray(operations)) {
            return Promise.all(operations.map(op => op));
          }
          return operations;
        });

        const batchStartTime = performance.now();
        const cancelled = await queueService.cancelByProject(projectId, userId);
        const batchEndTime = performance.now();

        performanceMetrics.push({
          timestamp: batchStartTime,
          duration: batchEndTime - batchStartTime,
          itemCount: cancelled.length
        });

        batchNumber++;
      }, batchInterval);

      // Wait for test completion
      await new Promise(resolve => {
        setTimeout(resolve, sustainedTestDuration + 1000);
      });

      // Analyze performance degradation
      const firstHalf = performanceMetrics.slice(0, Math.floor(performanceMetrics.length / 2));
      const secondHalf = performanceMetrics.slice(Math.floor(performanceMetrics.length / 2));

      const avgFirstHalf = firstHalf.reduce((sum, m) => sum + m.duration, 0) / firstHalf.length;
      const avgSecondHalf = secondHalf.reduce((sum, m) => sum + m.duration, 0) / secondHalf.length;

      const performanceDegradation = (avgSecondHalf - avgFirstHalf) / avgFirstHalf;

      // Performance should not degrade more than 20%
      expect(performanceDegradation).toBeLessThan(0.2);
      expect(performanceMetrics.length).toBeGreaterThan(100); // Should process many batches

      // Sustained load results recorded for analysis
      expect(performanceMetrics.length).toBeGreaterThan(0);
      expect(avgFirstHalf).toBeGreaterThan(0);
      expect(avgSecondHalf).toBeGreaterThan(0);
      expect(performanceDegradation).toBeLessThan(1);
    });
  });
});