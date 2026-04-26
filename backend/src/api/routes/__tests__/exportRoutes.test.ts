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
import { authenticate } from '../../../middleware/auth';
import { logger } from '../../../utils/logger';

// vi.hoisted so the factory below can reference these.
const { mockServiceInstance } = vi.hoisted(() => ({
  mockServiceInstance: {
    startExportJob: vi.fn(),
    getJobStatus: vi.fn(),
    getExportFilePath: vi.fn(),
    cancelJob: vi.fn(),
    getExportHistory: vi.fn(),
    setWebSocketService: vi.fn(),
  } as Record<string, Mock<any>>,
}));

vi.mock('../../../services/exportService', () => ({
  ExportService: {
    getInstance: vi.fn(() => mockServiceInstance),
  },
}));

// Mock all other dependencies
vi.mock('../../../middleware/auth');
vi.mock('../../../utils/logger');
vi.mock('fs/promises');
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
    EXPORT_DIR: './exports',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
  },
}));

// Import router AFTER mocks are in place
import { exportRoutes } from '../exportRoutes';

const mockedAuthenticate = authenticate as MockedFunction<
  typeof authenticate
>;
const mockedLogger = logger as Mocked<typeof logger>;

const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  emailVerified: true,
};

const validProjectId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const validJobId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const invalidId = 'not-a-uuid';

