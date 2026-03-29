import request from 'supertest';
import express from 'express';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { segmentationRoutes } from '../segmentationRoutes';
import { authenticate } from '../../../middleware/auth';
import { logger } from '../../../utils/logger';
import { ResponseHelper } from '../../../utils/response';
import { prisma as _prisma } from '../../../db';

// Mock all dependencies before imports
jest.mock('../../../middleware/auth');
jest.mock('../../../utils/logger');
jest.mock('../../../utils/response', () => ({
  asyncHandler: (fn: any) => fn,
  ResponseHelper: {
    success: jest.fn(),
    notFound: jest.fn(),
    unauthorized: jest.fn(),
    forbidden: jest.fn(),
    badRequest: jest.fn(),
    internalError: jest.fn(),
    validationError: jest.fn(),
    conflict: jest.fn(),
    rateLimit: jest.fn(),
    serviceUnavailable: jest.fn(),
    error: jest.fn(),
    paginated: jest.fn(),
  },
}));
jest.mock('../../../db');
jest.mock('../../../services/segmentationService');
jest.mock('../../../services/imageService');
jest.mock('../../../utils/config', () => ({
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

const mockedAuthenticate = authenticate as jest.MockedFunction<
  typeof authenticate
>;
const MockedResponseHelper = ResponseHelper as jest.Mocked<typeof ResponseHelper>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  emailVerified: true,
};

const validImageId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const invalidImageId = 'not-a-valid-uuid';

describe('Segmentation Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());

    // Default: auth passes through with user injected
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
    (MockedResponseHelper.success as jest.Mock).mockImplementation(
      (res: express.Response, data: unknown, message: string, statusCode: number = 200) => {
        return res.status(statusCode).json({ success: true, data, message });
      }
    );
    (MockedResponseHelper.notFound as jest.Mock).mockImplementation(
      (res: express.Response, message: string) => {
        return res.status(404).json({ success: false, error: message });
      }
    );
    (MockedResponseHelper.unauthorized as jest.Mock).mockImplementation(
      (res: express.Response, message: string) => {
        return res.status(401).json({ success: false, error: message });
      }
    );
    (MockedResponseHelper.badRequest as jest.Mock).mockImplementation(
      (res: express.Response, message: string) => {
        return res.status(400).json({ success: false, error: message });
      }
    );
    (MockedResponseHelper.validationError as jest.Mock).mockImplementation(
      (res: express.Response, errors: unknown) => {
        return res.status(400).json({ success: false, errors });
      }
    );
    (MockedResponseHelper.internalError as jest.Mock).mockImplementation(
      (res: express.Response, _err: unknown, message: string) => {
        return res.status(500).json({ success: false, error: message });
      }
    );

    mockedLogger.info = jest.fn() as jest.MockedFunction<typeof logger.info>;
    mockedLogger.error = jest.fn() as jest.MockedFunction<typeof logger.error>;
    mockedLogger.debug = jest.fn() as jest.MockedFunction<typeof logger.debug>;

    app.use('/api/segmentation', segmentationRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/segmentation/images/:imageId/results', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .get(`/api/segmentation/images/${validImageId}/results`)
        .expect(401);
    });

    it('should reject non-UUID imageId with 400', async () => {
      const response = await request(app)
        .get(`/api/segmentation/images/${invalidImageId}/results`)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should accept valid UUID imageId and proceed to controller', async () => {
      // Controller will call getSegmentationResults — mock returns 404 (no results)
      const response = await request(app)
        .get(`/api/segmentation/images/${validImageId}/results`)
        .expect(404);

      // 404 means auth and validation passed, controller ran, service returned null
      expect(response.body.success).toBe(false);
    });

    it('should pass auth middleware before reaching controller', async () => {
      await request(app)
        .get(`/api/segmentation/images/${validImageId}/results`)
        .set('Authorization', 'Bearer valid-token');

      expect(mockedAuthenticate).toHaveBeenCalled();
    });
  });

  describe('PUT /api/segmentation/images/:imageId/results', () => {
    const validPolygons = [
      {
        id: 'poly-1',
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
        type: 'external',
      },
    ];

    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .put(`/api/segmentation/images/${validImageId}/results`)
        .send({ polygons: validPolygons })
        .expect(401);
    });

    it('should reject non-UUID imageId', async () => {
      const response = await request(app)
        .put(`/api/segmentation/images/${invalidImageId}/results`)
        .send({ polygons: validPolygons })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should reject request without polygons array', async () => {
      const response = await request(app)
        .put(`/api/segmentation/images/${validImageId}/results`)
        .send({ polygons: 'not-an-array' })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should validate optional imageWidth as positive integer', async () => {
      const response = await request(app)
        .put(`/api/segmentation/images/${validImageId}/results`)
        .send({ polygons: validPolygons, imageWidth: -5 })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });
  });

  describe('DELETE /api/segmentation/images/:imageId/results', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .delete(`/api/segmentation/images/${validImageId}/results`)
        .expect(401);
    });

    it('should reject non-UUID imageId', async () => {
      const response = await request(app)
        .delete(`/api/segmentation/images/${invalidImageId}/results`)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should proceed to controller with valid UUID', async () => {
      const response = await request(app)
        .delete(`/api/segmentation/images/${validImageId}/results`);

      // 200 or 500 — auth and UUID validation passed
      expect([200, 500]).toContain(response.status);
    });
  });

  describe('POST /api/segmentation/batch', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .post('/api/segmentation/batch')
        .send({ imageIds: [validImageId] })
        .expect(401);
    });

    it('should reject empty imageIds array', async () => {
      const response = await request(app)
        .post('/api/segmentation/batch')
        .send({ imageIds: [] })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should reject non-UUID entries in imageIds', async () => {
      const response = await request(app)
        .post('/api/segmentation/batch')
        .send({ imageIds: ['not-a-uuid'] })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should reject invalid model value', async () => {
      const response = await request(app)
        .post('/api/segmentation/batch')
        .send({ imageIds: [validImageId], model: 'invalid_model' })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should reject threshold out of range', async () => {
      const response = await request(app)
        .post('/api/segmentation/batch')
        .send({ imageIds: [validImageId], threshold: 0.05 })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should reject duplicate imageIds', async () => {
      const response = await request(app)
        .post('/api/segmentation/batch')
        .send({ imageIds: [validImageId, validImageId] })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });
  });

  describe('POST /api/segmentation/batch/results', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .post('/api/segmentation/batch/results')
        .send({ imageIds: [validImageId] })
        .expect(401);
    });

    it('should reject empty imageIds', async () => {
      const response = await request(app)
        .post('/api/segmentation/batch/results')
        .send({ imageIds: [] })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should reject non-UUID imageIds', async () => {
      const response = await request(app)
        .post('/api/segmentation/batch/results')
        .send({ imageIds: ['not-a-uuid'] })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });
  });
});
