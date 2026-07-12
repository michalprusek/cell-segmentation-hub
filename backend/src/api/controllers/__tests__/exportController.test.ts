/**
 * exportController.test.ts
 *
 * Consolidated unit tests for ExportController. Merged from the former
 * exportController.test.ts + .gaps + .gaps2 + .gaps5 split files.
 *
 * Harness: supertest against a minimal Express app that mounts the real
 * controller. ResponseHelper runs for real so we assert the observable HTTP
 * status + body. Auth is injected via a tiny middleware (`authUser` closure)
 * so the controller's own `if (!userId)` guards are exercised directly.
 *
 * All I/O (ExportService, fs.stat, downloadTokenService, logger) is mocked —
 * no real filesystem, archiver, sharp or Prisma is touched.
 *
 * Grouped per endpoint; each group covers the relevant concerns: request
 * validation (missing params), success + controller→service delegation,
 * and error / permission branches.
 */

import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
vi.mock('../../../services/exportService');
vi.mock('../../../utils/logger');

// fs.stat is called by the controller via `import { promises as fs } from 'fs'`.
// A hoisted mock lets each test drive stat's behaviour; default = valid file.
const { statMock } = vi.hoisted(() => ({ statMock: vi.fn() }));
vi.mock('fs', () => ({
  promises: { stat: statMock, readFile: vi.fn() },
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
    EXPORT_DIR: './exports',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
  },
}));

