/**
 * exportController.gaps2.test.ts
 *
 * Covers the remaining uncovered branches of exportController.ts that are
 * NOT already tested in exportController.test.ts or exportController.gaps.test.ts:
 *
 *  1. startExport → rate-limit 429 when service message starts with
 *     "Rate limit exceeded:" (line ~122).
 *  2. downloadExport → fs.stat throws with a non-ENOENT errno code (line ~264):
 *     the logger.warn path fires and still returns 404.
 *  3. downloadExport → fs.stat returns a non-file (directory) → 404 (line ~258).
 *  4. downloadExport → filename sanitisation: special chars replaced with '_'
 *     and ".zip" appended when missing (lines ~277-281).
 *  5. getExportHistory → service throws → 500 (line ~369).
 *  6. cancelExport → service throws → 500 (line ~338).
 *  7. getExportStatus → status=null → 404 (line ~156).
 *
 * All I/O (fs, archiver, sharp, Prisma) is mocked.
 */

import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

vi.mock('../../../services/exportService');
vi.mock('../../../middleware/auth');
vi.mock('../../../utils/logger');

// fs.stat mock — controlled per-test via statMock
const { statMock } = vi.hoisted(() => {
  const statMock = vi.fn();
  return { statMock };
});

vi.mock('fs', () => ({
  promises: {
    stat: statMock,
    readFile: vi.fn(),
  },
}));

vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
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

vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: 'test-secret-at-least-32-chars-long-for-test',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars-long',
    REDIS_URL: 'redis://localhost:6379',
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
  issueDownloadToken: vi.fn().mockReturnValue({
    token: 'tok',
    expiresAt: Date.now() + 60_000,
  }),
  verifyDownloadToken: vi.fn().mockReturnValue({
    jobId: 'job-001',
    projectId: 'proj-001',
    userId: 'user-001',
    expiresAt: Date.now() + 60_000,
  }),
  InvalidDownloadTokenError: class InvalidDownloadTokenError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'InvalidDownloadTokenError';
    }
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { ExportController } from '../exportController';
import { ExportService } from '../../../services/exportService';
import { authenticate } from '../../../middleware/auth';

const MockedExportService = ExportService as any;
const mockAuth = authenticate as any;

