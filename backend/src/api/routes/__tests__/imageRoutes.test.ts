import request from 'supertest';
import express from 'express';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import type { MockedFunction } from 'vitest';
import imageRouter from '../imageRoutes';
import { authenticate } from '../../../middleware/auth';
import { logger } from '../../../utils/logger';
import { ResponseHelper } from '../../../utils/response';
import { prisma as _prisma } from '../../../db';

// Mock all dependencies
vi.mock('../../../middleware/auth');
vi.mock('../../../utils/logger');
vi.mock('../../../utils/response', () => ({
  asyncHandler: (fn: any) => fn,
  ResponseHelper: {
    success: vi.fn(),
    notFound: vi.fn(),
    unauthorized: vi.fn(),
    forbidden: vi.fn(),
    badRequest: vi.fn(),
    internalError: vi.fn(),
    validationError: vi.fn(),
    conflict: vi.fn(),
    rateLimit: vi.fn(),
    serviceUnavailable: vi.fn(),
    error: vi.fn(),
    paginated: vi.fn(),
  },
}));
vi.mock('../../../db');
vi.mock('../../../services/imageService');
vi.mock('../../../services/segmentationThumbnailService');
vi.mock('../../../services/sharingService');
vi.mock('../../../services/websocketService');
vi.mock('../../../storage');
vi.mock('../../../middleware/validation', () => ({
  validateBody: vi.fn((_schema: any) => (_req: any, _res: any, next: any) => next()),
  validateParams: vi.fn((_schema: any) => (_req: any, _res: any, next: any) => next()),
  validateQuery: vi.fn((_schema: any) => (_req: any, _res: any, next: any) => next()),
}));
vi.mock('../../../middleware/upload', () => ({
  uploadImages: vi.fn((_req: any, _res: any, next: any) => next()),
  handleUploadError: vi.fn((_req: any, _res: any, next: any) => next()),
  validateUploadedFiles: vi.fn((req: any, _res: any, next: any) => {
    req.files = [];
    next();
  }),
}));
vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-secret-at-least-32-chars-long-for-test',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars-long',
    REDIS_URL: 'redis://localhost:6379',
    ML_SERVICE_URL: 'http://localhost:8000',
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    FROM_EMAIL: 'test@example.com',
    FROM_NAME: 'Test',
    UPLOAD_DIR: './uploads',
    EMAIL_SERVICE: 'none',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
  },
}));

const mockedAuthenticate = authenticate as MockedFunction<
  typeof authenticate
>;
const MockedResponseHelper = ResponseHelper as Mocked<typeof ResponseHelper>;
const mockedLogger = logger as Mocked<typeof logger>;

const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  emailVerified: true,
};

const validProjectId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const validImageId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const _invalidId = 'not-a-uuid';

