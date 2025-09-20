import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueueService } from '../queueService';
import { SegmentationService } from '../segmentationService';
import { ImageService } from '../imageService';
import { logger } from '../../utils/logger';

// Mock dependencies
vi.mock('../../utils/logger');
vi.mock('../segmentationService');
vi.mock('../imageService');

// Mock Prisma
const mockPrisma = {
  segmentationQueue: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  },
  $transaction: vi.fn(),
  $executeRaw: vi.fn()
};

// Mock data
const mockQueueItems = [
  {
    id: 'queue-1',
    imageId: 'img-1',
    projectId: 'project-123',
    userId: 'user-123',
    status: 'queued',
    batchId: 'batch-123',
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
    startedAt: null,
    completedAt: null,
    model: 'hrnet',
    threshold: 0.5,
    priority: 0,
    detectHoles: true,
    error: null,
    retryCount: 0
  },
  {
    id: 'queue-2',
    imageId: 'img-2',
    projectId: 'project-123',
    userId: 'user-123',
    status: 'processing',
    batchId: 'batch-123',
    createdAt: new Date('2024-01-01T10:01:00Z'),
    updatedAt: new Date('2024-01-01T10:01:00Z'),
    startedAt: new Date('2024-01-01T10:01:00Z'),
    completedAt: null,
    model: 'hrnet',
    threshold: 0.5,
    priority: 0,
    detectHoles: true,
    error: null,
    retryCount: 0
  },
  {
    id: 'queue-3',
    imageId: 'img-3',
    projectId: 'project-123',
    userId: 'other-user',
    status: 'queued',
    batchId: 'batch-456',
    createdAt: new Date('2024-01-01T10:02:00Z'),
    updatedAt: new Date('2024-01-01T10:02:00Z'),
    startedAt: null,
    completedAt: null,
    model: 'hrnet',
    threshold: 0.5,
    priority: 0,
    detectHoles: true,
    error: null,
    retryCount: 0
  },
  {
    id: 'queue-4',
    imageId: 'img-4',
    projectId: 'project-123',
    userId: 'user-123',
    status: 'completed',
    batchId: 'batch-123',
    createdAt: new Date('2024-01-01T09:00:00Z'),
    updatedAt: new Date('2024-01-01T09:30:00Z'),
    startedAt: new Date('2024-01-01T09:00:00Z'),
    completedAt: new Date('2024-01-01T09:30:00Z'),
    model: 'hrnet',
    threshold: 0.5,
    priority: 0,
    detectHoles: true,
    error: null,
    retryCount: 0
  }
];

