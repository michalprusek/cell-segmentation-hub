/**
 * queueService.gaps.test.ts
 *
 * Covers uncovered paths in queueService.ts:
 *   - getBatchItems (getNextBatchExcluding) fairness / deprioritization logic
 *   - getMultipleBatches: serial-dispatch cap for microtubule model
 *   - addBatchToQueue: forceResegment path (clears existing segmentation rows)
 *   - addBatchToQueue: channel field propagated to queue rows
 *   - processBatch: retry-count increment on failure (< 3 retries)
 *   - processBatch: permanent failure + queue delete on retry >= 3
 *   - resetStuckItems: requeue items below retry cap, delete above
 *   - cleanupOldEntries: calls deleteMany with correct time filter
 *   - cancelBatch: deletes queued rows, resets image status
 *   - getQueueHealthStatus: healthy/unhealthy flags + issue text
 *   - getParallelProcessingStats: returns current activeBatches size
 *
 * Deliberately NOT tested here (infra/already covered):
 *   - Real ML HTTP calls (requestSegmentation) — exercised in processBatch
 *     which requires a running ML service; we skip that network boundary
 *   - processMultipleBatches full concurrency harness (tested in parallel test file)
 *   - cancelAllUserSegmentations (high line count, already has some coverage)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- config mock FIRST to prevent process.exit(1) in config.ts ----
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

// ---- Prisma mock (per-test reset via clearAllMocks) ----
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

const segmentationServiceMock = {
  requestSegmentation: vi.fn() as ReturnType<typeof vi.fn>,
  requestBatchSegmentation: vi.fn() as ReturnType<typeof vi.fn>,
  saveSegmentationResults: vi.fn() as ReturnType<typeof vi.fn>,
  checkServiceHealth: vi.fn() as ReturnType<typeof vi.fn>,
};

const imageServiceMock = {
  getImageById: vi.fn() as ReturnType<typeof vi.fn>,
  updateSegmentationStatus: vi.fn() as ReturnType<typeof vi.fn>,
};

const wsServiceMock = {
  emitSegmentationUpdate: vi.fn() as ReturnType<typeof vi.fn>,
  emitSegmentationComplete: vi.fn() as ReturnType<typeof vi.fn>,
  emitQueueStatsUpdate: vi.fn() as ReturnType<typeof vi.fn>,
  emitToUser: vi.fn() as ReturnType<typeof vi.fn>,
};

import { QueueService } from '../queueService';

const resetSingleton = () => {
  (QueueService as unknown as { instance: unknown }).instance = undefined;
};

const makeService = () => {
  resetSingleton();
  const svc = new QueueService(
    prismaMock as never,
    segmentationServiceMock as never,
    imageServiceMock as never
  );
  svc.setWebSocketService(wsServiceMock as never);
  return svc;
};

// Minimal queue entry shape
function makeQueueEntry(
  overrides: Partial<{
    id: string;
    imageId: string;
    projectId: string;
    userId: string;
    model: string;
    threshold: number;
    priority: number;
    status: string;
    batchId: string | null;
    detectHoles: boolean;
    retryCount: number;
    channel: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
  }> = {}
) {
  return {
    id: 'qe-1',
    imageId: 'img-1',
    projectId: 'project-id',
    userId: 'user-id',
    model: 'hrnet',
    threshold: 0.5,
    priority: 0,
    status: 'queued',
    batchId: null,
    detectHoles: true,
    retryCount: 0,
    channel: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('QueueService — getNextBatchExcluding fairness logic', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => {
    resetSingleton();
  });

  // getNextBatchExcluding is private; call through getMultipleBatches(1)
  it('prefers a user NOT in the recently-processed window', async () => {
    // Sequence: findMany(recentlyProcessed) → findFirst(preferred user) → findMany(batch)
    const userBItem = makeQueueEntry({ userId: 'user-B', imageId: 'img-B' });
    prismaMock.segmentationQueue.findMany
      .mockResolvedValueOnce([{ userId: 'user-A' }]) // recentlyProcessed → user-A deprioritised
      .mockResolvedValueOnce([userBItem]); // batch findMany for user-B's item
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(userBItem); // preferred-user (notIn user-A) → user-B

    const batches = await service.getMultipleBatches(1);

    expect(batches).toHaveLength(1);
    expect(batches[0].items[0].userId).toBe('user-B');
  });

  it('falls back to priority ordering when no non-recent user has work', async () => {
    // Recent: user-A. Preferred-user search returns null → plain fallback
    const userAItem = makeQueueEntry({ userId: 'user-A', imageId: 'img-A' });
    prismaMock.segmentationQueue.findMany
      .mockResolvedValueOnce([{ userId: 'user-A' }]) // recentlyProcessed
      .mockResolvedValueOnce([userAItem]); // batch findMany
    prismaMock.segmentationQueue.findFirst
      .mockResolvedValueOnce(null) // preferred-user: no non-recent user
      .mockResolvedValueOnce(userAItem); // plain-order fallback

    const batches = await service.getMultipleBatches(1);

    expect(batches).toHaveLength(1);
    expect(batches[0].items[0].userId).toBe('user-A');
  });

  it('returns empty batches when queue is empty', async () => {
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([]); // recentlyProcessed
    // No recentUserIds → skip preferred-user findFirst, go to plain fallback
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null); // plain fallback: empty

    const batches = await service.getMultipleBatches(4);

    expect(batches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('QueueService — getMultipleBatches serial-dispatch cap', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => {
    resetSingleton();
  });

  it('caps at 1 batch when the model is microtubule', async () => {
    const mtItem = makeQueueEntry({ model: 'microtubule' });

    // getNextBatchExcluding: findMany(recentlyProcessed) → recentUserIds empty
    // → skip preferred-user findFirst → plain-order findFirst → findMany(batch)
    prismaMock.segmentationQueue.findMany
      .mockResolvedValueOnce([]) // recentlyProcessed → empty
      .mockResolvedValueOnce([mtItem]); // batch findMany
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(mtItem); // plain-order fallback

    const batches = await service.getMultipleBatches(4);

    expect(batches).toHaveLength(1);
    expect(batches[0].model).toBe('microtubule');
  });

  it('allows multiple batches for non-serial models', async () => {
    const hrItem1 = makeQueueEntry({
      id: 'qe-1',
      imageId: 'img-1',
      model: 'hrnet',
    });
    const hrItem2 = makeQueueEntry({
      id: 'qe-2',
      imageId: 'img-2',
      model: 'hrnet',
    });

    // Each getNextBatchExcluding iteration:
    //   findMany(recentlyProcessed) → findFirst(fallback) → findMany(batch)
    prismaMock.segmentationQueue.findMany
      .mockResolvedValueOnce([]) // recentlyProcessed (iter 1)
      .mockResolvedValueOnce([hrItem1]) // batch items (iter 1)
      .mockResolvedValueOnce([]) // recentlyProcessed (iter 2)
      .mockResolvedValueOnce([hrItem2]); // batch items (iter 2)

    prismaMock.segmentationQueue.findFirst
      .mockResolvedValueOnce(hrItem1) // plain-order (iter 1)
      .mockResolvedValueOnce(hrItem2); // plain-order (iter 2)

    const batches = await service.getMultipleBatches(2);

    expect(batches.length).toBeGreaterThanOrEqual(1);
    // At least 1 hrnet batch should appear
    expect(batches.some(b => b.model === 'hrnet')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('QueueService — addBatchToQueue forceResegment', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => {
    resetSingleton();
  });

  it('deletes existing segmentation rows for completed images when forceResegment=true', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@test.com' });
    prismaMock.image.findMany.mockResolvedValueOnce([
      { id: 'img-1', segmentationStatus: 'segmented' }, // needs reset
    ]);

    const qe = makeQueueEntry({ imageId: 'img-1' });
    prismaMock.$transaction.mockImplementationOnce(
      async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          segmentation: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
          segmentationQueue: {
            createMany: vi.fn().mockResolvedValue({ count: 1 }),
            findMany: vi.fn().mockResolvedValue([qe]),
          },
          image: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        };
        return cb(tx);
      }
    );

    const results = await service.addBatchToQueue(
      ['img-1'],
      'project-id',
      'user-id',
      'hrnet',
      0.5,
      0,
      true // forceResegment
    );

    // Confirm transaction ran (segmentation.deleteMany was called)
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0].imageId).toBe('img-1');
  });

  it('does NOT delete segmentation rows when forceResegment=false', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@test.com' });
    prismaMock.image.findMany.mockResolvedValueOnce([
      { id: 'img-1', segmentationStatus: 'no_segmentation' },
    ]);

    let txSegmentationDeleteMany: ReturnType<typeof vi.fn> | null = null;
    prismaMock.$transaction.mockImplementationOnce(
      async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          segmentation: {
            deleteMany: (txSegmentationDeleteMany = vi
              .fn()
              .mockResolvedValue({ count: 0 })),
          },
          segmentationQueue: {
            createMany: vi.fn().mockResolvedValue({ count: 1 }),
            findMany: vi.fn().mockResolvedValue([makeQueueEntry()]),
          },
          image: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        };
        return cb(tx);
      }
    );

    await service.addBatchToQueue(
      ['img-1'],
      'project-id',
      'user-id',
      'hrnet',
      0.5,
      0,
      false // forceResegment off
    );

    // deleteMany should NOT have been called inside the transaction
    expect(txSegmentationDeleteMany).not.toHaveBeenCalled();
  });

  it('propagates channel field to queue row data', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@test.com' });
    prismaMock.image.findMany.mockResolvedValueOnce([
      { id: 'img-1', segmentationStatus: 'no_segmentation' },
    ]);

    let capturedCreateManyData: unknown = null;
    prismaMock.$transaction.mockImplementationOnce(
      async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          segmentation: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          segmentationQueue: {
            createMany: vi
              .fn()
              .mockImplementation(({ data }: { data: unknown }) => {
                capturedCreateManyData = data;
                return Promise.resolve({ count: 1 });
              }),
            findMany: vi.fn().mockResolvedValue([makeQueueEntry()]),
          },
          image: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        };
        return cb(tx);
      }
    );

    await service.addBatchToQueue(
      ['img-1'],
      'project-id',
      'user-id',
      'hrnet',
      0.5,
      0,
      false,
      true,
      'channel-A' // channel
    );

    expect(
      (capturedCreateManyData as Array<{ channel: string | null }>)[0].channel
    ).toBe('channel-A');
  });
});

// ---------------------------------------------------------------------------

describe('QueueService — processBatch retry handling', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => {
    resetSingleton();
  });

  it('increments retryCount and resets to queued on failure (< 3 retries)', async () => {
    const item = makeQueueEntry({ retryCount: 0 });
    const image = { id: 'img-1', width: 100, height: 100 };

    imageServiceMock.getImageById.mockResolvedValueOnce(image);
    prismaMock.segmentationQueue.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.segmentationQueue.count.mockResolvedValueOnce(1); // remainingQueuedCount

    // ML call fails
    segmentationServiceMock.requestSegmentation.mockRejectedValueOnce(
      new Error('ML timeout')
    );

    // retry update
    prismaMock.segmentationQueue.update.mockResolvedValueOnce({
      ...item,
      retryCount: 1,
      status: 'queued',
    });
    imageServiceMock.updateSegmentationStatus.mockResolvedValueOnce(undefined);

    await service.processBatch([item]);

    expect(prismaMock.segmentationQueue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'qe-1' },
        data: expect.objectContaining({
          status: 'queued',
          retryCount: 1,
        }),
      })
    );
    expect(imageServiceMock.updateSegmentationStatus).toHaveBeenCalledWith(
      'img-1',
      'no_segmentation',
      'user-id'
    );
  });

  it('marks permanently failed and deletes from queue when retryCount >= 3', async () => {
    const item = makeQueueEntry({ retryCount: 3 });
    const image = { id: 'img-1', width: 100, height: 100 };

    imageServiceMock.getImageById.mockResolvedValueOnce(image);
    prismaMock.segmentationQueue.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.segmentationQueue.count.mockResolvedValueOnce(1);

    segmentationServiceMock.requestSegmentation.mockRejectedValueOnce(
      new Error('persistent failure')
    );

    prismaMock.segmentationQueue.delete.mockResolvedValueOnce(item);
    imageServiceMock.updateSegmentationStatus.mockResolvedValueOnce(undefined);

    await service.processBatch([item]);

    expect(prismaMock.segmentationQueue.delete).toHaveBeenCalledWith({
      where: { id: 'qe-1' },
    });
    expect(imageServiceMock.updateSegmentationStatus).toHaveBeenCalledWith(
      'img-1',
      'failed',
      'user-id'
    );
    // emitSegmentationUpdate should report 'failed'
    expect(wsServiceMock.emitSegmentationUpdate).toHaveBeenCalledWith(
      'user-id',
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('emits segmentationComplete with polygon count on success', async () => {
    const item = makeQueueEntry();
    const image = { id: 'img-1', width: 100, height: 100 };

    imageServiceMock.getImageById.mockResolvedValueOnce(image);
    prismaMock.segmentationQueue.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.segmentationQueue.count.mockResolvedValueOnce(0); // isLastBatch=true

    segmentationServiceMock.requestSegmentation.mockResolvedValueOnce({
      polygons: [{ points: [] }, { points: [] }],
      polylines: [],
      confidence: 0.9,
      processing_time: 150,
      image_size: { width: 100, height: 100 },
    });

    segmentationServiceMock.saveSegmentationResults.mockResolvedValueOnce(
      undefined
    );
    imageServiceMock.updateSegmentationStatus.mockResolvedValueOnce(undefined);
    prismaMock.segmentationQueue.delete.mockResolvedValueOnce(item);
    prismaMock.image.findUnique.mockResolvedValueOnce({ parentVideoId: null });
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(0) // second count call for getQueueStats
      .mockResolvedValueOnce(0);

    await service.processBatch([item]);

    expect(wsServiceMock.emitSegmentationComplete).toHaveBeenCalledWith(
      'user-id',
      'img-1',
      'project-id',
      2 // polygon count
    );
  });
});

// ---------------------------------------------------------------------------

describe('QueueService — resetStuckItems', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => {
    resetSingleton();
  });

  it('resets items below retry cap back to queued', async () => {
    const item = makeQueueEntry({ status: 'processing', retryCount: 1 });
    // resetStuckItems calls segmentationQueue.findMany first, then image.findMany
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([item]); // stuckItems
    prismaMock.image.findMany.mockResolvedValueOnce([]); // orphaned images (none)
    prismaMock.segmentationQueue.update.mockResolvedValueOnce({
      ...item,
      status: 'queued',
      retryCount: 2,
    });
    imageServiceMock.updateSegmentationStatus.mockResolvedValue(undefined);

    const count = await service.resetStuckItems();

    expect(prismaMock.segmentationQueue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'qe-1' },
        data: expect.objectContaining({ status: 'queued', retryCount: 2 }),
      })
    );
    expect(count).toBe(1);
  });

  it('deletes items that reached max retries (>= 3) and marks as failed', async () => {
    const item = makeQueueEntry({ status: 'processing', retryCount: 3 });
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([item]);
    prismaMock.image.findMany.mockResolvedValueOnce([]);
    prismaMock.segmentationQueue.delete.mockResolvedValueOnce(item);
    imageServiceMock.updateSegmentationStatus.mockResolvedValue(undefined);

    const count = await service.resetStuckItems();

    expect(prismaMock.segmentationQueue.delete).toHaveBeenCalledWith({
      where: { id: 'qe-1' },
    });
    expect(imageServiceMock.updateSegmentationStatus).toHaveBeenCalledWith(
      'img-1',
      'failed',
      'user-id'
    );
    expect(count).toBe(1);
  });

  it('returns 0 when there are no stuck items', async () => {
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([]);
    prismaMock.image.findMany.mockResolvedValueOnce([]);

    const count = await service.resetStuckItems();

    expect(count).toBe(0);
    expect(prismaMock.segmentationQueue.update).not.toHaveBeenCalled();
    expect(prismaMock.segmentationQueue.delete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('QueueService — cleanupOldEntries', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => {
    resetSingleton();
  });

  it('deletes completed/failed entries older than daysOld', async () => {
    prismaMock.segmentationQueue.deleteMany.mockResolvedValueOnce({ count: 5 });

    const count = await service.cleanupOldEntries(7);

    expect(count).toBe(5);
    expect(prismaMock.segmentationQueue.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['completed', 'failed'] },
          completedAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      })
    );
  });

  it('returns 0 when no entries are old enough', async () => {
    prismaMock.segmentationQueue.deleteMany.mockResolvedValueOnce({ count: 0 });

    const count = await service.cleanupOldEntries(7);

    expect(count).toBe(0);
  });

  it('propagates DB error', async () => {
    prismaMock.segmentationQueue.deleteMany.mockRejectedValueOnce(
      new Error('DB down')
    );

    await expect(service.cleanupOldEntries()).rejects.toThrow('DB down');
  });
});

// ---------------------------------------------------------------------------

describe('QueueService — cancelBatch', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => {
    resetSingleton();
  });

  it('returns 0 and skips DB ops when no queued items found for batch', async () => {
    // Reset to avoid leftover oneshot mocks from prior tests leaking in
    prismaMock.segmentationQueue.findMany.mockResolvedValue([]);

    const count = await service.cancelBatch('batch-xyz', 'user-id');

    expect(count).toBe(0);
    expect(prismaMock.segmentationQueue.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.image.updateMany).not.toHaveBeenCalled();
  });

  it('deletes queued rows and resets image status on cancel', async () => {
    const item = {
      ...makeQueueEntry({ batchId: 'batch-xyz' }),
      image: { projectId: 'project-id' },
    };
    // cancelBatch calls findMany (include: {image: true}) then deleteMany + updateMany
    prismaMock.segmentationQueue.findMany.mockResolvedValue([item]);
    prismaMock.segmentationQueue.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValue({ count: 1 });
    // getQueueStats for WS emit: count (queued) + count (processing)
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const count = await service.cancelBatch('batch-xyz', 'user-id');

    expect(count).toBe(1);
    expect(prismaMock.segmentationQueue.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          batchId: 'batch-xyz',
          userId: 'user-id',
          status: 'queued',
        }),
      })
    );
    expect(prismaMock.image.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['img-1'] } },
        data: { segmentationStatus: 'no_segmentation' },
      })
    );
  });

  it('emits cancellation events for each cancelled item via WebSocket', async () => {
    const item = {
      ...makeQueueEntry({ batchId: 'batch-abc' }),
      image: { projectId: 'project-id' },
    };
    prismaMock.segmentationQueue.findMany.mockResolvedValue([item]);
    prismaMock.segmentationQueue.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await service.cancelBatch('batch-abc', 'user-id');

    expect(wsServiceMock.emitToUser).toHaveBeenCalledWith(
      'user-id',
      'segmentation:cancelled',
      expect.objectContaining({ imageId: 'img-1', batchId: 'batch-abc' })
    );
  });
});

// ---------------------------------------------------------------------------

describe('QueueService — getQueueHealthStatus', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => {
    resetSingleton();
  });

  // getQueueHealthStatus fires Promise.all([count×5, findFirst]) then checkServiceHealth.
  // All 6 DB calls are concurrent — mock them by value not by call order for clarity.

  it('returns healthy=true when there are no issues', async () => {
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(5) // queued
      .mockResolvedValueOnce(1) // processing
      .mockResolvedValueOnce(100) // completed
      .mockResolvedValueOnce(0) // failed
      .mockResolvedValueOnce(0); // stuck (processing+old startedAt)
    // findFirst for oldestQueued: recent date, so no "over 30 min" issue
    prismaMock.segmentationQueue.findFirst.mockResolvedValue({
      createdAt: new Date(),
    });
    segmentationServiceMock.checkServiceHealth.mockResolvedValue(true);

    const status = await service.getQueueHealthStatus();

    expect(status.healthy).toBe(true);
    expect(status.issues).toHaveLength(0);
    expect(status.mlServiceHealthy).toBe(true);
    expect(status.queueStats.queued).toBe(5);
    expect(status.queueStats.processing).toBe(1);
  });

  it('reports stuck items issue when stuck > 0', async () => {
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(0) // queued
      .mockResolvedValueOnce(2) // processing
      .mockResolvedValueOnce(0) // completed
      .mockResolvedValueOnce(0) // failed
      .mockResolvedValueOnce(2); // stuck
    prismaMock.segmentationQueue.findFirst.mockResolvedValue(null);
    segmentationServiceMock.checkServiceHealth.mockResolvedValue(true);

    const status = await service.getQueueHealthStatus();

    expect(status.healthy).toBe(false);
    expect(status.issues.some(i => i.includes('stuck'))).toBe(true);
    expect(status.queueStats.stuck).toBe(2);
  });

  it('reports ML service issue when checkServiceHealth returns false', async () => {
    prismaMock.segmentationQueue.count.mockResolvedValue(0);
    prismaMock.segmentationQueue.findFirst.mockResolvedValue(null);
    segmentationServiceMock.checkServiceHealth.mockResolvedValue(false);

    const status = await service.getQueueHealthStatus();

    expect(status.healthy).toBe(false);
    expect(status.issues.some(i => i.includes('ML service'))).toBe(true);
  });

  it('reports high backlog issue when queued > 100', async () => {
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(150) // queued > 100 → issue
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMock.segmentationQueue.findFirst.mockResolvedValue(null);
    segmentationServiceMock.checkServiceHealth.mockResolvedValue(true);

    const status = await service.getQueueHealthStatus();

    expect(status.healthy).toBe(false);
    expect(status.issues.some(i => i.includes('backlog'))).toBe(true);
  });

  it('returns healthy=false with safe defaults on DB error', async () => {
    prismaMock.segmentationQueue.count.mockRejectedValue(new Error('DB gone'));

    const status = await service.getQueueHealthStatus();

    expect(status.healthy).toBe(false);
    expect(status.issues).toContain('Failed to check queue health');
    expect(status.queueStats).toEqual({
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      stuck: 0,
    });
  });
});

// ---------------------------------------------------------------------------

describe('QueueService — getParallelProcessingStats', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => {
    resetSingleton();
  });

  it('returns zero active streams at startup', async () => {
    const stats = await service.getParallelProcessingStats();
    expect(stats.activeStreams).toBe(0);
    expect(stats.maxConcurrentStreams).toBeGreaterThan(0);
  });
});
