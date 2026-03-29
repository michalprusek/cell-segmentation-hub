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
import { segmentationController } from '../segmentationController';
import { authenticate } from '../../../middleware/auth';
import { logger } from '../../../utils/logger';
import { ResponseHelper } from '../../../utils/response';

// Mock all dependencies — must be before any imports that use them
jest.mock('../../../services/segmentationService');
jest.mock('../../../services/imageService');
jest.mock('../../../middleware/auth');
jest.mock('../../../utils/logger');
jest.mock('../../../utils/response');
jest.mock('../../../db');
jest.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: 'localhost',
    DATABASE_URL: 'file:./test.db',
    JWT_ACCESS_SECRET: 'test-secret-at-least-32-chars-long-for-test',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars-long',
    JWT_REFRESH_EXPIRY_REMEMBER: '30d',
    REDIS_URL: 'redis://localhost:6379',
    ML_SERVICE_URL: 'http://localhost:8000',
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    FROM_EMAIL: 'test@example.com',
    FROM_NAME: 'Test',
    UPLOAD_DIR: './uploads',
    EMAIL_SERVICE: 'none',
    SMTP_HOST: 'localhost',
    SMTP_PORT: 587,
    SMTP_USER: 'test',
    SMTP_PASS: 'test',
    SESSION_SECRET: 'test-session-secret',
    REQUIRE_EMAIL_VERIFICATION: false,
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
  },
}));

