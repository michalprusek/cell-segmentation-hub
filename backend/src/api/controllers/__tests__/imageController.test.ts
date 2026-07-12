/**
 * imageController.test.ts
 *
 * Consolidated unit tests for ImageController. Merged from the former
 * imageController.test.ts (large-batch upload) + .behavior + .gaps3 + .gaps4.
 *
 * Harness: supertest against minimal Express apps that mount the real
 * controller. All collaborators (ImageService, SegmentationThumbnailService,
 * WebSocketService, SharingService, storage, Prisma) are mocked, so no real
 * storage/DB/ML is touched.
 *
 * A single module-level `controller` is constructed; its captured mock
 * instances (`imageServiceInstance`, `thumbService`) are reset per-test and
 * configured per-test. Grouped per endpoint; each group covers request
 * validation, success + controller→service delegation, and error/permission
 * branches.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── config mock MUST come first (prevents process.exit(1) on bad env) ─────────
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

// ImageService — constructible class returning a controlled instance
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

// SegmentationThumbnailService — capture the constructed instance so
// regenerateThumbnails tests can drive generateBatchThumbnails per-test.
let capturedThumb: Record<string, ReturnType<typeof vi.fn>> | undefined;
vi.mock('../../../services/segmentationThumbnailService', () => {
  const SegmentationThumbnailService = vi.fn().mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.generateBatchThumbnails = vi.fn().mockResolvedValue(new Map());
    this.getConcurrencyStatus = vi
      .fn()
      .mockReturnValue({ active: 0, queued: 0 });
    capturedThumb = this as Record<string, ReturnType<typeof vi.fn>>;
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

// ── Imports AFTER mocks ───────────────────────────────────────────────────────
import { ImageController } from '../imageController';
import { ImageService } from '../../../services/imageService';
import * as SharingService from '../../../services/sharingService';
import { prisma } from '../../../db/index';
import { ApiError } from '../../../middleware/error';

// ── Single controller + captured mock instances ──────────────────────────────
const controller = new ImageController();

const _instances = vi.mocked(ImageService).mock.instances;
const imageServiceInstance = _instances[_instances.length - 1] as Record<
  string,
  ReturnType<typeof vi.fn>
>;
const thumbService = capturedThumb as Record<string, ReturnType<typeof vi.fn>>;

// ── Constants ─────────────────────────────────────────────────────────────────
const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const IMAGE_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const SEG_ID = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';

// ── App builders ──────────────────────────────────────────────────────────────

/** Wildcard app with an injected user (params come from the request URL). */
function buildApp(handler: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { user?: unknown }, _res, next) => {
    req.user = { id: USER_ID, email: 'user@test.com' };
    next();
  });
  app.all('/*', handler);
  return app;
}

/** Wildcard app with NO user → controller auth guard fires. */
function buildUnauthApp(handler: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.all('/*', handler);
  return app;
}

/** Authenticated app on a specific route (so a named path param resolves). */
function mountAuthed(
  method: 'get' | 'post' | 'delete' | 'patch',
  routePath: string,
  handler: express.RequestHandler
) {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { user?: unknown }, _res, next) => {
    req.user = { id: USER_ID };
    next();
  });
  (
    app as unknown as Record<
      string,
      (p: string, h: express.RequestHandler) => void
    >
  )[method](routePath, handler);
  return app;
}

/** Public app on a specific route (no user injected). */
function mountPublic(
  method: 'get' | 'post',
  routePath: string,
  handler: express.RequestHandler
) {
  const app = express();
  app.use(express.json());
  (
    app as unknown as Record<
      string,
      (p: string, h: express.RequestHandler) => void
    >
  )[method](routePath, handler);
  return app;
}

/** Upload app: injects user + req.files, mounts POST /:id. */
function buildUploadApp(files: unknown[]) {
  const app = express();
  app.use(express.json());
  app.use(
    (
      req: express.Request & { user?: unknown; files?: unknown },
      _res,
      next
    ) => {
      req.user = { id: USER_ID };
      req.files = files as Express.Multer.File[];
      next();
    }
  );
  app.post('/:id', controller.uploadImages);
  return app;
}

