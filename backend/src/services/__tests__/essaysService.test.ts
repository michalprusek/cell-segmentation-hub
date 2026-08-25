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
// fs.promises returns PROMISES; a bare vi.fn() returns undefined, and any
// production `await fs.rm(...).catch(...)` then dies on undefined.catch.
vi.mock('fs', () => ({
  promises: {
    access: (...a: unknown[]) => fsAccess(...a),
    mkdir: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ size: 0 }),
    readFile: (...a: unknown[]) => fsReadFile(...a),
    rename: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));
// Keep sanitizeFilename real-ish but avoid pulling in archiver et al.
vi.mock('../export/exportFileOperations', () => ({
  createZipArchive: vi.fn(),
  sanitizeFilename: (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_'),
}));

import {
  sanitizeNd2Name,
  EssaysService,
  coerceDevice,
  shouldKeepInput,
  isRetentionExpired,
} from '../essaysService';

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

// ─── input retention + rerun ─────────────────────────────────────────────────
//
// Roman, 2026-08-25: "Občas se stane že segmentace neproběhne ... hodila by se
// možnost znovu spuštění segmentace již nahraných složek abych je nemusel
// nahrávat znovu." He had re-uploaded the same 180-file, 9.9 GB folder three
// times, because a run that does not finish cleanly leaves nothing to re-run
// from: the finalize path deleted the whole job dir, input included.
//
// A run can fail to finish cleanly in TWO ways, and only one of them is called
// 'failed'. evaluate.py returns 0 even when individual wells failed to read or
// segment, so a PARTIAL run is stored as 'completed' carrying an `error` — and
// that is exactly the case Roman hit ("nebyla paměť na segmentaci všech jamek").
// Keying retention on status alone would therefore miss his case entirely;
// these tests key it on whether the run finished cleanly.

describe('shouldKeepInput (which runs are worth re-running)', () => {
  it('deletes the input after a clean run, as before', () => {
    expect(shouldKeepInput({ status: 'completed', error: null })).toBe(false);
    expect(shouldKeepInput({ status: 'completed', error: '' })).toBe(false);
  });

  it('keeps the input when the job failed outright', () => {
    expect(
      shouldKeepInput({
        status: 'failed',
        error: 'Worker stopped reporting (job timed out).',
      })
    ).toBe(true);
  });

  it('keeps the input when a "completed" run was actually partial', () => {
    // The case that keying on status would miss.
    expect(
      shouldKeepInput({ status: 'completed', error: '12 wells failed to read' })
    ).toBe(true);
  });

  it('does not keep anything for a job still in flight', () => {
    // Nothing to decide yet; the finalize path has not run.
    expect(shouldKeepInput({ status: 'running', error: null })).toBe(false);
    expect(shouldKeepInput({ status: 'queued', error: null })).toBe(false);
  });
});

describe('isRetentionExpired (the TTL that stops kept inputs growing)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date('2026-08-25T12:00:00Z');

  it('keeps a recently failed run', () => {
    expect(
      isRetentionExpired(new Date(now.getTime() - 2 * DAY), 7, now)
    ).toBe(false);
  });

  it('drops one past the window', () => {
    expect(
      isRetentionExpired(new Date(now.getTime() - 8 * DAY), 7, now)
    ).toBe(true);
  });

  it('treats the boundary as still inside the window', () => {
    // A job exactly at the limit is not yet expired — a TTL that fires early
    // deletes the input on the day the user comes back for it.
    expect(isRetentionExpired(new Date(now.getTime() - 7 * DAY), 7, now)).toBe(
      false
    );
  });

  it('never expires when the window is zero or negative (retention off)', () => {
    expect(
      isRetentionExpired(new Date(now.getTime() - 900 * DAY), 0, now)
    ).toBe(false);
    expect(
      isRetentionExpired(new Date(now.getTime() - 900 * DAY), -1, now)
    ).toBe(false);
  });
});

