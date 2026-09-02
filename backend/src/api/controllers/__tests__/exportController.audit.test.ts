/**
 * Wiring, not helper: `recordExportEvent` has its own unit tests, and the way
 * this feature fails is that nobody calls it, or calls it with the wrong
 * person.
 *
 * The download route accepts EITHER a session JWT or a signed token carried in
 * the URL, and the signed token names its own user. A download must therefore
 * be attributed to whoever the request actually authenticated as — the token's
 * subject when there is one — because that URL can be forwarded, and "who took
 * the data" is the entire question this log exists to answer.
 */
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

vi.mock('../../../services/exportService');
vi.mock('../../../utils/logger');

const { recordMock } = vi.hoisted(() => ({ recordMock: vi.fn() }));

vi.mock('../../../services/exportAuditService', () => ({
  recordExportEvent: recordMock,
}));

vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    EXPORT_DIR: './exports',
    JWT_ACCESS_SECRET: 'test-secret',
    JWT_REFRESH_SECRET: 'test-refresh',
    DATABASE_URL: 'file:./test.db',
  },
}));

vi.mock('../../../services/export/downloadTokenService', () => ({
  issueDownloadToken: vi.fn(),
  verifyDownloadToken: vi.fn(),
  InvalidDownloadTokenError: class InvalidDownloadTokenError extends Error {},
}));

import { ExportController } from '../exportController';
import { ExportService } from '../../../services/exportService';
import { verifyDownloadToken } from '../../../services/export/downloadTokenService';

const projectId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const jobId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const sessionUser = { id: 'session-user', email: 'a@example.com' };

// A REAL archive on disk, not a mocked `fs`: the success path ends in
// `res.sendFile`, which streams through express's own filesystem access and
// never completes against a mock. It also means the recorded size is the
// file's true byte length rather than a number this test made up.
const ARCHIVE_BYTES = Buffer.from('PK\u0003\u0004 not really a zip');
let exportDir: string;
let archivePath: string;

let authUser: typeof sessionUser | undefined;
let service: { getExportFilePath: ReturnType<typeof vi.fn> };

function buildApp(): express.Application {
  const app = express();
  const auth = (
    req: Request & { user?: unknown },
    _res: Response,
    next: NextFunction
  ) => {
    req.user = authUser;
    next();
  };
  const ctrl = new ExportController();
  app.get(
    '/projects/:projectId/export/:jobId/download',
    auth,
    ctrl.downloadExport
  );
  return app;
}

describe('export download auditing', () => {
  beforeAll(() => {
    exportDir = mkdtempSync(path.join(tmpdir(), 'export-audit-'));
    process.env.EXPORT_DIR = exportDir;
    archivePath = path.join(exportDir, 'export.zip');
    writeFileSync(archivePath, ARCHIVE_BYTES);
  });

  afterAll(() => {
    rmSync(exportDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    recordMock.mockReset().mockResolvedValue(undefined);
    authUser = sessionUser;

    service = { getExportFilePath: vi.fn() };
    service.getExportFilePath.mockResolvedValue(archivePath);
    vi.mocked(ExportService.getInstance).mockReturnValue(
      service as unknown as ExportService
    );
  });

  it('records the session user for a JWT download', async () => {
    await request(buildApp())
      .get(`/projects/${projectId}/export/${jobId}/download`)
      .expect(200);

    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock.mock.calls[0][0]).toMatchObject({
      kind: 'project',
      event: 'downloaded',
      userId: sessionUser.id,
      jobId,
      projectId,
      fileSizeBytes: ARCHIVE_BYTES.length,
      detail: 'jwt',
    });
  });

  it("records the TOKEN's user, not the session's, for a signed download", async () => {
    // The signed-token path exists so a browser <a href> can download without
    // an Authorization header. The URL is therefore forwardable, which is
    // exactly why the log has to name the token's subject.
    vi.mocked(verifyDownloadToken).mockReturnValue({
      jobId,
      projectId,
      userId: 'token-user',
    } as ReturnType<typeof verifyDownloadToken>);

    await request(buildApp())
      .get(`/projects/${projectId}/export/${jobId}/download?token=signed`)
      .expect(200);

    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock.mock.calls[0][0]).toMatchObject({
      userId: 'token-user',
      detail: 'token',
    });
  });

  it('records a DENIED row when the request carries no credential', async () => {
    // Denied attempts are the most interesting rows in an attribution log: a
    // forwarded signed-token URL retried after it expired, or someone walking
    // job ids, otherwise leaves no trace in the table built to catch exactly
    // that. There is no actor to name, which must not stop the row.
    authUser = undefined;

    await request(buildApp())
      .get(`/projects/${projectId}/export/${jobId}/download`)
      .expect(401);

    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'project',
        event: 'denied',
        userId: null,
        jobId,
        projectId,
        detail: 'no-credential',
      })
    );
  });

  it('records a DENIED row for a token pointed at another resource', async () => {
    // A valid signature over the wrong job — an edited forwarded URL. The
    // token still names its subject, so this row has an actor.
    vi.mocked(verifyDownloadToken).mockReturnValue({
      jobId: 'some-other-job',
      projectId,
      userId: 'token-user',
    } as ReturnType<typeof verifyDownloadToken>);

    await request(buildApp())
      .get(`/projects/${projectId}/export/${jobId}/download?token=signed`)
      .expect(403);

    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'denied',
        userId: 'token-user',
        detail: 'token-resource-mismatch',
      })
    );
  });

  it('records no DOWNLOAD when the file is not found', async () => {
    // A 404 is not an export. The `denied` rows above are refusals the code
    // knows about; a missing file is not one of them.
    service.getExportFilePath.mockResolvedValue(null);

    await request(buildApp())
      .get(`/projects/${projectId}/export/${jobId}/download`)
      .expect(404);

    expect(recordMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'downloaded' })
    );
  });

});
