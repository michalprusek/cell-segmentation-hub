import { QueueWorker } from '../queueWorker';
import { QueueService, QueueBatch } from '../../services/queueService';
import { SegmentationService as _SegmentationService } from '../../services/segmentationService';
import { ImageService as _ImageService } from '../../services/imageService';
import { PrismaClient, SegmentationQueue } from '@prisma/client';

// Mock dependencies
jest.mock('@prisma/client');
jest.mock('../../services/queueService');
jest.mock('../../services/segmentationService');
jest.mock('../../services/imageService');

describe('QueueWorker - Parallel Processing', () => {
  let queueWorker: QueueWorker;
  let mockPrisma: jest.Mocked<PrismaClient>;
  let mockQueueService: jest.Mocked<QueueService>;

  const mockQueueItems: SegmentationQueue[] = [
    {
      id: '1',
      imageId: 'img1',
      projectId: 'proj1',
      userId: 'user1',
      model: 'hrnet',
      threshold: 0.5,
      priority: 0,
      status: 'queued',
      detectHoles: true,
      batchId: null,
      retryCount: 0,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: '2',
      imageId: 'img2',
      projectId: 'proj1',
      userId: 'user1',
      model: 'cbam_resunet',
      threshold: 0.5,
      priority: 0,
      status: 'queued',
      detectHoles: true,
      batchId: null,
      retryCount: 0,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ];

  const mockBatches: QueueBatch[] = [
    {
      id: 'batch1',
      items: [mockQueueItems[0]],
      model: 'hrnet',
      threshold: 0.5,
      priority: 0,
      estimatedProcessingTime: 1000
    },
    {
      id: 'batch2',
      items: [mockQueueItems[1]],
      model: 'cbam_resunet',
      threshold: 0.5,
      priority: 0,
      estimatedProcessingTime: 2000
    }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Setup mock implementations
    mockPrisma = {} as any;

    // Mock QueueService.getInstance to return a mock
    mockQueueService = {
      getMultipleBatches: jest.fn(),
      processMultipleBatches: jest.fn(),
      setQueueWorker: jest.fn(),
      resetStuckItems: jest.fn(),
      getQueueHealthStatus: jest.fn(),
      cleanupOldEntries: jest.fn()
    } as any;

    (QueueService.getInstance as jest.Mock).mockReturnValue(mockQueueService);

    // Create QueueWorker instance
    queueWorker = QueueWorker.getInstance(mockPrisma);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Parallel Queue Processing', () => {
    it('should process multiple batches concurrently', async () => {
      mockQueueService.getMultipleBatches.mockResolvedValue(mockBatches);
      mockQueueService.processMultipleBatches.mockResolvedValue(undefined);

      queueWorker.start();

      // Trigger immediate processing
      queueWorker.triggerImmediateProcessing();

      // Fast-forward time to trigger processing
      jest.advanceTimersByTime(100);

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockQueueService.getMultipleBatches).toHaveBeenCalledWith(4);
      expect(mockQueueService.processMultipleBatches).toHaveBeenCalledWith(mockBatches);

      queueWorker.stop();
    });

    it('should handle empty queue gracefully', async () => {
      mockQueueService.getMultipleBatches.mockResolvedValue([]);

      queueWorker.start();

      // Trigger processing
      jest.advanceTimersByTime(100);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockQueueService.getMultipleBatches).toHaveBeenCalledWith(4);
      expect(mockQueueService.processMultipleBatches).not.toHaveBeenCalled();

      queueWorker.stop();
    });

    it('should continue processing when parallel processing fails', async () => {
      mockQueueService.getMultipleBatches
        .mockResolvedValueOnce(mockBatches)
        .mockResolvedValueOnce([]);

      mockQueueService.processMultipleBatches
        .mockRejectedValueOnce(new Error('Processing failed'));

      queueWorker.start();

      // First processing cycle - should fail but not crash
      jest.advanceTimersByTime(100);
      await new Promise(resolve => setTimeout(resolve, 0));

      // Second processing cycle - should work normally
      jest.advanceTimersByTime(100);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockQueueService.getMultipleBatches).toHaveBeenCalledTimes(2);
      expect(mockQueueService.processMultipleBatches).toHaveBeenCalledTimes(1);

      queueWorker.stop();
    });

    it('should prevent overlapping processing executions', async () => {
      let resolveProcessing: (value: any) => void;
      mockQueueService.getMultipleBatches.mockResolvedValue(mockBatches);
      mockQueueService.processMultipleBatches.mockImplementation(() =>
        new Promise(resolve => {
          resolveProcessing = resolve;
        })
      );

      queueWorker.start();

      // Trigger multiple immediate processing calls
      queueWorker.triggerImmediateProcessing();
      queueWorker.triggerImmediateProcessing();
      queueWorker.triggerImmediateProcessing();

      jest.advanceTimersByTime(100);
      await new Promise(resolve => setTimeout(resolve, 0));

      // Should only call processing once (overlapping prevention)
      expect(mockQueueService.processMultipleBatches).toHaveBeenCalledTimes(1);

      // Complete the processing
      resolveProcessing!(undefined);
      await new Promise(resolve => setTimeout(resolve, 0));

      queueWorker.stop();
    });

    it('should handle immediate processing triggers correctly', async () => {
      mockQueueService.getMultipleBatches.mockResolvedValue(mockBatches);
      mockQueueService.processMultipleBatches.mockResolvedValue(undefined);

      queueWorker.start();

      // Trigger immediate processing
      queueWorker.triggerImmediateProcessing();

      // Should process immediately, not wait for interval
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockQueueService.getMultipleBatches).toHaveBeenCalledWith(4);
      expect(mockQueueService.processMultipleBatches).toHaveBeenCalledWith(mockBatches);

      queueWorker.stop();
    });

    it('should log detailed batch information during parallel processing', async () => {
      const consoleSpy = jest.spyOn(console, 'info').mockImplementation();

      mockQueueService.getMultipleBatches.mockResolvedValue(mockBatches);
      mockQueueService.processMultipleBatches.mockResolvedValue(undefined);

      queueWorker.start();
      queueWorker.triggerImmediateProcessing();

      await new Promise(resolve => setTimeout(resolve, 0));

      queueWorker.stop();
      consoleSpy.mockRestore();
    });
  });

  describe('Health Checks and Maintenance', () => {
    it('should perform periodic health checks', async () => {
      mockQueueService.resetStuckItems.mockResolvedValue(0);
      mockQueueService.getQueueHealthStatus.mockResolvedValue({
        healthy: true,
        queueStats: { queued: 0, processing: 0, completed: 0, failed: 0, stuck: 0 },
        parallelStats: {
          activeStreams: 0,
          maxConcurrentStreams: 4,
          totalProcessingCapacity: 0,
          currentThroughput: 0,
          averageProcessingTime: 0
        },
        mlServiceHealthy: true,
        issues: []
      });

      queueWorker.start();

      // Fast-forward to trigger health check (1 minute interval)
      jest.advanceTimersByTime(60000);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockQueueService.resetStuckItems).toHaveBeenCalledWith(5);
      expect(mockQueueService.getQueueHealthStatus).toHaveBeenCalled();

      queueWorker.stop();
    });

    it('should reset stuck items on startup', async () => {
      mockQueueService.resetStuckItems.mockResolvedValue(2);

      queueWorker.start();

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockQueueService.resetStuckItems).toHaveBeenCalledWith(10);

      queueWorker.stop();
    });

    it('should perform periodic cleanup of old entries', async () => {
      mockPrisma.segmentationQueue = {
        deleteMany: jest.fn().mockResolvedValue({ count: 5 })
      } as any;

      queueWorker.start();

      // Fast-forward to trigger cleanup (1 hour interval)
      jest.advanceTimersByTime(3600000);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockPrisma.segmentationQueue.deleteMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['completed', 'failed'] },
          completedAt: { lt: expect.any(Date) }
        }
      });

      queueWorker.stop();
    });

    it('should handle health check failures gracefully', async () => {
      mockQueueService.resetStuckItems.mockRejectedValue(new Error('Database error'));
      mockQueueService.getQueueHealthStatus.mockRejectedValue(new Error('Health check failed'));

      queueWorker.start();

      // Should not crash on health check failures
      jest.advanceTimersByTime(60000);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockQueueService.resetStuckItems).toHaveBeenCalled();

      queueWorker.stop();
    });
  });

  describe('Lifecycle Management', () => {
    it('should start and stop correctly', () => {
      expect(queueWorker.start).toBeDefined();
      expect(queueWorker.stop).toBeDefined();

      // Should not throw when starting/stopping
      expect(() => queueWorker.start()).not.toThrow();
      expect(() => queueWorker.stop()).not.toThrow();

      // Should handle multiple start/stop calls
      expect(() => queueWorker.start()).not.toThrow();
      expect(() => queueWorker.stop()).not.toThrow();
    });

    it('should register itself with QueueService', () => {
      queueWorker.start();

      expect(mockQueueService.setQueueWorker).toHaveBeenCalledWith(queueWorker);

      queueWorker.stop();
    });

    it('should process queue immediately on start', async () => {
      mockQueueService.getMultipleBatches.mockResolvedValue([]);

      queueWorker.start();

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockQueueService.getMultipleBatches).toHaveBeenCalled();

      queueWorker.stop();
    });

    it('should handle trigger calls when not running', () => {
      // Should not throw when calling trigger before start
      expect(() => queueWorker.triggerImmediateProcessing()).not.toThrow();

      queueWorker.start();
      queueWorker.stop();

      // Should not throw when calling trigger after stop
      expect(() => queueWorker.triggerImmediateProcessing()).not.toThrow();
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle queue service errors gracefully', async () => {
      mockQueueService.getMultipleBatches.mockRejectedValue(new Error('Queue service error'));

      queueWorker.start();

      // Should not crash on queue service errors
      jest.advanceTimersByTime(100);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockQueueService.getMultipleBatches).toHaveBeenCalled();

      queueWorker.stop();
    });

    it('should continue periodic processing after errors', async () => {
      mockQueueService.getMultipleBatches
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce([]);

      queueWorker.start();

      // First cycle - error
      jest.advanceTimersByTime(100);
      await new Promise(resolve => setTimeout(resolve, 0));

      // Second cycle - should work
      jest.advanceTimersByTime(100);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockQueueService.getMultipleBatches).toHaveBeenCalledTimes(2);

      queueWorker.stop();
    });

    it('should handle parallel processing errors without affecting health checks', async () => {
      mockQueueService.getMultipleBatches.mockResolvedValue(mockBatches);
      mockQueueService.processMultipleBatches.mockRejectedValue(new Error('Processing error'));
      mockQueueService.resetStuckItems.mockResolvedValue(0);

      queueWorker.start();

      // Processing cycle with error
      jest.advanceTimersByTime(100);
      await new Promise(resolve => setTimeout(resolve, 0));

      // Health check cycle should still work
      jest.advanceTimersByTime(60000);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockQueueService.processMultipleBatches).toHaveBeenCalled();
      expect(mockQueueService.resetStuckItems).toHaveBeenCalled();

      queueWorker.stop();
    });
  });

  describe('Performance and Optimization', () => {
    it('should use optimal processing interval', () => {
      queueWorker.start();

      // Should use 100ms interval for near-instant processing
      jest.advanceTimersByTime(99);
      expect(mockQueueService.getMultipleBatches).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(mockQueueService.getMultipleBatches).toHaveBeenCalled();

      queueWorker.stop();
    });

    it('should handle high-frequency processing requests efficiently', async () => {
      mockQueueService.getMultipleBatches.mockResolvedValue([]);

      queueWorker.start();

      // Rapid-fire trigger calls
      for (let i = 0; i < 10; i++) {
        queueWorker.triggerImmediateProcessing();
      }

      await new Promise(resolve => setTimeout(resolve, 0));

      // Should not overwhelm the system with multiple simultaneous processing
      // (overlap prevention should handle this)
      expect(mockQueueService.getMultipleBatches).toHaveBeenCalledTimes(1);

      queueWorker.stop();
    });

    it('should process different batch configurations efficiently', async () => {
      const diverseBatches: QueueBatch[] = [
        {
          id: 'batch1',
          items: [mockQueueItems[0]],
          model: 'hrnet',
          threshold: 0.5,
          priority: 1,
          estimatedProcessingTime: 500
        },
        {
          id: 'batch2',
          items: [mockQueueItems[1]],
          model: 'cbam_resunet',
          threshold: 0.7,
          priority: 0,
          estimatedProcessingTime: 1500
        }
      ];

      mockQueueService.getMultipleBatches.mockResolvedValue(diverseBatches);
      mockQueueService.processMultipleBatches.mockResolvedValue(undefined);

      queueWorker.start();
      queueWorker.triggerImmediateProcessing();

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockQueueService.processMultipleBatches).toHaveBeenCalledWith(diverseBatches);

      queueWorker.stop();
    });
  });

  describe('Singleton Pattern', () => {
    it('should maintain singleton instance', () => {
      const instance1 = QueueWorker.getInstance(mockPrisma);
      const instance2 = QueueWorker.getInstance(mockPrisma);

      expect(instance1).toBe(instance2);
    });

    it('should work with singleton across start/stop cycles', () => {
      const instance = QueueWorker.getInstance(mockPrisma);

      instance.start();
      instance.stop();
      instance.start();
      instance.stop();

      // Should not throw errors
      expect(() => instance.triggerImmediateProcessing()).not.toThrow();
    });
  });
});