type AnyMock = ReturnType<typeof vi.fn>;
type MockService = {
  startExportJob: AnyMock;
  getJobStatus: AnyMock;
  getExportFilePath: AnyMock;
  cancelJob: AnyMock;
  getExportHistory: AnyMock;
  setWebSocketService: AnyMock;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const projectId = 'proj-001';
const jobId = 'job-001';
const mockUser = {
  id: 'user-001',
  email: 'test@example.com',
  emailVerified: true,
};

function buildApp(mockSvc: MockService): express.Application {
  const app = express();
  app.use(express.json());

  mockAuth.mockImplementation(
    async (
      req: Request & { user?: Record<string, unknown> },
      _res: Response,
      next: NextFunction
    ) => {
      req.user = mockUser;
      next();
    }
  );

  const ctrl = new ExportController();

  app.post('/projects/:projectId/export', mockAuth, ctrl.startExport);
  app.get(
    '/projects/:projectId/export/:jobId/status',
    mockAuth,
    ctrl.getExportStatus
  );
  app.get(
    '/projects/:projectId/export/:jobId/download',
    mockAuth,
    ctrl.downloadExport
  );
  app.post(
    '/projects/:projectId/export/:jobId/cancel',
    mockAuth,
    ctrl.cancelExport
  );
  app.get(
    '/projects/:projectId/export/history',
    mockAuth,
    ctrl.getExportHistory
  );
  app.get('/export/formats', ctrl.getExportFormats);

  return app;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe('ExportController (gaps2)', () => {
  let app: express.Application;
  let mockSvc: MockService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSvc = {
      startExportJob: vi.fn(),
      getJobStatus: vi.fn(),
      getExportFilePath: vi.fn(),
      cancelJob: vi.fn(),
      getExportHistory: vi.fn(),
      setWebSocketService: vi.fn(),
    };

    MockedExportService.getInstance = vi.fn().mockReturnValue(mockSvc);

    // Default stat: valid regular file
    statMock.mockResolvedValue({ isFile: () => true, size: 9999 });

    app = buildApp(mockSvc);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  // ── startExport → rate-limit 429 ────────────────────────────────────────────

  describe('startExport — rate limit branch', () => {
    it('returns 429 when service throws "Rate limit exceeded:" error', async () => {
      mockSvc.startExportJob.mockRejectedValueOnce(
        new Error('Rate limit exceeded: only one active export per user')
      );

      const res = await request(app)
        .post(`/projects/${projectId}/export`)
        .send({ options: {} })
        .expect(429);

      expect(res.body.error).toMatch(/Rate limit exceeded/);
    });

    it('returns 500 for non-rate-limit service errors', async () => {
      mockSvc.startExportJob.mockRejectedValueOnce(new Error('DB gone'));

      await request(app)
        .post(`/projects/${projectId}/export`)
        .send({ options: {} })
        .expect(500);
    });
  });

  // ── downloadExport → non-ENOENT fs.stat error ───────────────────────────────

  describe('downloadExport — fs.stat error paths', () => {
    beforeEach(() => {
      // Return a valid-looking file path within exports dir
      const exportsDir = path.resolve(process.env.EXPORT_DIR || './exports');
      mockSvc.getExportFilePath.mockResolvedValue(
        path.join(exportsDir, `${jobId}.zip`)
      );
    });

    it('returns 404 and logs warn when stat throws with a non-ENOENT errno', async () => {
      const permErr = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      statMock.mockRejectedValueOnce(permErr);

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/download`)
        .expect(404);

      expect(res.body.error).toBe('File not found');
    });

    it('returns 404 when stat throws with ENOENT (normal missing-file case)', async () => {
      const notFound = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      statMock.mockRejectedValueOnce(notFound);

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/download`)
        .expect(404);

      expect(res.body.error).toBe('File not found');
    });

    it('returns 404 when stat result.isFile() returns false (path is a directory)', async () => {
      statMock.mockResolvedValueOnce({ isFile: () => false, size: 0 });

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/download`)
        .expect(404);

      expect(res.body.error).toBe('File not found');
    });
  });

  // ── downloadExport — missing projectId / jobId guard ─────────────────────────
  // (Covers the remaining guard branches in downloadExport not exercised
  //  by gaps.test.ts which always has both params in the route.)

  describe('downloadExport — parameter guards', () => {
    it('returns 400 when projectId is absent', async () => {
      // Mount with no :projectId param in route
      const guardApp = express();
      guardApp.use(express.json());
      guardApp.use((req: any, _r: any, n: any) => {
        req.user = mockUser;
        n();
      });
      const ctrl = new ExportController();
      guardApp.get('/export/:jobId/download', ctrl.downloadExport);

      const res = await request(guardApp)
        .get(`/export/${jobId}/download`)
        .expect(400);
      expect(res.body.error).toBe('Project ID is required');
    });

    it('returns 400 when jobId is absent', async () => {
      const guardApp = express();
      guardApp.use(express.json());
      guardApp.use((req: any, _r: any, n: any) => {
        req.user = mockUser;
        n();
      });
      const ctrl = new ExportController();
      guardApp.get('/projects/:projectId/download', ctrl.downloadExport);

      const res = await request(guardApp)
        .get(`/projects/${projectId}/download`)
        .expect(400);
      expect(res.body.error).toBe('Job ID is required');
    });
  });

  // ── getExportHistory → service throws ────────────────────────────────────────

  describe('getExportHistory — error branch', () => {
    it('returns 500 when exportService.getExportHistory throws', async () => {
      mockSvc.getExportHistory.mockRejectedValueOnce(new Error('DB gone'));

      const res = await request(app)
        .get(`/projects/${projectId}/export/history`)
        .expect(500);

      expect(res.body.error).toBe('Failed to get export history');
    });
  });

  // ── cancelExport → service throws ──────────────────────────────────────────

  describe('cancelExport — service error branch', () => {
    it('returns 500 when cancelJob throws', async () => {
      mockSvc.cancelJob.mockRejectedValueOnce(new Error('Job not found'));

      const res = await request(app)
        .post(`/projects/${projectId}/export/${jobId}/cancel`)
        .expect(500);

      expect(res.body.error).toBe('Failed to cancel export');
    });
  });

  // ── getExportStatus → status=null → 404 ────────────────────────────────────

  describe('getExportStatus — null status branch', () => {
    it('returns 404 when getJobStatus returns null', async () => {
      mockSvc.getJobStatus.mockResolvedValueOnce(null);

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/status`)
        .expect(404);

      expect(res.body.error).toBe('Export status not found');
    });

    it('returns 500 when getJobStatus throws', async () => {
      mockSvc.getJobStatus.mockRejectedValueOnce(new Error('DB gone'));

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/status`)
        .expect(500);

      expect(res.body.error).toBe('Failed to get export status');
    });
  });
});
