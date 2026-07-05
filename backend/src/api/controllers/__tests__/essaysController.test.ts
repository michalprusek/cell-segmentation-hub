import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../utils/config', () => ({
  config: {
    JWT_ACCESS_SECRET:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    NODE_ENV: 'test',
    ESSAYS_SERVICE_URL: 'http://essays:8000',
    UPLOAD_DIR: '/app/uploads',
  },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Stub the service so constructing the controller doesn't spin up axios/timers.
const resolveDownload = vi.fn();
vi.mock('../../../services/essaysService', () => ({
  EssaysService: {
    getInstance: () => ({
      resolveDownload,
      submitJob: vi.fn(),
      listJobs: vi.fn(),
      getJob: vi.fn(),
      deleteJob: vi.fn(),
    }),
  },
}));
vi.mock('../../../utils/response', () => ({
  ResponseHelper: {
    unauthorized: vi.fn(),
    notFound: vi.fn(),
    badRequest: vi.fn(),
    internalError: vi.fn(),
  },
}));

import { EssaysController, parseOptions } from '../essaysController';
import { ResponseHelper } from '../../../utils/response';
// Real token service (config is mocked, so the secret is fixed) — the sentinel
// tests must exercise the actual issue/verify crypto, not a stub.
import { issueDownloadToken } from '../../../services/export/downloadTokenService';

const JOB = '11111111-1111-1111-1111-111111111111';
const USER = '33333333-3333-3333-3333-333333333333';
const SENTINEL = 'essays';

describe('parseOptions (evaluate.py option whitelist)', () => {
  it('returns {} for non-string / empty / whitespace input', () => {
    expect(parseOptions(undefined)).toEqual({});
    expect(parseOptions(42)).toEqual({});
    expect(parseOptions('')).toEqual({});
    expect(parseOptions('   ')).toEqual({});
  });

  it('returns {} for invalid JSON', () => {
    expect(parseOptions('{not json')).toEqual({});
  });

  it('drops unknown keys entirely', () => {
    expect(parseOptions('{"evil":"rm -rf /","__proto__":{}}')).toEqual({});
  });

  it('drops ill-typed values (string number, non-boolean, non-finite)', () => {
    expect(parseOptions('{"threshold":"5"}')).toEqual({});
    expect(parseOptions('{"threshold":null}')).toEqual({});
    expect(parseOptions('{"mtWidth":"3"}')).toEqual({});
    expect(parseOptions('{"noOverlays":"true"}')).toEqual({});
  });

  it('keeps a falsy-zero numeric option (the !== undefined edge)', () => {
    expect(parseOptions('{"threshold":0}')).toEqual({ threshold: 0 });
  });

  it('passes through exactly the whitelisted, well-typed keys', () => {
    const out = parseOptions(
      JSON.stringify({
        threshold: 0.6,
        mtWidth: 5,
        bgGap: 1,
        bgWidth: 5,
        limitWells: 2,
        tirfName: 'tirf',
        solutionName: 'insol',
        noOverlays: true,
        noJson: false,
        somethingElse: 'ignored',
      })
    );
    expect(out).toEqual({
      threshold: 0.6,
      mtWidth: 5,
      bgGap: 1,
      bgWidth: 5,
      limitWells: 2,
      tirfName: 'tirf',
      solutionName: 'insol',
      noOverlays: true,
      noJson: false,
    });
  });
});

describe('EssaysController.downloadJob (download-token sentinel)', () => {
  const controller = new EssaysController();

  const mockRes = () => {
    const res: Record<string, unknown> = {
      setHeader: vi.fn(),
      sendFile: vi.fn((_p: string, cb?: (e?: Error) => void) => cb && cb()),
      headersSent: false,
    };
    return res as never;
  };
  const reqWithToken = (token: string) =>
    ({ params: { jobId: JOB }, query: { token } }) as never;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveDownload.mockResolvedValue({
      filePath: '/exports/x.zip',
      downloadName: 'x_results.zip',
    });
  });

  it('streams the file for a valid essays token', async () => {
    const { token } = issueDownloadToken(JOB, SENTINEL, USER);
    const res = mockRes();
    await controller.downloadJob(reqWithToken(token), res);
    expect(resolveDownload).toHaveBeenCalledWith(USER, JOB);
    expect((res as unknown as { sendFile: ReturnType<typeof vi.fn> }).sendFile)
      .toHaveBeenCalled();
    expect(ResponseHelper.unauthorized).not.toHaveBeenCalled();
  });

  it('rejects a token minted for a different project (export ↔ essays isolation)', async () => {
    const { token } = issueDownloadToken(
      JOB,
      '22222222-2222-2222-2222-222222222222',
      USER
    );
    await controller.downloadJob(reqWithToken(token), mockRes());
    expect(ResponseHelper.unauthorized).toHaveBeenCalled();
    expect(resolveDownload).not.toHaveBeenCalled();
  });

  it('rejects a token bound to a different jobId', async () => {
    const { token } = issueDownloadToken('99999999-9999-9999-9999-999999999999', SENTINEL, USER);
    await controller.downloadJob(reqWithToken(token), mockRes());
    expect(ResponseHelper.unauthorized).toHaveBeenCalled();
    expect(resolveDownload).not.toHaveBeenCalled();
  });

  it('rejects a tampered/garbage token as unauthorized (not 500)', async () => {
    await controller.downloadJob(reqWithToken('not.a.valid.token'), mockRes());
    expect(ResponseHelper.unauthorized).toHaveBeenCalled();
    expect(ResponseHelper.internalError).not.toHaveBeenCalled();
    expect(resolveDownload).not.toHaveBeenCalled();
  });

  it('returns 404 when a valid token resolves no downloadable file', async () => {
    resolveDownload.mockResolvedValue(null);
    const { token } = issueDownloadToken(JOB, SENTINEL, USER);
    await controller.downloadJob(reqWithToken(token), mockRes());
    expect(ResponseHelper.notFound).toHaveBeenCalled();
  });
});