function makeImageFiles(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    fieldname: 'images',
    originalname: `img-${i}.jpg`,
    encoding: '7bit',
    mimetype: 'image/jpeg',
    buffer: Buffer.alloc(1024),
    size: 1024,
  }));
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ImageController', () => {
  beforeEach(() => {
    Object.values(imageServiceInstance ?? {}).forEach(fn => {
      if (typeof fn?.mockReset === 'function') fn.mockReset();
    });
    vi.mocked(prisma.image.findMany).mockReset();
    vi.mocked(prisma.image.count).mockReset();
    vi.mocked(prisma.segmentation.findUnique).mockReset();
    vi.mocked(SharingService.hasProjectAccess).mockReset();
    thumbService.generateBatchThumbnails.mockReset().mockResolvedValue(new Map());
    thumbService.getConcurrencyStatus
      .mockReset()
      .mockReturnValue({ active: 0, queued: 0 });
  });

  // ── uploadImages ─────────────────────────────────────────────────────────────
  describe('uploadImages', () => {
    it('uploads valid files and delegates to uploadImagesWithProgress with a progress callback', async () => {
      const uploaded = [
        {
          id: 'image-1',
          name: 'img-0.jpg',
          originalUrl: '/uploads/img-0.jpg',
          thumbnailUrl: '/uploads/img-0_thumb.jpg',
        },
      ];
      imageServiceInstance.uploadImagesWithProgress.mockResolvedValue(uploaded);

      const app = buildUploadApp(makeImageFiles(1));
      const res = await request(app).post(`/${PROJECT_ID}`).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.images).toHaveLength(1);
      expect(res.body.data.count).toBe(1);
      expect(imageServiceInstance.uploadImagesWithProgress).toHaveBeenCalledWith(
        PROJECT_ID,
        USER_ID,
        expect.any(Array),
        expect.any(String),
        expect.any(Function)
      );
    });

    it('returns 401 when unauthenticated', async () => {
      const app = express();
      app.use(express.json());
      app.post('/:id', controller.uploadImages);
      const res = await request(app).post(`/${PROJECT_ID}`).expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when the files array is empty', async () => {
      const app = buildUploadApp([]);
      const res = await request(app).post(`/${PROJECT_ID}`).expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for an invalid MIME type', async () => {
      const app = buildUploadApp([
        {
          fieldname: 'images',
          originalname: 'virus.exe',
          mimetype: 'application/octet-stream',
          buffer: Buffer.alloc(10),
          size: 10,
        },
      ]);
      const res = await request(app).post(`/${PROJECT_ID}`).expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Invalid file type/);
    });

    it('returns 400 when a file exceeds the size limit', async () => {
      const app = buildUploadApp([
        {
          fieldname: 'images',
          originalname: 'huge.png',
          mimetype: 'image/png',
          buffer: Buffer.alloc(100 * 1024 * 1024),
          size: 100 * 1024 * 1024,
        },
      ]);
      const res = await request(app).post(`/${PROJECT_ID}`).expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/File too large/);
    });

    it('returns 400 when a file buffer is null (corrupted multer upload)', async () => {
      const app = buildUploadApp([
        {
          fieldname: 'images',
          originalname: 'corrupt.jpg',
          mimetype: 'image/jpeg',
          buffer: null,
          size: 0,
        },
      ]);
      const res = await request(app).post(`/${PROJECT_ID}`).expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Invalid file/);
    });

    it('returns 500 when the upload service throws', async () => {
      imageServiceInstance.uploadImagesWithProgress.mockRejectedValue(
        new Error('Storage service temporarily unavailable')
      );
      const app = buildUploadApp(makeImageFiles(1));
      const res = await request(app).post(`/${PROJECT_ID}`).expect(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── getImages ────────────────────────────────────────────────────────────────
  describe('getImages', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await request(buildUnauthApp(controller.getImages))
        .get('/')
        .query({ projectId: PROJECT_ID })
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when projectId param is absent', async () => {
      const res = await request(mountAuthed('get', '/', controller.getImages))
        .get('/')
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when sortBy is not in the allowlist', async () => {
      const res = await request(mountAuthed('get', '/:id', controller.getImages))
        .get(`/${PROJECT_ID}`)
        .query({ sortBy: 'INVALID' })
        .expect(400);
      expect(res.body.error).toMatch(/Invalid query parameter/);
      expect(res.body.field).toBe('sortBy');
    });

    it('returns 400 when sortOrder is invalid', async () => {
      const res = await request(mountAuthed('get', '/:id', controller.getImages))
        .get(`/${PROJECT_ID}`)
        .query({ sortOrder: 'random' })
        .expect(400);
      expect(res.body.error).toMatch(/Invalid query parameter/);
      expect(res.body.field).toBe('sortOrder');
    });

    it('returns 400 when status is not a valid JOB_STATUS', async () => {
      const res = await request(mountAuthed('get', '/:id', controller.getImages))
        .get(`/${PROJECT_ID}`)
        .query({ status: 'flying' })
        .expect(400);
      expect(res.body.field).toBe('status');
    });

    it('delegates to getProjectImages with parsed params and returns 200', async () => {
      const mockResult = {
        images: [{ id: IMAGE_ID, name: 'shot.png' }],
        total: 1,
        page: 1,
        limit: 10,
      };
      imageServiceInstance.getProjectImages.mockResolvedValue(mockResult);

      const res = await request(mountAuthed('get', '/:id', controller.getImages))
        .get(`/${PROJECT_ID}`)
        .query({
          page: '2',
          limit: '5',
          sortBy: 'name',
          sortOrder: 'asc',
          status: 'pending',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockResult);
      expect(imageServiceInstance.getProjectImages).toHaveBeenCalledWith(
        PROJECT_ID,
        USER_ID,
        { page: 2, limit: 5, sortBy: 'name', sortOrder: 'asc', status: 'pending' }
      );
    });

    it('passes ApiError status through to the client', async () => {
      imageServiceInstance.getProjectImages.mockRejectedValue(
        ApiError.notFound('Project not found')
      );
      const res = await request(mountAuthed('get', '/:id', controller.getImages))
        .get(`/${PROJECT_ID}`)
        .expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 for non-ApiError service failures', async () => {
      imageServiceInstance.getProjectImages.mockRejectedValue(
        new Error('DB crash')
      );
      const res = await request(mountAuthed('get', '/:id', controller.getImages))
        .get(`/${PROJECT_ID}`)
        .expect(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── getImage ─────────────────────────────────────────────────────────────────
  describe('getImage', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await request(buildUnauthApp(controller.getImage))
        .get(`/${IMAGE_ID}`)
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when imageId param is absent', async () => {
      const res = await request(mountAuthed('get', '/', controller.getImage))
        .get('/')
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when the service returns null', async () => {
      imageServiceInstance.getImageById.mockResolvedValue(null);
      const res = await request(
        mountAuthed('get', '/:imageId', controller.getImage)
      )
        .get(`/${IMAGE_ID}`)
        .expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with image data and delegates to getImageById', async () => {
      const mockImage = { id: IMAGE_ID, name: 'cell.png', projectId: PROJECT_ID };
      imageServiceInstance.getImageById.mockResolvedValue(mockImage);

      const res = await request(
        mountAuthed('get', '/:imageId', controller.getImage)
      )
        .get(`/${IMAGE_ID}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.image).toEqual(mockImage);
      expect(imageServiceInstance.getImageById).toHaveBeenCalledWith(
        IMAGE_ID,
        USER_ID
      );
    });
  });

  // ── deleteImage ──────────────────────────────────────────────────────────────
  describe('deleteImage', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await request(buildUnauthApp(controller.deleteImage))
        .delete(`/${IMAGE_ID}`)
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when imageId param is absent', async () => {
      const res = await request(
        mountAuthed('delete', '/', controller.deleteImage)
      )
        .delete('/')
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 and delegates to deleteImage on success', async () => {
      imageServiceInstance.deleteImage.mockResolvedValue(undefined);
      const res = await request(
        mountAuthed('delete', '/:imageId', controller.deleteImage)
      )
        .delete(`/${IMAGE_ID}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(imageServiceInstance.deleteImage).toHaveBeenCalledWith(
        IMAGE_ID,
        USER_ID
      );
    });

    it('passes ApiError.forbidden (403) through to the client', async () => {
      imageServiceInstance.deleteImage.mockRejectedValue(
        ApiError.forbidden('Not your image')
      );
      const res = await request(
        mountAuthed('delete', '/:imageId', controller.deleteImage)
      )
        .delete(`/${IMAGE_ID}`)
        .expect(403);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 for a non-ApiError service failure', async () => {
      imageServiceInstance.deleteImage.mockRejectedValue(
        new Error('Generic DB crash')
      );
      const res = await request(
        mountAuthed('delete', '/:imageId', controller.deleteImage)
      )
        .delete(`/${IMAGE_ID}`)
        .expect(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── deleteBatch ──────────────────────────────────────────────────────────────
  describe('deleteBatch', () => {
    const validBody = {
      imageIds: [
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      ],
      projectId: PROJECT_ID,
    };

    it('returns 401 when unauthenticated', async () => {
      const res = await request(buildUnauthApp(controller.deleteBatch))
        .delete('/')
        .send(validBody)
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when imageIds is empty', async () => {
      const res = await request(buildApp(controller.deleteBatch))
        .delete('/')
        .send({ imageIds: [], projectId: PROJECT_ID })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when imageIds exceeds 100 items', async () => {
      const ids = Array(101).fill('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
      const res = await request(buildApp(controller.deleteBatch))
        .delete('/')
        .send({ imageIds: ids, projectId: PROJECT_ID })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when projectId is missing', async () => {
      const res = await request(buildApp(controller.deleteBatch))
        .delete('/')
        .send({ imageIds: validBody.imageIds })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when any imageId is not a valid UUID', async () => {
      const res = await request(buildApp(controller.deleteBatch))
        .delete('/')
        .send({ imageIds: ['not-a-uuid'], projectId: PROJECT_ID })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with deletedCount and forwards all ids', async () => {
      imageServiceInstance.deleteBatch.mockResolvedValue({
        deletedCount: 2,
        failedIds: [],
      });
      const res = await request(buildApp(controller.deleteBatch))
        .delete('/')
        .send(validBody)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.deletedCount).toBe(2);
      expect(imageServiceInstance.deleteBatch).toHaveBeenCalledWith(
        validBody.imageIds,
        USER_ID,
        PROJECT_ID
      );
    });

    it('passes ApiError status through on service failure', async () => {
      imageServiceInstance.deleteBatch.mockRejectedValue(
        ApiError.notFound('Images not found')
      );
      const res = await request(buildApp(controller.deleteBatch))
        .delete('/')
        .send(validBody)
        .expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 for a non-ApiError service failure', async () => {
      imageServiceInstance.deleteBatch.mockRejectedValue(
        new Error('Unexpected DB')
      );
      const res = await request(buildApp(controller.deleteBatch))
        .delete('/')
        .send({
          imageIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
          projectId: PROJECT_ID,
        })
        .expect(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── getImageWithSegmentation ───────────────────────────────────────────────
  describe('getImageWithSegmentation', () => {
    it('returns 401 when unauthenticated', async () => {
      await request(buildUnauthApp(controller.getImageWithSegmentation))
        .get(`/${IMAGE_ID}`)
        .expect(401);
    });

    it('returns 400 when imageId param is absent', async () => {
      const res = await request(
        mountAuthed('get', '/', controller.getImageWithSegmentation)
      )
        .get('/')
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when the image is not found', async () => {
      imageServiceInstance.getImageById.mockResolvedValue(null);
      const res = await request(
        mountAuthed('get', '/:imageId', controller.getImageWithSegmentation)
      )
        .get(`/${IMAGE_ID}`)
        .expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns bare image when includeSegmentation is not set', async () => {
      imageServiceInstance.getImageById.mockResolvedValue({
        id: IMAGE_ID,
        name: 'cell.png',
      });
      const res = await request(
        mountAuthed('get', '/:imageId', controller.getImageWithSegmentation)
      )
        .get(`/${IMAGE_ID}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.segmentation).toBeUndefined();
    });

    it('returns bare image when includeSegmentation=true but no record exists', async () => {
      imageServiceInstance.getImageById.mockResolvedValue({
        id: IMAGE_ID,
        name: 'cell.png',
      });
      vi.mocked(prisma.segmentation.findUnique).mockResolvedValue(null);

      const res = await request(
        mountAuthed('get', '/:imageId', controller.getImageWithSegmentation)
      )
        .get(`/${IMAGE_ID}`)
        .query({ includeSegmentation: 'true' })
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('returns parsed segmentation when a record exists and includeSegmentation=true', async () => {
      const polygons = [{ id: 'p1', points: [{ x: 0, y: 0 }] }];
      imageServiceInstance.getImageById.mockResolvedValue({
        id: IMAGE_ID,
        name: 'cell.png',
      });
      vi.mocked(prisma.segmentation.findUnique).mockResolvedValue({
        id: 'seg-1',
        imageId: IMAGE_ID,
        polygons: JSON.stringify(polygons),
        model: 'hrnet',
        threshold: 0.5,
        confidence: 0.9,
        processingTime: 200,
        imageWidth: 800,
        imageHeight: 600,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const res = await request(
        mountAuthed('get', '/:imageId', controller.getImageWithSegmentation)
      )
        .get(`/${IMAGE_ID}`)
        .query({ includeSegmentation: 'true' })
        .expect(200);

      expect(res.body.data.segmentation.polygons).toEqual(polygons);
      expect(res.body.data.segmentation.model).toBe('hrnet');
      expect(res.body.data.segmentation.status).toBe('completed');
    });

    it('returns 500 when segmentation JSON is malformed', async () => {
      imageServiceInstance.getImageById.mockResolvedValue({
        id: IMAGE_ID,
        name: 'cell.png',
      });
      vi.mocked(prisma.segmentation.findUnique).mockResolvedValue({
        id: 'seg-1',
        imageId: IMAGE_ID,
        polygons: '{INVALID JSON',
        model: 'hrnet',
        threshold: 0.5,
        confidence: 0.9,
        processingTime: 200,
        imageWidth: 800,
        imageHeight: 600,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const res = await request(
        mountAuthed('get', '/:imageId', controller.getImageWithSegmentation)
      )
        .get(`/${IMAGE_ID}`)
        .query({ includeSegmentation: 'true' })
        .expect(500);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 for a generic service error', async () => {
      imageServiceInstance.getImageById.mockRejectedValue(new Error('DB gone'));
      const res = await request(
        mountAuthed('get', '/:imageId', controller.getImageWithSegmentation)
      )
        .get(`/${IMAGE_ID}`)
        .expect(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── getImageStats ────────────────────────────────────────────────────────────
  describe('getImageStats', () => {
    it('returns 401 when unauthenticated', async () => {
      await request(buildUnauthApp(controller.getImageStats)).get('/').expect(401);
    });

    it('returns 400 when projectId param is absent', async () => {
      const res = await request(
        mountAuthed('get', '/', controller.getImageStats)
      )
        .get('/')
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with stats and delegates to getImageStats', async () => {
      const mockStats = { total: 42, segmented: 30, pending: 12 };
      imageServiceInstance.getImageStats.mockResolvedValue(mockStats);
      const res = await request(
        mountAuthed('get', '/:id', controller.getImageStats)
      )
        .get(`/${PROJECT_ID}`)
        .expect(200);
      expect(res.body.data.stats).toEqual(mockStats);
      expect(imageServiceInstance.getImageStats).toHaveBeenCalledWith(
        PROJECT_ID,
        USER_ID
      );
    });

    it('passes ApiError status through to the client', async () => {
      imageServiceInstance.getImageStats.mockRejectedValue(
        ApiError.notFound('Project not found')
      );
      const res = await request(
        mountAuthed('get', '/:id', controller.getImageStats)
      )
        .get(`/${PROJECT_ID}`)
        .expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 for a non-ApiError service error', async () => {
      imageServiceInstance.getImageStats.mockRejectedValue(
        new Error('Generic crash')
      );
      const res = await request(
        mountAuthed('get', '/:id', controller.getImageStats)
      )
        .get(`/${PROJECT_ID}`)
        .expect(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── getProjectImagesWithThumbnails ─────────────────────────────────────────
  describe('getProjectImagesWithThumbnails', () => {
    function makePrismaImage(overrides: Record<string, unknown> = {}) {
      return {
        id: IMAGE_ID,
        name: 'frame.png',
        projectId: PROJECT_ID,
        originalPath: 'projects/p/images/frame.png',
        thumbnailPath: null,
        segmentationThumbnailPath: null,
        segmentationStatus: 'pending',
        fileSize: 1024,
        width: 800,
        height: 600,
        mimeType: 'image/png',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        segmentation: null,
        isVideoContainer: false,
        parentVideoId: null,
        frameIndex: null,
        frameCount: null,
        videoDurationMs: null,
        pixelSizeUm: null,
        frameIntervalMs: null,
        channels: null,
        displayOrder: 0,
        ...overrides,
      };
    }

    const handler = controller.getProjectImagesWithThumbnails;

    beforeEach(() => {
      vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
        hasAccess: true,
      } as never);
      vi.mocked(prisma.image.findMany).mockResolvedValue([]);
      vi.mocked(prisma.image.count).mockResolvedValue(0);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await request(buildUnauthApp(handler))
        .get(`/${PROJECT_ID}`)
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when page is not a positive integer', async () => {
      const res = await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .query({ page: '0' })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when limit exceeds 100', async () => {
      const res = await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .query({ limit: '101' })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when lod is invalid', async () => {
      const res = await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .query({ lod: 'ultra' })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when SharingService denies access', async () => {
      vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
        hasAccess: false,
      } as never);
      const res = await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .expect(404);
      expect(res.body.success).toBe(false);
      expect(SharingService.hasProjectAccess).toHaveBeenCalledWith(
        PROJECT_ID,
        USER_ID
      );
    });

    it('returns 200 with pagination metadata for an empty project', async () => {
      const res = await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .query({ page: '1', limit: '10' })
        .expect(200);

      expect(res.body.data.images).toHaveLength(0);
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.pagination.limit).toBe(10);
      expect(res.body.data.pagination.total).toBe(0);
      expect(res.body.data.pagination.pages).toBe(0);
      expect(res.body.data.metadata.projectChannels).toEqual([]);
    });

    it('defaults limit=50 when no limit query param is provided', async () => {
      const res = await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .query({ page: '1' })
        .expect(200);
      expect(res.body.data.pagination.limit).toBe(50);
    });

    it('filters video containers (isVideoContainer:false) in the gallery query', async () => {
      await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .expect(200);

      const galleryCall = vi.mocked(prisma.image.findMany).mock.calls[0];
      expect(galleryCall[0]?.where).toMatchObject({
        projectId: PROJECT_ID,
        isVideoContainer: false,
      });
    });

    it('aggregates distinct, sorted projectChannels from container rows', async () => {
      vi.mocked(prisma.image.findMany)
        .mockResolvedValueOnce([makePrismaImage()])
        .mockResolvedValueOnce([
          { channels: [{ name: 'DAPI' }, { name: 'GFP' }] },
          { channels: [{ name: 'GFP' }] },
        ] as never);
      vi.mocked(prisma.image.count).mockResolvedValue(1);

      const res = await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .expect(200);
      expect(res.body.data.metadata.projectChannels).toEqual(['DAPI', 'GFP']);
    });

    it('bubbles calibration from the parent container onto frame rows', async () => {
      const PARENT_ID = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee';
      vi.mocked(prisma.image.findMany)
        .mockResolvedValueOnce([
          makePrismaImage({
            parentVideoId: PARENT_ID,
            pixelSizeUm: null,
            frameIntervalMs: null,
          }) as never,
        ])
        .mockResolvedValueOnce([
          { id: PARENT_ID, pixelSizeUm: 0.65, frameIntervalMs: 200 },
        ] as never)
        .mockResolvedValueOnce([]);
      vi.mocked(prisma.image.count).mockResolvedValue(1);

      const res = await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .expect(200);

      const frame = res.body.data.images[0];
      expect(frame.pixelSizeUm).toBe(0.65);
      expect(frame.frameIntervalMs).toBe(200);
    });

    it('uses the /display url for frame images (parentVideoId set)', async () => {
      const PARENT_ID = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee';
      vi.mocked(prisma.image.findMany)
        .mockResolvedValueOnce([
          makePrismaImage({ parentVideoId: PARENT_ID }) as never,
        ])
        .mockResolvedValueOnce([
          { id: PARENT_ID, pixelSizeUm: null, frameIntervalMs: null },
        ] as never)
        .mockResolvedValueOnce([]);
      vi.mocked(prisma.image.count).mockResolvedValue(1);

      const res = await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .expect(200);
      expect(res.body.data.images[0].url).toBe(`/api/images/${IMAGE_ID}/display`);
    });

    it('uses the /display url for video container images (isVideoContainer=true)', async () => {
      vi.mocked(prisma.image.findMany)
        .mockResolvedValueOnce([
          makePrismaImage({ isVideoContainer: true }) as never,
        ])
        .mockResolvedValueOnce([]);
      vi.mocked(prisma.image.count).mockResolvedValue(1);

      const res = await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .expect(200);
      expect(res.body.data.images[0].url).toBe(`/api/images/${IMAGE_ID}/display`);
    });

    it('strips polygon data for LOD=low but keeps the count', async () => {
      const polygons = [{ id: 'p1', points: [{ x: 0, y: 0 }] }];
      vi.mocked(prisma.image.findMany)
        .mockResolvedValueOnce([
          makePrismaImage({
            segmentation: {
              polygons: JSON.stringify(polygons),
              imageWidth: 800,
              imageHeight: 600,
            },
          }) as never,
        ])
        .mockResolvedValueOnce([]);
      vi.mocked(prisma.image.count).mockResolvedValue(1);

      const res = await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .query({ lod: 'low' })
        .expect(200);

      const seg = res.body.data.images[0].segmentationResult;
      expect(seg.polygons).toEqual([]);
      expect(seg.polygonCount).toBe(1);
    });

    it('returns full polygon data for LOD=high', async () => {
      const polygons = [{ id: 'p1', points: [{ x: 0, y: 0 }] }];
      vi.mocked(prisma.image.findMany)
        .mockResolvedValueOnce([
          makePrismaImage({
            segmentation: {
              polygons: JSON.stringify(polygons),
              imageWidth: 800,
              imageHeight: 600,
            },
          }) as never,
        ])
        .mockResolvedValueOnce([]);
      vi.mocked(prisma.image.count).mockResolvedValue(1);

      const res = await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .query({ lod: 'high' })
        .expect(200);
      expect(res.body.data.images[0].segmentationResult.polygons).toEqual(
        polygons
      );
    });

    it('falls back to a safe default when segmentation JSON is corrupted', async () => {
      vi.mocked(prisma.image.findMany)
        .mockResolvedValueOnce([
          makePrismaImage({
            segmentation: {
              polygons: 'NOT_JSON',
              imageWidth: 800,
              imageHeight: 600,
            },
          }) as never,
        ])
        .mockResolvedValueOnce([]);
      vi.mocked(prisma.image.count).mockResolvedValue(1);

      const res = await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .expect(200);
      const seg = res.body.data.images[0].segmentationResult;
      expect(seg.polygonCount).toBe(0);
      expect(seg.polygons).toEqual([]);
    });

    it('falls back to a safe default when polygons is valid JSON but not an array', async () => {
      vi.mocked(prisma.image.findMany)
        .mockResolvedValueOnce([
          makePrismaImage({
            segmentation: {
              polygons: JSON.stringify({ not: 'array' }),
              imageWidth: 800,
              imageHeight: 600,
            },
          }) as never,
        ])
        .mockResolvedValueOnce([]);
      vi.mocked(prisma.image.count).mockResolvedValue(1);

      const res = await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .expect(200);
      const seg = res.body.data.images[0].segmentationResult;
      expect(seg.polygonCount).toBe(0);
      expect(seg.polygons).toEqual([]);
    });

    it('returns 500 on an unexpected error (DB crash)', async () => {
      vi.mocked(prisma.image.findMany).mockRejectedValueOnce(
        new Error('DB gone')
      );
      const res = await request(mountAuthed('get', '/:id', handler))
        .get(`/${PROJECT_ID}`)
        .expect(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── getImageForDisplay ─────────────────────────────────────────────────────
  describe('getImageForDisplay', () => {
    it('returns 400 when imageId param is missing', async () => {
      const res = await request(
        mountPublic('get', '/', controller.getImageForDisplay)
      )
        .get('/')
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when the service throws a "nenalezen" error', async () => {
      imageServiceInstance.getBrowserCompatibleImage.mockRejectedValue(
        new Error('Image nenalezen in storage')
      );
      const res = await request(
        mountPublic('get', '/:imageId', controller.getImageForDisplay)
      )
        .get(`/${IMAGE_ID}`)
        .expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 for other service errors', async () => {
      imageServiceInstance.getBrowserCompatibleImage.mockRejectedValue(
        new Error('S3 timeout')
      );
      const res = await request(
        mountPublic('get', '/:imageId', controller.getImageForDisplay)
      )
        .get(`/${IMAGE_ID}`)
        .expect(500);
      expect(res.body.success).toBe(false);
    });

    it('sets Content-Type and cache headers and returns the image buffer', async () => {
      imageServiceInstance.getBrowserCompatibleImage.mockResolvedValue({
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        mimeType: 'image/png',
        filename: 'cell.png',
      });
      const res = await request(
        mountPublic('get', '/:imageId', controller.getImageForDisplay)
      )
        .get(`/${IMAGE_ID}`)
        .expect(200);
      expect(res.headers['content-type']).toMatch(/image\/png/);
      expect(res.headers['cache-control']).toMatch(/max-age=31536000/);
    });
  });

  // ── reorderImages ──────────────────────────────────────────────────────────
  describe('reorderImages', () => {
    const validBody = { imageIds: [IMAGE_ID], mode: 'all' };

    it('returns 401 when unauthenticated', async () => {
      const res = await request(buildUnauthApp(controller.reorderImages))
        .patch('/')
        .send(validBody)
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with count + mode and delegates to reorderImages', async () => {
      imageServiceInstance.reorderImages.mockResolvedValue(undefined);
      const res = await request(
        mountAuthed('patch', '/:id', controller.reorderImages)
      )
        .patch(`/${PROJECT_ID}`)
        .send(validBody)
        .expect(200);

      expect(res.body.data.reordered).toBe(1);
      expect(res.body.data.mode).toBe('all');
      expect(imageServiceInstance.reorderImages).toHaveBeenCalledWith(
        PROJECT_ID,
        USER_ID,
        [IMAGE_ID],
        'all'
      );
    });

    it('defaults mode to "all" when omitted', async () => {
      imageServiceInstance.reorderImages.mockResolvedValue(undefined);
      const res = await request(
        mountAuthed('patch', '/:id', controller.reorderImages)
      )
        .patch(`/${PROJECT_ID}`)
        .send({ imageIds: [IMAGE_ID] })
        .expect(200);
      expect(res.body.data.mode).toBe('all');
    });

    it('returns 409 on Prisma P2025 (record not found mid-drag)', async () => {
      const { Prisma } = await import('@prisma/client');
      imageServiceInstance.reorderImages.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '5.0.0',
        })
      );
      const res = await request(
        mountAuthed('patch', '/:id', controller.reorderImages)
      )
        .patch(`/${PROJECT_ID}`)
        .send(validBody)
        .expect(409);
      expect(res.body.success).toBe(false);
    });

    it('returns 409 on Prisma P2034 (serialization conflict)', async () => {
      const { Prisma } = await import('@prisma/client');
      imageServiceInstance.reorderImages.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Serialization failure', {
          code: 'P2034',
          clientVersion: '5.0.0',
        })
      );
      const res = await request(
        mountAuthed('patch', '/:id', controller.reorderImages)
      )
        .patch(`/${PROJECT_ID}`)
        .send(validBody)
        .expect(409);
      expect(res.body.success).toBe(false);
    });

    it('passes ApiError status through for service-level errors', async () => {
      imageServiceInstance.reorderImages.mockRejectedValue(
        ApiError.forbidden('Not project owner')
      );
      const res = await request(
        mountAuthed('patch', '/:id', controller.reorderImages)
      )
        .patch(`/${PROJECT_ID}`)
        .send(validBody)
        .expect(403);
      expect(res.body.success).toBe(false);
    });
  });

  // ── regenerateThumbnails ───────────────────────────────────────────────────
  describe('regenerateThumbnails', () => {
    function buildRegenApp(userId?: string) {
      const app = express();
      app.use(express.json());
      if (userId) {
        app.use((req: express.Request & { user?: unknown }, _res, next) => {
          req.user = { id: userId };
          next();
        });
      }
      app.post('/:projectId', controller.regenerateThumbnails);
      return app;
    }

    function makeImageWithSeg(name = 'cell.png') {
      return {
        id: IMAGE_ID,
        name,
        updatedAt: new Date(),
        segmentation: { id: SEG_ID, imageId: IMAGE_ID },
        segmentationThumbnailPath: null,
      };
    }

    beforeEach(() => {
      vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
        hasAccess: true,
      } as never);
      vi.mocked(prisma.image.findMany).mockResolvedValue([
        makeImageWithSeg() as never,
      ]);
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await request(buildRegenApp())
        .post(`/${PROJECT_ID}`)
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when projectId param is absent', async () => {
      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.post('/', controller.regenerateThumbnails);
      const res = await request(app).post('/').expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when limit is out of range', async () => {
      const res = await request(buildRegenApp(USER_ID))
        .post(`/${PROJECT_ID}`)
        .query({ limit: '2000' })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when SharingService denies access', async () => {
      vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
        hasAccess: false,
      } as never);
      const res = await request(buildRegenApp(USER_ID))
        .post(`/${PROJECT_ID}`)
        .expect(404);
      expect(res.body.success).toBe(false);
    });

    it('dry-run returns counts without regenerating', async () => {
      vi.mocked(prisma.image.findMany).mockResolvedValue([
        {
          id: IMAGE_ID,
          name: 'cell.png',
          updatedAt: new Date(),
          segmentation: { id: SEG_ID, imageId: IMAGE_ID },
          segmentationThumbnailPath: null,
        } as never,
      ]);

      const res = await request(buildRegenApp(USER_ID))
        .post(`/${PROJECT_ID}`)
        .query({ dryRun: 'true' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.imagesWithMissingThumbnails).toBe(1);
      expect(thumbService.generateBatchThumbnails).not.toHaveBeenCalled();
    });

    it('returns 200 with zero counts when no image needs regeneration', async () => {
      vi.mocked(prisma.image.findMany).mockResolvedValue([
        {
          id: IMAGE_ID,
          name: 'no-seg.png',
          updatedAt: new Date(),
          segmentation: null,
        } as never,
      ]);

      const res = await request(buildRegenApp(USER_ID))
        .post(`/${PROJECT_ID}`)
        .expect(200);
      expect(res.body.data.regeneratedCount).toBe(0);
    });

    it('reports failedCount and failedImages when generation returns null values', async () => {
      thumbService.generateBatchThumbnails.mockResolvedValueOnce(
        new Map([[SEG_ID, null]])
      );

      const res = await request(buildRegenApp(USER_ID))
        .post(`/${PROJECT_ID}`)
        .expect(200);

      expect(res.body.data.failedCount).toBe(1);
      expect(res.body.data.regeneratedCount).toBe(0);
      expect(res.body.data.failedImages).toContain('cell.png');
      expect(res.body.message).toMatch(/selhalo/);
    });

    it('reports full success (failedCount 0) with processingTime + concurrencyStatus', async () => {
      thumbService.generateBatchThumbnails.mockResolvedValueOnce(
        new Map([[SEG_ID, 'http://storage/thumb.png']])
      );

      const res = await request(buildRegenApp(USER_ID))
        .post(`/${PROJECT_ID}`)
        .expect(200);

      expect(res.body.data.regeneratedCount).toBe(1);
      expect(res.body.data.failedCount).toBe(0);
      expect(res.body.data.failedImages).toBeUndefined();
      expect(res.body.message).not.toMatch(/selhalo/);
      expect(typeof res.body.data.processingTime).toBe('number');
      expect(res.body.data.concurrencyStatus).toBeDefined();
    });

    it('forwards an ApiError status (e.g. 403) from the service', async () => {
      thumbService.generateBatchThumbnails.mockRejectedValueOnce(
        ApiError.forbidden('Access denied')
      );
      const res = await request(buildRegenApp(USER_ID))
        .post(`/${PROJECT_ID}`)
        .expect(403);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 for an unexpected error', async () => {
      thumbService.generateBatchThumbnails.mockRejectedValueOnce(
        new Error('Database exploded')
      );
      const res = await request(buildRegenApp(USER_ID))
        .post(`/${PROJECT_ID}`)
        .expect(500);
      expect(res.body.success).toBe(false);
    });
  });
});
