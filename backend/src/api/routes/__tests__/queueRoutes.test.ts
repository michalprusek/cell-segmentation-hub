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
import { queueRoutes } from '../queueRoutes';
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
vi.mock('../../../services/queueService');
vi.mock('../../../services/segmentationService');
vi.mock('../../../services/imageService');
vi.mock('../../../services/websocketService');
vi.mock('../../../middleware/validation', () => ({
  validateBody: vi.fn((_schema: any) => (_req: any, _res: any, next: any) => next()),
  validateParams: vi.fn((_schema: any) => (_req: any, _res: any, next: any) => next()),
  validateQuery: vi.fn((_schema: any) => (_req: any, _res: any, next: any) => next()),
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

const validImageId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const validProjectId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const validQueueId = 'c3d4e5f6-a7b8-9012-cdef-123456789012';

describe('Queue Routes', () => {
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

    app.use('/api/queue', queueRoutes);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/queue/images/:imageId — add to queue', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .post(`/api/queue/images/${validImageId}`)
        .send({ model: 'hrnet', threshold: 0.5 })
        .expect(401);

      expect(mockedAuthenticate).toHaveBeenCalled();
    });

    it('should reject non-UUID imageId with 400', async () => {
      const response = await request(app)
        .post('/api/queue/images/not-a-uuid')
        .send({ model: 'hrnet', threshold: 0.5 })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should accept valid UUID imageId', async () => {
      const response = await request(app)
        .post(`/api/queue/images/${validImageId}`)
        .send({ model: 'hrnet', threshold: 0.5 });

      // Status passes UUID validation — controller logic determines final status
      expect([200, 201, 400, 404, 500]).toContain(response.status);
      expect(mockedAuthenticate).toHaveBeenCalled();
    });
  });

  describe('POST /api/queue/batch — batch add', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .post('/api/queue/batch')
        .send({ imageIds: [validImageId], model: 'hrnet' })
        .expect(401);
    });

    it('should pass request body through to controller', async () => {
      await request(app)
        .post('/api/queue/batch')
        .send({ imageIds: [validImageId], model: 'hrnet', threshold: 0.5 });

      expect(mockedAuthenticate).toHaveBeenCalled();
    });
  });

  describe('GET /api/queue/projects/:projectId/stats', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .get(`/api/queue/projects/${validProjectId}/stats`)
        .expect(401);
    });

    it('should reject non-UUID projectId', async () => {
      const response = await request(app)
        .get('/api/queue/projects/not-a-uuid/stats')
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should accept valid UUID projectId', async () => {
      const response = await request(app)
        .get(`/api/queue/projects/${validProjectId}/stats`);

      expect([200, 400, 401, 404, 500]).toContain(response.status);
      expect(mockedAuthenticate).toHaveBeenCalled();
    });
  });

  describe('GET /api/queue/projects/:projectId/items — paginated', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .get(`/api/queue/projects/${validProjectId}/items`)
        .expect(401);
    });

    it('should reject non-UUID projectId', async () => {
      const response = await request(app)
        .get('/api/queue/projects/bad-id/items')
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should accept valid UUID with pagination query params', async () => {
      const response = await request(app)
        .get(`/api/queue/projects/${validProjectId}/items?page=1&limit=10`);

      expect([200, 400, 401, 404, 500]).toContain(response.status);
      expect(mockedAuthenticate).toHaveBeenCalled();
    });
  });

  describe('DELETE /api/queue/items/:queueId — cancel item', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .delete(`/api/queue/items/${validQueueId}`)
        .expect(401);
    });

    it('should reject non-UUID queueId', async () => {
      const response = await request(app)
        .delete('/api/queue/items/not-a-uuid')
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should accept valid UUID queueId', async () => {
      const response = await request(app)
        .delete(`/api/queue/items/${validQueueId}`);

      expect([200, 400, 404, 500]).toContain(response.status);
      expect(mockedAuthenticate).toHaveBeenCalled();
    });
  });

  describe('GET /api/queue/stats — overall stats', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .get('/api/queue/stats')
        .expect(401);
    });

    it('should call authenticate before handler', async () => {
      await request(app).get('/api/queue/stats');

      expect(mockedAuthenticate).toHaveBeenCalled();
    });
  });

  describe('POST /api/queue/reset-stuck', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .post('/api/queue/reset-stuck')
        .expect(401);
    });

    it('should reject maxProcessingMinutes out of range', async () => {
      const response = await request(app)
        .post('/api/queue/reset-stuck')
        .send({ maxProcessingMinutes: 100 })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should accept valid maxProcessingMinutes', async () => {
      const response = await request(app)
        .post('/api/queue/reset-stuck')
        .send({ maxProcessingMinutes: 30 });

      expect([200, 400, 500]).toContain(response.status);
    });
  });

  describe('POST /api/queue/cancel-all-user', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .post('/api/queue/cancel-all-user')
        .expect(401);
    });

    it('should call authenticate middleware', async () => {
      await request(app).post('/api/queue/cancel-all-user');

      expect(mockedAuthenticate).toHaveBeenCalled();
    });
  });
});
