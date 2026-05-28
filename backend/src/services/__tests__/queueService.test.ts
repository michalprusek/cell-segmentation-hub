import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock config early to prevent process.exit(1) during trackerService import chain
vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-for-testing-only-32-chars',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_REFRESH_EXPIRY_REMEMBER: '30d',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
    UPLOAD_DIR: './test-uploads',
    MAX_FILE_SIZE: 10485760,
    STORAGE_TYPE: 'local',
    SESSION_SECRET: 'test-session-secret',
    REDIS_URL: 'redis://localhost:6379',
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    FROM_EMAIL: 'test@example.com',
    FROM_NAME: 'Test Platform',
    EMAIL_SERVICE: 'none',
    REQUIRE_EMAIL_VERIFICATION: false,
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));
// Mock trackerService to avoid its prismaClient + axios side effects
vi.mock('../tracking/trackerService', () => ({
  scheduleTrackingForContainer: vi.fn(),
}));

// --- Prisma mock ---
const prismaMock = {
  segmentationQueue: {
    findFirst: vi.fn() as any,
    findMany: vi.fn() as any,
    create: vi.fn() as any,
    createMany: vi.fn() as any,
    delete: vi.fn() as any,
    deleteMany: vi.fn() as any,
    update: vi.fn() as any,
    updateMany: vi.fn() as any,
    count: vi.fn() as any,
  },
  image: {
    updateMany: vi.fn() as any,
    findFirst: vi.fn() as any,
    findMany: vi.fn() as any,
  },
  user: {
    findUnique: vi.fn() as any,
  },
  segmentation: {
    deleteMany: vi.fn() as any,
  },
  $transaction: vi.fn() as any,
};

// --- Segmentation service mock ---
const segmentationServiceMock = {
  requestSegmentation: vi.fn() as any,
  requestBatchSegmentation: vi.fn() as any,
};

// --- Image service mock ---
const imageServiceMock = {
  getImageById: vi.fn() as any,
  updateSegmentationStatus: vi.fn() as any,
};

// --- WebSocket service mock ---
const wsServiceMock = {
  emitSegmentationUpdate: vi.fn() as any,
  emitQueueStatsUpdate: vi.fn() as any,
};

// --- Logger mock ---
vi.mock('../../utils/logger');
vi.mock('../../utils/batchProcessor', () => ({
  batchProcessor: {
    processBatch: vi.fn(async (items: unknown[], processor: (item: unknown) => Promise<unknown>) =>
      Promise.all(items.map(processor))
    ),
  },
}));

import { QueueService } from '../queueService';

// Reset the singleton between tests so each describe block gets a fresh instance
const resetSingleton = () => {
  // Access private static field via casting
  (QueueService as any).instance = undefined;
};

const makeService = () => {
  resetSingleton();
  return new QueueService(
    prismaMock as any,
    segmentationServiceMock as any,
    imageServiceMock as any
  );
};

const mockQueueEntry = {
  id: 'queue-id',
  imageId: 'image-id',
  projectId: 'project-id',
  userId: 'user-id',
  model: 'hrnet',
  threshold: 0.5,
  priority: 0,
  status: 'queued',
  batchId: null,
  detectHoles: true,
  createdAt: new Date(),
  startedAt: null,
  completedAt: null,
};

