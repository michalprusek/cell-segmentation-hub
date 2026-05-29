/**
 * ImageController — behavioral unit tests.
 *
 * Covers endpoints NOT exercised by the existing imageController.test.ts:
 *   - getImages (query-param validation, service call forwarding, error paths)
 *   - getImage (auth guard, 404, success)
 *   - deleteImage (auth guard, ApiError passthrough, success)
 *   - deleteBatch (auth, body validation, UUID check, 100-limit, success)
 *   - getImageWithSegmentation (auth, 404, without seg, with seg, JSON parse error)
 *   - getImageStats (auth, ApiError passthrough, success)
 *   - getProjectImagesWithThumbnails (auth, pagination param validation, LOD
 *     validation, SharingService 404 gate, container-filter + calibration
 *     bubbling, projectChannels aggregation, LOD low strips polygon data,
 *     error path)
 *   - getImageForDisplay (no-auth allowed, 404 via "nenalezen" message, success)
 *   - reorderImages (auth, success, Prisma P2025 → 409)
 *   - uploadImages (auth guard covered by existing tests; here: no-files 400,
 *     invalid MIME 400, file-too-large 400, missing buffer 400)
 *
 * Design notes:
 * - vi.mock factories are hoisted above imports.  All mock objects are built
 *   with vi.fn() inline to avoid TDZ issues.
 * - Prisma + SharingService mocks are reset in beforeEach so tests are isolated.
 * - buildApp() injects req.user; buildUnauthApp() leaves it unset (→ 401).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── MUST come first: config mock prevents process.exit(1) trap ───────────────
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

// SegmentationThumbnailService stub
vi.mock('../../../services/segmentationThumbnailService', () => {
  const SegmentationThumbnailService = vi.fn().mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.generateBatchThumbnails = vi.fn();
    this.getConcurrencyStatus = vi
      .fn()
      .mockReturnValue({ active: 0, queued: 0 });
  });
  return { SegmentationThumbnailService };
});

// WebSocketService — getInstance returns no-op stub
vi.mock('../../../services/websocketService', () => ({
  WebSocketService: {
    getInstance: vi.fn(() => ({
      emitToUser: vi.fn(),
      emitToProject: vi.fn(),
    })),
  },
}));

// SharingService — module-level fns used directly by the controller
vi.mock('../../../services/sharingService', () => ({
  hasProjectAccess: vi.fn(),
}));

// Storage provider — getUrl returns a predictable URL
vi.mock('../../../storage/index', () => ({
  getStorageProvider: vi.fn(() => ({
    getUrl: vi.fn((path: string) => Promise.resolve(`http://storage/${path}`)),
    saveFile: vi.fn(() => Promise.resolve('/mock/path')),
    deleteFile: vi.fn(() => Promise.resolve()),
  })),
}));

// Prisma — only the sub-namespaces the controller actually uses
vi.mock('../../../db/index', () => ({
  prisma: {
    image: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    segmentation: {
      findUnique: vi.fn(),
    },
  },
}));

// ── Import AFTER all vi.mock calls ────────────────────────────────────────────
import { ImageController } from '../imageController';
import { ImageService } from '../../../services/imageService';
import * as SharingService from '../../../services/sharingService';
import { prisma } from '../../../db/index';
import { ApiError } from '../../../middleware/error';

// ── Shared controller instance ────────────────────────────────────────────────
// Construct BEFORE reading mock.instances so our instance is the most recent one.
const controller = new ImageController();

// ── Resolve the service instance the controller captured at construction ──────
// Use the last instance — any earlier ImageController (from other test files
// sharing the module registry) will have already been recorded before ours.
const _instances = vi.mocked(ImageService).mock.instances;
const imageServiceInstance = _instances[_instances.length - 1] as Record<
  string,
  ReturnType<typeof vi.fn>
>;

// ── Constants ─────────────────────────────────────────────────────────────────
const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const IMAGE_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

// ── App builders ──────────────────────────────────────────────────────────────

/** Authenticated app — injects req.user */
function buildApp(handler: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { user?: unknown }, _res, next) => {
    req.user = { id: USER_ID, email: 'user@test.com' };
    next();
  });
  // Mount on a wildcard so params work: callers use /:param style in URLs
  app.all('/*', handler);
  return app;
}

