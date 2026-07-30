import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';

// vi.hoisted so the mock factories below can reference the prisma mock.
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    essayJob: {
      findFirst: vi.fn() as any,
      update: vi.fn() as any,
    },
  },
}));

const fsAccess = vi.fn();
const fsReadFile = vi.fn();

vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../utils/config', () => ({
  config: {
    ESSAYS_SERVICE_URL: 'http://essays:8000',
    UPLOAD_DIR: '/app/uploads',
  },
}));
// The service constructs an axios client + timers in its constructor; stub them
// so getInstance() is side-effect-free under test.
vi.mock('axios', () => ({
  default: { create: vi.fn(() => ({ post: vi.fn() })) },
}));
vi.mock('fs', () => ({
  promises: {
    access: (...a: unknown[]) => fsAccess(...a),
    mkdir: vi.fn(),
    rm: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    readFile: (...a: unknown[]) => fsReadFile(...a),
    rename: vi.fn(),
    copyFile: vi.fn(),
    unlink: vi.fn(),
  },
}));
// Keep sanitizeFilename real-ish but avoid pulling in archiver et al.
vi.mock('../export/exportFileOperations', () => ({
  createZipArchive: vi.fn(),
  sanitizeFilename: (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_'),
}));

import { sanitizeNd2Name, EssaysService, coerceDevice } from '../essaysService';

const USER = 'user-1';
const JOB = 'job-1';

describe('sanitizeNd2Name (staged-filename sanitization)', () => {
  it('strips a parent-traversal path to a bare basename', () => {
    expect(sanitizeNd2Name('../evil.nd2')).toBe('evil.nd2');
    expect(sanitizeNd2Name('../../../../tmp/x.nd2')).toBe('x.nd2');
  });

  it('strips an absolute path and appends a single .nd2', () => {
    expect(sanitizeNd2Name('/etc/passwd')).toBe('passwd.nd2');
  });

  it('lowercases an uppercase extension without doubling it', () => {
    expect(sanitizeNd2Name('WELL.ND2')).toBe('WELL.nd2');
    expect(sanitizeNd2Name('D04_TIRF.Nd2')).toBe('D04_TIRF.nd2');
  });

  it('replaces unsafe characters with underscores', () => {
    expect(sanitizeNd2Name('my well;rm -rf.nd2')).toBe('my_well_rm_-rf.nd2');
  });

  it('appends .nd2 when there is no extension', () => {
    expect(sanitizeNd2Name('noext')).toBe('noext.nd2');
  });
});

describe('EssaysService.resolveDownload (path-traversal + ownership guard)', () => {
  const svc = EssaysService.getInstance();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EXPORT_DIR = '/tmp/essays-exports-test';
    fsAccess.mockResolvedValue(undefined);
  });

  it('returns null when the job is not found (ownership isolation)', async () => {
    // findFirst is keyed on { id, userId }, so a mismatched owner yields null.
    prismaMock.essayJob.findFirst.mockResolvedValue(null);
    expect(await svc.resolveDownload(USER, JOB)).toBeNull();
  });

  it('returns null when the job is not completed', async () => {
    prismaMock.essayJob.findFirst.mockResolvedValue({
      id: JOB,
      userId: USER,
      status: 'running',
      resultZipKey: 'x.zip',
      name: 'r',
    });
    expect(await svc.resolveDownload(USER, JOB)).toBeNull();
  });

  it('returns null when there is no resultZipKey', async () => {
    prismaMock.essayJob.findFirst.mockResolvedValue({
      id: JOB,
      userId: USER,
      status: 'completed',
      resultZipKey: null,
      name: 'r',
    });
    expect(await svc.resolveDownload(USER, JOB)).toBeNull();
  });

  it('rejects a path-traversal resultZipKey before touching the filesystem', async () => {
    prismaMock.essayJob.findFirst.mockResolvedValue({
      id: JOB,
      userId: USER,
      status: 'completed',
      resultZipKey: '../../../etc/passwd',
      name: 'r',
    });
    expect(await svc.resolveDownload(USER, JOB)).toBeNull();
    expect(fsAccess).not.toHaveBeenCalled();
  });

  it('returns null when the completed zip file is gone from disk', async () => {
    prismaMock.essayJob.findFirst.mockResolvedValue({
      id: JOB,
      userId: USER,
      status: 'completed',
      resultZipKey: 'good.zip',
      name: 'r',
    });
    fsAccess.mockRejectedValue(new Error('ENOENT'));
    expect(await svc.resolveDownload(USER, JOB)).toBeNull();
  });

  it('resolves a completed job to a path inside the uploads volume with a sanitized name', async () => {
    prismaMock.essayJob.findFirst.mockResolvedValue({
      id: JOB,
      userId: USER,
      status: 'completed',
      // resultZipKey is relative to the (persistent) uploads volume.
      resultZipKey: 'essays-results/job-1.zip',
      name: 'My Run/2026',
    });
    const dl = await svc.resolveDownload(USER, JOB);
    expect(dl).not.toBeNull();
    // config mock sets UPLOAD_DIR = '/app/uploads'
    expect(dl!.filePath).toBe(
      path.resolve('/app/uploads', 'essays-results/job-1.zip')
    );
    // sanitized (no slash/space) and suffixed
    expect(dl!.downloadName).toBe('My_Run_2026_results.zip');
  });
});