vi.mock('../../../services/export/downloadTokenService', () => ({
  issueDownloadToken: vi.fn(),
  verifyDownloadToken: vi.fn(),
  InvalidDownloadTokenError: class InvalidDownloadTokenError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'InvalidDownloadTokenError';
    }
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { ExportController } from '../exportController';
import { ExportService } from '../../../services/exportService';
import {
  issueDownloadToken,
  verifyDownloadToken,
  InvalidDownloadTokenError,
} from '../../../services/export/downloadTokenService';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const projectId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const jobId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const mockUser = { id: 'user-id', email: 'test@example.com', emailVerified: true };

type Fn = ReturnType<typeof vi.fn>;
type ServiceMock = {
  startExportJob: Fn;
  getJobStatus: Fn;
  getExportFilePath: Fn;
  cancelJob: Fn;
  getExportHistory: Fn;
  setWebSocketService: Fn;
};

/** Path that resolves inside the exports dir so it passes the traversal guard. */
const inExportsDir = (name: string): string =>
  path.join(path.resolve(process.env.EXPORT_DIR || './exports'), name);

// ── App builders ──────────────────────────────────────────────────────────────
let authUser: typeof mockUser | undefined;

function buildApp(ctrl: ExportController): express.Application {
  const app = express();
  app.use(express.json());
  const auth = (
    req: Request & { user?: unknown },
    _res: Response,
    next: NextFunction
  ) => {
    req.user = authUser;
    next();
  };

  app.get(
    '/projects/:projectId/export/:jobId/token',
    auth,
    ctrl.getDownloadToken
  );
  app.post('/projects/:projectId/export', auth, ctrl.startExport);
  app.get(
    '/projects/:projectId/export/:jobId/status',
    auth,
    ctrl.getExportStatus
  );
  app.get(
    '/projects/:projectId/export/:jobId/download',
    auth,
    ctrl.downloadExport
  );
  app.post('/projects/:projectId/export/:jobId/cancel', auth, ctrl.cancelExport);
  app.get('/projects/:projectId/export/history', auth, ctrl.getExportHistory);
  app.get('/export/formats', ctrl.getExportFormats);
  return app;
}

/**
 * App for missing-param validation: mounts a single handler on a route that
 * intentionally omits a path param so the controller's guard branch fires.
 * Auth is always injected (guard checks run after the auth check).
 */
function guardApp(
  method: 'get' | 'post',
  routePath: string,
  handler: express.RequestHandler
): express.Application {
  const app = express();
  app.use(express.json());
  app.use((req: Request & { user?: unknown }, _res, next) => {
    req.user = mockUser;
    next();
  });
  (app as unknown as Record<string, (p: string, h: express.RequestHandler) => void>)[
    method
  ](routePath, handler);
  return app;
}

// ── Setup ─────────────────────────────────────────────────────────────────────
describe('ExportController', () => {
  let ctrl: ExportController;
  let app: express.Application;
  let mockService: ServiceMock;

  beforeEach(() => {
    vi.clearAllMocks();
    authUser = mockUser;

    mockService = {
      startExportJob: vi.fn(),
      getJobStatus: vi.fn(),
      getExportFilePath: vi.fn(),
      cancelJob: vi.fn(),
      getExportHistory: vi.fn(),
      setWebSocketService: vi.fn(),
    };
    (
      ExportService as unknown as { getInstance: Fn }
    ).getInstance = vi.fn().mockReturnValue(mockService);

    vi.mocked(issueDownloadToken).mockReturnValue({
      token: 'mock-token-value',
      expiresAt: Date.now() + 600_000,
    });
    vi.mocked(verifyDownloadToken).mockReturnValue({
      jobId,
      projectId,
      userId: mockUser.id,
      expiresAt: Date.now() + 600_000,
    });

    statMock.mockReset();
    statMock.mockResolvedValue({ isFile: () => true, size: 9999 });

    ctrl = new ExportController();
    app = buildApp(ctrl);
  });

  // ── getDownloadToken ─────────────────────────────────────────────────────────
  describe('getDownloadToken', () => {
    it('returns token + expiresAt and delegates to issueDownloadToken', async () => {
      mockService.getExportFilePath.mockResolvedValueOnce('/exports/foo.zip');

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/token`)
        .expect(200);

      expect(res.body.token).toBe('mock-token-value');
      expect(typeof res.body.expiresAt).toBe('number');
      expect(issueDownloadToken).toHaveBeenCalledWith(
        jobId,
        projectId,
        mockUser.id
      );
    });

    it('returns 401 when req.user is missing', async () => {
      authUser = undefined;
      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/token`)
        .expect(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 400 when projectId and jobId are missing', async () => {
      const res = await request(guardApp('get', '/token', ctrl.getDownloadToken))
        .get('/token')
        .expect(400);
      expect(res.body.error).toBe('Project ID and Job ID are required');
    });

    it('returns 404 when the export file does not exist', async () => {
      mockService.getExportFilePath.mockResolvedValueOnce(null);
      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/token`)
        .expect(404);
      expect(res.body.error).toBe('Export file not found');
    });

    it('returns 500 when the service throws', async () => {
      mockService.getExportFilePath.mockRejectedValueOnce(new Error('DB gone'));
      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/token`)
        .expect(500);
      expect(res.body.error).toBe('Failed to issue download token');
    });
  });

  // ── startExport ──────────────────────────────────────────────────────────────
  describe('startExport', () => {
    it('returns jobId and delegates to startExportJob on success', async () => {
      mockService.startExportJob.mockResolvedValueOnce(jobId);

      const res = await request(app)
        .post(`/projects/${projectId}/export`)
        .send({
          options: { annotationFormats: ['coco'] },
          projectName: 'Test Project',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.jobId).toBe(jobId);
      expect(res.body.message).toBe('Export job started successfully');
      expect(mockService.startExportJob).toHaveBeenCalledWith(
        projectId,
        mockUser.id,
        { annotationFormats: ['coco'] },
        'Test Project'
      );
    });

    it('defaults to empty options + undefined name when body is empty', async () => {
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

    it('returns 401 when req.user is missing', async () => {
      authUser = undefined;
      const res = await request(app)
        .post(`/projects/${projectId}/export`)
        .send({ options: {} })
        .expect(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 400 when projectId is missing', async () => {
      const res = await request(guardApp('post', '/export', ctrl.startExport))
        .post('/export')
        .send({ options: {} })
        .expect(400);
      expect(res.body.error).toBe('Project ID is required');
    });

    it('returns 429 when the service reports the per-user rate limit', async () => {
      mockService.startExportJob.mockRejectedValueOnce(
        new Error('Rate limit exceeded: only one active export per user')
      );

      const res = await request(app)
        .post(`/projects/${projectId}/export`)
        .send({ options: {} })
        .expect(429);
      expect(res.body.error).toMatch(/Rate limit exceeded/);
    });

    it('returns 500 for a non-rate-limit service failure', async () => {
      mockService.startExportJob.mockRejectedValueOnce(new Error('DB gone'));

      const res = await request(app)
        .post(`/projects/${projectId}/export`)
        .send({ options: {} })
        .expect(500);
      expect(res.body.error).toBe('Failed to start export');
    });
  });

  // ── getExportStatus ──────────────────────────────────────────────────────────
  describe('getExportStatus', () => {
    it('returns status and delegates to getJobStatus', async () => {
      const mockStatus = {
        id: jobId,
        projectId,
        status: 'completed',
        progress: 100,
      };
      mockService.getJobStatus.mockResolvedValueOnce(mockStatus);

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/status`)
        .expect(200);

      expect(res.body).toMatchObject({ id: jobId });
      expect(mockService.getJobStatus).toHaveBeenCalledWith(
        jobId,
        projectId,
        mockUser.id
      );
    });

    it('returns 404 when the job is not found', async () => {
      mockService.getJobStatus.mockResolvedValueOnce(null);
      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/status`)
        .expect(404);
      expect(res.body.error).toBe('Export status not found');
    });

    it('returns 401 when req.user is missing', async () => {
      authUser = undefined;
      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/status`)
        .expect(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 400 when projectId is missing', async () => {
      const res = await request(
        guardApp('get', '/export/:jobId/status', ctrl.getExportStatus)
      )
        .get(`/export/${jobId}/status`)
        .expect(400);
      expect(res.body.error).toBe('Project ID is required');
    });

    it('returns 400 when jobId is missing', async () => {
      const res = await request(
        guardApp('get', '/projects/:projectId/status', ctrl.getExportStatus)
      )
        .get(`/projects/${projectId}/status`)
        .expect(400);
      expect(res.body.error).toBe('Job ID is required');
    });

    it('returns 500 when the service throws', async () => {
      mockService.getJobStatus.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/status`)
        .expect(500);
      expect(res.body.error).toBe('Failed to get export status');
    });
  });

  // ── downloadExport ───────────────────────────────────────────────────────────
  describe('downloadExport', () => {
    describe('parameter + JWT-auth guards', () => {
      it('returns 400 when projectId is missing', async () => {
        const res = await request(
          guardApp('get', '/export/:jobId/download', ctrl.downloadExport)
        )
          .get(`/export/${jobId}/download`)
          .expect(400);
        expect(res.body.error).toBe('Project ID is required');
      });

      it('returns 400 when jobId is missing', async () => {
        const res = await request(
          guardApp('get', '/projects/:projectId/download', ctrl.downloadExport)
        )
          .get(`/projects/${projectId}/download`)
          .expect(400);
        expect(res.body.error).toBe('Job ID is required');
      });

      it('returns 401 when req.user is absent and no token is provided', async () => {
        authUser = undefined;
        const res = await request(app)
          .get(`/projects/${projectId}/export/${jobId}/download`)
          .expect(401);
        expect(res.body.error).toBe('Unauthorized');
      });

      it('returns 404 when the file path is null', async () => {
        mockService.getExportFilePath.mockResolvedValueOnce(null);
        const res = await request(app)
          .get(`/projects/${projectId}/export/${jobId}/download`)
          .expect(404);
        expect(res.body.error).toBe('Export file not found');
      });

      it('returns 400 for a path-traversal file path', async () => {
        mockService.getExportFilePath.mockResolvedValueOnce('/etc/passwd');
        const res = await request(app)
          .get(`/projects/${projectId}/export/${jobId}/download`)
          .expect(400);
        expect(res.body.error).toBe('Invalid file path');
      });

      it('returns 500 when the service throws unexpectedly', async () => {
        mockService.getExportFilePath.mockRejectedValueOnce(
          new Error('unexpected db error')
        );
        const res = await request(app)
          .get(`/projects/${projectId}/export/${jobId}/download`)
          .expect(500);
        expect(res.body.error).toBe('Failed to download export');
      });
    });

    describe('fs.stat branches', () => {
      beforeEach(() => {
        mockService.getExportFilePath.mockResolvedValue(
          inExportsDir(`${jobId}.zip`)
        );
      });

      it('returns 404 and logs warn when stat fails with a non-ENOENT errno', async () => {
        statMock.mockRejectedValueOnce(
          Object.assign(new Error('EACCES'), { code: 'EACCES' })
        );
        const res = await request(app)
          .get(`/projects/${projectId}/export/${jobId}/download`)
          .expect(404);
        expect(res.body.error).toBe('File not found');
      });

      it('returns 404 when stat fails with ENOENT (missing file)', async () => {
        statMock.mockRejectedValueOnce(
          Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        );
        const res = await request(app)
          .get(`/projects/${projectId}/export/${jobId}/download`)
          .expect(404);
        expect(res.body.error).toBe('File not found');
      });

      it('returns 404 when the resolved path is not a regular file', async () => {
        statMock.mockResolvedValueOnce({ isFile: () => false, size: 0 });
        const res = await request(app)
          .get(`/projects/${projectId}/export/${jobId}/download`)
          .expect(404);
        expect(res.body.error).toBe('File not found');
      });
    });

    describe('signed-token auth', () => {
      it('verifies the token and resolves userId from the payload', async () => {
        // Valid token → userId comes from the token, not req.user.
        // getExportFilePath returns null → 404 (not a guard-level 401/403).
        mockService.getExportFilePath.mockResolvedValueOnce(null);

        const res = await request(app).get(
          `/projects/${projectId}/export/${jobId}/download?token=some-token`
        );

        expect(verifyDownloadToken).toHaveBeenCalledWith('some-token');
        expect(mockService.getExportFilePath).toHaveBeenCalledWith(
          jobId,
          projectId,
          mockUser.id
        );
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      });

      it('returns 403 when the token jobId does not match the URL', async () => {
        vi.mocked(verifyDownloadToken).mockReturnValueOnce({
          jobId: 'completely-different-job',
          projectId,
          userId: mockUser.id,
          expiresAt: Date.now() + 600_000,
        });
        const res = await request(app)
          .get(`/projects/${projectId}/export/${jobId}/download?token=bad`)
          .expect(403);
        expect(res.body.error).toBe('Token does not match resource');
      });

      it('returns 403 when the token projectId does not match the URL', async () => {
        vi.mocked(verifyDownloadToken).mockReturnValueOnce({
          jobId,
          projectId: 'different-project',
          userId: mockUser.id,
          expiresAt: Date.now() + 600_000,
        });
        const res = await request(app)
          .get(`/projects/${projectId}/export/${jobId}/download?token=bad`)
          .expect(403);
        expect(res.body.error).toBe('Token does not match resource');
      });

      it('returns 401 when the token is invalid', async () => {
        vi.mocked(verifyDownloadToken).mockImplementationOnce(() => {
          throw new InvalidDownloadTokenError('token expired');
        });
        const res = await request(app)
          .get(`/projects/${projectId}/export/${jobId}/download?token=expired`)
          .expect(401);
        expect(res.body.error).toMatch(/Invalid download token/);
      });
    });
  });

  // ── cancelExport ─────────────────────────────────────────────────────────────
  describe('cancelExport', () => {
    it('cancels the job and delegates to cancelJob', async () => {
      mockService.cancelJob.mockResolvedValueOnce(undefined);

      const res = await request(app)
        .post(`/projects/${projectId}/export/${jobId}/cancel`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Export job cancelled successfully');
      expect(mockService.cancelJob).toHaveBeenCalledWith(
        jobId,
        projectId,
        mockUser.id
      );
    });

    it('returns 401 when req.user is missing', async () => {
      authUser = undefined;
      const res = await request(app)
        .post(`/projects/${projectId}/export/${jobId}/cancel`)
        .expect(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 400 when projectId is missing', async () => {
      const res = await request(
        guardApp('post', '/export/:jobId/cancel', ctrl.cancelExport)
      )
        .post(`/export/${jobId}/cancel`)
        .expect(400);
      expect(res.body.error).toBe('Project ID is required');
    });

    it('returns 400 when jobId is missing', async () => {
      const res = await request(
        guardApp('post', '/projects/:projectId/cancel', ctrl.cancelExport)
      )
        .post(`/projects/${projectId}/cancel`)
        .expect(400);
      expect(res.body.error).toBe('Job ID is required');
    });

    it('returns 500 when cancel fails', async () => {
      mockService.cancelJob.mockRejectedValueOnce(new Error('Job not found'));
      const res = await request(app)
        .post(`/projects/${projectId}/export/${jobId}/cancel`)
        .expect(500);
      expect(res.body.error).toBe('Failed to cancel export');
    });
  });

  // ── getExportHistory ─────────────────────────────────────────────────────────
  describe('getExportHistory', () => {
    it('returns the history list and delegates to getExportHistory', async () => {
      const mockHistory = [
        { id: jobId, status: 'completed' },
        { id: 'other-job-id', status: 'failed' },
      ];
      mockService.getExportHistory.mockResolvedValueOnce(mockHistory);

      const res = await request(app)
        .get(`/projects/${projectId}/export/history`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      expect(mockService.getExportHistory).toHaveBeenCalledWith(
        projectId,
        mockUser.id
      );
    });

    it('returns 401 when req.user is missing', async () => {
      authUser = undefined;
      const res = await request(app)
        .get(`/projects/${projectId}/export/history`)
        .expect(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 400 when projectId is missing', async () => {
      const res = await request(
        guardApp('get', '/export/history', ctrl.getExportHistory)
      )
        .get('/export/history')
        .expect(400);
      expect(res.body.error).toBe('Project ID is required');
    });

    it('returns 500 on service error', async () => {
      mockService.getExportHistory.mockRejectedValueOnce(
        new Error('DB connection failed')
      );
      const res = await request(app)
        .get(`/projects/${projectId}/export/history`)
        .expect(500);
      expect(res.body.error).toBe('Failed to get export history');
    });
  });

  // ── getExportFormats ─────────────────────────────────────────────────────────
  describe('getExportFormats', () => {
    it('exposes annotation formats [coco, yolo, json] each with id/name/description', async () => {
      const res = await request(app).get('/export/formats').expect(200);

      const annotations = res.body.annotations as Array<{
        id: string;
        name: string;
        description: string;
      }>;
      expect(annotations.map(f => f.id)).toEqual(['coco', 'yolo', 'json']);
      for (const fmt of annotations) {
        expect(typeof fmt.id).toBe('string');
        expect(typeof fmt.name).toBe('string');
        expect(typeof fmt.description).toBe('string');
      }
    });

    it('exposes metrics formats [excel, csv, json] each with id/name/description', async () => {
      const res = await request(app).get('/export/formats').expect(200);

      const metrics = res.body.metrics as Array<{
        id: string;
        name: string;
        description: string;
      }>;
      expect(metrics.map(f => f.id)).toEqual(['excel', 'csv', 'json']);
      for (const fmt of metrics) {
        expect(typeof fmt.id).toBe('string');
        expect(typeof fmt.name).toBe('string');
        expect(typeof fmt.description).toBe('string');
      }
    });
  });
});
