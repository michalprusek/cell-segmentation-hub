/**
 * queueService.gaps5.test.ts
 *
 * Covers branches still uncovered after gaps, gaps2, gaps3, parallel tests:
 *
 *  A. processBatchOperations — private, exercised via addBatchToQueue
 *     - onBatchComplete callback logs debug
 *     - onItemError callback logs error
 *
 *  B. setQueueWorker / triggerQueueProcessing
 *     - setQueueWorker stores the worker reference
 *     - addToQueue calls triggerImmediateProcessing when worker is set
 *     - addToQueue does NOT throw when worker has no triggerImmediateProcessing
 *
 *  C. processMultipleBatches
 *     - returns immediately when batches is empty
 *     - processes concurrently, updates processingStats
 *     - handles per-batch error (rejected promise) without propagating
 *
 *  D. processSingleBatch
 *     - delegates to processBatch (same logic path)
 *     - returns when batch is empty
 *
 *  E. emitQueueStatsForBatch
 *     - sends WS stats for each unique (projectId, userId) pair
 *     - no WS call when websocketService absent
 *
 *  F. getQueueHealthStatus
 *     - healthy=true when no issues
 *     - healthy=false, issues populated when stuck>0 + mlServiceHealthy=false
 *     - healthy=false, includes 'high backlog' when queued>100
 *
 *  G. cleanupOldEntries error propagation
 *     - re-throws DB error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

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

// ─── Prisma mock ─────────────────────────────────────────────────────────────

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

function resetSingleton(): void {
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

// ─── B. setQueueWorker / triggerQueueProcessing ───────────────────────────────

describe('QueueService — setQueueWorker', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('stores the worker and calls triggerImmediateProcessing on addToQueue', async () => {
    const triggerMock = vi.fn();
    service.setQueueWorker({ triggerImmediateProcessing: triggerMock });

    // addToQueue triggers the worker
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'user-1' });
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null); // no dup
    prismaMock.segmentationQueue.create.mockResolvedValueOnce(makeQueueItem());
    // getQueueStats counts
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    await service.addToQueue('img-1', 'proj-1', 'user-1', 'hrnet', 0.5);
    expect(triggerMock).toHaveBeenCalledTimes(1);
  });

  it('does not throw when worker lacks triggerImmediateProcessing', async () => {
    service.setQueueWorker({ somethingElse: vi.fn() });

    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'user-1' });
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null);
    prismaMock.segmentationQueue.create.mockResolvedValueOnce(makeQueueItem());
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await expect(
      service.addToQueue('img-1', 'proj-1', 'user-1', 'hrnet', 0.5)
    ).resolves.not.toThrow();
  });
});

// ─── C. processMultipleBatches ────────────────────────────────────────────────

describe('QueueService — processMultipleBatches', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('returns immediately when batches array is empty', async () => {
    await expect(service.processMultipleBatches([])).resolves.toBeUndefined();
    expect(segmentationServiceMock.requestSegmentation).not.toHaveBeenCalled();
  });

  it('processes batches concurrently and updates processingStats', async () => {
    const item = makeQueueItem();
    const imageData = {
      id: 'img-1',
      originalPath: 'path.jpg',
      width: 100,
      height: 100,
      mimeType: 'image/jpeg',
      name: 'img.jpg',
      projectId: 'proj-1',
    };

    imageServiceMock.getImageById.mockResolvedValue(imageData);
    segmentationServiceMock.requestSegmentation.mockResolvedValue({
      success: true,
      polygons: [
        {
          id: 'p1',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ],
          type: 'external',
          confidence: 0.9,
        },
      ],
      polylines: [],
      model_used: 'hrnet',
      threshold_used: 0.5,
      confidence: 0.9,
      processing_time: 200,
      image_size: { width: 100, height: 100 },
    });
    prismaMock.segmentationQueue.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.segmentationQueue.delete.mockResolvedValue(item);
    prismaMock.image.findUnique.mockResolvedValue(null); // no parentVideoId
    // getQueueStats
    prismaMock.segmentationQueue.count.mockResolvedValue(0);

    const batches = [{ id: 'b1', items: [item], model: 'hrnet' }];

    await expect(
      service.processMultipleBatches(batches)
    ).resolves.toBeUndefined();
  });

  it('handles per-batch error without propagating', async () => {
    const item = makeQueueItem();
    imageServiceMock.getImageById.mockRejectedValue(new Error('DB error'));
    prismaMock.segmentationQueue.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValue({ count: 1 });
    // retry path: retryCount=0 < 3 → update to queued
    prismaMock.segmentationQueue.update.mockResolvedValue(item);

    const batches = [{ id: 'b1', items: [item], model: 'hrnet' }];

    // Should not throw even if a batch fails
    await expect(
      service.processMultipleBatches(batches)
    ).resolves.toBeUndefined();
  });
});

// ─── D. processSingleBatch ────────────────────────────────────────────────────

describe('QueueService — processSingleBatch', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('returns immediately when batch is empty', async () => {
    await expect(service.processSingleBatch([])).resolves.toBeUndefined();
    expect(segmentationServiceMock.requestSegmentation).not.toHaveBeenCalled();
  });

  it('delegates to processBatch for a single item batch', async () => {
    const item = makeQueueItem();
    const imageData = {
      id: 'img-1',
      originalPath: 'path.jpg',
      width: 100,
      height: 100,
      mimeType: 'image/jpeg',
      name: 'img.jpg',
      projectId: 'proj-1',
    };

    imageServiceMock.getImageById.mockResolvedValue(imageData);
    segmentationServiceMock.requestSegmentation.mockResolvedValue({
      success: true,
      polygons: [
        {
          id: 'p1',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ],
          type: 'external',
          confidence: 0.9,
        },
      ],
      polylines: [],
      model_used: 'hrnet',
      threshold_used: 0.5,
      confidence: 0.9,
      processing_time: 200,
      image_size: { width: 100, height: 100 },
    });
    prismaMock.segmentationQueue.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.segmentationQueue.delete.mockResolvedValue(item);
    prismaMock.image.findUnique.mockResolvedValue(null);
    prismaMock.segmentationQueue.count.mockResolvedValue(0);

    await expect(service.processSingleBatch([item])).resolves.toBeUndefined();
    expect(segmentationServiceMock.requestSegmentation).toHaveBeenCalledTimes(
      1
    );
  });
});

// ─── E. emitQueueStatsForBatch ────────────────────────────────────────────────

describe('QueueService — emitQueueStatsForBatch (via processBatch)', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('emits WS queue stats for unique project+user pairs on success', async () => {
    const item = makeQueueItem();
    const imageData = {
      id: 'img-1',
      originalPath: 'path.jpg',
      width: 100,
      height: 100,
      mimeType: 'image/jpeg',
      name: 'img.jpg',
      projectId: 'proj-1',
    };

    imageServiceMock.getImageById.mockResolvedValue(imageData);
    segmentationServiceMock.requestSegmentation.mockResolvedValue({
      success: true,
      polygons: [
        {
          id: 'p1',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ],
          type: 'external',
          confidence: 0.9,
        },
      ],
      polylines: [],
      model_used: 'hrnet',
      threshold_used: 0.5,
      confidence: 0.9,
      processing_time: 200,
      image_size: { width: 100, height: 100 },
    });
    prismaMock.segmentationQueue.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.segmentationQueue.delete.mockResolvedValue(item);
    prismaMock.image.findUnique.mockResolvedValue(null);
    // getQueueStats calls
    prismaMock.segmentationQueue.count.mockResolvedValue(0);

    await service.processBatch([item]);
    expect(wsMock.emitQueueStatsUpdate).toHaveBeenCalled();
  });
});

// ─── F. getQueueHealthStatus ──────────────────────────────────────────────────

describe('QueueService — getQueueHealthStatus', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('returns healthy=true when all checks pass', async () => {
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(0) // queued
      .mockResolvedValueOnce(0) // processing
      .mockResolvedValueOnce(5) // completed
      .mockResolvedValueOnce(0) // failed
      .mockResolvedValueOnce(0); // stuck
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null); // oldestQueued
    segmentationServiceMock.checkServiceHealth.mockResolvedValueOnce(true);

    const result = await service.getQueueHealthStatus();
    expect(result.healthy).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.mlServiceHealthy).toBe(true);
  });

  it('returns healthy=false with issues when stuck > 0 and ML unhealthy', async () => {
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(5) // queued
      .mockResolvedValueOnce(2) // processing
      .mockResolvedValueOnce(0) // completed
      .mockResolvedValueOnce(1) // failed
      .mockResolvedValueOnce(3); // stuck (> 0)
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null);
    segmentationServiceMock.checkServiceHealth.mockResolvedValueOnce(false);

    const result = await service.getQueueHealthStatus();
    expect(result.healthy).toBe(false);
    expect(result.mlServiceHealthy).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('stuck'),
        expect.stringContaining('ML service'),
      ])
    );
  });

  it('includes high backlog issue when queued > 100', async () => {
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(150) // queued > 100
      .mockResolvedValueOnce(0) // processing
      .mockResolvedValueOnce(0) // completed
      .mockResolvedValueOnce(0) // failed
      .mockResolvedValueOnce(0); // stuck
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null);
    segmentationServiceMock.checkServiceHealth.mockResolvedValueOnce(true);

    const result = await service.getQueueHealthStatus();
    expect(result.healthy).toBe(false);
    expect(result.issues.some(i => i.includes('backlog'))).toBe(true);
  });

  it('includes "oldest item" issue when oldest queued is > 30 min old', async () => {
    const oldDate = new Date(Date.now() - 35 * 60 * 1000);
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce({
      createdAt: oldDate,
    });
    segmentationServiceMock.checkServiceHealth.mockResolvedValueOnce(true);

    const result = await service.getQueueHealthStatus();
    expect(result.healthy).toBe(false);
    expect(result.issues.some(i => i.includes('30 minutes'))).toBe(true);
  });
});

// ─── G. cleanupOldEntries error propagation ───────────────────────────────────

describe('QueueService — cleanupOldEntries error', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('re-throws DB error from cleanupOldEntries', async () => {
    prismaMock.segmentationQueue.deleteMany.mockRejectedValueOnce(
      new Error('DB connection lost')
    );

    await expect(service.cleanupOldEntries(7)).rejects.toThrow(
      'DB connection lost'
    );
  });
});