describe('rerunJob', () => {
  const svc = () => EssaysService.getInstance();

  beforeEach(() => {
    vi.clearAllMocks();
    fsAccess.mockReset();
  });

  it('refuses a job that is not the caller\'s', async () => {
    prismaMock.essayJob.findFirst.mockResolvedValue(null);
    await expect(svc().rerunJob(USER, JOB)).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(prismaMock.essayJob.update).not.toHaveBeenCalled();
  });

  it('refuses while the job is still in flight', async () => {
    // Re-queueing a running job would hand the worker the same jobId twice and
    // let two runs write the same output dir.
    prismaMock.essayJob.findFirst.mockResolvedValue({
      id: JOB,
      userId: USER,
      status: 'running',
      error: null,
    });
    await expect(svc().rerunJob(USER, JOB)).resolves.toEqual({
      ok: false,
      reason: 'in_flight',
    });
    expect(prismaMock.essayJob.update).not.toHaveBeenCalled();
  });

  it('refuses when the input is no longer on disk', async () => {
    // The honest failure: a clean run's input was deleted, so there is nothing
    // to re-run from and the user must be told rather than shown a job that
    // silently fails a minute later.
    prismaMock.essayJob.findFirst.mockResolvedValue({
      id: JOB,
      userId: USER,
      status: 'completed',
      error: null,
    });
    fsAccess.mockRejectedValue(new Error('ENOENT'));
    await expect(svc().rerunJob(USER, JOB)).resolves.toEqual({
      ok: false,
      reason: 'input_gone',
    });
    expect(prismaMock.essayJob.update).not.toHaveBeenCalled();
  });

  it('re-queues a failed job and clears the previous outcome', async () => {
    prismaMock.essayJob.findFirst.mockResolvedValue({
      id: JOB,
      userId: USER,
      status: 'failed',
      error: 'Worker stopped reporting (job timed out).',
      resultZipKey: null,
    });
    fsAccess.mockResolvedValue(undefined);
    prismaMock.essayJob.update.mockResolvedValue({});

    await expect(svc().rerunJob(USER, JOB)).resolves.toEqual({ ok: true });

    const data = prismaMock.essayJob.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: 'queued',
      progress: 0,
      error: null,
      resultZipKey: null,
      completedAt: null,
    });
  });

  it('re-queues a partial run too — that is the reported case', async () => {
    // Stored as 'completed' with an error, because evaluate.py exits 0 when
    // individual wells fail. Refusing it would miss the whole point.
    prismaMock.essayJob.findFirst.mockResolvedValue({
      id: JOB,
      userId: USER,
      status: 'completed',
      error: '12 wells failed to read',
      resultZipKey: 'essays-results/job-1.zip',
    });
    fsAccess.mockResolvedValue(undefined);
    prismaMock.essayJob.update.mockResolvedValue({});

    await expect(svc().rerunJob(USER, JOB)).resolves.toEqual({ ok: true });
    expect(prismaMock.essayJob.update.mock.calls[0][0].data.status).toBe(
      'queued'
    );
  });
});

describe('listJobs canRerun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsAccess.mockReset();
  });

  it('offers a re-run only when the input is really on disk', async () => {
    // Deriving this from status would light the button up for every finished
    // job, including the clean ones whose input was deleted on purpose.
    prismaMock.essayJob.findMany = vi.fn().mockResolvedValue([
      { id: 'a', userId: USER, status: 'failed', error: 'timed out' },
      { id: 'b', userId: USER, status: 'completed', error: null },
      { id: 'c', userId: USER, status: 'running', error: null },
    ]);
    // 'a' has input, 'b' does not; 'c' is never stat'd because it is in flight.
    fsAccess.mockImplementation((p: string) =>
      p.includes('/a/') ? Promise.resolve() : Promise.reject(new Error('ENOENT'))
    );

    const jobs = await EssaysService.getInstance().listJobs(USER);
    expect(jobs.map((j) => [j.id, j.canRerun])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
    ]);
  });
});
