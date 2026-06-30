/**
 * QueueController behavioral tests — mock services, test HTTP layer only.
 *
 * The existing queueController.test.ts tests Zod schemas only; this file
 * tests the actual controller handlers (success, auth-guard, validation,
 * not-found, error propagation).
 *
 * Design notes:
 * - vi.mock factories are hoisted before any const declarations, so mock
 *   objects are built inside factories using vi.fn() inline.
 * - The controller is a singleton instantiated at module load time.  It
 *   captures the QueueService / ImageService instances at construction, so we
 *   grab those exact instances via the mock's records after import.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── CRITICAL: must be first — config calls process.exit(1) in non-test envs ──
vi.mock('../../../utils/config', () => ({
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

vi.mock('../../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ImageService — constructible; stores created instances so we can retrieve them
vi.mock('../../../services/imageService', () => {
  const ImageService = vi.fn().mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.getImageById = vi.fn();
  });
  return { ImageService };
});

// SegmentationService — constructible stub
vi.mock('../../../services/segmentationService', () => {
  const SegmentationService = vi
    .fn()
    .mockImplementation(function (this: Record<string, unknown>) {});
  return { SegmentationService };
});

// QueueService singleton — the returned object is captured at QueueController
// construction time.  We build a single object with vi.fn() fns so we can
// spy on it without needing clearAllMocks to re-wire the singleton.
const _queueServiceMock = {
  addToQueue: vi.fn(),
  addBatchToQueue: vi.fn(),
  getQueueStats: vi.fn(),
  getQueueItems: vi.fn(),
  removeFromQueue: vi.fn(),
  cleanupOldEntries: vi.fn(),
  getQueueHealthStatus: vi.fn(),
  resetStuckItems: vi.fn(),
  cancelAllUserSegmentations: vi.fn(),
};
// NOTE: this object is declared before vi.mock is hoisted but its properties
// are vi.fn() which are themselves lazy — using the variable inside the factory
// would normally fail due to hoisting.  Instead we just return the inline
// object directly inside the factory, and keep the reference separate for use
// in tests.  We then synchronise them in beforeEach via mockReturnValue.

vi.mock('../../../services/queueService', () => ({
  QueueService: {
    getInstance: vi.fn(() => ({
      addToQueue: vi.fn(),
      addBatchToQueue: vi.fn(),
      getQueueStats: vi.fn(),
      getQueueItems: vi.fn(),
      removeFromQueue: vi.fn(),
      cleanupOldEntries: vi.fn(),
      getQueueHealthStatus: vi.fn(),
      resetStuckItems: vi.fn(),
      cancelAllUserSegmentations: vi.fn(),
    })),
  },
}));

// WebSocketService
vi.mock('../../../services/websocketService', () => ({
  WebSocketService: {
    getInstance: vi.fn(() => ({
      emitSegmentationUpdate: vi.fn(),
      emitQueueStatsUpdate: vi.fn(),
      emitToUser: vi.fn(),
    })),
  },
}));

// Prisma — inline fns to avoid hoisting
vi.mock('../../../db', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    project: { findFirst: vi.fn() },
    segmentationQueue: { findFirst: vi.fn() },
  },
}));

// ── Import AFTER all mocks ─────────────────────────────────────────────────
import { queueController } from '../queueController';
import { ImageService } from '../../../services/imageService';
import { QueueService } from '../../../services/queueService';
import { prisma } from '../../../db';

// ── Resolve the instances the controller captured at construction time ─────

// The controller calls `new ImageService(prisma)` once at construction.
// That instance is recorded in the mock's `.mock.instances` array.
const imageServiceInstance = vi.mocked(ImageService).mock
  .instances[0] as Record<string, ReturnType<typeof vi.fn>>;

// The controller calls QueueService.getInstance() once at construction.
// That call's return value is recorded in `.mock.results[0].value`.
const queueServiceInstance = vi.mocked(QueueService).getInstance.mock.results[0]
  ?.value as Record<string, ReturnType<typeof vi.fn>>;

// ── Constants ──────────────────────────────────────────────────────────────

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const IMAGE_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const QUEUE_ID = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
const BATCH_ID = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';

// ── App builders ───────────────────────────────────────────────────────────

function buildApp(handler: express.RequestHandler, paramName?: string) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req: express.Request & { user?: unknown }, _res, next) => {
    req.user = { id: USER_ID, email: 'user@test.com' };
    next();
  });
  const path = paramName ? `/:${paramName}` : '/';
  app.all(path, handler);
  return app;
}

function buildUnauthApp(handler: express.RequestHandler, paramName?: string) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const path = paramName ? `/:${paramName}` : '/';
  app.all(path, handler);
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('QueueController — behavioral', () => {
  beforeEach(() => {
    // Reset only the mock fn call records (not implementations)
    // so we can assert on calls per-test without clearing service instances.
    Object.values(imageServiceInstance ?? {}).forEach(fn => fn.mockReset());
    Object.values(queueServiceInstance ?? {}).forEach(fn => fn.mockReset());
    vi.mocked(prisma.user.findUnique).mockReset();
    vi.mocked(prisma.project.findFirst).mockReset();
    vi.mocked(prisma.segmentationQueue.findFirst).mockReset();
  });

  // ── addImageToQueue ─────────────────────────────────────────────────────

  describe('addImageToQueue', () => {
    it('returns 401 when user is not authenticated', async () => {
      const app = buildUnauthApp(queueController.addImageToQueue, 'imageId');
      const res = await request(app)
        .post(`/${IMAGE_ID}`)
        .send({ model: 'hrnet' })
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when image is not found or not owned', async () => {
      imageServiceInstance.getImageById.mockResolvedValue(null);

      const app = buildApp(queueController.addImageToQueue, 'imageId');
      const res = await request(app)
        .post(`/${IMAGE_ID}`)
        .send({ model: 'hrnet' })
        .expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 and queues the image when everything is valid', async () => {
      imageServiceInstance.getImageById.mockResolvedValue({
        id: IMAGE_ID,
        projectId: PROJECT_ID,
      });

      const queueEntry = {
        id: QUEUE_ID,
        imageId: IMAGE_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        model: 'hrnet',
        threshold: 0.5,
        priority: 0,
        detectHoles: true,
        status: 'queued',
        createdAt: new Date(),
        updatedAt: new Date(),
        retryCount: 0,
      };
      queueServiceInstance.addToQueue.mockResolvedValue(queueEntry);
      queueServiceInstance.getQueueStats.mockResolvedValue({ pending: 1 });

      const app = buildApp(queueController.addImageToQueue, 'imageId');
      const res = await request(app)
        .post(`/${IMAGE_ID}`)
        .send({ model: 'hrnet', threshold: 0.5 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(QUEUE_ID);
      expect(queueServiceInstance.addToQueue).toHaveBeenCalledWith(
        IMAGE_ID,
        PROJECT_ID,
        USER_ID,
        'hrnet',
        0.5,
        0,
        true
      );
    });

    it('returns 500 when queueService.addToQueue throws', async () => {
      imageServiceInstance.getImageById.mockResolvedValue({
        id: IMAGE_ID,
        projectId: PROJECT_ID,
      });
      queueServiceInstance.addToQueue.mockRejectedValue(
        new Error('DB is down')
      );

      const app = buildApp(queueController.addImageToQueue, 'imageId');
      const res = await request(app)
        .post(`/${IMAGE_ID}`)
        .send({ model: 'hrnet' })
        .expect(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── addBatchToQueue ─────────────────────────────────────────────────────

  describe('addBatchToQueue', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(queueController.addBatchToQueue);
      const res = await request(app)
        .post('/')
        .send({ imageIds: [IMAGE_ID], projectId: PROJECT_ID })
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when imageIds is empty', async () => {
      const app = buildApp(queueController.addBatchToQueue);
      const res = await request(app)
        .post('/')
        .send({ imageIds: [], projectId: PROJECT_ID })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when imageIds array exceeds 10000 items', async () => {
      // Send a small body that triggers the runtime check (don't try to send
      // 10001 UUIDs over the wire — that would 413 before the controller runs)
      // Simulate by making imageIds.length > 10000 via a mock.
      // The controller checks Array.isArray(imageIds) && imageIds.length > 10000.
      // We can do this by sending a crafted body with length property, but
      // Express will parse it as a regular array.  Instead, we send an array
      // that's exactly 10001 short UUIDs small enough to fit in 1mb limit.
      // 10001 × 5 bytes = ~50 KB — well under 1 MB.
      const smallIds = Array(10001).fill('x');
      const app = buildApp(queueController.addBatchToQueue);
      const res = await request(app)
        .post('/')
        .send({ imageIds: smallIds, projectId: PROJECT_ID })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 401 when the user record is not found in DB', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const app = buildApp(queueController.addBatchToQueue);
      const res = await request(app)
        .post('/')
        .send({ imageIds: [IMAGE_ID], projectId: PROJECT_ID })
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when project is not found or not accessible', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: USER_ID,
        email: 'u@t.com',
      } as any);
      vi.mocked(prisma.project.findFirst).mockResolvedValue(null);

      const app = buildApp(queueController.addBatchToQueue);
      const res = await request(app)
        .post('/')
        .send({ imageIds: [IMAGE_ID], projectId: PROJECT_ID })
        .expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with queued count and entries on success', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: USER_ID,
        email: 'u@t.com',
      } as any);
      vi.mocked(prisma.project.findFirst).mockResolvedValue({
        id: PROJECT_ID,
        userId: USER_ID,
      } as any);

      const fakeEntries = [
        {
          id: QUEUE_ID,
          imageId: IMAGE_ID,
          projectId: PROJECT_ID,
          userId: USER_ID,
          model: 'hrnet',
          threshold: 0.5,
          priority: 0,
          detectHoles: true,
          status: 'queued',
          createdAt: new Date(),
          updatedAt: new Date(),
          retryCount: 0,
        },
      ];
      queueServiceInstance.addBatchToQueue.mockResolvedValue(fakeEntries);
      queueServiceInstance.getQueueStats.mockResolvedValue({ pending: 1 });

      const app = buildApp(queueController.addBatchToQueue);
      const res = await request(app)
        .post('/')
        .send({ imageIds: [IMAGE_ID], projectId: PROJECT_ID, model: 'hrnet' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.queuedCount).toBe(1);
      expect(res.body.data.totalRequested).toBe(1);
      expect(queueServiceInstance.addBatchToQueue).toHaveBeenCalledWith(
        [IMAGE_ID],
        PROJECT_ID,
        USER_ID,
        'hrnet',
        0.5,
        0,
        false,
        true,
        undefined
      );
    });
  });

  // ── getQueueStats (project-scoped) ──────────────────────────────────────

  describe('getQueueStats', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(queueController.getQueueStats, 'projectId');
      await request(app).get(`/${PROJECT_ID}`).expect(401);
    });

    it('returns 404 when project not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: USER_ID,
        email: 'u@t.com',
      } as any);
      vi.mocked(prisma.project.findFirst).mockResolvedValue(null);

      const app = buildApp(queueController.getQueueStats, 'projectId');
      const res = await request(app).get(`/${PROJECT_ID}`).expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with stats on success', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: USER_ID,
        email: 'u@t.com',
      } as any);
      vi.mocked(prisma.project.findFirst).mockResolvedValue({
        id: PROJECT_ID,
      } as any);
      queueServiceInstance.getQueueStats.mockResolvedValue({
        pending: 3,
        processing: 1,
      });

      const app = buildApp(queueController.getQueueStats, 'projectId');
      const res = await request(app).get(`/${PROJECT_ID}`).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ pending: 3, processing: 1 });
      expect(queueServiceInstance.getQueueStats).toHaveBeenCalledWith(
        PROJECT_ID,
        USER_ID
      );
    });
  });

  // ── getQueueItems ───────────────────────────────────────────────────────

  describe('getQueueItems', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(queueController.getQueueItems, 'projectId');
      await request(app).get(`/${PROJECT_ID}`).expect(401);
    });

    it('returns 404 when project inaccessible', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: USER_ID,
        email: 'u@t.com',
      } as any);
      vi.mocked(prisma.project.findFirst).mockResolvedValue(null);

      const app = buildApp(queueController.getQueueItems, 'projectId');
      const res = await request(app).get(`/${PROJECT_ID}`).expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with items list', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: USER_ID,
        email: 'u@t.com',
      } as any);
      vi.mocked(prisma.project.findFirst).mockResolvedValue({
        id: PROJECT_ID,
      } as any);
      const items = [{ id: QUEUE_ID, status: 'queued' }];
      queueServiceInstance.getQueueItems.mockResolvedValue(items);

      const app = buildApp(queueController.getQueueItems, 'projectId');
      const res = await request(app).get(`/${PROJECT_ID}`).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(items);
    });
  });

  // ── removeFromQueue ─────────────────────────────────────────────────────

  describe('removeFromQueue', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(queueController.removeFromQueue, 'queueId');
      await request(app).delete(`/${QUEUE_ID}`).expect(401);
    });

    it('returns 404 when queue item not found', async () => {
      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(null);

      const app = buildApp(queueController.removeFromQueue, 'queueId');
      const res = await request(app).delete(`/${QUEUE_ID}`).expect(404);
      expect(res.body.success).toBe(false);
    });

    it('removes item and returns 200 on success', async () => {
      const queueItem = {
        id: QUEUE_ID,
        imageId: IMAGE_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
      };
      vi.mocked(prisma.segmentationQueue.findFirst).mockResolvedValue(
        queueItem as any
      );
      queueServiceInstance.removeFromQueue.mockResolvedValue(undefined);
      queueServiceInstance.getQueueStats.mockResolvedValue({ pending: 0 });

      const app = buildApp(queueController.removeFromQueue, 'queueId');
      const res = await request(app).delete(`/${QUEUE_ID}`).expect(200);

      expect(res.body.success).toBe(true);
      expect(queueServiceInstance.removeFromQueue).toHaveBeenCalledWith(
        QUEUE_ID,
        USER_ID
      );
    });
  });

  // ── getOverallQueueStats ────────────────────────────────────────────────

  describe('getOverallQueueStats', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(queueController.getOverallQueueStats);
      await request(app).get('/').expect(401);
    });

    it('returns 200 with overall stats', async () => {
      const stats = { pending: 10, processing: 2, failed: 0 };
      queueServiceInstance.getQueueStats.mockResolvedValue(stats);

      const app = buildApp(queueController.getOverallQueueStats);
      const res = await request(app).get('/').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(stats);
      expect(queueServiceInstance.getQueueStats).toHaveBeenCalledWith();
    });
  });

  // ── cleanupQueue ────────────────────────────────────────────────────────

  describe('cleanupQueue', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(queueController.cleanupQueue);
      await request(app).post('/').send({ daysOld: 7 }).expect(401);
    });

    it('returns 200 with deleted count', async () => {
      queueServiceInstance.cleanupOldEntries.mockResolvedValue(5);

      const app = buildApp(queueController.cleanupQueue);
      const res = await request(app).post('/').send({ daysOld: 7 }).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.deletedCount).toBe(5);
      expect(queueServiceInstance.cleanupOldEntries).toHaveBeenCalledWith(7);
    });
  });

  // ── getQueueHealth ──────────────────────────────────────────────────────

  describe('getQueueHealth', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(queueController.getQueueHealth);
      await request(app).get('/').expect(401);
    });

    it('returns 200 with healthy status when pipeline is healthy', async () => {
      queueServiceInstance.getQueueHealthStatus.mockResolvedValue({
        healthy: true,
        issues: [],
      });

      const app = buildApp(queueController.getQueueHealth);
      const res = await request(app).get('/').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.healthy).toBe(true);
    });

    it('returns 200 with unhealthy status and issues in message', async () => {
      queueServiceInstance.getQueueHealthStatus.mockResolvedValue({
        healthy: false,
        issues: ['ML service down', 'Queue stalled'],
      });

      const app = buildApp(queueController.getQueueHealth);
      const res = await request(app).get('/').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.healthy).toBe(false);
      expect(res.body.message).toContain('ML service down');
    });
  });

  // ── resetStuckItems ─────────────────────────────────────────────────────

  describe('resetStuckItems', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(queueController.resetStuckItems);
      await request(app)
        .post('/')
        .send({ maxProcessingMinutes: 30 })
        .expect(401);
    });

    it('returns 200 with reset count', async () => {
      queueServiceInstance.resetStuckItems.mockResolvedValue(3);

      const app = buildApp(queueController.resetStuckItems);
      const res = await request(app)
        .post('/')
        .send({ maxProcessingMinutes: 30 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.resetCount).toBe(3);
      expect(queueServiceInstance.resetStuckItems).toHaveBeenCalledWith(30);
    });
  });

  // NOTE: the `cancelBatch` and `cancelAllSegmentation` controller handlers
  // were removed as dead stubs (commit a6dd828); they returned a hardcoded
  // cancelledCount=0 and were mounted by no route. The live cancel path is
  // `cancelAllUserSegmentations` below.

  // ── cancelAllUserSegmentations ──────────────────────────────────────────

  describe('cancelAllUserSegmentations', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(queueController.cancelAllUserSegmentations);
      await request(app).post('/').expect(401);
    });

    it('returns 200 with cancel summary', async () => {
      queueServiceInstance.cancelAllUserSegmentations.mockResolvedValue({
        cancelledCount: 7,
        affectedProjects: [PROJECT_ID],
        affectedBatches: [BATCH_ID],
      });

      const app = buildApp(queueController.cancelAllUserSegmentations);
      const res = await request(app).post('/').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.cancelledCount).toBe(7);
      expect(res.body.data.affectedProjects).toContain(PROJECT_ID);
      expect(
        queueServiceInstance.cancelAllUserSegmentations
      ).toHaveBeenCalledWith(USER_ID);
    });
  });
});