describe('QueueService', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
    service.setWebSocketService(wsServiceMock as any);
  });

  afterEach(() => {
    resetSingleton();
  });

  // ---------------------------------------------------------------------------
  describe('addToQueue', () => {
    it('creates a queue entry with correct fields', async () => {
      prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null);
      prismaMock.segmentationQueue.create.mockResolvedValueOnce(mockQueueEntry as any);
      imageServiceMock.updateSegmentationStatus.mockResolvedValueOnce(undefined);

      const result = await service.addToQueue(
        'image-id',
        'project-id',
        'user-id',
        'hrnet',
        0.5,
        0,
        true
      );

      expect(prismaMock.segmentationQueue.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          imageId: 'image-id',
          projectId: 'project-id',
          userId: 'user-id',
          model: 'hrnet',
          threshold: 0.5,
          priority: 0,
          status: 'queued',
        }),
      });
      expect(imageServiceMock.updateSegmentationStatus).toHaveBeenCalledWith(
        'image-id',
        'queued',
        'user-id'
      );
      expect(result.id).toBe('queue-id');
    });

    it('throws when image is already queued', async () => {
      prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(mockQueueEntry as any);

      await expect(
        service.addToQueue('image-id', 'project-id', 'user-id')
      ).rejects.toThrow('Image is already in segmentation queue');

      expect(prismaMock.segmentationQueue.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  describe('addBatchToQueue', () => {
    it('queues multiple images, skips already-queued ones', async () => {
      const imageIds = ['img-1', 'img-2', 'img-3'];

      // New bulk implementation: user.findUnique → image.findMany → $transaction
      prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'user@test.com' });

      // image.findMany returns only the images accessible and not-yet-queued
      // (img-2 with status 'queued' is returned but filtered client-side)
      prismaMock.image.findMany.mockResolvedValueOnce([
        { id: 'img-1', segmentationStatus: 'no_segmentation' },
        { id: 'img-2', segmentationStatus: 'queued' },
        { id: 'img-3', segmentationStatus: 'no_segmentation' },
      ] as any);

      const queueEntry1 = { ...mockQueueEntry, id: 'qe-1', imageId: 'img-1' };
      const queueEntry3 = { ...mockQueueEntry, id: 'qe-3', imageId: 'img-3' };

      // $transaction receives a callback; call it with a tx object that has the
      // right shape so we can control what findMany returns at the end.
      prismaMock.$transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          segmentation: { deleteMany: vi.fn() },
          segmentationQueue: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
            findMany: vi.fn().mockResolvedValue([queueEntry1, queueEntry3]),
          },
          image: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
        };
        return cb(tx);
      });

      const results = await service.addBatchToQueue(imageIds, 'project-id', 'user-id');

      // img-2 is skipped (already queued)
      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.imageId)).toEqual(
        expect.arrayContaining(['img-1', 'img-3'])
      );
    });

    it('skips images not found or not accessible', async () => {
      // user found, but image.findMany returns empty (no accessible images)
      prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'user@test.com' });
      prismaMock.image.findMany.mockResolvedValueOnce([]);

      const results = await service.addBatchToQueue(
        ['missing-img'],
        'project-id',
        'user-id'
      );

      expect(results).toHaveLength(0);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('throws when user is not found', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.addBatchToQueue(['img-1'], 'project-id', 'unknown-user')
      ).rejects.toThrow('User unknown-user not found');
    });

    it('returns empty array for empty imageIds', async () => {
      const results = await service.addBatchToQueue([], 'project-id', 'user-id');
      expect(results).toHaveLength(0);
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  describe('getQueueStats', () => {
    it('returns queued and processing counts', async () => {
      prismaMock.segmentationQueue.count
        .mockResolvedValueOnce(3)   // queued
        .mockResolvedValueOnce(1);  // processing

      const stats = await service.getQueueStats('project-id', 'user-id');

      expect(stats).toEqual({ queued: 3, processing: 1, total: 4 });
      expect(prismaMock.segmentationQueue.count).toHaveBeenCalledTimes(2);
    });

    it('emits queue stats via WebSocket when projectId is provided', async () => {
      prismaMock.segmentationQueue.count
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0);

      await service.getQueueStats('project-id');

      expect(wsServiceMock.emitQueueStatsUpdate).toHaveBeenCalledWith(
        'project-id',
        expect.objectContaining({ projectId: 'project-id', queued: 2 })
      );
    });

    it('throws on database failure', async () => {
      prismaMock.segmentationQueue.count.mockRejectedValueOnce(
        new Error('DB error')
      );

      await expect(service.getQueueStats()).rejects.toThrow('DB error');
    });
  });

  // ---------------------------------------------------------------------------
  describe('getQueueItems', () => {
    it('returns queue items for user', async () => {
      const items = [
        { ...mockQueueEntry, id: 'q1' },
        { ...mockQueueEntry, id: 'q2' },
      ];
      prismaMock.segmentationQueue.findMany.mockResolvedValueOnce(items as any);

      const result = await service.getQueueItems('project-id', 'user-id');

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('id', 'q1');
      expect(result[0]).toHaveProperty('imageId');
      expect(result[0]).toHaveProperty('status');
      expect(prismaMock.segmentationQueue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'project-id',
            userId: 'user-id',
          }),
        })
      );
    });

    it('returns empty array when no active queue items', async () => {
      prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([]);

      const result = await service.getQueueItems('project-id', 'user-id');

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  describe('removeFromQueue', () => {
    it('removes queued item and resets image status', async () => {
      prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(
        mockQueueEntry as any
      );
      prismaMock.segmentationQueue.delete.mockResolvedValueOnce(
        mockQueueEntry as any
      );
      imageServiceMock.updateSegmentationStatus.mockResolvedValueOnce(undefined);

      await service.removeFromQueue('queue-id', 'user-id');

      expect(prismaMock.segmentationQueue.delete).toHaveBeenCalledWith({
        where: { id: 'queue-id' },
      });
      expect(imageServiceMock.updateSegmentationStatus).toHaveBeenCalledWith(
        'image-id',
        'no_segmentation',
        'user-id'
      );
    });

    it('throws when queue item not found or already processing', async () => {
      prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.removeFromQueue('nonexistent', 'user-id')
      ).rejects.toThrow('Queue item not found or cannot be removed');
    });
  });

  // ---------------------------------------------------------------------------
  describe('getInstance', () => {
    it('returns the same singleton instance on repeated calls', () => {
      const instance1 = QueueService.getInstance(
        prismaMock as any,
        segmentationServiceMock as any,
        imageServiceMock as any
      );
      const instance2 = QueueService.getInstance(prismaMock as any);

      expect(instance1).toBe(instance2);
    });

    it('throws when called without dependencies on first init', () => {
      resetSingleton();

      expect(() => QueueService.getInstance(prismaMock as any)).toThrow(
        'SegmentationService and ImageService are required for first initialization'
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe('error handling', () => {
    it('propagates DB error from addToQueue', async () => {
      prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null);
      prismaMock.segmentationQueue.create.mockRejectedValueOnce(
        new Error('Connection refused')
      );

      await expect(
        service.addToQueue('image-id', 'project-id', 'user-id')
      ).rejects.toThrow('Connection refused');
    });

    it('propagates DB error from getQueueItems', async () => {
      prismaMock.segmentationQueue.findMany.mockRejectedValueOnce(
        new Error('Timeout')
      );

      await expect(
        service.getQueueItems('project-id', 'user-id')
      ).rejects.toThrow('Timeout');
    });
  });
});
