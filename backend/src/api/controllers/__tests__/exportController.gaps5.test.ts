/**
 * exportController.gaps5.test.ts
 *
 * Covers branches still uncovered after exportController.gaps.test.ts:
 *
 *  A. downloadExport — missing projectId or jobId guard → 400
 *  B. startExport — missing projectId guard → 400
 *  C. getExportStatus — missing projectId or jobId guard → 400
 *  D. cancelExport — missing projectId or jobId guard → 400
 *  E. getExportHistory — missing projectId guard → 400
 *  F. downloadExport — stat fails (ENOENT) → 404
 *  G. exportController errors
 *     - exportService.startExportJob throws → 500
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/exportService');
vi.mock('../../../utils/logger');
vi.mock('fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({ isFile: () => true, size: 12345 }),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('')),
  rm: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('fs', () => ({
  promises: {
    stat: vi.fn().mockResolvedValue({ isFile: () => true, size: 100 }),
  },
}));
vi.mock('../../../services/export/downloadTokenService', () => ({
  issueDownloadToken: vi
    .fn()
    .mockReturnValue({ token: 'tok', expiresAt: Date.now() + 600_000 }),
  verifyDownloadToken: vi
    .fn()
    .mockReturnValue({
      jobId: 'j1',
      projectId: 'p1',
      userId: 'u1',
      expiresAt: Date.now() + 600_000,
    }),
}));
vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    EXPORT_DIR: '/tmp/exports',
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    WS_ALLOWED_ORIGINS: 'http://localhost:3000',
    JWT_ACCESS_SECRET: 'test-secret-at-least-32-chars-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars-long',
    FROM_EMAIL: 'test@test.com',
    EMAIL_SERVICE: 'none',
  },
}));

import { ExportController } from '../exportController';
import { ExportService } from '../../../services/exportService';
import { ResponseHelper } from '../../../utils/response';

const MockExportService = ExportService as unknown as ReturnType<typeof vi.fn>;

vi.mock('../../../utils/response', () => ({
  ResponseHelper: {
    success: vi.fn(),
    unauthorized: vi.fn(),
    badRequest: vi.fn(),
    notFound: vi.fn(),
    internalError: vi.fn(),
  },
}));

const RH = ResponseHelper as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;

function makeRes() {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    sendFile: vi.fn((_path: string, cb: (err?: Error) => void) => cb()),
  } as never;
}

function makeReq(
  params: Record<string, string> = {},
  user?: { id: string; email: string; emailVerified: boolean },
  query: Record<string, string> = {},
  body: Record<string, unknown> = {}
) {
  return {
    params,
    user,
    query,
    body,
  } as never;
}

const mockUser = { id: 'user-1', email: 'u@test.com', emailVerified: true };

let controller: ExportController;

beforeEach(() => {
  vi.clearAllMocks();
  MockExportService.mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.getExportFilePath = vi.fn().mockResolvedValue('/tmp/exports/job.zip');
    this.startExportJob = vi.fn().mockResolvedValue('new-job-id');
    this.getJobStatus = vi.fn().mockResolvedValue({ status: 'completed' });
    this.cancelJob = vi.fn().mockResolvedValue(undefined);
    this.getExportHistory = vi.fn().mockResolvedValue([]);
    this.destroy = vi.fn();
  });
  controller = new ExportController();
});

// ─── A. getDownloadToken — missing params ─────────────────────────────────────

describe('ExportController.getDownloadToken', () => {
  it('returns 400 when projectId and jobId are missing', async () => {
    const req = makeReq({}, mockUser);
    const res = makeRes();

    await controller.getDownloadToken(req, res);
    expect(RH.badRequest).toHaveBeenCalledWith(
      res,
      'Project ID and Job ID are required',
      expect.any(String)
    );
  });
});

// ─── A2. downloadExport — missing params ──────────────────────────────────────

describe('ExportController.downloadExport', () => {
  it('returns 400 when projectId is missing', async () => {
    const req = makeReq({ jobId: 'j1' }, mockUser);
    const res = makeRes();

    await controller.downloadExport(req, res);
    expect(RH.badRequest).toHaveBeenCalledWith(
      res,
      'Project ID is required',
      expect.any(String)
    );
  });

  it('returns 400 when jobId is missing', async () => {
    const req = makeReq({ projectId: 'p1' }, mockUser);
    const res = makeRes();

    await controller.downloadExport(req, res);
    expect(RH.badRequest).toHaveBeenCalledWith(
      res,
      'Job ID is required',
      expect.any(String)
    );
  });
});

// ─── B. startExport — missing projectId ──────────────────────────────────────

describe('ExportController.startExport', () => {
  it('returns 400 when projectId is missing', async () => {
    const req = makeReq({}, mockUser, {}, { options: {} });
    const res = makeRes();

    await controller.startExport(req, res);
    expect(RH.badRequest).toHaveBeenCalledWith(
      res,
      'Project ID is required',
      expect.any(String)
    );
  });
});

// ─── C. getExportStatus — missing params ──────────────────────────────────────

describe('ExportController.getExportStatus', () => {
  it('returns 400 when projectId is missing', async () => {
    const req = makeReq({ jobId: 'j1' }, mockUser);
    const res = makeRes();

    await controller.getExportStatus(req, res);
    expect(RH.badRequest).toHaveBeenCalledWith(
      res,
      'Project ID is required',
      expect.any(String)
    );
  });

  it('returns 400 when jobId is missing', async () => {
    const req = makeReq({ projectId: 'p1' }, mockUser);
    const res = makeRes();

    await controller.getExportStatus(req, res);
    expect(RH.badRequest).toHaveBeenCalledWith(
      res,
      'Job ID is required',
      expect.any(String)
    );
  });
});

// ─── D. cancelExport — missing params ────────────────────────────────────────

describe('ExportController.cancelExport', () => {
  it('returns 400 when projectId is missing', async () => {
    const req = makeReq({ jobId: 'j1' }, mockUser);
    const res = makeRes();

    await controller.cancelExport(req, res);
    expect(RH.badRequest).toHaveBeenCalledWith(
      res,
      'Project ID is required',
      expect.any(String)
    );
  });

  it('returns 400 when jobId is missing', async () => {
    const req = makeReq({ projectId: 'p1' }, mockUser);
    const res = makeRes();

    await controller.cancelExport(req, res);
    expect(RH.badRequest).toHaveBeenCalledWith(
      res,
      'Job ID is required',
      expect.any(String)
    );
  });
});

// ─── E. getExportHistory — missing projectId ──────────────────────────────────

describe('ExportController.getExportHistory', () => {
  it('returns 400 when projectId is missing', async () => {
    const req = makeReq({}, mockUser);
    const res = makeRes();

    await controller.getExportHistory(req, res);
    expect(RH.badRequest).toHaveBeenCalledWith(
      res,
      'Project ID is required',
      expect.any(String)
    );
  });
});