describe('coerceDevice (worker device report -> UI domain)', () => {
  it('passes through the two devices the worker can actually run on', () => {
    expect(coerceDevice('cuda', undefined)).toBe('cuda');
    expect(coerceDevice('cpu', undefined)).toBe('cpu');
  });

  it('distinguishes a broken GPU from a merely busy one', () => {
    // The whole point. Only 'fault' is worth telling a user to report; 'busy'
    // is a shared card doing its job and must not wear the incident badge.
    expect(coerceDevice('cpu', 'fault')).toBe('cpu-degraded');
    expect(coerceDevice('cpu', 'busy')).toBe('cpu-busy');
  });

  it('leaves a CPU-only host as plain cpu', () => {
    expect(coerceDevice('cpu', null)).toBe('cpu');
  });

  it('never annotates cuda — no reason is meaningful there', () => {
    expect(coerceDevice('cuda', 'fault')).toBe('cuda');
    expect(coerceDevice('cuda', 'busy')).toBe('cuda');
  });

  it('rejects anything outside the domain so junk cannot reach the DB or the badge', () => {
    // status.json is parsed with an unchecked cast, so this is the only guard.
    expect(coerceDevice('gpu', undefined)).toBeUndefined();
    expect(coerceDevice('cpu-degraded', undefined)).toBeUndefined();
    expect(coerceDevice(undefined, undefined)).toBeUndefined();
    expect(coerceDevice(null, 'fault')).toBeUndefined();
    expect(coerceDevice(42, undefined)).toBeUndefined();
  });

  it('ignores an unrecognised reason rather than inventing a state', () => {
    expect(coerceDevice('cpu', 'degraded')).toBe('cpu');
    expect(coerceDevice('cpu', true)).toBe('cpu');
  });
});

describe('reconcileJob wiring (coerceDevice is actually applied to the DB write)', () => {
  // The pure-function tests above all pass even if both call sites are reverted
  // to a raw `ws.device` cast — the helper stays proven while the wiring
  // regresses silently, and the badge quietly goes back to plain "CPU". This
  // suite is what fails in that case.
  const jobRow = {
    id: JOB,
    userId: USER,
    status: 'running',
    progress: 10,
    mtCount: 0,
    device: 'cuda',
    updatedAt: new Date(),
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.essayJob.update.mockResolvedValue({});
  });

  const reconcile = (ws: Record<string, unknown>) => {
    fsReadFile.mockResolvedValue(JSON.stringify(ws));
    return (EssaysService.getInstance() as never as {
      reconcileJob: (j: never) => Promise<boolean>;
    }).reconcileJob(jobRow);
  };

  it("writes cpu-degraded when the worker reports a fault", async () => {
    await reconcile({ state: 'running', progress: 20, device: 'cpu', deviceReason: 'fault' });
    expect(prismaMock.essayJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ device: 'cpu-degraded' }) })
    );
  });

  it('writes cpu-busy when the shared card was merely busy', async () => {
    await reconcile({ state: 'running', progress: 20, device: 'cpu', deviceReason: 'busy' });
    expect(prismaMock.essayJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ device: 'cpu-busy' }) })
    );
  });

  it('keeps the stored device when the worker reports something out of domain', async () => {
    await reconcile({ state: 'running', progress: 20, device: 'quantum', deviceReason: 'fault' });
    const call = prismaMock.essayJob.update.mock.calls[0];
    // Either no update at all (nothing changed) or the previous value retained —
    // never the junk value.
    if (call) expect(call[0].data.device).toBe('cuda');
  });
});
