/**
 * queueService.gaps2.test.ts
 *
 * Covers branches NOT exercised by queueService.gaps.test.ts or
 * queueService.parallel.test.ts:
 *
 *  - addToQueue: duplicate detection (already queued/processing → throws),
 *    success path (creates queue entry + updates image status)
 *  - getQueueStats: no project/user filter (global count), with projectId
 *    filter (emits WS), DB error propagation
 *  - getQueueItems: returns mapped items, propagates DB error
 *  - removeFromQueue: item not found → throws, success path
 *  - processBatch: empty result (0 polygons) → no_segmentation status,
 *    WS emitSegmentationComplete with 0
 *  - getQueueHealthStatus: oldestQueuedItem > 30 min → issue reported
 *  - resetStuckItems: orphaned image with no active queue entry → reset
 *    (via image.findMany mock)
 *
 * Skipped (infra-bound):
 *  - Real HTTP calls to ML service
 *  - processMultipleBatches concurrency (covered in parallel test file)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── config mock FIRST ────────────────────────────────────────────────────────
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

// ── Prisma mock ──────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────────────────────

describe('QueueService — addToQueue', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('throws when image is already queued or processing', async () => {
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(
      makeQueueEntry({ status: 'queued' })
    );

    await expect(
      service.addToQueue('img-1', 'proj-1', 'user-1')
    ).rejects.toThrow('Image is already in segmentation queue');

    expect(prismaMock.segmentationQueue.create).not.toHaveBeenCalled();
  });

  it('creates a queue entry and updates image status on success', async () => {
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null); // not already queued
    const created = makeQueueEntry({ id: 'new-qe' });
    prismaMock.segmentationQueue.create.mockResolvedValueOnce(created);
    imageServiceMock.updateSegmentationStatus.mockResolvedValueOnce(undefined);

    const result = await service.addToQueue(
      'img-1',
      'proj-1',
      'user-1',
      'hrnet',
      0.5,
      0,
      true
    );

    expect(prismaMock.segmentationQueue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          imageId: 'img-1',
          projectId: 'proj-1',
          userId: 'user-1',
          model: 'hrnet',
          status: 'queued',
        }),
      })
    );
    expect(imageServiceMock.updateSegmentationStatus).toHaveBeenCalledWith(
      'img-1',
      'queued',
      'user-1'
    );
    expect(result.id).toBe('new-qe');
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe('QueueService — getQueueStats', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('returns global counts with no filter applied when called without args', async () => {
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(3) // queued
      .mockResolvedValueOnce(1); // processing

    const stats = await service.getQueueStats();

    expect(stats.queued).toBe(3);
    expect(stats.processing).toBe(1);
    expect(stats.total).toBe(4);
    // No WS emit when projectId is absent
    expect(wsServiceMock.emitQueueStatsUpdate).not.toHaveBeenCalled();
  });

  it('emits WS queue stats when projectId is provided', async () => {
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);

    await service.getQueueStats('proj-ws', 'user-ws');

    expect(wsServiceMock.emitQueueStatsUpdate).toHaveBeenCalledWith(
      'proj-ws',
      expect.objectContaining({
        projectId: 'proj-ws',
        queued: 2,
        processing: 0,
      })
    );
  });

  it('propagates DB error', async () => {
    prismaMock.segmentationQueue.count.mockRejectedValueOnce(
      new Error('DB error')
    );

    await expect(service.getQueueStats()).rejects.toThrow('DB error');
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe('QueueService — getQueueItems', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('returns mapped queue items with expected fields', async () => {
    const raw = makeQueueEntry({ id: 'qi-1', status: 'queued' });
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([raw]);

    const items = await service.getQueueItems('proj-1', 'user-1');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'qi-1',
      imageId: 'img-1',
      projectId: 'project-id',
      userId: 'user-id',
      model: 'hrnet',
      threshold: 0.5,
      priority: 0,
      status: 'queued',
    });
  });

  it('propagates DB error', async () => {
    prismaMock.segmentationQueue.findMany.mockRejectedValueOnce(
      new Error('DB fail')
    );

    await expect(service.getQueueItems('proj-1', 'user-1')).rejects.toThrow(
      'DB fail'
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe('QueueService — removeFromQueue', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('throws when queue item not found or not removable', async () => {
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null);

    await expect(service.removeFromQueue('bad-id', 'user-1')).rejects.toThrow(
      'Queue item not found or cannot be removed'
    );

    expect(prismaMock.segmentationQueue.delete).not.toHaveBeenCalled();
  });

  it('removes queued item and resets image status', async () => {
    const item = makeQueueEntry({
      id: 'rm-1',
      status: 'queued',
      imageId: 'img-rm',
    });
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(item);
    prismaMock.segmentationQueue.delete.mockResolvedValueOnce(item);
    imageServiceMock.updateSegmentationStatus.mockResolvedValueOnce(undefined);

    await service.removeFromQueue('rm-1', 'user-id');

    expect(prismaMock.segmentationQueue.delete).toHaveBeenCalledWith({
      where: { id: 'rm-1' },
    });
    expect(imageServiceMock.updateSegmentationStatus).toHaveBeenCalledWith(
      'img-rm',
      'no_segmentation',
      'user-id'
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe('QueueService — processBatch empty-polygon path', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('marks image as no_segmentation when ML returns 0 polygons', async () => {
    const item = makeQueueEntry();
    const image = { id: 'img-1', width: 100, height: 100 };

    imageServiceMock.getImageById.mockResolvedValueOnce(image);
    prismaMock.segmentationQueue.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.segmentationQueue.count.mockResolvedValueOnce(0); // remainingQueuedCount

    // ML returns success but 0 polygons
    segmentationServiceMock.requestSegmentation.mockResolvedValueOnce({
      polygons: [],
      polylines: [],
      confidence: 0.5,
      processing_time: 100,
      image_size: { width: 100, height: 100 },
    });

    segmentationServiceMock.saveSegmentationResults.mockResolvedValueOnce(
      undefined
    );
    imageServiceMock.updateSegmentationStatus.mockResolvedValueOnce(undefined);
    prismaMock.segmentationQueue.delete.mockResolvedValueOnce(item);
    prismaMock.image.findUnique.mockResolvedValueOnce({ parentVideoId: null });
    // getQueueStats calls
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await service.processBatch([item]);

    expect(imageServiceMock.updateSegmentationStatus).toHaveBeenCalledWith(
      'img-1',
      'no_segmentation',
      'user-id'
    );
    expect(wsServiceMock.emitSegmentationComplete).toHaveBeenCalledWith(
      'user-id',
      'img-1',
      'project-id',
      0 // 0 polygons
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe('QueueService — getQueueHealthStatus: oldest-item > 30 min', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('reports issue when oldest queued item is over 30 minutes old', async () => {
    const staleDate = new Date(Date.now() - 35 * 60 * 1000); // 35 min ago

    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(1) // queued
      .mockResolvedValueOnce(0) // processing
      .mockResolvedValueOnce(0) // completed
      .mockResolvedValueOnce(0) // failed
      .mockResolvedValueOnce(0); // stuck
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce({
      createdAt: staleDate,
    });
    segmentationServiceMock.checkServiceHealth.mockResolvedValueOnce(true);

    const status = await service.getQueueHealthStatus();

    expect(status.healthy).toBe(false);
    expect(status.issues.some(i => i.includes('30 minutes'))).toBe(true);
    expect(status.oldestQueuedItem).toEqual(staleDate);
  });
});

// ────────────────────────────────────────────────────────────────────────────

describe('QueueService — resetStuckItems: orphaned image cleanup', () => {
  let service: QueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => resetSingleton());

  it('resets orphaned images stuck in processing with no active queue entry', async () => {
    // No stuck queue items
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([]);
    // One orphaned image
    prismaMock.image.findMany.mockResolvedValueOnce([
      {
        id: 'orphan-img',
        project: { userId: 'orphan-user' },
      },
    ]);
    imageServiceMock.updateSegmentationStatus.mockResolvedValue(undefined);

    const count = await service.resetStuckItems();

    expect(imageServiceMock.updateSegmentationStatus).toHaveBeenCalledWith(
      'orphan-img',
      'no_segmentation',
      'orphan-user'
    );
    // count = stuckCount (0) + failedCount (0) = 0; orphan handling is separate
    expect(count).toBe(0);
  });
});