/** Unauthenticated app — req.user is undefined */
function buildUnauthApp(handler: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.all('/*', handler);
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ImageController — behavioral', () => {
  beforeEach(() => {
    // Reset call records without changing implementations
    Object.values(imageServiceInstance ?? {}).forEach(fn => {
      if (typeof fn?.mockReset === 'function') fn.mockReset();
    });
    vi.mocked(prisma.image.findMany).mockReset();
    vi.mocked(prisma.image.count).mockReset();
    vi.mocked(prisma.segmentation.findUnique).mockReset();
    vi.mocked(SharingService.hasProjectAccess).mockReset();
  });

  // ── getImages ──────────────────────────────────────────────────────────────

  describe('getImages', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(controller.getImages);
      const res = await request(app)
        .get('/')
        .query({ projectId: PROJECT_ID })
        .expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when sortBy is not in allowlist', async () => {
      // Route must supply :id param for the controller to read projectId
      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getImages);

      const res = await request(app)
        .get(`/${PROJECT_ID}`)
        .query({ sortBy: 'INVALID' })
        .expect(400);
      expect(res.body.error).toMatch(/Invalid query parameter/);
      expect(res.body.field).toBe('sortBy');
    });

    it('returns 400 when sortOrder is invalid', async () => {
      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getImages);

      const res = await request(app)
        .get(`/${PROJECT_ID}`)
        .query({ sortOrder: 'random' })
        .expect(400);
      expect(res.body.error).toMatch(/Invalid query parameter/);
      expect(res.body.field).toBe('sortOrder');
    });

    it('returns 400 when status is not a valid JOB_STATUS', async () => {
      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getImages);

      const res = await request(app)
        .get(`/${PROJECT_ID}`)
        .query({ status: 'flying' })
        .expect(400);
      expect(res.body.field).toBe('status');
    });

    it('calls imageService.getProjectImages with parsed params and returns 200', async () => {
      const mockResult = {
        images: [{ id: IMAGE_ID, name: 'shot.png' }],
        total: 1,
        page: 1,
        limit: 10,
      };
      imageServiceInstance.getProjectImages.mockResolvedValue(mockResult);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getImages);

      const res = await request(app)
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
        {
          page: 2,
          limit: 5,
          sortBy: 'name',
          sortOrder: 'asc',
          status: 'pending',
        }
      );
    });

    it('passes ApiError status code through to the client', async () => {
      const err = ApiError.notFound('Project not found');
      imageServiceInstance.getProjectImages.mockRejectedValue(err);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getImages);

      const res = await request(app).get(`/${PROJECT_ID}`).expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 for non-ApiError service failures', async () => {
      imageServiceInstance.getProjectImages.mockRejectedValue(
        new Error('DB crash')
      );

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getImages);

      const res = await request(app).get(`/${PROJECT_ID}`).expect(500);
      expect(res.body.success).toBe(false);
    });
  });

  // ── getImage ───────────────────────────────────────────────────────────────

  describe('getImage', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(controller.getImage);
      const res = await request(app).get(`/${IMAGE_ID}`).expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when service returns null', async () => {
      imageServiceInstance.getImageById.mockResolvedValue(null);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:imageId', controller.getImage);

      const res = await request(app).get(`/${IMAGE_ID}`).expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with image data on success', async () => {
      const mockImage = {
        id: IMAGE_ID,
        name: 'cell.png',
        projectId: PROJECT_ID,
      };
      imageServiceInstance.getImageById.mockResolvedValue(mockImage);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:imageId', controller.getImage);

      const res = await request(app).get(`/${IMAGE_ID}`).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.image).toEqual(mockImage);
      expect(imageServiceInstance.getImageById).toHaveBeenCalledWith(
        IMAGE_ID,
        USER_ID
      );
    });
  });

  // ── deleteImage ────────────────────────────────────────────────────────────

  describe('deleteImage', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(controller.deleteImage);
      const res = await request(app).delete(`/${IMAGE_ID}`).expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 and calls deleteImage service on success', async () => {
      imageServiceInstance.deleteImage.mockResolvedValue(undefined);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.delete('/:imageId', controller.deleteImage);

      const res = await request(app).delete(`/${IMAGE_ID}`).expect(200);
      expect(res.body.success).toBe(true);
      expect(imageServiceInstance.deleteImage).toHaveBeenCalledWith(
        IMAGE_ID,
        USER_ID
      );
    });

    it('passes ApiError.forbidden status 403 to the client', async () => {
      imageServiceInstance.deleteImage.mockRejectedValue(
        ApiError.forbidden('Not your image')
      );

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.delete('/:imageId', controller.deleteImage);

      const res = await request(app).delete(`/${IMAGE_ID}`).expect(403);
      expect(res.body.success).toBe(false);
    });
  });

  // ── deleteBatch ────────────────────────────────────────────────────────────

  describe('deleteBatch', () => {
    const validBody = {
      imageIds: [
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      ],
      projectId: PROJECT_ID,
    };

    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(controller.deleteBatch);
      const res = await request(app).delete('/').send(validBody).expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when imageIds is empty', async () => {
      const app = buildApp(controller.deleteBatch);
      const res = await request(app)
        .delete('/')
        .send({ imageIds: [], projectId: PROJECT_ID })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when imageIds array exceeds 100 items', async () => {
      const ids = Array(101).fill('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
      const app = buildApp(controller.deleteBatch);
      const res = await request(app)
        .delete('/')
        .send({ imageIds: ids, projectId: PROJECT_ID })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when projectId is missing', async () => {
      const app = buildApp(controller.deleteBatch);
      const res = await request(app)
        .delete('/')
        .send({ imageIds: validBody.imageIds })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when any imageId is not a valid UUID', async () => {
      const app = buildApp(controller.deleteBatch);
      const res = await request(app)
        .delete('/')
        .send({ imageIds: ['not-a-uuid'], projectId: PROJECT_ID })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with deletedCount on success and forwards all ids', async () => {
      const mockResult = { deletedCount: 2, failedIds: [] };
      imageServiceInstance.deleteBatch.mockResolvedValue(mockResult);

      const app = buildApp(controller.deleteBatch);
      const res = await request(app).delete('/').send(validBody).expect(200);

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

      const app = buildApp(controller.deleteBatch);
      const res = await request(app).delete('/').send(validBody).expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── getImageWithSegmentation ───────────────────────────────────────────────

  describe('getImageWithSegmentation', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(controller.getImageWithSegmentation);
      await request(app).get(`/${IMAGE_ID}`).expect(401);
    });

    it('returns 404 when image not found', async () => {
      imageServiceInstance.getImageById.mockResolvedValue(null);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:imageId', controller.getImageWithSegmentation);

      const res = await request(app).get(`/${IMAGE_ID}`).expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with bare image when includeSegmentation is not set', async () => {
      const mockImage = { id: IMAGE_ID, name: 'cell.png' };
      imageServiceInstance.getImageById.mockResolvedValue(mockImage);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:imageId', controller.getImageWithSegmentation);

      const res = await request(app).get(`/${IMAGE_ID}`).expect(200);
      expect(res.body.success).toBe(true);
      // No segmentation key expected when not requested
      expect(res.body.data.segmentation).toBeUndefined();
    });

    it('returns 200 with bare image when includeSegmentation=true but no record exists', async () => {
      const mockImage = { id: IMAGE_ID, name: 'cell.png' };
      imageServiceInstance.getImageById.mockResolvedValue(mockImage);
      vi.mocked(prisma.segmentation.findUnique).mockResolvedValue(null);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:imageId', controller.getImageWithSegmentation);

      const res = await request(app)
        .get(`/${IMAGE_ID}`)
        .query({ includeSegmentation: 'true' })
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 200 with parsed segmentation when record exists and includeSegmentation=true', async () => {
      const mockImage = { id: IMAGE_ID, name: 'cell.png' };
      const polygons = [{ id: 'p1', points: [{ x: 0, y: 0 }] }];
      const mockSeg = {
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
      };
      imageServiceInstance.getImageById.mockResolvedValue(mockImage);
      vi.mocked(prisma.segmentation.findUnique).mockResolvedValue(
        mockSeg as any
      );

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:imageId', controller.getImageWithSegmentation);

      const res = await request(app)
        .get(`/${IMAGE_ID}`)
        .query({ includeSegmentation: 'true' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.segmentation.polygons).toEqual(polygons);
      expect(res.body.data.segmentation.model).toBe('hrnet');
      expect(res.body.data.segmentation.status).toBe('completed');
    });

    it('returns 500 when segmentation JSON is malformed', async () => {
      const mockImage = { id: IMAGE_ID, name: 'cell.png' };
      const mockSeg = {
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
      };
      imageServiceInstance.getImageById.mockResolvedValue(mockImage);
      vi.mocked(prisma.segmentation.findUnique).mockResolvedValue(
        mockSeg as any
      );

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:imageId', controller.getImageWithSegmentation);

      const res = await request(app)
        .get(`/${IMAGE_ID}`)
        .query({ includeSegmentation: 'true' })
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  // ── getImageStats ──────────────────────────────────────────────────────────

  describe('getImageStats', () => {
    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(controller.getImageStats);
      await request(app).get('/').expect(401);
    });

    it('returns 200 with stats on success', async () => {
      const mockStats = { total: 42, segmented: 30, pending: 12 };
      imageServiceInstance.getImageStats.mockResolvedValue(mockStats);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getImageStats);

      const res = await request(app).get(`/${PROJECT_ID}`).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stats).toEqual(mockStats);
      expect(imageServiceInstance.getImageStats).toHaveBeenCalledWith(
        PROJECT_ID,
        USER_ID
      );
    });

    it('passes ApiError status through to client', async () => {
      imageServiceInstance.getImageStats.mockRejectedValue(
        ApiError.notFound('Project not found')
      );

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getImageStats);

      const res = await request(app).get(`/${PROJECT_ID}`).expect(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── getProjectImagesWithThumbnails ─────────────────────────────────────────

  describe('getProjectImagesWithThumbnails', () => {
    /** Minimal image row returned by prisma.image.findMany */
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

    beforeEach(() => {
      // Default: access granted, no images
      vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
        hasAccess: true,
      } as any);
      vi.mocked(prisma.image.findMany).mockResolvedValue([]);
      vi.mocked(prisma.image.count).mockResolvedValue(0);
    });

    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(controller.getProjectImagesWithThumbnails);
      const res = await request(app).get(`/${PROJECT_ID}`).expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when page is not a positive integer', async () => {
      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getProjectImagesWithThumbnails);

      const res = await request(app)
        .get(`/${PROJECT_ID}`)
        .query({ page: '0' })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when limit exceeds 100', async () => {
      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getProjectImagesWithThumbnails);

      const res = await request(app)
        .get(`/${PROJECT_ID}`)
        .query({ limit: '101' })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when lod is invalid', async () => {
      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getProjectImagesWithThumbnails);

      const res = await request(app)
        .get(`/${PROJECT_ID}`)
        .query({ lod: 'ultra' })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when SharingService denies access', async () => {
      vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
        hasAccess: false,
      } as any);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getProjectImagesWithThumbnails);

      const res = await request(app).get(`/${PROJECT_ID}`).expect(404);
      expect(res.body.success).toBe(false);
      expect(SharingService.hasProjectAccess).toHaveBeenCalledWith(
        PROJECT_ID,
        USER_ID
      );
    });

    it('returns 200 with pagination metadata and empty images for empty project', async () => {
      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getProjectImagesWithThumbnails);

      const res = await request(app)
        .get(`/${PROJECT_ID}`)
        .query({ page: '1', limit: '10' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.images).toHaveLength(0);
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.pagination.limit).toBe(10);
      expect(res.body.data.pagination.total).toBe(0);
      expect(res.body.data.pagination.pages).toBe(0);
      expect(res.body.data.metadata.projectChannels).toEqual([]);
    });

    it('filters video containers (isVideoContainer: false) in the Prisma query', async () => {
      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getProjectImagesWithThumbnails);

      await request(app).get(`/${PROJECT_ID}`).expect(200);

      // Both findMany calls should include isVideoContainer:false (gallery filter)
      // or isVideoContainer:true (channel aggregation). The first call is gallery.
      const galleryCall = vi.mocked(prisma.image.findMany).mock.calls[0];
      expect(galleryCall[0]?.where).toMatchObject({
        projectId: PROJECT_ID,
        isVideoContainer: false,
      });
    });

    it('aggregates projectChannels from video container rows', async () => {
      // Gallery images (frames) come first; container rows come from the 2nd findMany
      vi.mocked(prisma.image.findMany)
        .mockResolvedValueOnce([makePrismaImage()]) // gallery: one frame
        .mockResolvedValueOnce([
          // containers: one with channels
          { channels: [{ name: 'DAPI' }, { name: 'GFP' }] },
          { channels: [{ name: 'GFP' }] }, // duplicate — should be deduped
        ] as any);
      vi.mocked(prisma.image.count).mockResolvedValue(1);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getProjectImagesWithThumbnails);

      const res = await request(app).get(`/${PROJECT_ID}`).expect(200);

      // Distinct, sorted
      expect(res.body.data.metadata.projectChannels).toEqual(['DAPI', 'GFP']);
    });

    it('bubbles calibration from parent container onto frame rows', async () => {
      const PARENT_ID = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee';
      const frameImage = makePrismaImage({
        parentVideoId: PARENT_ID,
        pixelSizeUm: null, // frame itself has no calibration
        frameIntervalMs: null,
      });

      // Gallery query returns the frame; container query for channels returns []
      vi.mocked(prisma.image.findMany)
        .mockResolvedValueOnce([frameImage as any]) // gallery
        .mockResolvedValueOnce([
          // parent calibration lookup
          { id: PARENT_ID, pixelSizeUm: 0.65, frameIntervalMs: 200 },
        ] as any)
        .mockResolvedValueOnce([]); // project containers for channels

      // count() is called once
      vi.mocked(prisma.image.count).mockResolvedValue(1);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getProjectImagesWithThumbnails);

      const res = await request(app).get(`/${PROJECT_ID}`).expect(200);

      const returnedFrame = res.body.data.images[0];
      expect(returnedFrame.pixelSizeUm).toBe(0.65);
      expect(returnedFrame.frameIntervalMs).toBe(200);
    });

    it('uses displayUrl=/api/images/:id/display for frame images (parentVideoId set)', async () => {
      const PARENT_ID = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee';
      const frameImage = makePrismaImage({ parentVideoId: PARENT_ID });

      vi.mocked(prisma.image.findMany)
        .mockResolvedValueOnce([frameImage as any])
        .mockResolvedValueOnce([
          { id: PARENT_ID, pixelSizeUm: null, frameIntervalMs: null },
        ] as any)
        .mockResolvedValueOnce([]);
      vi.mocked(prisma.image.count).mockResolvedValue(1);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getProjectImagesWithThumbnails);

      const res = await request(app).get(`/${PROJECT_ID}`).expect(200);

      expect(res.body.data.images[0].url).toBe(
        `/api/images/${IMAGE_ID}/display`
      );
    });

    it('returns LOD=low with empty polygons array when segmentation exists', async () => {
      const polygons = [{ id: 'p1', points: [{ x: 0, y: 0 }] }];
      const imageWithSeg = makePrismaImage({
        segmentation: {
          polygons: JSON.stringify(polygons),
          imageWidth: 800,
          imageHeight: 600,
        },
      });

      vi.mocked(prisma.image.findMany)
        .mockResolvedValueOnce([imageWithSeg as any])
        .mockResolvedValueOnce([]);
      vi.mocked(prisma.image.count).mockResolvedValue(1);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getProjectImagesWithThumbnails);

      const res = await request(app)
        .get(`/${PROJECT_ID}`)
        .query({ lod: 'low' })
        .expect(200);

      const seg = res.body.data.images[0].segmentationResult;
      expect(seg.polygons).toEqual([]); // stripped for low LOD
      expect(seg.polygonCount).toBe(1); // count still present
    });

    it('returns full polygon data for LOD=high', async () => {
      const polygons = [{ id: 'p1', points: [{ x: 0, y: 0 }] }];
      const imageWithSeg = makePrismaImage({
        segmentation: {
          polygons: JSON.stringify(polygons),
          imageWidth: 800,
          imageHeight: 600,
        },
      });

      vi.mocked(prisma.image.findMany)
        .mockResolvedValueOnce([imageWithSeg as any])
        .mockResolvedValueOnce([]);
      vi.mocked(prisma.image.count).mockResolvedValue(1);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getProjectImagesWithThumbnails);

      const res = await request(app)
        .get(`/${PROJECT_ID}`)
        .query({ lod: 'high' })
        .expect(200);

      const seg = res.body.data.images[0].segmentationResult;
      expect(seg.polygons).toEqual(polygons);
    });

    it('falls back to safe default when segmentation JSON is corrupted', async () => {
      const imageWithBadSeg = makePrismaImage({
        segmentation: {
          polygons: 'NOT_JSON',
          imageWidth: 800,
          imageHeight: 600,
        },
      });

      vi.mocked(prisma.image.findMany)
        .mockResolvedValueOnce([imageWithBadSeg as any])
        .mockResolvedValueOnce([]);
      vi.mocked(prisma.image.count).mockResolvedValue(1);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.get('/:id', controller.getProjectImagesWithThumbnails);

      // Should NOT 500 — the controller catches parse errors and uses a safe default
      const res = await request(app).get(`/${PROJECT_ID}`).expect(200);
      const seg = res.body.data.images[0].segmentationResult;
      expect(seg.polygonCount).toBe(0);
      expect(seg.polygons).toEqual([]);
    });
  });

  // ── getImageForDisplay ─────────────────────────────────────────────────────

  describe('getImageForDisplay', () => {
    it('returns 400 when imageId param is missing', async () => {
      // Build a route without :imageId param
      const app = express();
      app.get('/', controller.getImageForDisplay);
      const res = await request(app).get('/').expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when service throws error containing "nenalezen"', async () => {
      imageServiceInstance.getBrowserCompatibleImage.mockRejectedValue(
        new Error('Image nenalezen in storage')
      );

      const app = express();
      app.use(express.json());
      app.get('/:imageId', controller.getImageForDisplay);

      const res = await request(app).get(`/${IMAGE_ID}`).expect(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 for other service errors', async () => {
      imageServiceInstance.getBrowserCompatibleImage.mockRejectedValue(
        new Error('S3 timeout')
      );

      const app = express();
      app.use(express.json());
      app.get('/:imageId', controller.getImageForDisplay);

      const res = await request(app).get(`/${IMAGE_ID}`).expect(500);
      expect(res.body.success).toBe(false);
    });

    it('sets Content-Type and returns image buffer on success', async () => {
      const fakeBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
      imageServiceInstance.getBrowserCompatibleImage.mockResolvedValue({
        buffer: fakeBuffer,
        mimeType: 'image/png',
        filename: 'cell.png',
      });

      // getImageForDisplay doesn't require authentication
      const app = express();
      app.get('/:imageId', controller.getImageForDisplay);

      const res = await request(app).get(`/${IMAGE_ID}`).expect(200);
      expect(res.headers['content-type']).toMatch(/image\/png/);
      expect(res.headers['cache-control']).toMatch(/max-age=31536000/);
    });
  });

  // ── reorderImages ──────────────────────────────────────────────────────────

  describe('reorderImages', () => {
    const validBody = { imageIds: [IMAGE_ID], mode: 'all' };

    it('returns 401 when unauthenticated', async () => {
      const app = buildUnauthApp(controller.reorderImages);
      const res = await request(app).patch('/').send(validBody).expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with reordered count and mode on success', async () => {
      imageServiceInstance.reorderImages.mockResolvedValue(undefined);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.patch('/:id', controller.reorderImages);

      const res = await request(app)
        .patch(`/${PROJECT_ID}`)
        .send(validBody)
        .expect(200);

      expect(res.body.success).toBe(true);
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

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.patch('/:id', controller.reorderImages);

      const res = await request(app)
        .patch(`/${PROJECT_ID}`)
        .send({ imageIds: [IMAGE_ID] })
        .expect(200);

      expect(res.body.data.mode).toBe('all');
    });

    it('returns 409 on Prisma P2025 (record not found mid-drag)', async () => {
      const { Prisma } = await import('@prisma/client');
      const prismaErr = new Prisma.PrismaClientKnownRequestError(
        'Record not found',
        {
          code: 'P2025',
          clientVersion: '5.0.0',
        }
      );
      imageServiceInstance.reorderImages.mockRejectedValue(prismaErr);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.patch('/:id', controller.reorderImages);

      const res = await request(app)
        .patch(`/${PROJECT_ID}`)
        .send(validBody)
        .expect(409);
      expect(res.body.success).toBe(false);
    });

    it('returns 409 on Prisma P2034 (serialization conflict)', async () => {
      const { Prisma } = await import('@prisma/client');
      const prismaErr = new Prisma.PrismaClientKnownRequestError(
        'Serialization failure',
        {
          code: 'P2034',
          clientVersion: '5.0.0',
        }
      );
      imageServiceInstance.reorderImages.mockRejectedValue(prismaErr);

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.patch('/:id', controller.reorderImages);

      const res = await request(app)
        .patch(`/${PROJECT_ID}`)
        .send(validBody)
        .expect(409);
      expect(res.body.success).toBe(false);
    });

    it('passes ApiError status through for service-level errors', async () => {
      imageServiceInstance.reorderImages.mockRejectedValue(
        ApiError.forbidden('Not project owner')
      );

      const app = express();
      app.use(express.json());
      app.use((req: express.Request & { user?: unknown }, _res, next) => {
        req.user = { id: USER_ID };
        next();
      });
      app.patch('/:id', controller.reorderImages);

      const res = await request(app)
        .patch(`/${PROJECT_ID}`)
        .send(validBody)
        .expect(403);
      expect(res.body.success).toBe(false);
    });
  });

  // ── uploadImages (additional guards not covered by existing tests) ─────────

  describe('uploadImages (guard paths)', () => {
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

    it('returns 401 when unauthenticated', async () => {
      const app = express();
      app.use(express.json());
      app.post('/:id', controller.uploadImages);
      const res = await request(app).post(`/${PROJECT_ID}`).expect(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when files array is empty', async () => {
      const app = buildUploadApp([]);
      const res = await request(app).post(`/${PROJECT_ID}`).expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when a file has invalid MIME type', async () => {
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

    it('returns 400 when a file exceeds size limit', async () => {
      const app = buildUploadApp([
        {
          fieldname: 'images',
          originalname: 'huge.png',
          mimetype: 'image/png',
          buffer: Buffer.alloc(100 * 1024 * 1024),
          size: 100 * 1024 * 1024, // 100 MB
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
  });
});
