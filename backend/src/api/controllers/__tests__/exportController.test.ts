import request from 'supertest';
import express from 'express';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import { ExportController } from '../exportController';
import { ExportService } from '../../../services/exportService';
import { authenticate } from '../../../middleware/auth';
import { logger } from '../../../utils/logger';

// Mock dependencies before imports are resolved
vi.mock('../../../services/exportService');
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

const MockedExportService = ExportService as MockedClass<typeof ExportService>;
const mockAuthMiddleware = authenticate as MockedFunction<typeof authenticate>;
const mockedLogger = logger as Mocked<typeof logger>;

type AnyMock = Mock<any>;

// Typed mock service helpers — avoids `never` inference from Mocked<ExportService>
type MockServiceMethods = {
  startExportJob: AnyMock;
  getJobStatus: AnyMock;
  getExportFilePath: AnyMock;
  cancelJob: AnyMock;
  getExportHistory: AnyMock;
  setWebSocketService: AnyMock;
};

describe('ExportController', () => {
  let app: express.Application;
  let mockService: MockServiceMethods;

  const mockUser = {
    id: 'user-id',
    email: 'test@example.com',
    emailVerified: true,
  };

  const projectId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const jobId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

  beforeEach(() => {
    vi.clearAllMocks();

    // Create plain mock object for service methods
    mockService = {
      startExportJob: vi.fn() as AnyMock,
      getJobStatus: vi.fn() as AnyMock,
      getExportFilePath: vi.fn() as AnyMock,
      cancelJob: vi.fn() as AnyMock,
      getExportHistory: vi.fn() as AnyMock,
      setWebSocketService: vi.fn() as AnyMock,
    };

    // Make getInstance return our mock service
    (MockedExportService.getInstance as Mock<any>) = vi.fn().mockReturnValue(mockService);

    // Mock logger methods
    mockedLogger.info = vi.fn() as MockedFunction<typeof logger.info>;
    mockedLogger.error = vi.fn() as MockedFunction<typeof logger.error>;
    mockedLogger.debug = vi.fn() as MockedFunction<typeof logger.debug>;

    app = express();
    app.use(express.json());

    // Mock auth to inject user by default
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

    const exportController = new ExportController();

    app.post(
      '/projects/:projectId/export',
      mockAuthMiddleware,
      exportController.startExport
    );
    app.get(
      '/projects/:projectId/export/:jobId/status',
      mockAuthMiddleware,
      exportController.getExportStatus
    );
    app.get(
      '/projects/:projectId/export/:jobId/download',
      mockAuthMiddleware,
      exportController.downloadExport
    );
    app.post(
      '/projects/:projectId/export/:jobId/cancel',
      mockAuthMiddleware,
      exportController.cancelExport
    );
    app.get(
      '/projects/:projectId/export/history',
      mockAuthMiddleware,
      exportController.getExportHistory
    );
    app.get('/export/formats', exportController.getExportFormats);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  describe('startExport', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockAuthMiddleware.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      await request(app)
        .post(`/projects/${projectId}/export`)
        .send({ options: {} })
        .expect(401);
    });

    it('should return 401 when req.user is missing', async () => {
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
        .post(`/projects/${projectId}/export`)
        .send({ options: {} })
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return jobId on successful export start', async () => {
      mockService.startExportJob.mockResolvedValueOnce(jobId);

      const response = await request(app)
        .post(`/projects/${projectId}/export`)
        .send({ options: { annotationFormats: ['coco'] }, projectName: 'Test Project' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.jobId).toBe(jobId);
      expect(response.body.message).toBe('Export job started successfully');
      expect(mockService.startExportJob).toHaveBeenCalledWith(
        projectId,
        mockUser.id,
        { annotationFormats: ['coco'] },
        'Test Project'
      );
    });

    it('should return 500 on export service failure', async () => {
      mockService.startExportJob.mockRejectedValueOnce(
        new Error('Service unavailable')
      );

      const response = await request(app)
        .post(`/projects/${projectId}/export`)
        .send({ options: {} })
        .expect(500);

      expect(response.body.error).toBe('Failed to start export');
    });

    it('should return 429 when service rejects due to per-user concurrency cap', async () => {
      mockService.startExportJob.mockRejectedValueOnce(
        new Error(
          'Rate limit exceeded: you already have an export in progress. ' +
            'Wait for it to finish or cancel it before starting another.'
        )
      );

      const response = await request(app)
        .post(`/projects/${projectId}/export`)
        .send({ options: {} })
        .expect(429);

      expect(response.body.error).toContain('Rate limit exceeded');
    });

    it('should use empty options when options not provided', async () => {
      mockService.startExportJob.mockResolvedValueOnce(jobId);

      await request(app)
        .post(`/projects/${projectId}/export`)
        .send({})
        .expect(200);

      expect(mockService.startExportJob).toHaveBeenCalledWith(
        projectId,
        mockUser.id,
        {},
        undefined
      );
    });
  });

  describe('getExportStatus', () => {
    it('should return status for existing job', async () => {
      const mockStatus = {
        id: jobId,
        projectId,
        status: 'completed',
        progress: 100,
        createdAt: new Date('2024-01-01').toISOString(),
      };
      mockService.getJobStatus.mockResolvedValueOnce(mockStatus);

      const response = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/status`)
        .expect(200);

      expect(response.body).toMatchObject({ id: jobId });
      expect(mockService.getJobStatus).toHaveBeenCalledWith(
        jobId,
        projectId,
        mockUser.id
      );
    });

    it('should return 404 for non-existent job', async () => {
      mockService.getJobStatus.mockResolvedValueOnce(null);

      const response = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/status`)
        .expect(404);

      expect(response.body.error).toBe('Export status not found');
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthMiddleware.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      await request(app)
        .get(`/projects/${projectId}/export/${jobId}/status`)
        .expect(401);
    });

    it('should return 500 on service error', async () => {
      mockService.getJobStatus.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/status`)
        .expect(500);

      expect(response.body.error).toBe('Failed to get export status');
    });
  });

  describe('downloadExport', () => {
    it('should return 404 when file path not found', async () => {
      mockService.getExportFilePath.mockResolvedValueOnce(null);

      const response = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/download`)
        .expect(404);

      expect(response.body.error).toBe('Export file not found');
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthMiddleware.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      await request(app)
        .get(`/projects/${projectId}/export/${jobId}/download`)
        .expect(401);
    });

    it('should return 400 for invalid (path-traversal) file path', async () => {
      mockService.getExportFilePath.mockResolvedValueOnce('/etc/passwd');

      const response = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/download`)
        .expect(400);

      expect(response.body.error).toBe('Invalid file path');
    });

    it('should return 401 when req.user missing during download', async () => {
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
        .get(`/projects/${projectId}/export/${jobId}/download`)
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });
  });

  describe('cancelExport', () => {
    it('should cancel an active job successfully', async () => {
      mockService.cancelJob.mockResolvedValueOnce(undefined);

      const response = await request(app)
        .post(`/projects/${projectId}/export/${jobId}/cancel`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Export job cancelled successfully');
      expect(mockService.cancelJob).toHaveBeenCalledWith(
        jobId,
        projectId,
        mockUser.id
      );
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthMiddleware.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      await request(app)
        .post(`/projects/${projectId}/export/${jobId}/cancel`)
        .expect(401);
    });

    it('should return 500 when cancel fails', async () => {
      mockService.cancelJob.mockRejectedValueOnce(new Error('Job not found'));

      const response = await request(app)
        .post(`/projects/${projectId}/export/${jobId}/cancel`)
        .expect(500);

      expect(response.body.error).toBe('Failed to cancel export');
    });
  });

  describe('getExportHistory', () => {
    it('should return export history list', async () => {
      const mockHistory = [
        { id: jobId, status: 'completed', createdAt: new Date('2024-01-01') },
        { id: 'other-job-id', status: 'failed', createdAt: new Date('2024-01-02') },
      ];
      mockService.getExportHistory.mockResolvedValueOnce(mockHistory);

      const response = await request(app)
        .get(`/projects/${projectId}/export/history`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
      expect(mockService.getExportHistory).toHaveBeenCalledWith(
        projectId,
        mockUser.id
      );
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthMiddleware.mockImplementationOnce(async (_req, res, _next) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      await request(app)
        .get(`/projects/${projectId}/export/history`)
        .expect(401);
    });

    it('should return 500 on service error', async () => {
      mockService.getExportHistory.mockRejectedValueOnce(
        new Error('DB connection failed')
      );

      const response = await request(app)
        .get(`/projects/${projectId}/export/history`)
        .expect(500);

      expect(response.body.error).toBe('Failed to get export history');
    });
  });

  describe('getExportFormats', () => {
    it('should return available export formats without authentication', async () => {
      const response = await request(app)
        .get('/export/formats')
        .expect(200);

      expect(response.body).toHaveProperty('annotations');
      expect(response.body).toHaveProperty('metrics');
      expect(Array.isArray(response.body.annotations)).toBe(true);
      expect(Array.isArray(response.body.metrics)).toBe(true);
    });

    it('should include coco, yolo, json annotation formats', async () => {
      const response = await request(app)
        .get('/export/formats')
        .expect(200);

      const annotationIds = response.body.annotations.map(
        (f: { id: string }) => f.id
      );
      expect(annotationIds).toContain('coco');
      expect(annotationIds).toContain('yolo');
      expect(annotationIds).toContain('json');
    });

    it('should include excel, csv, json metrics formats', async () => {
      const response = await request(app)
        .get('/export/formats')
        .expect(200);

      const metricsIds = response.body.metrics.map((f: { id: string }) => f.id);
      expect(metricsIds).toContain('excel');
      expect(metricsIds).toContain('csv');
      expect(metricsIds).toContain('json');
    });
  });
});
