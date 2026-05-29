/**
 * imageController.gaps4.test.ts
 *
 * Covers the last uncovered branches in imageController.ts that are NOT
 * exercised by the existing test files (behavior, gaps3, main):
 *
 *  regenerateThumbnails:
 *    - generateBatchThumbnails returns a Map with at least one null value
 *      → failedCount > 0 branch (lines ~1466-1470) — response message
 *      uses "X selhalo" variant and includes failedImages list
 *    - generateBatchThumbnails returns a Map where all values are truthy
 *      → failedCount == 0 branch — "Úspěšně regenerováno X náhledů"
 *    - service throws ApiError → 403/404/etc. forwarded (lines ~1488-1496)
 *    - service throws generic Error → 500 (lines ~1497-1503)
 *
 * Deliberately skipped:
 *  - Actual storage I/O (sharp, fs, S3)
 *  - WebSocket event round-trips
 *
 * Runs standalone: npx vitest run src/api/controllers/__tests__/imageController.gaps4.test.ts --reporter=dot
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── Mocks (must precede any source import) ────────────────────────────────

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
    STORAGE_TYPE: 'local',
    MAX_FILE_SIZE: '10485760',
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

vi.mock('../../../services/imageService', () => {
  const ImageService = vi.fn().mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.uploadImages = vi.fn();
    this.uploadImagesWithProgress = vi.fn();
    this.getProjectImages = vi.fn();
    this.getImageById = vi.fn();
    this.deleteImage = vi.fn();
    this.deleteBatch = vi.fn();
    this.getImageStats = vi.fn();
    this.getBrowserCompatibleImage = vi.fn();
    this.reorderImages = vi.fn();
  });
  return { ImageService };
});

// Track the latest SegmentationThumbnailService instance so tests can
// configure it per-test.
let latestThumbService: Record<string, ReturnType<typeof vi.fn>>;

vi.mock('../../../services/segmentationThumbnailService', () => {
  const SegmentationThumbnailService = vi.fn().mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.generateBatchThumbnails = vi.fn().mockResolvedValue(new Map());
    this.getConcurrencyStatus = vi
      .fn()
      .mockReturnValue({ active: 0, queued: 0 });
    latestThumbService = this as Record<string, ReturnType<typeof vi.fn>>;
  });
  return { SegmentationThumbnailService };
});

vi.mock('../../../services/websocketService', () => ({
  WebSocketService: {
    getInstance: vi.fn(() => ({
      emitToUser: vi.fn(),
      emitToProject: vi.fn(),
    })),
  },
}));

vi.mock('../../../services/sharingService', () => ({
  hasProjectAccess: vi.fn(),
}));

vi.mock('../../../storage/index', () => ({
  getStorageProvider: vi.fn(() => ({
    getUrl: vi.fn((p: string) => Promise.resolve(`http://storage/${p}`)),
    saveFile: vi.fn(() => Promise.resolve('/mock/path')),
    deleteFile: vi.fn(() => Promise.resolve()),
  })),
}));

vi.mock('../../../db/index', () => ({
  prisma: {
    image: { findMany: vi.fn(), count: vi.fn() },
    segmentation: { findUnique: vi.fn() },
  },
}));

import { ImageController } from '../imageController';
import * as SharingService from '../../../services/sharingService';
import { prisma } from '../../../db/index';
import { ApiError } from '../../../middleware/error';

// ── Test data ────────────────────────────────────────────────────────────────

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const IMAGE_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const SEG_ID = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';

function buildApp() {
  // Construct a fresh controller per test — this triggers new SegmentationThumbnailService()
  // which sets latestThumbService to the new instance. We do this BEFORE the test
  // body configures the mock so the reference is current.
  const controller = new ImageController();
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { user?: unknown }, _res, next) => {
    req.user = { id: USER_ID, email: 'user@test.com' };
    next();
  });
  app.post('/:projectId', controller.regenerateThumbnails);
  return app;
}

// Image fixture with a segmentation record
function makeImageWithSeg(name = 'cell.png') {
  return {
    id: IMAGE_ID,
    name,
    updatedAt: new Date(),
    segmentation: { id: SEG_ID, imageId: IMAGE_ID },
    segmentationThumbnailPath: null,
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('ImageController.regenerateThumbnails — remaining branches', () => {
  beforeEach(() => {
    vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
      hasAccess: true,
    } as any);
    // Default: one valid image with segmentation
    vi.mocked(prisma.image.findMany).mockResolvedValue([
      makeImageWithSeg() as any,
    ]);
  });

  // Helper: build app AND configure thumbService mock in one call.
  // Must be called BEFORE setting mock behaviors because buildApp()
  // constructs the controller (and therefore the SegmentationThumbnailService),
  // which sets latestThumbService to the fresh instance.
  function makeAppWithThumbMock(thumbMap: Map<string, string | null>) {
    const app = buildApp(); // sets latestThumbService
    latestThumbService.generateBatchThumbnails.mockResolvedValueOnce(thumbMap);
    return app;
  }

  // ── failedCount > 0 branch ────────────────────────────────────────────────

  describe('when generateBatchThumbnails returns a Map with null values', () => {
    it('returns 200 with failedCount > 0 and includes failedImages list', async () => {
      // Ensure findMany returns our fixture (guard against clearMocks side-effects)
      vi.mocked(prisma.image.findMany).mockResolvedValue([
        makeImageWithSeg() as any,
      ]);
      const app = makeAppWithThumbMock(new Map([[SEG_ID, null]]));
      const res = await request(app).post(`/${PROJECT_ID}`).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.failedCount).toBe(1);
      expect(res.body.data.regeneratedCount).toBe(0);
      // The controller includes the failed image names when failedCount > 0
      expect(Array.isArray(res.body.data.failedImages)).toBe(true);
      expect(res.body.data.failedImages).toContain('cell.png');
      // Response message variant contains "selhalo" (Czech for "failed")
      expect(res.body.message).toMatch(/selhalo/);
    });

    it('failedImages contains the image name for each null-valued entry', async () => {
      const image2Id = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
      const seg2Id = 'ffffffff-ffff-4fff-ffff-ffffffffffff';

      vi.mocked(prisma.image.findMany).mockResolvedValueOnce([
        makeImageWithSeg('first.png') as any,
        {
          id: image2Id,
          name: 'second.png',
          updatedAt: new Date(),
          segmentation: { id: seg2Id, imageId: image2Id },
          segmentationThumbnailPath: null,
        } as any,
      ]);

      // Build app first so latestThumbService is set, then configure mock
      const app = buildApp();
      latestThumbService.generateBatchThumbnails.mockResolvedValueOnce(
        new Map<string, string | null>([
          [SEG_ID, null],
          [seg2Id, null],
        ])
      );

      const res = await request(app).post(`/${PROJECT_ID}`).expect(200);

      expect(res.body.data.failedCount).toBe(2);
      expect(res.body.data.regeneratedCount).toBe(0);
      expect(res.body.data.failedImages).toHaveLength(2);
    });
  });

  // ── failedCount == 0 branch ────────────────────────────────────────────────

  describe('when generateBatchThumbnails returns all-success Map', () => {
    it('returns 200 with failedCount=0 and no failedImages key in response', async () => {
      const app = makeAppWithThumbMock(
        new Map([[SEG_ID, 'http://storage/thumb.png']])
      );
      const res = await request(app).post(`/${PROJECT_ID}`).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.regeneratedCount).toBe(1);
      expect(res.body.data.failedCount).toBe(0);
      // When no failures, controller sets failedImages: undefined (not sent in JSON)
      expect(res.body.data.failedImages).toBeUndefined();
      // Response message must NOT contain "selhalo"
      expect(res.body.message).not.toMatch(/selhalo/);
    });
  });

  // ── ApiError error branch ─────────────────────────────────────────────────

  describe('when the service throws an ApiError', () => {
    it('forwards the ApiError status code (e.g. 403 Forbidden) to the client', async () => {
      const app = buildApp();
      latestThumbService.generateBatchThumbnails.mockRejectedValueOnce(
        ApiError.forbidden('Access denied to regenerate thumbnails')
      );

      const res = await request(app).post(`/${PROJECT_ID}`).expect(403);
      expect(res.body.success).toBe(false);
    });

    it('forwards a 404 ApiError when the project is not found', async () => {
      const app = buildApp();
      latestThumbService.generateBatchThumbnails.mockRejectedValueOnce(
        ApiError.notFound('Project not found')
      );

      const res = await request(app).post(`/${PROJECT_ID}`).expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── Generic error branch ──────────────────────────────────────────────────

  describe('when the service throws a generic Error', () => {
    it('returns 500 for an unexpected error', async () => {
      const app = buildApp();
      latestThumbService.generateBatchThumbnails.mockRejectedValueOnce(
        new Error('Database exploded')
      );

      const res = await request(app).post(`/${PROJECT_ID}`).expect(500);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 when prisma.image.findMany throws unexpectedly', async () => {
      // For this test the error happens before generateBatchThumbnails is called
      // so we can call buildApp() first, then override the prisma mock
      const app = buildApp();
      vi.mocked(prisma.image.findMany).mockRejectedValueOnce(
        new Error('Prisma I/O failure')
      );

      const res = await request(app).post(`/${PROJECT_ID}`).expect(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── processingTime is included in the response ───────────────────────────

  it('always includes processingTime (number) in successful response', async () => {
    const app = makeAppWithThumbMock(
      new Map([[SEG_ID, 'http://storage/thumb.png']])
    );
    const res = await request(app).post(`/${PROJECT_ID}`).expect(200);
    expect(typeof res.body.data.processingTime).toBe('number');
  });

  // ── concurrencyStatus is included in the response ───────────────────────

  it('always includes concurrencyStatus in successful response', async () => {
    const app = makeAppWithThumbMock(
      new Map([[SEG_ID, 'http://storage/thumb.png']])
    );
    const res = await request(app).post(`/${PROJECT_ID}`).expect(200);
    expect(res.body.data.concurrencyStatus).toBeDefined();
  });
});
