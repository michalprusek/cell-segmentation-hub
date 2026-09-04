/**
 * queueService.test.ts
 *
 * Consolidated unit tests for QueueService. Merged (2026-07-12) from the former
 * incremental split files queueService.{gaps,gaps2,gaps3,gaps5}.test.ts, which
 * had accumulated large amounts of duplicated mock scaffolding and overlapping
 * cases. Organized by concern — one `describe` per public surface:
 *
 *   enqueue                → addToQueue, addBatchToQueue
 *   read                   → getQueueStats, getQueueItems, getInstance
 *   remove/cancel          → removeFromQueue, cancelBatch, cancelAllUserSegmentations
 *   dequeue / fairness     → getMultipleBatches (getNextBatchExcluding), serial-dispatch cap
 *   worker state machine   → processBatch / processSingleBatch / processMultipleBatches
 *   stuck-item recovery    → resetStuckItems, cleanupOldEntries
 *   health / stats         → getQueueHealthStatus, getParallelProcessingStats
 *
 * The concurrency / stateful-store integration harness (4-way parallel
 * processing, WS notifications across concurrent streams, retry requeue through
 * a live queue store) lives separately in queueService.parallel.test.ts because
 * it uses a fundamentally different mock strategy (full PrismaClient mock with a
 * stateful queueStore vs. the one-shot resolved-value mocks used here).
 *
 * All I/O is mocked — no real ML HTTP calls, no real DB.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SegmentationQueue } from '@prisma/client';

// ── config mock FIRST: prevents process.exit(1) in config.ts during the
//    trackerService import chain ─────────────────────────────────────────────
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

// ── Shared mocks ─────────────────────────────────────────────────────────────
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

// ── Helpers ──────────────────────────────────────────────────────────────────
const resetSingleton = () => {
  (QueueService as unknown as { instance: unknown }).instance = undefined;
};

const makeService = (): QueueService => {
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
  overrides: Partial<SegmentationQueue> = {}
): SegmentationQueue {
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
    error: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SegmentationQueue;
}

// Every stateful mock fn used across tests. We `mockReset()` each one in
// beforeEach because this project's vitest config uses Jest-style
// `clearMocks`/`restoreMocks` (which clear call history + spies but NOT the
// `mockResolvedValueOnce` queue), so an unconsumed one-shot would otherwise
// leak into the next test. Resetting here makes every test order-independent.
const allMockFns: ReturnType<typeof vi.fn>[] = [
  ...Object.values(prismaMock.segmentationQueue),
  ...Object.values(prismaMock.image),
  prismaMock.user.findUnique,
  prismaMock.segmentation.deleteMany,
  prismaMock.$transaction,
  ...Object.values(segmentationServiceMock),
  ...Object.values(imageServiceMock),
  ...Object.values(wsServiceMock),
];

let service: QueueService;

beforeEach(() => {
  allMockFns.forEach(fn => fn.mockReset());
  service = makeService();
});

afterEach(() => {
  resetSingleton();
});

// ═══════════════════════════════════════════════════════════════════════════
// ENQUEUE
// ═══════════════════════════════════════════════════════════════════════════

describe('addToQueue', () => {
  it('creates a queue entry with the correct fields and updates image status', async () => {
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null);
    prismaMock.segmentationQueue.create.mockResolvedValueOnce(makeQueueEntry());
    imageServiceMock.updateSegmentationStatus.mockResolvedValueOnce(undefined);

    const result = await service.addToQueue(
      'img-1',
      'project-id',
      'user-id',
      'hrnet',
      0.5,
      0,
      true
    );

    expect(prismaMock.segmentationQueue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        imageId: 'img-1',
        projectId: 'project-id',
        userId: 'user-id',
        model: 'hrnet',
        threshold: 0.5,
        priority: 0,
        status: 'queued',
      }),
    });
    expect(imageServiceMock.updateSegmentationStatus).toHaveBeenCalledWith(
      'img-1',
      'queued',
      'user-id'
    );
    expect(result.id).toBe('qe-1');
  });

  it('throws when the image is already queued or processing', async () => {
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(
      makeQueueEntry()
    );

    await expect(
      service.addToQueue('img-1', 'project-id', 'user-id')
    ).rejects.toThrow('Image is already in segmentation queue');

    expect(prismaMock.segmentationQueue.create).not.toHaveBeenCalled();
  });

  it('propagates a DB error from create', async () => {
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null);
    prismaMock.segmentationQueue.create.mockRejectedValueOnce(
      new Error('Connection refused')
    );

    await expect(
      service.addToQueue('img-1', 'project-id', 'user-id')
    ).rejects.toThrow('Connection refused');
  });

  it('triggers the registered queue worker after enqueue', async () => {
    const triggerImmediateProcessing = vi.fn();
    service.setQueueWorker({ triggerImmediateProcessing });

    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null);
    prismaMock.segmentationQueue.create.mockResolvedValueOnce(makeQueueEntry());
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    await service.addToQueue('img-1', 'project-id', 'user-id', 'hrnet', 0.5);

    expect(triggerImmediateProcessing).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the worker lacks triggerImmediateProcessing', async () => {
    service.setQueueWorker({ somethingElse: vi.fn() });

    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null);
    prismaMock.segmentationQueue.create.mockResolvedValueOnce(makeQueueEntry());
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await expect(
      service.addToQueue('img-1', 'project-id', 'user-id', 'hrnet', 0.5)
    ).resolves.not.toThrow();
  });
});

describe('addBatchToQueue', () => {
  it('queues multiple images and skips already-queued ones', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'user@test.com' });
    // img-2 comes back with status 'queued' → filtered out client-side
    prismaMock.image.findMany.mockResolvedValueOnce([
      { id: 'img-1', segmentationStatus: 'no_segmentation' },
      { id: 'img-2', segmentationStatus: 'queued' },
      { id: 'img-3', segmentationStatus: 'no_segmentation' },
    ] as never);

    const qe1 = makeQueueEntry({ id: 'qe-1', imageId: 'img-1' });
    const qe3 = makeQueueEntry({ id: 'qe-3', imageId: 'img-3' });
    prismaMock.$transaction.mockImplementationOnce(async (cb: never) => {
      const tx = {
        segmentation: { deleteMany: vi.fn() },
        segmentationQueue: {
          createMany: vi.fn().mockResolvedValue({ count: 2 }),
          findMany: vi.fn().mockResolvedValue([qe1, qe3]),
        },
        image: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      };
      return (cb as (tx: unknown) => Promise<unknown>)(tx);
    });

    const results = await service.addBatchToQueue(
      ['img-1', 'img-2', 'img-3'],
      'project-id',
      'user-id'
    );

    expect(results).toHaveLength(2);
    expect(results.map(r => r.imageId)).toEqual(
      expect.arrayContaining(['img-1', 'img-3'])
    );
  });

  it('skips images not found or not accessible', async () => {
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

  it('throws when the user is not found', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.addBatchToQueue(['img-1'], 'project-id', 'unknown-user')
    ).rejects.toThrow('not found');
  });

  it('returns an empty array (no DB calls) for empty imageIds', async () => {
    const results = await service.addBatchToQueue([], 'project-id', 'user-id');

    expect(results).toEqual([]);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('deletes existing segmentation rows when forceResegment=true', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@test.com' });
    prismaMock.image.findMany.mockResolvedValueOnce([
      { id: 'img-1', segmentationStatus: 'segmented' },
    ] as never);

    const segDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    prismaMock.$transaction.mockImplementationOnce(async (cb: never) => {
      const tx = {
        segmentation: { deleteMany: segDeleteMany },
        segmentationQueue: {
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
          findMany: vi.fn().mockResolvedValue([makeQueueEntry()]),
        },
        image: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      return (cb as (tx: unknown) => Promise<unknown>)(tx);
    });

    const results = await service.addBatchToQueue(
      ['img-1'],
      'project-id',
      'user-id',
      'hrnet',
      0.5,
      0,
      true // forceResegment
    );

    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(segDeleteMany).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].imageId).toBe('img-1');
  });

  it('does NOT delete segmentation rows when forceResegment=false', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@test.com' });
    prismaMock.image.findMany.mockResolvedValueOnce([
      { id: 'img-1', segmentationStatus: 'no_segmentation' },
    ] as never);

    const segDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    prismaMock.$transaction.mockImplementationOnce(async (cb: never) => {
      const tx = {
        segmentation: { deleteMany: segDeleteMany },
        segmentationQueue: {
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
          findMany: vi.fn().mockResolvedValue([makeQueueEntry()]),
        },
        image: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      return (cb as (tx: unknown) => Promise<unknown>)(tx);
    });

    await service.addBatchToQueue(
      ['img-1'],
      'project-id',
      'user-id',
      'hrnet',
      0.5,
      0,
      false // forceResegment off
    );

    expect(segDeleteMany).not.toHaveBeenCalled();
  });

  it('propagates the channel field to the queue row data', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ email: 'u@test.com' });
    prismaMock.image.findMany.mockResolvedValueOnce([
      { id: 'img-1', segmentationStatus: 'no_segmentation' },
    ] as never);

    let capturedCreateManyData: unknown = null;
    prismaMock.$transaction.mockImplementationOnce(async (cb: never) => {
      const tx = {
        segmentation: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        segmentationQueue: {
          createMany: vi.fn().mockImplementation(({ data }: { data: unknown }) => {
            capturedCreateManyData = data;
            return Promise.resolve({ count: 1 });
          }),
          findMany: vi.fn().mockResolvedValue([makeQueueEntry()]),
        },
        image: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      return (cb as (tx: unknown) => Promise<unknown>)(tx);
    });

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

// ═══════════════════════════════════════════════════════════════════════════
// READ / INTROSPECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('getQueueStats', () => {
  it('returns queued/processing/total counts', async () => {
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(3) // queued
      .mockResolvedValueOnce(1); // processing

    const stats = await service.getQueueStats('project-id', 'user-id');

    expect(stats).toEqual({ queued: 3, processing: 1, total: 4 });
    expect(prismaMock.segmentationQueue.count).toHaveBeenCalledTimes(2);
  });

  it('returns global counts and does NOT emit WS when called without a projectId', async () => {
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);

    const stats = await service.getQueueStats();

    expect(stats).toEqual({ queued: 3, processing: 1, total: 4 });
    expect(wsServiceMock.emitQueueStatsUpdate).not.toHaveBeenCalled();
  });

  it('emits WS queue stats when a projectId is provided', async () => {
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);

    await service.getQueueStats('project-id');

    expect(wsServiceMock.emitQueueStatsUpdate).toHaveBeenCalledWith(
      'project-id',
      expect.objectContaining({ projectId: 'project-id', queued: 2 })
    );
  });

  it('propagates a DB error', async () => {
    prismaMock.segmentationQueue.count.mockRejectedValueOnce(
      new Error('DB error')
    );

    await expect(service.getQueueStats()).rejects.toThrow('DB error');
  });
});

describe('getQueueItems', () => {
  it('returns mapped queue items with expected fields', async () => {
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([
      makeQueueEntry({ id: 'qi-1' }),
      makeQueueEntry({ id: 'qi-2' }),
    ]);

    const items = await service.getQueueItems('project-id', 'user-id');

    expect(items).toHaveLength(2);
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
    expect(prismaMock.segmentationQueue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 'project-id',
          userId: 'user-id',
        }),
      })
    );
  });

  it('returns an empty array when there are no active queue items', async () => {
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([]);

    const result = await service.getQueueItems('project-id', 'user-id');

    expect(result).toEqual([]);
  });

  it('propagates a DB error', async () => {
    prismaMock.segmentationQueue.findMany.mockRejectedValueOnce(
      new Error('Timeout')
    );

    await expect(
      service.getQueueItems('project-id', 'user-id')
    ).rejects.toThrow('Timeout');
  });
});

describe('getInstance (singleton)', () => {
  it('returns the same instance on repeated calls', () => {
    const instance1 = QueueService.getInstance(
      prismaMock as never,
      segmentationServiceMock as never,
      imageServiceMock as never
    );
    const instance2 = QueueService.getInstance(prismaMock as never);

    expect(instance1).toBe(instance2);
  });

  it('throws when first-initialized without the required dependencies', () => {
    resetSingleton();

    expect(() => QueueService.getInstance(prismaMock as never)).toThrow(
      'SegmentationService and ImageService are required for first initialization'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REMOVE / CANCEL
// ═══════════════════════════════════════════════════════════════════════════

describe('removeFromQueue', () => {
  it('removes a queued item and resets the image status', async () => {
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(
      makeQueueEntry({ id: 'queue-id' })
    );
    prismaMock.segmentationQueue.delete.mockResolvedValueOnce(makeQueueEntry());
    imageServiceMock.updateSegmentationStatus.mockResolvedValueOnce(undefined);

    await service.removeFromQueue('queue-id', 'user-id');

    expect(prismaMock.segmentationQueue.delete).toHaveBeenCalledWith({
      where: { id: 'queue-id' },
    });
    expect(imageServiceMock.updateSegmentationStatus).toHaveBeenCalledWith(
      'img-1',
      'no_segmentation',
      'user-id'
    );
  });

  it('throws when the queue item is not found or is already processing', async () => {
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.removeFromQueue('nonexistent', 'user-id')
    ).rejects.toThrow('Queue item not found or cannot be removed');

    expect(prismaMock.segmentationQueue.delete).not.toHaveBeenCalled();
  });
});

describe('cancelBatch', () => {
  it('returns 0 and skips DB writes when no queued items exist for the batch', async () => {
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([]);

    const count = await service.cancelBatch('batch-empty', 'user-id');

    expect(count).toBe(0);
    expect(prismaMock.segmentationQueue.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.image.updateMany).not.toHaveBeenCalled();
  });

  it('deletes queued rows and resets image status on cancel', async () => {
    const item = {
      ...makeQueueEntry({ batchId: 'batch-1' }),
      image: { projectId: 'project-id' },
    };
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([item] as never);
    prismaMock.segmentationQueue.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const count = await service.cancelBatch('batch-1', 'user-id');

    expect(count).toBe(1);
    expect(prismaMock.segmentationQueue.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          batchId: 'batch-1',
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

  it('emits "segmentation:cancelled" for each cancelled item via WS', async () => {
    const item = {
      ...makeQueueEntry({ batchId: 'batch-1' }),
      image: { projectId: 'project-id' },
    };
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([item] as never);
    prismaMock.segmentationQueue.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.segmentationQueue.count.mockResolvedValue(0);

    await service.cancelBatch('batch-1', 'user-id');

    expect(wsServiceMock.emitToUser).toHaveBeenCalledWith(
      'user-id',
      'segmentation:cancelled',
      expect.objectContaining({ imageId: 'img-1', batchId: 'batch-1' })
    );
  });

  it('propagates a DB error from deleteMany', async () => {
    const item = {
      ...makeQueueEntry({ batchId: 'batch-1' }),
      image: { projectId: 'project-id' },
    };
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([item] as never);
    prismaMock.segmentationQueue.deleteMany.mockRejectedValueOnce(
      new Error('DB error')
    );

    await expect(service.cancelBatch('batch-1', 'user-id')).rejects.toThrow(
      'DB error'
    );
  });
});

describe('cancelAllUserSegmentations', () => {
  it('returns zero counts when the user has no active items', async () => {
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([]);

    const result = await service.cancelAllUserSegmentations('user-empty');

    expect(result.cancelledCount).toBe(0);
    expect(result.affectedProjects).toHaveLength(0);
    expect(result.affectedBatches).toHaveLength(0);
  });

  it('deletes queued items, marks processing as cancelled, and collects affected ids', async () => {
    const queuedItem = {
      ...makeQueueEntry({ status: 'queued', batchId: 'b-1' }),
      image: { projectId: 'project-id' },
    };
    const processingItem = {
      ...makeQueueEntry({
        id: 'qe-2',
        imageId: 'img-2',
        status: 'processing',
        batchId: 'b-2',
      }),
      image: { projectId: 'project-id' },
    };
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([
      queuedItem,
      processingItem,
    ] as never);
    prismaMock.segmentationQueue.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.segmentationQueue.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValueOnce({ count: 2 });
    prismaMock.segmentationQueue.count.mockResolvedValue(0);

    const result = await service.cancelAllUserSegmentations('user-id');

    expect(prismaMock.segmentationQueue.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'queued' }),
      })
    );
    expect(prismaMock.segmentationQueue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'cancelled' } })
    );
    expect(prismaMock.image.updateMany).toHaveBeenCalled();
    expect(result.affectedProjects).toContain('project-id');
    expect(result.affectedBatches.sort()).toEqual(['b-1', 'b-2'].sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DEQUEUE / FAIRNESS (getMultipleBatches → getNextBatchExcluding)
// ═══════════════════════════════════════════════════════════════════════════

describe('getMultipleBatches — fairness & dispatch', () => {
  // Query order inside getNextBatchExcluding: the plain priority/createdAt
  // candidate and the recently-processed window go out together (Promise.all,
  // findFirst first), and the user-restricted candidate is a SECOND findFirst
  // issued only when that window is non-empty.
  it('prefers a user NOT in the recently-processed window', async () => {
    const userAItem = makeQueueEntry({ userId: 'user-A', imageId: 'img-A' });
    const userBItem = makeQueueEntry({ userId: 'user-B', imageId: 'img-B' });
    prismaMock.segmentationQueue.findMany
      .mockResolvedValueOnce([{ userId: 'user-A' }]) // recentlyProcessed
      .mockResolvedValueOnce([userBItem]); // batch findMany for user-B
    prismaMock.segmentationQueue.findFirst
      .mockResolvedValueOnce(userAItem) // plain-order candidate: the recent user
      .mockResolvedValueOnce(userBItem); // preferred non-recent user wins

    const batches = await service.getMultipleBatches(1);

    expect(batches).toHaveLength(1);
    expect(batches[0].items[0].userId).toBe('user-B');
  });

  it('falls back to priority ordering when no non-recent user has work', async () => {
    const userAItem = makeQueueEntry({ userId: 'user-A', imageId: 'img-A' });
    prismaMock.segmentationQueue.findMany
      .mockResolvedValueOnce([{ userId: 'user-A' }]) // recentlyProcessed
      .mockResolvedValueOnce([userAItem]); // batch findMany
    prismaMock.segmentationQueue.findFirst
      .mockResolvedValueOnce(userAItem) // plain-order candidate
      .mockResolvedValueOnce(null); // preferred-user search: none

    const batches = await service.getMultipleBatches(1);

    expect(batches).toHaveLength(1);
    expect(batches[0].items[0].userId).toBe('user-A');
  });

  it('returns empty batches when the queue is empty', async () => {
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([]); // recentlyProcessed
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(null); // plain candidate

    const batches = await service.getMultipleBatches(4);

    expect(batches).toHaveLength(0);
  });

  it('costs ONE findFirst and ONE findMany per tick on an empty queue', async () => {
    // The worker calls this every 100 ms forever. An empty queue used to cost
    // three SERIAL round trips — the recently-processed window, the
    // user-restricted candidate, then the plain one. The plain candidate now
    // goes out with the window and a null result short-circuits, so the
    // user-restricted lookup is never issued.
    prismaMock.segmentationQueue.findMany.mockResolvedValue([
      { userId: 'user-A' },
    ]); // a NON-empty fairness window, i.e. the expensive branch
    prismaMock.segmentationQueue.findFirst.mockResolvedValue(null);

    const batches = await service.getMultipleBatches(4);

    expect(batches).toHaveLength(0);
    expect(prismaMock.segmentationQueue.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.segmentationQueue.findMany).toHaveBeenCalledTimes(1);
  });

  it('caps to a single batch for a serial-dispatch model (microtubule)', async () => {
    const mtItem = makeQueueEntry({ model: 'microtubule' });
    prismaMock.segmentationQueue.findMany
      .mockResolvedValueOnce([]) // recentlyProcessed → empty
      .mockResolvedValueOnce([mtItem]); // batch findMany
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce(mtItem); // plain-order fallback

    const batches = await service.getMultipleBatches(4);

    expect(batches).toHaveLength(1);
    expect(batches[0].model).toBe('microtubule');
  });

  it('allows multiple batches for non-serial models', async () => {
    const hr1 = makeQueueEntry({ id: 'qe-1', imageId: 'img-1', model: 'hrnet' });
    const hr2 = makeQueueEntry({ id: 'qe-2', imageId: 'img-2', model: 'hrnet' });
    prismaMock.segmentationQueue.findMany
      .mockResolvedValueOnce([]) // recentlyProcessed (iter 1)
      .mockResolvedValueOnce([hr1]) // batch items (iter 1)
      .mockResolvedValueOnce([]) // recentlyProcessed (iter 2)
      .mockResolvedValueOnce([hr2]); // batch items (iter 2)
    prismaMock.segmentationQueue.findFirst
      .mockResolvedValueOnce(hr1)
      .mockResolvedValueOnce(hr2);

    const batches = await service.getMultipleBatches(2);

    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches.some(b => b.model === 'hrnet')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WORKER STATE MACHINE (processBatch / processSingleBatch / processMultipleBatches)
// ═══════════════════════════════════════════════════════════════════════════

describe('processBatch', () => {
  it('emits segmentationComplete with the polygon count on success', async () => {
    const item = makeQueueEntry();

    imageServiceMock.getImageById.mockResolvedValueOnce({
      id: 'img-1',
      width: 100,
      height: 100,
    });
    prismaMock.segmentationQueue.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.segmentationQueue.count.mockResolvedValueOnce(0); // isLastBatch
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
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await service.processBatch([item]);

    expect(wsServiceMock.emitSegmentationComplete).toHaveBeenCalledWith(
      'user-id',
      'img-1',
      'project-id',
      2 // polygon count
    );
    expect(wsServiceMock.emitQueueStatsUpdate).toHaveBeenCalled();
  });

  it('marks the image as no_segmentation when ML returns 0 polygons', async () => {
    const item = makeQueueEntry();

    imageServiceMock.getImageById.mockResolvedValueOnce({
      id: 'img-1',
      width: 100,
      height: 100,
    });
    prismaMock.segmentationQueue.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.segmentationQueue.count.mockResolvedValueOnce(0);
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
      0
    );
  });

  it('requeues with an incremented retryCount on failure (< 3 retries)', async () => {
    const item = makeQueueEntry({ retryCount: 0 });

    imageServiceMock.getImageById.mockResolvedValueOnce({
      id: 'img-1',
      width: 100,
      height: 100,
    });
    prismaMock.segmentationQueue.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.segmentationQueue.count.mockResolvedValueOnce(1);
    segmentationServiceMock.requestSegmentation.mockRejectedValueOnce(
      new Error('ML timeout')
    );
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
        data: expect.objectContaining({ status: 'queued', retryCount: 1 }),
      })
    );
    // 'queued', not 'no_segmentation': the row really is queued again, and the
    // WS event next to this update already said 'queued'. Reporting "no
    // segmentation" made a pending retry look like a finished, empty run.
    expect(imageServiceMock.updateSegmentationStatus).toHaveBeenCalledWith(
      'img-1',
      'queued',
      'user-id'
    );
  });

  it('permanently fails and deletes the item when retryCount >= 3', async () => {
    const item = makeQueueEntry({ retryCount: 3 });

    imageServiceMock.getImageById.mockResolvedValueOnce({
      id: 'img-1',
      width: 100,
      height: 100,
    });
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
    expect(wsServiceMock.emitSegmentationUpdate).toHaveBeenCalledWith(
      'user-id',
      expect.objectContaining({ status: 'failed' })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NOTHING MAY STALL IN 'processing'
//
// Every one of these encodes a way an item used to be left with
// segmentationQueue.status = 'processing' AND image.segmentationStatus =
// 'processing' and nothing left running to move it — the "stuck in
// processing" the user reported. They are 2-item batches on purpose: the
// stalls all come from one item's fate leaking into another's.
// ═══════════════════════════════════════════════════════════════════════════

describe("processBatch — nothing may stall in 'processing'", () => {
  const item1 = () => makeQueueEntry({ id: 'qe-1', imageId: 'img-1' });
  const item2 = () => makeQueueEntry({ id: 'qe-2', imageId: 'img-2' });

  // A real hrnet-shaped result: one closed polygon.
  const polygonResult = () => ({
    success: true,
    polygons: [
      {
        id: 'p1',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
        ],
        type: 'external',
      },
    ],
    polylines: [],
    model_used: 'hrnet',
    threshold_used: 0.5,
    confidence: 0.9,
    processing_time: 120,
    image_size: { width: 100, height: 100 },
  });

  const stubBatchPlumbing = () => {
    imageServiceMock.getImageById.mockImplementation(async (id: string) => ({
      id,
      originalPath: `${id}.png`,
      width: 100,
      height: 100,
      mimeType: 'image/png',
    }));
    imageServiceMock.updateSegmentationStatus.mockResolvedValue(undefined);
    segmentationServiceMock.saveSegmentationResults.mockResolvedValue(
      undefined
    );
    prismaMock.segmentationQueue.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.image.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.segmentationQueue.count.mockResolvedValue(0);
    prismaMock.segmentationQueue.delete.mockResolvedValue(undefined);
    prismaMock.segmentationQueue.update.mockResolvedValue(undefined);
    prismaMock.image.findUnique.mockResolvedValue({ parentVideoId: null });
  };

  const statusesFor = (imageId: string): string[] =>
    imageServiceMock.updateSegmentationStatus.mock.calls
      .filter((call: unknown[]) => call[0] === imageId)
      .map((call: unknown[]) => call[1] as string);

  it('settles an item the ML service returned no result for', async () => {
    stubBatchPlumbing();
    // One result for a two-item batch: a truncated / misaligned response.
    segmentationServiceMock.requestBatchSegmentation.mockResolvedValueOnce([
      polygonResult(),
    ]);

    await service.processBatch([item1(), item2()]);

    // img-1 finished normally.
    expect(statusesFor('img-1')).toContain('segmented');
    // img-2 must not be abandoned: it used to be skipped with a log line and
    // no status write at all, leaving both rows on 'processing' forever.
    expect(prismaMock.segmentationQueue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'qe-2' },
        data: expect.objectContaining({ status: 'queued', retryCount: 1 }),
      })
    );
    expect(statusesFor('img-2')).toContain('queued');
  });

  it('keeps processing the rest of the batch after one item throws', async () => {
    stubBatchPlumbing();
    segmentationServiceMock.requestBatchSegmentation.mockResolvedValueOnce([
      polygonResult(),
      polygonResult(),
    ]);
    // The first item's save blows up (disk full, thumbnail failure, ...).
    segmentationServiceMock.saveSegmentationResults
      .mockRejectedValueOnce(new Error('save failed'))
      .mockResolvedValue(undefined);

    await service.processBatch([item1(), item2()]);

    // The failing item is requeued...
    expect(statusesFor('img-1')).toContain('queued');
    // ...and — the actual regression — the item AFTER it still gets its own
    // result. It used to be skipped entirely by the throw unwinding the loop.
    expect(statusesFor('img-2')).toContain('segmented');
    expect(prismaMock.segmentationQueue.delete).toHaveBeenCalledWith({
      where: { id: 'qe-2' },
    });
  });

  it('does not roll a finished item back when the trailing work fails', async () => {
    stubBatchPlumbing();
    segmentationServiceMock.requestBatchSegmentation.mockResolvedValueOnce([
      polygonResult(),
      polygonResult(),
    ]);
    // Both items complete and their rows are removed; the queue-stats read
    // afterwards fails, which lands in the batch-level catch.
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(0) // isLastBatch probe
      .mockRejectedValue(new Error('stats query failed'));

    await service.processBatch([item1(), item2()]);

    // Recovery must skip items that already reached a terminal state. It used
    // to requeue them, overwriting a saved result with 'no_segmentation'.
    expect(statusesFor('img-1')).toEqual(['segmented']);
    expect(statusesFor('img-2')).toEqual(['segmented']);
    expect(prismaMock.segmentationQueue.update).not.toHaveBeenCalled();
  });

  it('recovers every item even when one queue row is already gone', async () => {
    stubBatchPlumbing();
    segmentationServiceMock.requestBatchSegmentation.mockRejectedValueOnce(
      new Error('ML service unavailable')
    );
    // Prisma P2025 for the first row — it vanished under a concurrent cancel.
    prismaMock.segmentationQueue.update
      .mockRejectedValueOnce(
        Object.assign(new Error('Record to update not found'), {
          code: 'P2025',
        })
      )
      .mockResolvedValue(undefined);

    await service.processBatch([item1(), item2()]);

    // The P2025 used to escape the recovery loop, so every item after the
    // first stayed on 'processing'.
    expect(prismaMock.segmentationQueue.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'qe-2' } })
    );
    expect(statusesFor('img-2')).toContain('queued');

    // img-1 has no row left, so it cannot be 'queued' — nothing would ever
    // run that retry. It is repaired only if it is still stuck on
    // 'processing', which leaves a concurrent cancel's status alone.
    expect(statusesFor('img-1')).toEqual([]);
    expect(prismaMock.image.updateMany).toHaveBeenCalledWith({
      where: { id: 'img-1', segmentationStatus: 'processing' },
      data: { segmentationStatus: 'failed' },
    });
  });

  it('treats an explicit ML failure as a failure, not as an empty result', async () => {
    stubBatchPlumbing();
    segmentationServiceMock.requestBatchSegmentation.mockResolvedValueOnce([
      {
        success: false,
        polygons: [],
        model_used: 'hrnet',
        threshold_used: 0.5,
        confidence: null,
        processing_time: null,
        image_size: { width: 0, height: 0 },
        error: 'Image skipped or invalid',
      },
      polygonResult(),
    ]);

    await service.processBatch([item1(), item2()]);

    // `success: false` carries empty shapes because nothing ran. Reading that
    // as "the model found nothing" wrote a clean `no_segmentation` and dropped
    // the queue row, so the image was never retried.
    expect(statusesFor('img-1')).not.toContain('no_segmentation');
    expect(statusesFor('img-1')).toContain('queued');
    expect(prismaMock.segmentationQueue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'qe-1' },
        data: expect.objectContaining({
          status: 'queued',
          error: 'Image skipped or invalid',
        }),
      })
    );
    expect(statusesFor('img-2')).toContain('segmented');
  });

  it('accepts a genuinely empty result and clears it out of the queue', async () => {
    stubBatchPlumbing();
    segmentationServiceMock.requestBatchSegmentation.mockResolvedValueOnce([
      {
        ...polygonResult(),
        polygons: [],
        polylines: [],
      },
      polygonResult(),
    ]);

    await service.processBatch([item1(), item2()]);

    // The user's ask: an image with nothing on it is a completed run, not an
    // error and not a stall.
    expect(statusesFor('img-1')).toEqual(['no_segmentation']);
    expect(
      segmentationServiceMock.saveSegmentationResults
    ).toHaveBeenCalledWith(
      'img-1',
      [],
      'hrnet',
      0.5,
      expect.anything(),
      expect.anything(),
      100,
      100,
      'user-id',
      expect.anything()
    );
    expect(prismaMock.segmentationQueue.delete).toHaveBeenCalledWith({
      where: { id: 'qe-1' },
    });
    expect(wsServiceMock.emitSegmentationComplete).toHaveBeenCalledWith(
      'user-id',
      'img-1',
      'project-id',
      0
    );
  });

  it('keeps the polylines of a polyline model out of the empty branch', async () => {
    stubBatchPlumbing();
    // Real microtubule v5H shape: polygons is empty, the detections are
    // polylines. Losing them here marked a segmented frame no_segmentation.
    segmentationServiceMock.requestBatchSegmentation.mockResolvedValueOnce([
      {
        success: true,
        polygons: [],
        polylines: [
          {
            id: 'polyline_1',
            points: [
              { x: 447, y: 8 },
              { x: 465, y: 25 },
              { x: 467, y: 25 },
            ],
            type: 'external',
            class: 'microtubule',
            geometry: 'polyline',
            instanceId: 'mt_c1a01b00',
            confidence: 1,
            vertices_count: 3,
          },
        ],
        model_used: 'microtubule',
        threshold_used: 0.97,
        confidence: 1,
        processing_time: 4500,
        image_size: { width: 512, height: 512 },
      },
      polygonResult(),
    ]);

    await service.processBatch([item1(), item2()]);

    expect(statusesFor('img-1')).toEqual(['segmented']);
    expect(wsServiceMock.emitSegmentationComplete).toHaveBeenCalledWith(
      'user-id',
      'img-1',
      'project-id',
      1
    );
  });
});

describe('processSingleBatch / processMultipleBatches', () => {
  const stubSuccessfulProcessing = (item: SegmentationQueue) => {
    imageServiceMock.getImageById.mockResolvedValue({
      id: 'img-1',
      originalPath: 'path.jpg',
      width: 100,
      height: 100,
      mimeType: 'image/jpeg',
      name: 'img.jpg',
      projectId: 'project-id',
    });
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
    segmentationServiceMock.saveSegmentationResults.mockResolvedValue(undefined);
    prismaMock.segmentationQueue.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.segmentationQueue.delete.mockResolvedValue(item);
    prismaMock.image.findUnique.mockResolvedValue(null);
    prismaMock.segmentationQueue.count.mockResolvedValue(0);
  };

  it('processSingleBatch returns immediately for an empty batch', async () => {
    await expect(service.processSingleBatch([])).resolves.toBeUndefined();
    expect(segmentationServiceMock.requestSegmentation).not.toHaveBeenCalled();
  });

  it('processSingleBatch delegates to processBatch for a single item', async () => {
    const item = makeQueueEntry();
    stubSuccessfulProcessing(item);

    await expect(service.processSingleBatch([item])).resolves.toBeUndefined();
    expect(segmentationServiceMock.requestSegmentation).toHaveBeenCalledTimes(1);
  });

  it('processMultipleBatches returns immediately for an empty list', async () => {
    await expect(service.processMultipleBatches([])).resolves.toBeUndefined();
    expect(segmentationServiceMock.requestSegmentation).not.toHaveBeenCalled();
  });

  it('processMultipleBatches processes batches concurrently', async () => {
    const item = makeQueueEntry();
    stubSuccessfulProcessing(item);

    const batches = [{ id: 'b1', items: [item], model: 'hrnet' }];

    await expect(
      service.processMultipleBatches(batches as never)
    ).resolves.toBeUndefined();
  });

  it('processMultipleBatches swallows a per-batch error without propagating', async () => {
    const item = makeQueueEntry();
    imageServiceMock.getImageById.mockRejectedValue(new Error('DB error'));
    prismaMock.segmentationQueue.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.image.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.segmentationQueue.update.mockResolvedValue(item); // retry path

    const batches = [{ id: 'b1', items: [item], model: 'hrnet' }];

    await expect(
      service.processMultipleBatches(batches as never)
    ).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STUCK-ITEM RECOVERY & CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

describe('resetStuckItems', () => {
  it('resets items below the retry cap back to queued', async () => {
    const item = makeQueueEntry({ status: 'processing', retryCount: 1 });
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([item]); // stuck
    prismaMock.image.findMany.mockResolvedValueOnce([]); // no orphans
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

  it('deletes items that reached the max retry count (>= 3) and marks them failed', async () => {
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

  it('marks orphaned images stuck in processing as failed, not no_segmentation', async () => {
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([]); // no stuck queue rows
    prismaMock.image.findMany.mockResolvedValueOnce([
      { id: 'orphan-img', project: { userId: 'orphan-user' } },
    ] as never);
    imageServiceMock.updateSegmentationStatus.mockResolvedValue(undefined);

    const count = await service.resetStuckItems();

    // 'no_segmentation' is what a SUCCESSFUL run over a blank frame writes.
    // Reusing it for a run that never finished made a dead worker
    // indistinguishable from an image that genuinely has nothing on it.
    expect(imageServiceMock.updateSegmentationStatus).toHaveBeenCalledWith(
      'orphan-img',
      'failed',
      'orphan-user'
    );
    expect(count).toBe(0); // orphan handling is separate from stuck/failed counts
  });

  it('only sweeps orphaned images that have been processing past the cutoff', async () => {
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([]);
    prismaMock.image.findMany.mockResolvedValueOnce([]);

    await service.resetStuckItems(10);

    // Without the age filter this query also matches a run that started a
    // second ago via POST /segmentation/batch — which segments directly, with
    // no queue row — and the sweeper would reset it out from under itself.
    expect(prismaMock.image.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          segmentationStatus: 'processing',
          updatedAt: { lt: expect.any(Date) },
        }),
      })
    );
  });

  it('keeps a floor on the orphan cutoff even at maxProcessingMinutes = 0', async () => {
    prismaMock.segmentationQueue.findMany.mockResolvedValueOnce([]);
    prismaMock.image.findMany.mockResolvedValueOnce([]);

    // queueWorker's deadlock path calls resetStuckItems(0), which is meant to
    // be aggressive about QUEUE rows. Letting that cutoff reach the image sweep
    // would put it at "now" and kill a healthy in-flight direct segmentation.
    await service.resetStuckItems(0);

    const where = prismaMock.image.findMany.mock.calls[0][0].where as {
      updatedAt: { lt: Date };
    };
    expect(Date.now() - where.updatedAt.lt.getTime()).toBeGreaterThanOrEqual(
      5 * 60 * 1000
    );
  });
});

describe('cleanupOldEntries', () => {
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

  it('propagates a DB error', async () => {
    prismaMock.segmentationQueue.deleteMany.mockRejectedValueOnce(
      new Error('DB down')
    );

    await expect(service.cleanupOldEntries()).rejects.toThrow('DB down');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH & PARALLEL STATS
// ═══════════════════════════════════════════════════════════════════════════

describe('getQueueHealthStatus', () => {
  it('returns healthy=true when there are no issues', async () => {
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(5) // queued
      .mockResolvedValueOnce(1) // processing
      .mockResolvedValueOnce(100) // completed
      .mockResolvedValueOnce(0) // failed
      .mockResolvedValueOnce(0); // stuck
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

  it('reports a stuck-items issue when stuck > 0', async () => {
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(2); // stuck
    prismaMock.segmentationQueue.findFirst.mockResolvedValue(null);
    segmentationServiceMock.checkServiceHealth.mockResolvedValue(true);

    const status = await service.getQueueHealthStatus();

    expect(status.healthy).toBe(false);
    expect(status.issues.some(i => i.includes('stuck'))).toBe(true);
    expect(status.queueStats.stuck).toBe(2);
  });

  it('reports an ML-service issue when checkServiceHealth returns false', async () => {
    prismaMock.segmentationQueue.count.mockResolvedValue(0);
    prismaMock.segmentationQueue.findFirst.mockResolvedValue(null);
    segmentationServiceMock.checkServiceHealth.mockResolvedValue(false);

    const status = await service.getQueueHealthStatus();

    expect(status.healthy).toBe(false);
    expect(status.issues.some(i => i.includes('ML service'))).toBe(true);
  });

  it('reports a high-backlog issue when queued > 100', async () => {
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(150) // queued > 100
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

  it('reports an issue when the oldest queued item is over 30 minutes old', async () => {
    const staleDate = new Date(Date.now() - 35 * 60 * 1000);
    prismaMock.segmentationQueue.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMock.segmentationQueue.findFirst.mockResolvedValueOnce({
      createdAt: staleDate,
    });
    segmentationServiceMock.checkServiceHealth.mockResolvedValueOnce(true);

    const status = await service.getQueueHealthStatus();

    expect(status.healthy).toBe(false);
    expect(status.issues.some(i => i.includes('30 minutes'))).toBe(true);
    expect(status.oldestQueuedItem).toEqual(staleDate);
  });

  it('returns healthy=false with safe defaults on a DB error', async () => {
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

describe('getParallelProcessingStats', () => {
  it('returns a snapshot with zero active streams at startup', async () => {
    const stats = await service.getParallelProcessingStats();

    expect(stats.activeStreams).toBe(0);
    expect(stats.maxConcurrentStreams).toBeGreaterThan(0);
  });
});
