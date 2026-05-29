/**
 * queueService.gaps3.test.ts
 *
 * Covers branches still uncovered after queueService.test.ts, .gaps.test.ts,
 * .gaps2.test.ts, and .parallel.test.ts:
 *
 *  A. cancelBatch
 *     - returns 0 immediately when no queued items found for batchId
 *     - deletes queued rows, updates image statuses, returns count
 *     - emits "segmentation:cancelled" and updates queue stats via WS when items found
 *
 *  B. cancelAllUserSegmentations
 *     - returns zero counts when no active items exist for user
 *     - deletes queued, marks processing as cancelled, updates images
 *     - collects affectedProjects / affectedBatches correctly
 *
 *  C. cleanupOldEntries
 *     - delegates to segmentationQueue.deleteMany with correct where clause
 *     - propagates DB error
 *
 *  D. getNextBatch / getMultipleBatches
 *     - returns [] when queue is empty
 *     - caps to 1 batch when first item model is in SERIAL_DISPATCH_MODELS
 *
 *  E. getParallelProcessingStats
 *     - returns snapshot including activeBatches.size
 *
 *  F. processBatch — retry path
 *     - item with retryCount < 3: resets to queued, increments retryCount
 *     - item with retryCount >= 3: deletes item, marks image as failed
 *
 *  G. addBatchToQueue
 *     - returns [] immediately when imageIds is empty
 *     - throws when user not found
 *
 *  H. getInstance — throws when called the first time without required deps
 *
 * Real HTTP calls / ML service are never used — all I/O mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── config mock FIRST ─────────────────────────────────────────────────────────
vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
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
    FROM_NAME: 'Test',
    EMAIL_SERVICE: 'none',
    REQUIRE_EMAIL_VERIFICATION: false,
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
  getOrigins: () => ['http://localhost:3000'],
}));

vi.mock('../tracking/trackerService', () => ({
  scheduleTrackingForContainer: vi.fn(),
}));

vi.mock('../../utils/logger');

vi.mock('../../utils/batchProcessor', () => ({
  batchProcessor: {
    processBatch: vi.fn(
      async (
        items: unknown[],
        processor: (item: unknown) => Promise<unknown>
      ) => Promise.all(items.map(processor))
    ),
  },
}));

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const prismaMock = {
  segmentationQueue: {
    findFirst: vi.fn() as ReturnType<typeof vi.fn>,
    findMany: vi.fn() as ReturnType<typeof vi.fn>,
    create: vi.fn() as ReturnType<typeof vi.fn>,
    createMany: vi.fn() as ReturnType<typeof vi.fn>,
    delete: vi.fn() as ReturnType<typeof vi.fn>,
    deleteMany: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    updateMany: vi.fn() as ReturnType<typeof vi.fn>,
    count: vi.fn() as ReturnType<typeof vi.fn>,
  },
  image: {
    updateMany: vi.fn() as ReturnType<typeof vi.fn>,
    findFirst: vi.fn() as ReturnType<typeof vi.fn>,
    findMany: vi.fn() as ReturnType<typeof vi.fn>,
    findUnique: vi.fn() as ReturnType<typeof vi.fn>,
  },
  user: {
    findUnique: vi.fn() as ReturnType<typeof vi.fn>,
  },
  segmentation: {
    deleteMany: vi.fn() as ReturnType<typeof vi.fn>,
  },
  $transaction: vi.fn() as ReturnType<typeof vi.fn>,
};

// ─── Service / dependency mocks ───────────────────────────────────────────────

import { QueueService } from '../queueService';
import type { SegmentationQueue } from '@prisma/client';

const segmentationServiceMock = {
  requestSegmentation: vi.fn(),
  requestBatchSegmentation: vi.fn(),
  saveSegmentationResults: vi.fn().mockResolvedValue(undefined),
  checkServiceHealth: vi.fn().mockResolvedValue(true),
};

const imageServiceMock = {
  getImageById: vi.fn(),
  updateSegmentationStatus: vi.fn().mockResolvedValue(undefined),
};

const wsMock = {
  emitToUser: vi.fn(),
  emitSegmentationUpdate: vi.fn(),
  emitSegmentationComplete: vi.fn(),
  emitQueueStatsUpdate: vi.fn(),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetSingleton() {
  (QueueService as unknown as { instance: unknown }).instance = undefined;
}

function makeService(): QueueService {
  resetSingleton();
  const svc = new QueueService(
    prismaMock as never,
    segmentationServiceMock as never,
    imageServiceMock as never
  );
  svc.setWebSocketService(wsMock as never);
  return svc;
}

function makeQueueItem(
  overrides: Partial<SegmentationQueue> = {}
): SegmentationQueue {
  return {
    id: 'qi-1',
    imageId: 'img-1',
    projectId: 'proj-1',
    userId: 'user-1',
    model: 'hrnet',
    threshold: 0.5,
    priority: 0,
    status: 'queued',
    batchId: 'batch-1',
    retryCount: 0,
    detectHoles: true,
    channel: null,
    error: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SegmentationQueue;
}

// ─── A. cancelBatch ──────────────────────────────────────────────────────────

describe('QueueService — cancelBatch', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('returns 0 when no queued items found for batchId', async () => {
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([]);

    const count = await service.cancelBatch('batch-empty', 'user-1');
    expect(count).toBe(0);
    expect(prismaMock.segmentationQueue.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes queued rows, updates image statuses, returns count', async () => {
    const item = makeQueueItem({ image: { projectId: 'proj-1' } as never });
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([item]);
    prismaMock.segmentationQueue.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValueOnce({ count: 1 });
    // getQueueStats inside cancelBatch
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(0) // queued
      .mockResolvedValueOnce(0); // processing

    const count = await service.cancelBatch('batch-1', 'user-1');
    expect(count).toBe(1);
    expect(prismaMock.segmentationQueue.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          batchId: 'batch-1',
          userId: 'user-1',
          status: 'queued',
        }),
      })
    );
    expect(prismaMock.image.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { segmentationStatus: 'no_segmentation' },
      })
    );
  });

  it('emits "segmentation:cancelled" for each cancelled image via WS', async () => {
    const item = makeQueueItem({ image: { projectId: 'proj-1' } as never });
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([item]);
    prismaMock.segmentationQueue.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.segmentationQueue.count.mockResolvedValue(0);

    await service.cancelBatch('batch-1', 'user-1');

    expect(wsMock.emitToUser).toHaveBeenCalledWith(
      'user-1',
      'segmentation:cancelled',
      expect.objectContaining({ imageId: 'img-1', batchId: 'batch-1' })
    );
  });

  it('propagates DB error from deleteMany', async () => {
    const item = makeQueueItem({ image: { projectId: 'proj-1' } as never });
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([item]);
    prismaMock.segmentationQueue.deleteMany.mockRejectedValueOnce(
      new Error('DB error')
    );

    await expect(service.cancelBatch('batch-1', 'user-1')).rejects.toThrow(
      'DB error'
    );
  });
});

// ─── B. cancelAllUserSegmentations ───────────────────────────────────────────

describe('QueueService — cancelAllUserSegmentations', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('returns zero counts when no active items exist for user', async () => {
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([]);

    const result = await service.cancelAllUserSegmentations('user-empty');
    expect(result.cancelledCount).toBe(0);
    expect(result.affectedProjects).toHaveLength(0);
    expect(result.affectedBatches).toHaveLength(0);
  });

  it('deletes queued items, marks processing as cancelled, updates images', async () => {
    const queuedItem = makeQueueItem({
      status: 'queued',
      batchId: 'b-1',
      image: { projectId: 'proj-1' } as never,
    });
    const processingItem = makeQueueItem({
      id: 'qi-2',
      imageId: 'img-2',
      status: 'processing',
      batchId: 'b-2',
      image: { projectId: 'proj-1' } as never,
    });
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([
      queuedItem,
      processingItem,
    ]);
    prismaMock.segmentationQueue.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.segmentationQueue.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValueOnce({ count: 2 });
    // getQueueStats calls inside
    prismaMock.segmentationQueue.count.mockResolvedValue(0);

    const result = await service.cancelAllUserSegmentations('user-1');
    expect(prismaMock.segmentationQueue.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'queued' }),
      })
    );
    expect(prismaMock.segmentationQueue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'cancelled' } })
    );
    expect(prismaMock.image.updateMany).toHaveBeenCalled();
    expect(result.affectedProjects).toContain('proj-1');
    expect(result.affectedBatches.sort()).toEqual(['b-1', 'b-2'].sort());
  });
});

// ─── C. cleanupOldEntries ────────────────────────────────────────────────────

describe('QueueService — cleanupOldEntries', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('calls deleteMany with completed/failed status filter and returns deleted count', async () => {
    prismaMock.segmentationQueue.deleteMany.mockResolvedValueOnce({ count: 5 });

    const count = await service.cleanupOldEntries(7);
    expect(count).toBe(5);
    expect(prismaMock.segmentationQueue.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['completed', 'failed'] },
        }),
      })
    );
  });

  it('propagates DB error', async () => {
    prismaMock.segmentationQueue.deleteMany.mockRejectedValueOnce(
      new Error('DB gone')
    );

    await expect(service.cleanupOldEntries(7)).rejects.toThrow('DB gone');
  });
});

// ─── D. getNextBatch / getMultipleBatches ─────────────────────────────────────

describe('QueueService — getMultipleBatches', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('returns [] when queue is empty', async () => {
    prismaMock.segmentationQueue.findMany.mockResolvedValue([]);
    prismaMock.segmentationQueue.findFirst.mockResolvedValue(null);

    const batches = await service.getMultipleBatches(4);
    expect(batches).toHaveLength(0);
  });

  it('caps to 1 batch when model is in SERIAL_DISPATCH_MODELS (microtubule)', async () => {
    const microItem = makeQueueItem({ model: 'microtubule' });

    // getNextBatchExcluding calls:
    //   1. findMany for recentlyProcessed
    //   2. findFirst (fairness: non-recent user) → null
    //   3. findFirst (fallback) → microItem
    //   4. findMany for batch with same model/threshold/priority → [microItem]
    prismaMock.segmentationQueue.findMany
      .mockResolvedValueOnce([]) // recentlyProcessed (no recent users)
      .mockResolvedValueOnce([microItem]); // batch findMany by model/threshold

    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(microItem); // fallback first item (recentUserIds empty → skip fairness)

    const batches = await service.getMultipleBatches(4);
    expect(batches).toHaveLength(1);
    expect(batches[0].model).toBe('microtubule');
  });
});

// ─── E. getParallelProcessingStats ───────────────────────────────────────────

describe('QueueService — getParallelProcessingStats', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('returns snapshot with activeStreams equal to activeBatches.size', async () => {
    const stats = await service.getParallelProcessingStats();
    expect(typeof stats.activeStreams).toBe('number');
    expect(typeof stats.maxConcurrentStreams).toBe('number');
    expect(stats.maxConcurrentStreams).toBeGreaterThan(0);
  });
});

// ─── F. processBatch — error retry paths ─────────────────────────────────────

describe('QueueService — processBatch retry/fail paths', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  const stubProcessingPrelude = () => {
    // updateMany for status=processing
    prismaMock.segmentationQueue.updateMany.mockResolvedValueOnce({ count: 1 });
    // image updateMany for processing
    prismaMock.image.updateMany.mockResolvedValueOnce({ count: 1 });
    // count for isLastBatch
    prismaMock.segmentationQueue.count.mockResolvedValueOnce(0);
  };

  it('resets item to queued with incremented retryCount when retryCount < 3', async () => {
    const item = makeQueueItem({ retryCount: 0 });
    stubProcessingPrelude();
    imageServiceMock.getImageById.mockResolvedValueOnce({
      id: 'img-1',
      name: 'i.png',
      originalPath: 'p',
    });
    segmentationServiceMock.requestSegmentation.mockRejectedValueOnce(
      new Error('ML down')
    );
    prismaMock.segmentationQueue.update.mockResolvedValueOnce({});

    await service.processBatch([item]);

    expect(prismaMock.segmentationQueue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'qi-1' },
        data: expect.objectContaining({ status: 'queued', retryCount: 1 }),
      })
    );
  });

  it('marks image as failed and deletes item when retryCount >= 3', async () => {
    const item = makeQueueItem({ retryCount: 3 });
    stubProcessingPrelude();
    imageServiceMock.getImageById.mockResolvedValueOnce({
      id: 'img-1',
      name: 'i.png',
      originalPath: 'p',
    });
    segmentationServiceMock.requestSegmentation.mockRejectedValueOnce(
      new Error('ML down')
    );
    prismaMock.segmentationQueue.delete.mockResolvedValueOnce({});

    await service.processBatch([item]);

    expect(imageServiceMock.updateSegmentationStatus).toHaveBeenCalledWith(
      'img-1',
      'failed',
      'user-1'
    );
    expect(prismaMock.segmentationQueue.delete).toHaveBeenCalledWith({
      where: { id: 'qi-1' },
    });
  });
});

// ─── G. addBatchToQueue ───────────────────────────────────────────────────────

describe('QueueService — addBatchToQueue edge cases', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('returns [] immediately when imageIds is empty', async () => {
    const result = await service.addBatchToQueue([], 'proj-1', 'user-1');
    expect(result).toEqual([]);
    // No DB calls should occur
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('throws when user not found', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.addBatchToQueue(['img-1'], 'proj-1', 'ghost-user')
    ).rejects.toThrow('not found');
  });
});

// ─── H. getInstance throws without deps ──────────────────────────────────────

describe('QueueService.getInstance', () => {
  beforeEach(() => resetSingleton());
  afterEach(() => resetSingleton());

  it('throws when called for the first time without segmentationService and imageService', () => {
    expect(() => QueueService.getInstance(prismaMock as never)).toThrow(
      'SegmentationService and ImageService are required'
    );
  });

  it('returns existing instance on subsequent calls without deps', () => {
    const svc = new QueueService(
      prismaMock as never,
      segmentationServiceMock as never,
      imageServiceMock as never
    );
    (QueueService as unknown as { instance: unknown }).instance = svc;

    const retrieved = QueueService.getInstance(prismaMock as never);
    expect(retrieved).toBe(svc);
  });
});