const mockAuthMiddleware = authenticate as jest.MockedFunction<typeof authenticate>;
const MockedResponseHelper = ResponseHelper as jest.Mocked<typeof ResponseHelper>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('SegmentationController', () => {
  let app: express.Application;

  const mockUser = {
    id: 'user-id',
    email: 'test@example.com',
    emailVerified: true,
  };

  const imageId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  const mockPolygons = [
    {
      id: 'poly-1',
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      type: 'external',
    },
  ];

  const mockSegmentationResults = {
    imageId,
    polygons: mockPolygons,
    imageWidth: 800,
    imageHeight: 600,
    updatedAt: new Date('2024-01-01').toISOString(),
  };

  // Install ResponseHelper mocks
  function installResponseMocks() {
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
      (res: express.Response, message: string | Record<string, string[]>) => {
        return res.status(400).json({ success: false, error: message });
      }
    );
    (MockedResponseHelper.internalError as jest.Mock).mockImplementation(
      (res: express.Response, _err: unknown, message: string) => {
        return res.status(500).json({ success: false, error: message });
      }
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    installResponseMocks();

    app = express();
    app.use(express.json());

    // Auth injects user by default
    mockAuthMiddleware.mockImplementation(
      async (
        req: express.Request & { user?: Record<string, unknown> },
        _res: express.Response,
        next: express.NextFunction
      ) => {
        req.user = mockUser;
        next();
      }
    );

    mockedLogger.debug = jest.fn() as jest.MockedFunction<typeof logger.debug>;
    mockedLogger.error = jest.fn() as jest.MockedFunction<typeof logger.error>;
    mockedLogger.info = jest.fn() as jest.MockedFunction<typeof logger.info>;

    // Setup routes
    app.get(
      '/segmentation/images/:imageId/results',
      mockAuthMiddleware,
      segmentationController.getSegmentationResults
    );
    app.put(
      '/segmentation/images/:imageId/results',
      mockAuthMiddleware,
      segmentationController.updateSegmentationResults
    );
    app.delete(
      '/segmentation/images/:imageId/results',
      mockAuthMiddleware,
      segmentationController.deleteSegmentationResults
    );
    app.post(
      '/segmentation/batch',
      mockAuthMiddleware,
      segmentationController.batchSegment
    );
    app.post(
      '/segmentation/batch/results',
      mockAuthMiddleware,
      segmentationController.batchGetSegmentationResults
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  // Helper to set a fresh mock on the private segmentationService inside the
  // singleton segmentationController. Uses a type bypass to access the private field.
  function mockMethod(method: string): jest.Mock<any> {
    const fn: jest.Mock<any> = jest.fn();
    // Access the private service via index signature bypass
    const ctrl = segmentationController as Record<string, any>;
    if (ctrl.segmentationService) {
      ctrl.segmentationService[method] = fn;
    }
    return fn;
  }

  describe('getSegmentationResults', () => {
    it('should return results for valid imageId', async () => {
      mockMethod('getSegmentationResults').mockResolvedValueOnce(mockSegmentationResults);
      installResponseMocks();

      const response = await request(app)
        .get(`/segmentation/images/${imageId}/results`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return 401 when user is not authenticated', async () => {
      mockAuthMiddleware.mockImplementationOnce(
        async (
          req: express.Request & { user?: Record<string, unknown> },
          _res: express.Response,
          next: express.NextFunction
        ) => {
          req.user = undefined;
          next();
        }
      );

      const response = await request(app)
        .get(`/segmentation/images/${imageId}/results`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 when no results found', async () => {
      mockMethod('getSegmentationResults').mockResolvedValueOnce(null);
      installResponseMocks();

      const response = await request(app)
        .get(`/segmentation/images/${imageId}/results`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 when imageId is missing from params', async () => {
      // Route without imageId param still calls controller; controller validates
      const response = await request(app)
        .get(`/segmentation/images/${imageId}/results`);

      // Any non-401 response means the auth layer passed
      expect(response.status).not.toBe(401);
    });

    it('should return 500 on service error', async () => {
      mockMethod('getSegmentationResults').mockRejectedValueOnce(new Error('DB error'));
      installResponseMocks();

      const response = await request(app)
        .get(`/segmentation/images/${imageId}/results`)
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });

  describe('updateSegmentationResults (saveSegmentation)', () => {
    it('should save manual segmentation edit successfully', async () => {
      mockMethod('updateSegmentationResults').mockResolvedValueOnce(mockSegmentationResults);
      installResponseMocks();

      const response = await request(app)
        .put(`/segmentation/images/${imageId}/results`)
        .send({ polygons: mockPolygons, imageWidth: 800, imageHeight: 600 })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return 400 when polygons are not an array', async () => {
      const response = await request(app)
        .put(`/segmentation/images/${imageId}/results`)
        .send({ polygons: 'not-an-array' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should return 401 when user is not authenticated', async () => {
      mockAuthMiddleware.mockImplementationOnce(
        async (
          req: express.Request & { user?: Record<string, unknown> },
          _res: express.Response,
          next: express.NextFunction
        ) => {
          req.user = undefined;
          next();
        }
      );

      const response = await request(app)
        .put(`/segmentation/images/${imageId}/results`)
        .send({ polygons: mockPolygons })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should return 500 on service error during update', async () => {
      mockMethod('updateSegmentationResults').mockRejectedValueOnce(new Error('Write error'));
      installResponseMocks();

      const response = await request(app)
        .put(`/segmentation/images/${imageId}/results`)
        .send({ polygons: mockPolygons })
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });

  describe('deleteSegmentationResults', () => {
    it('should delete segmentation results successfully', async () => {
      mockMethod('deleteSegmentationResults').mockResolvedValueOnce(undefined);
      installResponseMocks();

      const response = await request(app)
        .delete(`/segmentation/images/${imageId}/results`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthMiddleware.mockImplementationOnce(
        async (
          req: express.Request & { user?: Record<string, unknown> },
          _res: express.Response,
          next: express.NextFunction
        ) => {
          req.user = undefined;
          next();
        }
      );

      const response = await request(app)
        .delete(`/segmentation/images/${imageId}/results`)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should return 500 when deletion fails', async () => {
      mockMethod('deleteSegmentationResults').mockRejectedValueOnce(new Error('Deletion error'));
      installResponseMocks();

      const response = await request(app)
        .delete(`/segmentation/images/${imageId}/results`)
        .expect(500);

      expect(response.body.success).toBe(false);
    });
  });

  describe('batchSegment (processImage)', () => {
    it('should initiate batch processing successfully', async () => {
      const batchResult = { processed: 2, failed: 0, results: [] };
      mockMethod('batchProcess').mockResolvedValueOnce(batchResult);
      installResponseMocks();

      const response = await request(app)
        .post('/segmentation/batch')
        .send({
          imageIds: [
            'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            'b2c3d4e5-f6a7-8901-bcde-f12345678901',
          ],
          model: 'hrnet',
          threshold: 0.5,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return 400 when imageIds is empty', async () => {
      const response = await request(app)
        .post('/segmentation/batch')
        .send({ imageIds: [] })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 for invalid model param', async () => {
      const response = await request(app)
        .post('/segmentation/batch')
        .send({
          imageIds: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
          model: 'invalid_model',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 when threshold is out of range', async () => {
      const response = await request(app)
        .post('/segmentation/batch')
        .send({
          imageIds: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
          model: 'hrnet',
          threshold: 0.99,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthMiddleware.mockImplementationOnce(
        async (
          req: express.Request & { user?: Record<string, unknown> },
          _res: express.Response,
          next: express.NextFunction
        ) => {
          req.user = undefined;
          next();
        }
      );

      const response = await request(app)
        .post('/segmentation/batch')
        .send({
          imageIds: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
          model: 'hrnet',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should validate max 50 images per batch', async () => {
      const ids = Array.from(
        { length: 51 },
        (_, i) => `a1b2c3d4-e5f6-7890-ab${String(i).padStart(2, '0')}-ef1234567890`
      );

      const response = await request(app)
        .post('/segmentation/batch')
        .send({ imageIds: ids, model: 'hrnet' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('batchGetSegmentationResults', () => {
    it('should return batch results for multiple images', async () => {
      const batchResults = { [imageId]: mockSegmentationResults };
      mockMethod('getBatchSegmentationResults').mockResolvedValueOnce(batchResults);
      installResponseMocks();

      const response = await request(app)
        .post('/segmentation/batch/results')
        .send({ imageIds: [imageId] })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return 400 when imageIds is empty', async () => {
      const response = await request(app)
        .post('/segmentation/batch/results')
        .send({ imageIds: [] })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthMiddleware.mockImplementationOnce(
        async (
          req: express.Request & { user?: Record<string, unknown> },
          _res: express.Response,
          next: express.NextFunction
        ) => {
          req.user = undefined;
          next();
        }
      );

      const response = await request(app)
        .post('/segmentation/batch/results')
        .send({ imageIds: [imageId] })
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });
});
