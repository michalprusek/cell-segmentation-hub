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

import { vi } from 'vitest';
import type { MockedFunction } from 'vitest';

// Mock config early to prevent process.exit(1) during module load chain
vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET:
      'test-refresh-secret-for-testing-only-32-characters-long',
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
vi.mock('sharp', () => vi.fn());
vi.mock('../../storage/index', () => ({ getStorageProvider: vi.fn() }));

// Mock PrismaClient before any import that could trigger DB init
vi.mock('@prisma/client', () => {
  const mockPrismaClient = {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $transaction: vi.fn(),
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    project: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    image: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    segmentation: {
      deleteMany: vi.fn(),
    },
    segmentationQueue: {
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  return {
    PrismaClient: vi.fn().mockImplementation(function (this: any) {
      Object.assign(this, mockPrismaClient);
    }),
    Prisma: { PrismaClientKnownRequestError: class extends Error {} },
  };
});

import { PrismaClient } from '@prisma/client';
import { QueueService } from '../queueService';
import { SegmentationService } from '../segmentationService';
import { ImageService } from '../imageService';
import { WebSocketService } from '../websocketService';
import { logger as _logger } from '../../utils/logger';

// Mock dependencies
vi.mock('../../utils/logger');
vi.mock('../websocketService');
vi.mock('../segmentationService');
vi.mock('../imageService');

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
      requestBatchSegmentation: vi
        .fn()
        .mockImplementation(async (images: any[]) =>
          images.map(() => mockSegmentationResults())
        ),
      requestSegmentation: vi
        .fn()
        .mockImplementation(async () => mockSegmentationResults()),
      saveSegmentationResults: (vi.fn() as any).mockResolvedValue(undefined),
      checkServiceHealth: (vi.fn() as any).mockResolvedValue(true),
    } as any;

    // Mock imageService to return a valid image for any imageId
    mockImageService = {
      getImageById: vi.fn().mockImplementation(async (imageId: string) => ({
        id: imageId,
        segmentationStatus: 'no_segmentation',
        projectId:
          concurrentUsers.find(u => u.imageIds.includes(imageId))?.projectId ||
          'project_1',
        name: `${imageId}.tif`,
        width: 512,
        height: 512,
        fileSize: 1024,
        mimeType: 'image/tiff',
      })),
      updateSegmentationStatus: vi.fn(),
    } as any;

    mockWebSocketService = {
      emitSegmentationUpdate: vi.fn(),
      emitSegmentationComplete: vi.fn(),
      emitQueueStatsUpdate: vi.fn(),
    } as unknown as WebSocketService;

    // Mock prisma.$transaction to execute the callback with prisma as tx
    (prisma.$transaction as MockedFunction<any>).mockImplementation(
      async (callback: (tx: any) => Promise<any>) => {
        if (typeof callback === 'function') {
          return callback(prisma);
        }
        return undefined;
      }
    );

    // Mock segmentationQueue operations to return proper values
    let queueIdCounter = 0;
    const queueStore: any[] = [];

    (prisma.segmentationQueue.create as MockedFunction<any>).mockImplementation(
      async ({ data }: any) => {
        const entry = {
          id: `queue_${++queueIdCounter}`,
          retryCount: 0, // default
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        queueStore.push(entry);
        return entry;
      }
    );

    (
      prisma.segmentationQueue.createMany as MockedFunction<any>
    ).mockImplementation(async ({ data }: any) => {
      const rows = Array.isArray(data) ? data : [];
      for (const d of rows) {
        queueStore.push({
          id: `queue_${++queueIdCounter}`,
          retryCount: 0,
          error: null,
          startedAt: null,
          completedAt: null,
          ...d,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      return { count: rows.length };
    });

    // Helper to filter queueStore by a where clause
    const matchesWhere = (entry: any, where: any): boolean => {
      if (!where) return true;
      return Object.entries(where).every(([key, val]) => {
        // Prisma OMITS a filter whose value is `undefined`; it does not match
        // rows whose column is null/absent. getNextBatchExcluding passes
        // `imageId: undefined` whenever nothing is excluded, and treating that
        // as an equality test made its batching findMany return [] every time,
        // so the "batch several images of the same model" path was dead here.
        if (val === undefined) return true;
        if (val && typeof val === 'object') {
          const v = val as any;
          if ('in' in v) return v.in.includes(entry[key]);
          if ('notIn' in v) return !v.notIn.includes(entry[key]);
          if ('gt' in v) return entry[key] > v.gt;
          if ('lt' in v) return entry[key] < v.lt;
          if ('gte' in v) return entry[key] >= v.gte;
          if ('lte' in v) return entry[key] <= v.lte;
        }
        return entry[key] === val;
      });
    };

    // `orderBy` used to be accepted and dropped on the floor (it was spelled
    // `orderBy: _orderBy`), and findFirst did not even take it. Everything the
    // queue does about PRIORITY is expressed as
    // `orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }]`, so with it
    // ignored the fake always handed back the first row inserted and no test
    // in this file could observe priority at all — the "fairness" test below
    // was reduced to comparing Date.now() readings taken in the same
    // millisecond. Array.prototype.sort is stable, so equal keys keep
    // insertion order, which is what a tied createdAt means here.
    const applyOrderBy = (rows: any[], orderBy: any): any[] => {
      if (!orderBy) return rows;
      const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
      // Dates are compared by their VALUE, not by reference. `createdAt` is a
      // fresh `new Date()` per row, so two rows written in the same
      // millisecond are `!==` while being equal as timestamps: a reference
      // check made the comparator return 1 for both (a,b) and (b,a) — an
      // asymmetric comparator, whose sort result is implementation-defined
      // rather than "stable, so insertion order" — and stopped a tie ever
      // falling through to the next orderBy clause.
      const key = (v: unknown): unknown =>
        v instanceof Date ? v.getTime() : v;
      return [...rows].sort((a, b) => {
        for (const clause of clauses) {
          for (const [field, dir] of Object.entries(clause)) {
            const av = key(a[field]);
            const bv = key(b[field]);
            if (av === bv) continue;
            if (av === null || av === undefined) return 1;
            if (bv === null || bv === undefined) return -1;
            const cmp = (av as never) < (bv as never) ? -1 : 1;
            return dir === 'desc' ? -cmp : cmp;
          }
        }
        return 0;
      });
    };

    (
      prisma.segmentationQueue.findMany as MockedFunction<any>
    ).mockImplementation(async ({ where, take, orderBy }: any = {}) => {
      let results = applyOrderBy(
        queueStore.filter(e => matchesWhere(e, where)),
        orderBy
      );
      if (take !== undefined) results = results.slice(0, take);
      return results;
    });

    (
      prisma.segmentationQueue.findFirst as MockedFunction<any>
    ).mockImplementation(
      async ({ where, orderBy }: any = {}) =>
        applyOrderBy(
          queueStore.filter(e => matchesWhere(e, where)),
          orderBy
        )[0] || null
    );

    (prisma.segmentationQueue.count as MockedFunction<any>).mockImplementation(
      async ({ where }: any = {}) =>
        queueStore.filter(e => matchesWhere(e, where)).length
    );

    (
      prisma.segmentationQueue.updateMany as MockedFunction<any>
    ).mockImplementation(async ({ where, data }: any) => {
      const matching = queueStore.filter(e => matchesWhere(e, where));
      matching.forEach(e => Object.assign(e, data));
      return { count: matching.length };
    });

    (prisma.segmentationQueue.update as MockedFunction<any>).mockImplementation(
      async ({ where, data }: any) => {
        const entry = queueStore.find(e => matchesWhere(e, where));
        if (entry) Object.assign(entry, data);
        return entry;
      }
    );

    (prisma.segmentationQueue.delete as MockedFunction<any>).mockImplementation(
      async ({ where }: any) => {
        const idx = queueStore.findIndex(e => matchesWhere(e, where));
        if (idx !== -1) {
          const [removed] = queueStore.splice(idx, 1);
          return removed;
        }
        return null;
      }
    );

    // Mock image count to return a fixed value representing total test images
    const totalTestImages = concurrentUsers.reduce(
      (sum, u) => sum + u.imageIds.length,
      0
    );
    (prisma.image.count as MockedFunction<any>).mockResolvedValue(
      totalTestImages
    );
    // image.findMany is used by addBatchToQueue to bulk-load accessible images.
    // Return all requested imageIds (from where.id.in) as accessible images with
    // no_segmentation status so they are all eligible for queueing.
    (prisma.image.findMany as MockedFunction<any>).mockImplementation(
      async ({ where }: any = {}) => {
        const ids: string[] = where?.id?.in ?? [];
        return ids.map((id: string) => ({
          id,
          segmentationStatus: 'no_segmentation',
        }));
      }
    );
    (prisma.image.findUnique as MockedFunction<any>).mockResolvedValue(null);
    (prisma.image.update as MockedFunction<any>).mockResolvedValue({});
    (prisma.image.updateMany as MockedFunction<any>).mockResolvedValue({
      count: 0,
    });
    (prisma.project.findMany as MockedFunction<any>).mockResolvedValue([]);
    // user.findUnique is called by addBatchToQueue to verify user exists.
    // Return a minimal user object for any userId.
    (prisma.user.findUnique as MockedFunction<any>).mockImplementation(
      async ({ where }: any = {}) => ({
        id: where?.id,
        email: `${where?.id}@test.com`,
      })
    );
    (prisma.user.create as MockedFunction<any>).mockResolvedValue({});
    (prisma.project.create as MockedFunction<any>).mockResolvedValue({});
    (prisma.image.create as MockedFunction<any>).mockResolvedValue({});

    // Reset singleton so each test gets a fresh instance
    (QueueService as any).instance = null;

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
    vi.clearAllMocks();
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

        return {
          user: user.userId,
          queueEntries,
          batchSize: user.imageIds.length,
        };
      });

      // Execute all submissions in parallel
      const results = await Promise.all(concurrentSubmissions);

      // Assertions
      expect(results).toHaveLength(4);

      // Verify all batches were submitted successfully
      for (const result of results) {
        expect(result.queueEntries).toHaveLength(result.batchSize);
      }

      // There were two wall-clock ceilings here — submissionTime < 1000 ms and
      // totalTime < 2000 ms — and they were removed rather than tuned.
      // `addBatchToQueue` runs entirely against the in-memory `queueStore`
      // fake in this file, so they timed a `vi.fn()`, and measured 2 ms
      // against the 1000 ms ceiling: a 500x margin, i.e. green through any
      // regression a reviewer would care about. What the submissions must
      // actually do is below and does not involve a clock.

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

    // Named for what it demonstrates. It used to be "should process 4
    // concurrent batches without blocking", which it does not show: the four
    // calls all take the same queue row (see the count assertion below).
    test('runs 4 overlapping getNextBatch/processBatch cycles to completion', async () => {
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
      expect(batchProcessingMetrics.successfulBatches).toBe(4);
      expect(batchProcessingMetrics.failedBatches).toBe(0);
      // BATCH_LIMITS in getNextBatchExcluding is 1 for every model, so a batch
      // is one image and never more.
      expect(batchResults.map(r => r.batchSize)).toEqual([1, 1, 1, 1]);

      // Two wall-clock ceilings were removed here (totalTime < 1000 ms,
      // averageBatchTime < 500 ms). Both timed the file's own
      // `setTimeout(196|396)` mock of requestBatchSegmentation, so they
      // measured the mock's timer and nothing in queueService.

      const remainingQueueItems = await prisma.segmentationQueue.count({
        where: { status: 'queued' },
      });
      // 15, NOT 12 — and this used to say `toBeLessThan(16)` beside a comment
      // claiming 12, which is how the discrepancy stayed invisible. All four
      // calls claim the SAME row: `getNextBatch` -> `getMultipleBatches(1)` ->
      // `getNextBatchExcluding` READS the top-priority queued row (findFirst /
      // findMany) and does not mark it taken, so four overlapping reads see
      // one row and process it four times.
      //
      // That is not a production bug — there is exactly one queue worker
      // (`workers/queueWorker.ts`), so concurrent `getNextBatch()` calls never
      // happen there — but it does mean this test does NOT show that
      // concurrent claims are safe, whatever its name suggests. Pinned at 15
      // so that if an atomic claim is ever added (making the honest answer
      // 12), this fails and says so rather than passing either way.
      expect(remainingQueueItems).toBe(15);

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

      // What getNextBatch actually chose, which is the only thing that can
      // show priority ordering. The old version inferred it from Date.now()
      // readings and could not: all four start times landed in the same
      // millisecond, so `maxDeviation` was exactly 0 against a `< 100`
      // ceiling, and the priority comparison was
      // `avgHighPriorityStart <= avgLowPriorityStart + 50` — 0 <= 50 — wrapped
      // in an `if` that would have skipped it silently had either list come
      // back empty.
      const pickedRows: Array<{
        imageId: string;
        userId: string;
        priority: number;
      }> = [];

      // Process batches and track metrics
      const processingPromises = fairnessTestUsers.map(async user => {
        const batch = await queueService.getNextBatch();
        pickedRows.push(
          ...(
            batch as unknown as Array<{
              imageId: string;
              userId: string;
              priority: number;
            }>
          ).map(b => ({
            imageId: b.imageId,
            userId: b.userId,
            priority: b.priority,
          }))
        );

        await queueService.processBatch(batch);

        return { userId: user.userId, batchSize: batch.length };
      });

      const processed = await Promise.all(processingPromises);

      // Every call is served, and each serves one image (BATCH_LIMITS is 1).
      expect(processed.map(p => p.batchSize)).toEqual([1, 1, 1, 1]);
      expect(pickedRows).toHaveLength(4);

      // Priority beats arrival order. user_1 queued first but at priority 0;
      // user_2 is the earliest of the priority-1 users, so
      // `orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }]` in
      // getNextBatchExcluding must reach for its first image.
      for (const row of pickedRows) {
        expect(row.priority).toBe(1);
        expect(row.userId).toBe('user_2');
        expect(row.imageId).toBe('img_2_1');
      }
      // And a priority-0 user really was waiting, or the line above is
      // satisfied by there being nothing else to choose.
      const queuedLowPriority = await prisma.segmentationQueue.count({
        where: { status: 'queued', priority: 0 },
      });
      expect(queuedLowPriority).toBeGreaterThan(0);
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

      // Process all items in the queue to ensure all users receive notifications
      // (batch_size=1 so process one at a time until queue is empty)
      let processedCount = 0;
      const maxProcessingRounds = 20; // 4 users × 4 images + buffer
      for (let i = 0; i < maxProcessingRounds; i++) {
        const batch = await queueService.getNextBatch();
        if (batch.length === 0) break;
        await queueService.processBatch(batch);
        processedCount++;
      }

      // Verify WebSocket notifications were sent
      // Total notifications should reflect all processed items
      const totalUpdates = Object.values(notificationTracker).reduce(
        (sum, n) => sum + n.updates,
        0
      );
      const totalCompletions = Object.values(notificationTracker).reduce(
        (sum, n) => sum + n.completions,
        0
      );

      expect(totalUpdates).toBeGreaterThan(0); // Notifications were sent
      expect(totalCompletions).toBeGreaterThan(0); // Completion notifications were sent
      expect(processedCount).toBeGreaterThan(0); // Items were processed

      // Verify each processed user received notifications
      const usersWithNotifications = concurrentUsers.filter(
        user => notificationTracker[user.userId].updates > 0
      );
      expect(usersWithNotifications.length).toBeGreaterThan(0);
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

      // Mock WebSocket service to fail on some notifications (but only non-critical status emits)
      let notificationAttempts = 0;
      (mockWebSocketService.emitSegmentationUpdate as any).mockImplementation(
        (_userId: string, data: any) => {
          notificationAttempts++;
          // Only fail when emitting "processing" status (first call per item), not "segmented" status
          // This simulates transient WS failures that don't affect processing outcome
          if (data?.status === 'processing' && notificationAttempts % 2 === 0) {
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

      // Verify processing completed despite WebSocket failures - the 3 remaining items
      // were not part of this batch (batch_size=1, so only 1 item was processed)
      const remainingItems = await prisma.segmentationQueue.count({
        where: { status: 'queued' },
      });
      expect(remainingItems).toBeLessThan(4); // At least one item was removed from queue

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

      // Mock segmentation service to fail for one specific call (batch_size=1 so requestSegmentation is used)
      let callCount = 0;
      (mockSegmentationService.requestSegmentation as any).mockImplementation(
        async () => {
          callCount++;

          // Fail the second call (representing one user's failure during recovery)
          if (callCount === 2) {
            throw new Error('ML service temporarily unavailable');
          }

          await new Promise(resolve => setTimeout(resolve, 10));
          return mockSegmentationResults();
        }
      );

      // Process exactly 2 batches sequentially:
      // - Call 1: success (callCount=1)
      // - Call 2: failure (callCount=2) → item re-queued with retryCount=1
      // Then stop so the re-queued item isn't immediately re-processed
      const processingResults: PromiseSettledResult<void>[] = [];
      for (let i = 0; i < 2; i++) {
        const batch = await queueService.getNextBatch();
        const result = await Promise.allSettled([
          queueService.processBatch(batch),
        ]);
        processingResults.push(...result);
      }

      // processBatch catches all errors internally and always resolves
      const successful = processingResults.filter(
        r => r.status === 'fulfilled'
      );

      // All should be fulfilled since processBatch never rejects
      expect(successful.length).toBeGreaterThan(0);

      // Verify error recovery - failed items should be requeued for retry with retryCount incremented
      const requeuedItems = await prisma.segmentationQueue.findMany({
        where: {
          status: 'queued',
          retryCount: { gt: 0 },
        },
      });

      expect(requeuedItems.length).toBeGreaterThan(0); // Failed item was requeued with retryCount incremented
    });
  });
});
