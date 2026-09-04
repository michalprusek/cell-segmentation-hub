/**
 * The two download routes let the URL carry its own credential (`?token=`),
 * because a native `<a href>` download cannot attach the session cookie. That
 * makes "is there a token here?" a security decision — it is what decides
 * whether `authenticate` runs at all — and the predicate used to be hand-copied
 * into four places: `optionalJwtAuth` in each of the two route files, and again
 * in each of the two controllers.
 *
 * They had already drifted once: the controllers tested `typeof token ===
 * 'string'` while the routers tested that AND `length > 0`, so `?token=`
 * (empty) ran the session middleware and was then audited as a token pull.
 *
 * These tests mount the REAL routers, not a hand-rolled app with its own auth
 * middleware (`exportController.audit.test.ts` does that, which is why an
 * authorisation branch can look covered there while production never reaches
 * it). `authenticate` is the one thing stubbed, so that "did the session
 * middleware run?" is directly observable — which is the question a drift
 * between the two predicates changes the answer to.
 */
import request from 'supertest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const SESSION_USER = { id: 'session-user', email: 'session@example.com' };

const { authenticateMock, recordMock, resolveDownload, getExportFilePath } =
  vi.hoisted(() => ({
    authenticateMock: vi.fn(),
    recordMock: vi.fn(),
    resolveDownload: vi.fn(),
    getExportFilePath: vi.fn(),
  }));

// The ONLY stubbed link in the chain. It stands in for "the session cookie was
// accepted", so a test can assert whether the router asked for a session at all.
vi.mock('../../../middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    authenticateMock();
    (req as Request & { user?: typeof SESSION_USER }).user = sessionUser;
    if (!sessionUser) {
      res.status(401).json({ success: false, message: 'no session' });
      return;
    }
    next();
  },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    EXPORT_DIR: './exports',
    // A fixed secret so the real issue/verify crypto runs — the whole point is
    // to exercise the actual predicate, not a stub of it.
    JWT_ACCESS_SECRET:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    JWT_REFRESH_SECRET: 'test-refresh',
    ESSAYS_SERVICE_URL: 'http://essays:8000',
    UPLOAD_DIR: '/app/uploads',
  },
}));

vi.mock('../../../services/exportAuditService', () => ({
  recordExportEvent: recordMock,
}));

vi.mock('../../../services/essaysService', () => ({
  EssaysService: {
    getInstance: () => ({
      resolveDownload,
      submitJob: vi.fn(),
      listJobs: vi.fn(),
      getJob: vi.fn(),
      deleteJob: vi.fn(),
      rerunJob: vi.fn(),
    }),
  },
}));

vi.mock('../../../services/exportService', () => ({
  ExportService: {
    getInstance: () => ({
      getExportFilePath,
      startExport: vi.fn(),
      getExportStatus: vi.fn(),
      cancelExport: vi.fn(),
      getExportHistory: vi.fn(),
    }),
  },
}));

// Multer's disk setup is irrelevant here and would touch the filesystem.
vi.mock('../../../middleware/upload', () => ({
  uploadEssaysFiles: (_req: Request, _res: Response, next: NextFunction) =>
    next(),
  handleUploadError: (_req: Request, _res: Response, next: NextFunction) =>
    next(),
}));

import { essaysRoutes } from '../essaysRoutes';
import { exportRoutes } from '../exportRoutes';
import { issueDownloadToken } from '../../../services/export/downloadTokenService';

let sessionUser: typeof SESSION_USER | undefined = SESSION_USER;

// RFC-shaped: `param('jobId').isUUID()` checks the version and variant
// nibbles, so an all-1s string is a 400 before any of this is reached.
const JOB = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const TOKEN_USER = '33333333-3333-3333-3333-333333333333';
const ESSAYS_SENTINEL = 'essays';

const ARCHIVE_BYTES = Buffer.from('PK not really a zip');
let dir: string;
let archivePath: string;

function app(): express.Application {
  const a = express();
  a.use('/api', exportRoutes);
  a.use('/api', essaysRoutes);
  return a;
}

const essaysUrl = (query = ''): string =>
  `/api/essays/jobs/${JOB}/download${query}`;
const exportUrl = (query = ''): string =>
  `/api/projects/${PROJECT}/export/${JOB}/download${query}`;