describe('QueueService Cancel Methods', () => {
  let queueService: QueueService;
  let mockSegmentationService: any;
  let mockImageService: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSegmentationService = {
      processQueue: vi.fn()
    };

    mockImageService = {
      getImageById: vi.fn()
    };

    vi.mocked(SegmentationService).mockImplementation(() => mockSegmentationService);
    vi.mocked(ImageService).mockImplementation(() => mockImageService);

    // Create QueueService instance with mocked dependencies
    queueService = QueueService.getInstance(mockPrisma as any, mockSegmentationService, mockImageService);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('cancelByProject', () => {
    it('should cancel queue items atomically', async () => {
      const projectId = 'project-123';
      const userId = 'user-123';

      // Mock finding cancellable items
      mockPrisma.segmentationQueue.findMany.mockResolvedValue([
        mockQueueItems[0], // queued
        mockQueueItems[1]  // processing
      ]);

      // Mock successful update
      mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: 2 });

      // Mock transaction
      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      const result = await queueService.cancelByProject(projectId, userId);

      expect(mockPrisma.segmentationQueue.findMany).toHaveBeenCalledWith({
        where: {
          projectId,
          userId,
          status: { in: ['queued', 'processing'] }
        },
        select: { id: true }
      });

      expect(mockPrisma.segmentationQueue.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['queue-1', 'queue-2'] }
        },
        data: {
          status: 'cancelled',
          updatedAt: expect.any(Date),
          completedAt: expect.any(Date)
        }
      });

      expect(result).toEqual(['queue-1', 'queue-2']);
    });

    it('should handle race conditions', async () => {
      const projectId = 'project-123';
      const userId = 'user-123';

      // First call finds items
      mockPrisma.segmentationQueue.findMany.mockResolvedValue([
        mockQueueItems[0],
        mockQueueItems[1]
      ]);

      // But update only affects one item (other was processed in parallel)
      mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: 1 });

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      const result = await queueService.cancelByProject(projectId, userId);

      expect(result).toEqual(['queue-1', 'queue-2']); // Returns original found items
      expect(logger.info).toHaveBeenCalledWith(
        'Cancelled queue items for project',
        expect.objectContaining({
          projectId,
          userId,
          itemsFound: 2,
          itemsUpdated: 1
        })
      );
    });

    it('should handle empty queue gracefully', async () => {
      const projectId = 'project-123';
      const userId = 'user-123';

      mockPrisma.segmentationQueue.findMany.mockResolvedValue([]);

      const result = await queueService.cancelByProject(projectId, userId);

      expect(result).toEqual([]);
      expect(mockPrisma.segmentationQueue.updateMany).not.toHaveBeenCalled();
    });

    it('should only cancel user\'s items', async () => {
      const projectId = 'project-123';
      const userId = 'user-123';

      mockPrisma.segmentationQueue.findMany.mockResolvedValue([
        mockQueueItems[0], // user-123's item
        mockQueueItems[1]  // user-123's item
        // mockQueueItems[2] is other-user's item - not returned
      ]);

      mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: 2 });

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      await queueService.cancelByProject(projectId, userId);

      expect(mockPrisma.segmentationQueue.findMany).toHaveBeenCalledWith({
        where: {
          projectId,
          userId, // Only user's items
          status: { in: ['queued', 'processing'] }
        },
        select: { id: true }
      });
    });

    it('should not cancel completed items', async () => {
      const projectId = 'project-123';
      const userId = 'user-123';

      // Only return queued/processing items, not completed ones
      mockPrisma.segmentationQueue.findMany.mockResolvedValue([
        mockQueueItems[0], // queued
        mockQueueItems[1]  // processing
        // mockQueueItems[3] is completed - not included
      ]);

      mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: 2 });

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      await queueService.cancelByProject(projectId, userId);

      expect(mockPrisma.segmentationQueue.findMany).toHaveBeenCalledWith({
        where: {
          projectId,
          userId,
          status: { in: ['queued', 'processing'] } // Only cancellable statuses
        },
        select: { id: true }
      });
    });

    it('should handle database transaction rollback', async () => {
      const projectId = 'project-123';
      const userId = 'user-123';

      mockPrisma.segmentationQueue.findMany.mockResolvedValue([mockQueueItems[0]]);

      const transactionError = new Error('Transaction failed');
      mockPrisma.$transaction.mockRejectedValue(transactionError);

      await expect(queueService.cancelByProject(projectId, userId)).rejects.toThrow('Transaction failed');

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to cancel queue items for project',
        expect.objectContaining({
          error: transactionError,
          projectId,
          userId
        })
      );
    });

    it('should handle concurrent cancel operations', async () => {
      const projectId = 'project-123';
      const userId = 'user-123';

      // Simulate concurrent operations by having different results
      mockPrisma.segmentationQueue.findMany
        .mockResolvedValueOnce([mockQueueItems[0], mockQueueItems[1]])
        .mockResolvedValueOnce([mockQueueItems[0]]); // Second call finds fewer items

      mockPrisma.segmentationQueue.updateMany
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce({ count: 1 });

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      const [result1, result2] = await Promise.all([
        queueService.cancelByProject(projectId, userId),
        queueService.cancelByProject(projectId, userId)
      ]);

      expect(result1).toEqual(['queue-1', 'queue-2']);
      expect(result2).toEqual(['queue-1']);
    });
  });

  describe('cancelBatch', () => {
    it('should cancel batch with proper logging', async () => {
      const batchId = 'batch-123';
      const userId = 'user-123';

      mockPrisma.segmentationQueue.findMany.mockResolvedValue([
        mockQueueItems[0],
        mockQueueItems[1]
      ]);

      mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: 2 });

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      const result = await queueService.cancelBatch(batchId, userId);

      expect(mockPrisma.segmentationQueue.findMany).toHaveBeenCalledWith({
        where: {
          batchId,
          userId,
          status: { in: ['queued', 'processing'] }
        },
        select: { id: true }
      });

      expect(result).toEqual(['queue-1', 'queue-2']);

      expect(logger.info).toHaveBeenCalledWith(
        'Cancelled batch items',
        expect.objectContaining({
          batchId,
          userId,
          itemsFound: 2,
          itemsUpdated: 2
        })
      );
    });

    it('should only cancel user\'s batch items', async () => {
      const batchId = 'batch-123';
      const userId = 'user-123';

      // Mock returns only user's items from the batch
      mockPrisma.segmentationQueue.findMany.mockResolvedValue([
        mockQueueItems[0],
        mockQueueItems[1]
      ]);

      mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: 2 });

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      await queueService.cancelBatch(batchId, userId);

      expect(mockPrisma.segmentationQueue.findMany).toHaveBeenCalledWith({
        where: {
          batchId,
          userId, // Filter by user
          status: { in: ['queued', 'processing'] }
        },
        select: { id: true }
      });
    });

    it('should handle non-existent batch', async () => {
      const batchId = 'non-existent-batch';
      const userId = 'user-123';

      mockPrisma.segmentationQueue.findMany.mockResolvedValue([]);

      const result = await queueService.cancelBatch(batchId, userId);

      expect(result).toEqual([]);
      expect(mockPrisma.segmentationQueue.updateMany).not.toHaveBeenCalled();
    });

    it('should set correct timestamps', async () => {
      const batchId = 'batch-123';
      const userId = 'user-123';
      const beforeTime = new Date();

      mockPrisma.segmentationQueue.findMany.mockResolvedValue([mockQueueItems[0]]);
      mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: 1 });

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      await queueService.cancelBatch(batchId, userId);

      const afterTime = new Date();

      expect(mockPrisma.segmentationQueue.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['queue-1'] }
        },
        data: {
          status: 'cancelled',
          updatedAt: expect.any(Date),
          completedAt: expect.any(Date)
        }
      });

      // Verify timestamps are reasonable
      const updateCall = mockPrisma.segmentationQueue.updateMany.mock.calls[0][0];
      const updatedAt = updateCall.data.updatedAt;
      const completedAt = updateCall.data.completedAt;

      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(updatedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
      expect(completedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(completedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      const projectId = 'project-123';
      const userId = 'user-123';

      const dbError = new Error('Database connection failed');
      mockPrisma.segmentationQueue.findMany.mockRejectedValue(dbError);

      await expect(queueService.cancelByProject(projectId, userId)).rejects.toThrow('Database connection failed');

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to cancel queue items for project',
        expect.objectContaining({
          error: dbError,
          projectId,
          userId
        })
      );
    });

    it('should handle partial database failures', async () => {
      const projectId = 'project-123';
      const userId = 'user-123';

      mockPrisma.segmentationQueue.findMany.mockResolvedValue([
        mockQueueItems[0],
        mockQueueItems[1]
      ]);

      // Update fails for some reason
      mockPrisma.segmentationQueue.updateMany.mockRejectedValue(new Error('Update failed'));

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      await expect(queueService.cancelByProject(projectId, userId)).rejects.toThrow('Update failed');
    });

    it('should handle timeout errors', async () => {
      const projectId = 'project-123';
      const userId = 'user-123';

      const timeoutError = new Error('Query timeout');
      mockPrisma.$transaction.mockRejectedValue(timeoutError);

      await expect(queueService.cancelByProject(projectId, userId)).rejects.toThrow('Query timeout');
    });
  });

  describe('Performance Tests', () => {
    it('should handle cancellation of large batches efficiently', async () => {
      const projectId = 'project-123';
      const userId = 'user-123';

      // Generate large number of queue items
      const largeQueue = Array.from({ length: 1000 }, (_, i) => ({
        ...mockQueueItems[0],
        id: `queue-${i}`,
        imageId: `img-${i}`
      }));

      mockPrisma.segmentationQueue.findMany.mockResolvedValue(largeQueue);
      mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: 1000 });

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      const startTime = Date.now();
      const result = await queueService.cancelByProject(projectId, userId);
      const endTime = Date.now();

      expect(result).toHaveLength(1000);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete in under 5 seconds
    });

    it('should handle concurrent large cancellations', async () => {
      const projectId = 'project-123';
      const userId1 = 'user-123';
      const userId2 = 'user-456';

      const queue1 = Array.from({ length: 500 }, (_, i) => ({
        ...mockQueueItems[0],
        id: `queue-1-${i}`,
        userId: userId1
      }));

      const queue2 = Array.from({ length: 500 }, (_, i) => ({
        ...mockQueueItems[0],
        id: `queue-2-${i}`,
        userId: userId2
      }));

      mockPrisma.segmentationQueue.findMany
        .mockResolvedValueOnce(queue1)
        .mockResolvedValueOnce(queue2);

      mockPrisma.segmentationQueue.updateMany
        .mockResolvedValueOnce({ count: 500 })
        .mockResolvedValueOnce({ count: 500 });

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      const [result1, result2] = await Promise.all([
        queueService.cancelByProject(projectId, userId1),
        queueService.cancelByProject(projectId, userId2)
      ]);

      expect(result1).toHaveLength(500);
      expect(result2).toHaveLength(500);
    });
  });

  describe('Data Integrity', () => {
    it('should maintain correct status transitions', async () => {
      const projectId = 'project-123';
      const userId = 'user-123';

      mockPrisma.segmentationQueue.findMany.mockResolvedValue([mockQueueItems[0]]);
      mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: 1 });

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      await queueService.cancelByProject(projectId, userId);

      expect(mockPrisma.segmentationQueue.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['queue-1'] }
        },
        data: {
          status: 'cancelled',
          updatedAt: expect.any(Date),
          completedAt: expect.any(Date)
        }
      });
    });

    it('should preserve audit trail information', async () => {
      const batchId = 'batch-123';
      const userId = 'user-123';

      mockPrisma.segmentationQueue.findMany.mockResolvedValue([mockQueueItems[0]]);
      mockPrisma.segmentationQueue.updateMany.mockResolvedValue({ count: 1 });

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      await queueService.cancelBatch(batchId, userId);

      expect(logger.info).toHaveBeenCalledWith(
        'Cancelled batch items',
        expect.objectContaining({
          batchId,
          userId,
          itemsFound: 1,
          itemsUpdated: 1,
          itemIds: ['queue-1']
        })
      );
    });

    it('should handle database constraints properly', async () => {
      const projectId = 'project-123';
      const userId = 'user-123';

      mockPrisma.segmentationQueue.findMany.mockResolvedValue([mockQueueItems[0]]);

      // Simulate constraint violation
      const constraintError = new Error('Foreign key constraint violation');
      mockPrisma.segmentationQueue.updateMany.mockRejectedValue(constraintError);

      mockPrisma.$transaction.mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations.map(op => op));
        }
        return operations;
      });

      await expect(queueService.cancelByProject(projectId, userId)).rejects.toThrow('Foreign key constraint violation');
    });
  });
});