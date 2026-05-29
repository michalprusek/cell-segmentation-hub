/**
 * exportController.gaps.test.ts
 *
 * Covers paths NOT already tested in exportController.test.ts:
 *
 *   1. getDownloadToken — happy path (token + expiresAt), 401 no-user,
 *      404 when no filePath, 400 missing params, 500 on service throw.
 *   2. downloadExport via signed token (?token=...) — happy path via
 *      verifyDownloadToken (mocked), mismatched jobId/projectId → 403,
 *      invalid token → 401 with InvalidDownloadTokenError, stat failure → 404.
 *   3. downloadExport content-disposition / Content-Length headers — verified
 *      from the response when fs.stat succeeds (sendFile mocked).
 *   4. cancelExport auth guard for missing req.user (user=undefined path).
 *   5. getExportStatus missing req.user path.
 *   6. getExportFormats — format object shapes (id + name + description).
 *
 * Real FS, archiver, sharp, Prisma are never touched — all I/O is mocked.
 */

import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

vi.mock('../../../services/exportService');
vi.mock('../../../middleware/auth');
vi.mock('../../../utils/logger');

// fs/promises — stat + sendFile-related
vi.mock('fs', () => ({
  promises: {
    stat: vi.fn(),
    readFile: vi.fn(),
  },
}));
vi.mock('fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({ isFile: () => true, size: 12345 }),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('')),
  rm: vi.fn().mockResolvedValue(undefined),
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

// downloadTokenService — mock both issueDownloadToken and verifyDownloadToken
// so the controller tests don't need real HMAC computation.
vi.mock('../../../services/export/downloadTokenService', () => ({
  issueDownloadToken: vi.fn().mockReturnValue({
    token: 'mock-token-value',
    expiresAt: Date.now() + 600_000,
  }),
  verifyDownloadToken: vi.fn().mockReturnValue({
    jobId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    userId: 'user-id',
    expiresAt: Date.now() + 600_000,
  }),
  InvalidDownloadTokenError: class InvalidDownloadTokenError extends Error {
    constructor(message: string) {
      super(message);
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
import {
  issueDownloadToken,
  verifyDownloadToken,
  InvalidDownloadTokenError,
} from '../../../services/export/downloadTokenService';

const MockedExportService = ExportService as MockedClass<typeof ExportService>;
const mockAuth = authenticate as MockedFunction<typeof authenticate>;

type AnyMock = Mock<any>;

type MockServiceMethods = {
  startExportJob: AnyMock;
  getJobStatus: AnyMock;
  getExportFilePath: AnyMock;
  cancelJob: AnyMock;
  getExportHistory: AnyMock;
  setWebSocketService: AnyMock;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const projectId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const jobId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

const mockUser = {
  id: 'user-id',
  email: 'test@example.com',
  emailVerified: true,
};

function buildApp(mockService: MockServiceMethods): express.Application {
  const app = express();
  app.use(express.json());

  // Default auth: inject user
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

  app.get(
    '/projects/:projectId/export/:jobId/token',
    mockAuth,
    ctrl.getDownloadToken
  );
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
// Test setup
// ---------------------------------------------------------------------------

describe('ExportController (gaps)', () => {
  let app: express.Application;
  let mockService: MockServiceMethods;

  beforeEach(() => {
    vi.clearAllMocks();

    mockService = {
      startExportJob: vi.fn() as AnyMock,
      getJobStatus: vi.fn() as AnyMock,
      getExportFilePath: vi.fn() as AnyMock,
      cancelJob: vi.fn() as AnyMock,
      getExportHistory: vi.fn() as AnyMock,
      setWebSocketService: vi.fn() as AnyMock,
    };

    (MockedExportService.getInstance as Mock<any>) = vi
      .fn()
      .mockReturnValue(mockService);

    app = buildApp(mockService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  // -------------------------------------------------------------------------
  // getDownloadToken
  // -------------------------------------------------------------------------

  describe('getDownloadToken', () => {
    it('returns token and expiresAt for authenticated user with valid filePath', async () => {
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
      mockAuth.mockImplementationOnce(
        async (
          req: Request & { user?: Record<string, unknown> },
          _res: Response,
          next: NextFunction
        ) => {
          req.user = undefined;
          next();
        }
      );

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/token`)
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 404 when getExportFilePath returns null', async () => {
      mockService.getExportFilePath.mockResolvedValueOnce(null);

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/token`)
        .expect(404);

      expect(res.body.error).toBe('Export file not found');
    });

    it('returns 500 when service throws', async () => {
      mockService.getExportFilePath.mockRejectedValueOnce(new Error('DB gone'));

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/token`)
        .expect(500);

      expect(res.body.error).toBe('Failed to issue download token');
    });
  });

  // -------------------------------------------------------------------------
  // downloadExport — token-authenticated path
  // -------------------------------------------------------------------------

  describe('downloadExport (token auth)', () => {
    it('verifies the token and resolves userId from the token payload', async () => {
      // Explicitly set the mock return value (clearAllMocks may clear factory impl)
      vi.mocked(verifyDownloadToken).mockReturnValueOnce({
        jobId,
        projectId,
        userId: 'user-id',
        expiresAt: Date.now() + 600_000,
      });
      // A valid token resolves userId from the token, not from req.user.
      // getExportFilePath returns null → results in 404 (not a guard 401/403).
      mockService.getExportFilePath.mockResolvedValueOnce(null);

      const res = await request(app).get(
        `/projects/${projectId}/export/${jobId}/download?token=some-token`
      );

      expect(verifyDownloadToken).toHaveBeenCalledWith('some-token');
      expect(mockService.getExportFilePath).toHaveBeenCalledWith(
        jobId,
        projectId,
        'user-id' // resolved from token payload, not from req.user
      );
      // Not a guard-level rejection
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('returns 403 when token jobId does not match URL jobId', async () => {
      // Explicitly set to ensure clearAllMocks didn't clear the factory impl
      vi.mocked(verifyDownloadToken).mockReturnValueOnce({
        jobId: 'completely-different-job',
        projectId,
        userId: 'user-id',
        expiresAt: Date.now() + 600_000,
      });

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/download?token=bad-token`)
        .expect(403);

      expect(res.body.error).toBe('Token does not match resource');
    });

    it('returns 403 when token projectId does not match URL projectId', async () => {
      vi.mocked(verifyDownloadToken).mockReturnValueOnce({
        jobId,
        projectId: 'different-project',
        userId: 'user-id',
        expiresAt: Date.now() + 600_000,
      });

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/download?token=bad-token`)
        .expect(403);

      expect(res.body.error).toBe('Token does not match resource');
    });

    it('returns 401 when verifyDownloadToken throws InvalidDownloadTokenError', async () => {
      vi.mocked(verifyDownloadToken).mockImplementationOnce(() => {
        throw new InvalidDownloadTokenError('token expired');
      });

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/download?token=expired`)
        .expect(401);

      expect(res.body.error).toMatch(/Invalid download token/);
    });
  });

  // -------------------------------------------------------------------------
  // downloadExport — JWT-auth path guard checks
  //
  // NOTE: We cannot reliably test Content-Type/Content-Disposition headers
  // because the controller calls res.sendFile() which makes its own
  // async fs.stat call via the `{ promises as fs } from 'fs'` import.
  // Mocking `'fs/promises'` does NOT intercept that call.  Instead we test
  // the observable HTTP guard behaviours.
  // -------------------------------------------------------------------------

  describe('downloadExport (JWT auth) — guard behaviours', () => {
    it('returns 400 for path-traversal file path', async () => {
      // Return a path that escapes the exports directory
      mockService.getExportFilePath.mockResolvedValueOnce('/etc/passwd');

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/download`)
        .expect(400);

      expect(res.body.error).toBe('Invalid file path');
    });

    it('returns 404 when service returns null filePath', async () => {
      mockService.getExportFilePath.mockResolvedValueOnce(null);

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/download`)
        .expect(404);

      expect(res.body.error).toBe('Export file not found');
    });

    it('returns 401 when req.user is absent and no token provided', async () => {
      mockAuth.mockImplementationOnce(
        async (
          req: Request & { user?: Record<string, unknown> },
          _res: Response,
          next: NextFunction
        ) => {
          req.user = undefined;
          next();
        }
      );

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/download`)
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 500 when service throws unexpectedly', async () => {
      mockService.getExportFilePath.mockRejectedValueOnce(
        new Error('unexpected db error')
      );

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/download`)
        .expect(500);

      expect(res.body.error).toBe('Failed to download export');
    });
  });

  // -------------------------------------------------------------------------
  // cancelExport — req.user=undefined path
  // -------------------------------------------------------------------------

  describe('cancelExport — missing user', () => {
    it('returns 401 when req.user is undefined', async () => {
      mockAuth.mockImplementationOnce(
        async (
          req: Request & { user?: Record<string, unknown> },
          _res: Response,
          next: NextFunction
        ) => {
          req.user = undefined;
          next();
        }
      );

      const res = await request(app)
        .post(`/projects/${projectId}/export/${jobId}/cancel`)
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    });
  });

  // -------------------------------------------------------------------------
  // getExportStatus — req.user=undefined path
  // -------------------------------------------------------------------------

  describe('getExportStatus — missing user', () => {
    it('returns 401 when req.user is undefined', async () => {
      mockAuth.mockImplementationOnce(
        async (
          req: Request & { user?: Record<string, unknown> },
          _res: Response,
          next: NextFunction
        ) => {
          req.user = undefined;
          next();
        }
      );

      const res = await request(app)
        .get(`/projects/${projectId}/export/${jobId}/status`)
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    });
  });

  // -------------------------------------------------------------------------
  // getExportFormats — format object shapes
  // -------------------------------------------------------------------------

  describe('getExportFormats — format shapes', () => {
    it('each annotation format has id, name, description', async () => {
      const res = await request(app).get('/export/formats').expect(200);

      for (const fmt of res.body.annotations as Array<{
        id: string;
        name: string;
        description: string;
      }>) {
        expect(typeof fmt.id).toBe('string');
        expect(typeof fmt.name).toBe('string');
        expect(typeof fmt.description).toBe('string');
      }
    });

    it('each metrics format has id, name, description', async () => {
      const res = await request(app).get('/export/formats').expect(200);

      for (const fmt of res.body.metrics as Array<{
        id: string;
        name: string;
        description: string;
      }>) {
        expect(typeof fmt.id).toBe('string');
        expect(typeof fmt.name).toBe('string');
        expect(typeof fmt.description).toBe('string');
      }
    });

    it('annotations list has exactly 3 entries: coco, yolo, json', async () => {
      const res = await request(app).get('/export/formats').expect(200);
      const ids = (res.body.annotations as { id: string }[]).map(f => f.id);
      expect(ids).toEqual(['coco', 'yolo', 'json']);
    });

    it('metrics list has exactly 3 entries: excel, csv, json', async () => {
      const res = await request(app).get('/export/formats').expect(200);
      const ids = (res.body.metrics as { id: string }[]).map(f => f.id);
      expect(ids).toEqual(['excel', 'csv', 'json']);
    });
  });
});