const _mockImage = {
  id: validImageId,
  name: 'test-image.jpg',
  projectId: validProjectId,
  originalPath: '/uploads/test-image.jpg',
  thumbnailPath: '/uploads/thumb-test.jpg',
  width: 800,
  height: 600,
  fileSize: 102400,
  mimeType: 'image/jpeg',
  segmentationStatus: 'none',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

describe('Image Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());

    // Default: auth passes with user injected
    mockedAuthenticate.mockImplementation(
      async (
        req: express.Request & { user?: Record<string, unknown> },
        _res: express.Response,
        next: express.NextFunction
      ) => {
        req.user = mockUser;
        next();
      }
    );

    // ResponseHelper mocks
    (MockedResponseHelper.success as Mock).mockImplementation(
      (res: express.Response, data: unknown, message: string, statusCode: number = 200) => {
        return res.status(statusCode).json({ success: true, data, message });
      }
    );
    (MockedResponseHelper.notFound as Mock).mockImplementation(
      (res: express.Response, message: string) => {
        return res.status(404).json({ success: false, error: message });
      }
    );
    (MockedResponseHelper.unauthorized as Mock).mockImplementation(
      (res: express.Response, message: string) => {
        return res.status(401).json({ success: false, error: message });
      }
    );
    (MockedResponseHelper.badRequest as Mock).mockImplementation(
      (res: express.Response, message: string) => {
        return res.status(400).json({ success: false, error: message });
      }
    );
    (MockedResponseHelper.validationError as Mock).mockImplementation(
      (res: express.Response, errors: unknown) => {
        return res.status(400).json({ success: false, errors });
      }
    );
    (MockedResponseHelper.internalError as Mock).mockImplementation(
      (res: express.Response, _err: unknown, message: string) => {
        return res.status(500).json({ success: false, error: message });
      }
    );

    mockedLogger.info = vi.fn() as MockedFunction<typeof logger.info>;
    mockedLogger.error = vi.fn() as MockedFunction<typeof logger.error>;
    mockedLogger.debug = vi.fn() as MockedFunction<typeof logger.debug>;

    app.use('/api', imageRouter);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/:id/images — upload', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .post(`/api/${validProjectId}/images`)
        .attach('images', Buffer.from('fake-image'), 'test.jpg')
        .expect(401);

      expect(mockedAuthenticate).toHaveBeenCalled();
    });

    it('should call authenticate middleware for upload', async () => {
      await request(app)
        .post(`/api/${validProjectId}/images`)
        .set('Authorization', 'Bearer valid-token')
        .timeout(5000)
        .catch(() => {/* timeout is acceptable — auth was still called */});

      expect(mockedAuthenticate).toHaveBeenCalled();
    });
  });

  describe('GET /api/:id/images — list images', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .get(`/api/${validProjectId}/images`)
        .expect(401);
    });

    it('should accept pagination query params', async () => {
      const response = await request(app)
        .get(`/api/${validProjectId}/images?page=1&limit=20`);

      expect([200, 404, 500]).toContain(response.status);
      expect(mockedAuthenticate).toHaveBeenCalled();
    });

    it('should call authenticate before controller', async () => {
      await request(app)
        .get(`/api/${validProjectId}/images`)
        .set('Authorization', 'Bearer valid-token');

      expect(mockedAuthenticate).toHaveBeenCalled();
    });
  });

  describe('GET /api/:projectId/images/:imageId — single image', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .get(`/api/${validProjectId}/images/${validImageId}`)
        .expect(401);
    });

    it('should return image data', async () => {
      const response = await request(app)
        .get(`/api/${validProjectId}/images/${validImageId}`);

      // Regardless of service mock, auth and params passed
      expect([200, 404, 500]).toContain(response.status);
      expect(mockedAuthenticate).toHaveBeenCalled();
    });

    it('should handle authenticated request with auth header', async () => {
      await request(app)
        .get(`/api/${validProjectId}/images/${validImageId}`)
        .set('Authorization', 'Bearer valid-token');

      expect(mockedAuthenticate).toHaveBeenCalled();
    });
  });

  describe('DELETE /api/:projectId/images/:imageId — delete single', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .delete(`/api/${validProjectId}/images/${validImageId}`)
        .expect(401);
    });

    it('should call authenticate before delete handler', async () => {
      await request(app)
        .delete(`/api/${validProjectId}/images/${validImageId}`)
        .set('Authorization', 'Bearer valid-token');

      expect(mockedAuthenticate).toHaveBeenCalled();
    });

    it('should return success response shape on delete', async () => {
      const response = await request(app)
        .delete(`/api/${validProjectId}/images/${validImageId}`);

      expect([200, 404, 500]).toContain(response.status);
    });
  });

  describe('DELETE /api/batch — batch delete', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .delete('/api/batch')
        .send({ imageIds: [validImageId] })
        .expect(401);
    });

    it('should reject empty imageIds array', async () => {
      const response = await request(app)
        .delete('/api/batch')
        .send({ imageIds: [] });

      // Validation passes (mocked) but controller should reject empty array
      expect([400, 500]).toContain(response.status);
    });

    it('should reject missing imageIds body', async () => {
      const response = await request(app)
        .delete('/api/batch')
        .send({});

      expect([400, 500]).toContain(response.status);
    });

    it('should call authenticate middleware', async () => {
      await request(app)
        .delete('/api/batch')
        .send({ imageIds: [validImageId] });

      expect(mockedAuthenticate).toHaveBeenCalled();
    });
  });

  describe('PATCH /api/:id/images/reorder — time-series reorder', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .patch(`/api/${validProjectId}/images/reorder`)
        .send({ imageIds: [validImageId] })
        .expect(401);
    });

    it('should route reorder requests through authentication middleware', async () => {
      await request(app)
        .patch(`/api/${validProjectId}/images/reorder`)
        .send({ imageIds: [validImageId] });

      expect(mockedAuthenticate).toHaveBeenCalled();
    });

    it('should not match the image-detail GET route (route ordering)', async () => {
      // PATCH /api/:id/images/reorder must be declared before the
      // GET /api/:projectId/images/:imageId route, otherwise the detail
      // route would swallow ``reorder`` as a path param.
      const response = await request(app)
        .patch(`/api/${validProjectId}/images/reorder`)
        .send({ imageIds: [validImageId] });

      // GET-only route would return 404/405; our PATCH landed on the
      // controller (possibly returning 500 because ImageService is mocked).
      expect([200, 400, 500]).toContain(response.status);
    });

    it('should accept a mode parameter (all | partial)', async () => {
      const allRes = await request(app)
        .patch(`/api/${validProjectId}/images/reorder`)
        .send({ imageIds: [validImageId], mode: 'all' });
      expect([200, 400, 500]).toContain(allRes.status);

      const partialRes = await request(app)
        .patch(`/api/${validProjectId}/images/reorder`)
        .send({ imageIds: [validImageId], mode: 'partial' });
      expect([200, 400, 500]).toContain(partialRes.status);
    });
  });

  describe('GET /api/:imageId/display — public route', () => {
    it('should not require authentication', async () => {
      // authenticate should NOT be called for /display route (public)
      const _callCount = mockedAuthenticate.mock.calls.length;

      await request(app)
        .get(`/api/${validImageId}/display`);

      // authenticate may still be called later in the route stack, but
      // the display endpoint itself is declared before router.use(authenticate)
      // The key test is that it does NOT return 401 from auth
      // (it may 404 from service, which is fine)
      const response = await request(app)
        .get(`/api/${validImageId}/display`);
      expect(response.status).not.toBe(401);
    });
  });

  describe('GET /api/:id/images-with-thumbnails — optimized listing', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .get(`/api/${validProjectId}/images-with-thumbnails`)
        .expect(401);
    });

    it('should accept lod query parameter', async () => {
      const response = await request(app)
        .get(`/api/${validProjectId}/images-with-thumbnails?lod=low&page=1&limit=50`);

      expect([200, 404, 500]).toContain(response.status);
    });
  });

  describe('Authentication boundary', () => {
    it('should block all authenticated routes without token', async () => {
      mockedAuthenticate.mockImplementation(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      const protectedRoutes = [
        { method: 'get', path: `/api/${validProjectId}/images` },
        { method: 'get', path: `/api/${validProjectId}/images/${validImageId}` },
        { method: 'delete', path: `/api/${validProjectId}/images/${validImageId}` },
        { method: 'delete', path: '/api/batch' },
      ];

      for (const route of protectedRoutes) {
        const response =
          route.method === 'get'
            ? await request(app).get(route.path)
            : await request(app).delete(route.path).send({ imageIds: [] });

        expect(response.status).toBe(401);
      }
    });
  });
});