describe('download routes: one predicate decides whether the session runs', () => {
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'download-auth-'));
    archivePath = path.join(dir, 'export.zip');
    writeFileSync(archivePath, ARCHIVE_BYTES);
    process.env.EXPORT_DIR = dir;
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    sessionUser = SESSION_USER;
    resolveDownload.mockResolvedValue({
      filePath: archivePath,
      downloadName: 'results.zip',
    });
    getExportFilePath.mockResolvedValue(archivePath);
    recordMock.mockResolvedValue(undefined);
  });

  describe('essays', () => {
    it('runs the session middleware when there is no ?token= at all', async () => {
      await request(app()).get(essaysUrl()).expect(200);

      expect(authenticateMock).toHaveBeenCalledTimes(1);
      expect(resolveDownload).toHaveBeenCalledWith(SESSION_USER.id, JOB);
      expect(recordMock.mock.calls[0][0]).toMatchObject({
        kind: 'essays',
        event: 'downloaded',
        userId: SESSION_USER.id,
        detail: 'jwt',
      });
    });

    it('treats an EMPTY ?token= as the session pull it actually is', async () => {
      // The exact drift that shipped once: a router predicate of
      // `typeof token === 'string'` skips `authenticate` here, and a controller
      // that re-derives its own predicate answers 401 on a request that has a
      // perfectly good session.
      await request(app()).get(essaysUrl('?token=')).expect(200);

      expect(authenticateMock).toHaveBeenCalledTimes(1);
      expect(recordMock.mock.calls[0][0]).toMatchObject({
        userId: SESSION_USER.id,
        detail: 'jwt',
      });
    });

    it('accepts a signed token with NO session, and audits the token subject', async () => {
      sessionUser = undefined;
      const { token } = issueDownloadToken(JOB, ESSAYS_SENTINEL, TOKEN_USER);

      await request(app())
        .get(essaysUrl(`?token=${encodeURIComponent(token)}`))
        .expect(200);

      expect(authenticateMock).not.toHaveBeenCalled();
      expect(resolveDownload).toHaveBeenCalledWith(TOKEN_USER, JOB);
      expect(recordMock.mock.calls[0][0]).toMatchObject({
        userId: TOKEN_USER,
        detail: 'token',
      });
    });

    it('lets a garbage token reach the controller so the refusal is audited', async () => {
      sessionUser = undefined;

      await request(app()).get(essaysUrl('?token=not-a-token')).expect(401);

      expect(authenticateMock).not.toHaveBeenCalled();
      expect(recordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'essays',
          event: 'denied',
          detail: expect.stringContaining('invalid-token:'),
        })
      );
      expect(resolveDownload).not.toHaveBeenCalled();
    });

    it('refuses a token minted for another project (export ↔ essays isolation)', async () => {
      sessionUser = undefined;
      const { token } = issueDownloadToken(JOB, PROJECT, TOKEN_USER);

      await request(app())
        .get(essaysUrl(`?token=${encodeURIComponent(token)}`))
        .expect(401);

      expect(recordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'denied',
          userId: TOKEN_USER,
          detail: 'token-resource-mismatch',
        })
      );
      expect(resolveDownload).not.toHaveBeenCalled();
    });

    it('falls back to the session for a REPEATED ?token= (an array, not a string)', async () => {
      // `?token=a&token=b` parses to string[]. Anything that is not a
      // non-empty string must fail closed onto the cookie.
      const { token } = issueDownloadToken(JOB, ESSAYS_SENTINEL, TOKEN_USER);
      sessionUser = undefined;

      await request(app())
        .get(essaysUrl(`?token=${encodeURIComponent(token)}&token=x`))
        .expect(401);

      expect(authenticateMock).toHaveBeenCalledTimes(1);
      expect(resolveDownload).not.toHaveBeenCalled();
    });
  });

  describe('export', () => {
    it('runs the session middleware when there is no ?token= at all', async () => {
      await request(app()).get(exportUrl()).expect(200);

      expect(authenticateMock).toHaveBeenCalledTimes(1);
      expect(recordMock.mock.calls[0][0]).toMatchObject({
        kind: 'project',
        event: 'downloaded',
        userId: SESSION_USER.id,
        detail: 'jwt',
      });
    });

    it('treats an EMPTY ?token= as the session pull it actually is', async () => {
      await request(app()).get(exportUrl('?token=')).expect(200);

      expect(authenticateMock).toHaveBeenCalledTimes(1);
      expect(recordMock.mock.calls[0][0]).toMatchObject({
        userId: SESSION_USER.id,
        detail: 'jwt',
      });
    });

    it('accepts a signed token with NO session, and audits the token subject', async () => {
      sessionUser = undefined;
      const { token } = issueDownloadToken(JOB, PROJECT, TOKEN_USER);

      await request(app())
        .get(exportUrl(`?token=${encodeURIComponent(token)}`))
        .expect(200);

      expect(authenticateMock).not.toHaveBeenCalled();
      expect(recordMock.mock.calls[0][0]).toMatchObject({
        userId: TOKEN_USER,
        detail: 'token',
      });
    });

    it('lets a garbage token reach the controller so the refusal is audited', async () => {
      sessionUser = undefined;

      await request(app()).get(exportUrl('?token=not-a-token')).expect(401);

      expect(authenticateMock).not.toHaveBeenCalled();
      expect(recordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'project',
          event: 'denied',
          detail: expect.stringContaining('invalid-token:'),
        })
      );
      expect(getExportFilePath).not.toHaveBeenCalled();
    });

    it('refuses a token minted for another job', async () => {
      sessionUser = undefined;
      const { token } = issueDownloadToken(
        '44444444-4444-4444-8444-444444444444',
        PROJECT,
        TOKEN_USER
      );

      await request(app())
        .get(exportUrl(`?token=${encodeURIComponent(token)}`))
        .expect(403);

      expect(recordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'denied',
          userId: TOKEN_USER,
          detail: 'token-resource-mismatch',
        })
      );
      expect(getExportFilePath).not.toHaveBeenCalled();
    });
  });
});