describe('Export Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    // Reset service mock methods (but keep the same instance reference)
    Object.values(mockServiceInstance).forEach((fn) => fn.mockReset());

    app = express();
    app.use(express.json());

    mockedLogger.info = vi.fn() as MockedFunction<typeof logger.info>;
    mockedLogger.error = vi.fn() as MockedFunction<typeof logger.error>;
    mockedLogger.debug = vi.fn() as MockedFunction<typeof logger.debug>;

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

    app.use('/api', exportRoutes);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/projects/:projectId/export — start export', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .post(`/api/projects/${validProjectId}/export`)
        .send({ options: {} })
        .expect(401);
    });

    it('should reject non-UUID projectId with 400', async () => {
      const response = await request(app)
        .post(`/api/projects/${invalidId}/export`)
        .send({ options: {} })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should reject request without options object', async () => {
      const response = await request(app)
        .post(`/api/projects/${validProjectId}/export`)
        .send({ projectName: 'Test' })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should start export and return jobId', async () => {
      mockServiceInstance.startExportJob.mockResolvedValueOnce(validJobId);

      const response = await request(app)
        .post(`/api/projects/${validProjectId}/export`)
        .send({ options: { annotationFormats: ['coco'] } })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.jobId).toBe(validJobId);
    });

    it('should handle optional boolean options fields', async () => {
      mockServiceInstance.startExportJob.mockResolvedValueOnce(validJobId);

      const response = await request(app)
        .post(`/api/projects/${validProjectId}/export`)
        .send({
          options: {
            includeOriginalImages: true,
            includeVisualizations: false,
            annotationFormats: ['yolo'],
            metricsFormats: ['csv'],
          },
        })
        .expect(200);

      expect(response.body.jobId).toBe(validJobId);
    });

    it('should return 500 when service throws', async () => {
      mockServiceInstance.startExportJob.mockRejectedValueOnce(
        new Error('Export service down')
      );

      const response = await request(app)
        .post(`/api/projects/${validProjectId}/export`)
        .send({ options: {} })
        .expect(500);

      expect(response.body.error).toBe('Failed to start export');
    });
  });

  describe('GET /api/projects/:projectId/export/:jobId/status', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .get(`/api/projects/${validProjectId}/export/${validJobId}/status`)
        .expect(401);
    });

    it('should reject non-UUID projectId', async () => {
      const response = await request(app)
        .get(`/api/projects/${invalidId}/export/${validJobId}/status`)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should reject non-UUID jobId', async () => {
      const response = await request(app)
        .get(`/api/projects/${validProjectId}/export/${invalidId}/status`)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should return job status for valid IDs', async () => {
      const mockStatus = {
        id: validJobId,
        status: 'processing',
        progress: 50,
        createdAt: new Date('2024-01-01').toISOString(),
      };
      mockServiceInstance.getJobStatus.mockResolvedValueOnce(mockStatus);

      const response = await request(app)
        .get(`/api/projects/${validProjectId}/export/${validJobId}/status`)
        .expect(200);

      expect(response.body).toMatchObject({ id: validJobId });
    });

    it('should return 404 when job not found', async () => {
      mockServiceInstance.getJobStatus.mockResolvedValueOnce(null);

      const response = await request(app)
        .get(`/api/projects/${validProjectId}/export/${validJobId}/status`)
        .expect(404);

      expect(response.body.error).toBe('Export status not found');
    });
  });

  describe('GET /api/projects/:projectId/export/:jobId/download', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .get(`/api/projects/${validProjectId}/export/${validJobId}/download`)
        .expect(401);
    });

    it('should reject non-UUID IDs', async () => {
      const response = await request(app)
        .get(`/api/projects/${invalidId}/export/${validJobId}/download`)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should return 404 when export file not found', async () => {
      mockServiceInstance.getExportFilePath.mockResolvedValueOnce(null);

      const response = await request(app)
        .get(`/api/projects/${validProjectId}/export/${validJobId}/download`)
        .expect(404);

      expect(response.body.error).toBe('Export file not found');
    });

    it('should return 400 for path traversal attempt', async () => {
      mockServiceInstance.getExportFilePath.mockResolvedValueOnce(
        '/etc/passwd'
      );

      const response = await request(app)
        .get(`/api/projects/${validProjectId}/export/${validJobId}/download`)
        .expect(400);

      expect(response.body.error).toBe('Invalid file path');
    });
  });

  describe('POST /api/projects/:projectId/export/:jobId/cancel', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .post(`/api/projects/${validProjectId}/export/${validJobId}/cancel`)
        .expect(401);
    });

    it('should reject non-UUID IDs', async () => {
      const response = await request(app)
        .post(`/api/projects/${invalidId}/export/${validJobId}/cancel`)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should cancel job and return success', async () => {
      mockServiceInstance.cancelJob.mockResolvedValueOnce(undefined);

      const response = await request(app)
        .post(`/api/projects/${validProjectId}/export/${validJobId}/cancel`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Export job cancelled successfully');
    });

    it('should return 500 when cancel service throws', async () => {
      mockServiceInstance.cancelJob.mockRejectedValueOnce(
        new Error('Cannot cancel completed job')
      );

      const response = await request(app)
        .post(`/api/projects/${validProjectId}/export/${validJobId}/cancel`)
        .expect(500);

      expect(response.body.error).toBe('Failed to cancel export');
    });
  });

  describe('GET /api/projects/:projectId/export/history', () => {
    it('should require authentication', async () => {
      mockedAuthenticate.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ success: false, message: 'Unauthorized' });
      });

      await request(app)
        .get(`/api/projects/${validProjectId}/export/history`)
        .expect(401);
    });

    it('should reject non-UUID projectId', async () => {
      const response = await request(app)
        .get(`/api/projects/${invalidId}/export/history`)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should return export history', async () => {
      const mockHistory = [
        { id: validJobId, status: 'completed', createdAt: new Date('2024-01-01') },
      ];
      mockServiceInstance.getExportHistory.mockResolvedValueOnce(mockHistory);

      const response = await request(app)
        .get(`/api/projects/${validProjectId}/export/history`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('GET /api/export/formats', () => {
    it('should return export formats without authentication', async () => {
      const response = await request(app)
        .get('/api/export/formats')
        .expect(200);

      expect(response.body).toHaveProperty('annotations');
      expect(response.body).toHaveProperty('metrics');
    });

    it('should include expected annotation format IDs', async () => {
      const response = await request(app)
        .get('/api/export/formats')
        .expect(200);

      const annotationIds = response.body.annotations.map(
        (f: { id: string }) => f.id
      );
      expect(annotationIds).toContain('coco');
      expect(annotationIds).toContain('yolo');
    });
  });
});
