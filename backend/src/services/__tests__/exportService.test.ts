/**
 * exportService.test.ts — Job management & lifecycle.
 *
 * Covers the public job-orchestration surface of ExportService and its
 * job-state private helpers:
 *   - getInstance singleton
 *   - startExportJob (access guard, per-user rate limit, projectName
 *     supplied / fetched-from-DB / DB-lookup-throws)
 *   - hasActiveJobForUser (which statuses block a new job)
 *   - getJobStatus / getExportFilePath / getExportJob (access + project gating)
 *   - cancelJob (status transitions, idempotency, silent no-op paths)
 *   - getExportHistory (project filter, newest-first, cap 10, access guard)
 *   - cleanupOldJobs (TTL eviction + logging)
 *   - destroy (interval teardown)
 *   - sendToUser (WS passthrough + no-ws + emit-throws branches)
 *   - updateJobProgress (enriched progress payload + phase computation)
 *
 * Content-generation paths (metrics / annotations / visualizations / docs /
 * MT / wound) live in exportService.generation.test.ts and
 * exportService.woundTimeSeries.test.ts.
 *
 * All I/O (FS / archiver / sharp / Prisma / ML) is mocked — nothing real runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mocks — factories use only inline vi.fn() / hoisted consts ───────

vi.mock('../../db', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    image: { update: vi.fn() },
  },
}));

vi.mock('../../db/prismaClient', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    image: { update: vi.fn() },
  },
}));

const mockHasProjectAccess = vi.fn().mockResolvedValue({ hasAccess: true });
vi.mock('../sharingService', () => ({
  hasProjectAccess: (...args: unknown[]) => mockHasProjectAccess(...args),
}));

const mockEmitToUser = vi.fn();
vi.mock('../websocketService', () => ({
  WebSocketService: {
    getInstance: vi.fn(() => ({ emitToUser: mockEmitToUser })),
  },
}));

vi.mock('uuid', () => ({ v4: vi.fn(() => 'export-job-id') }));

vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    UPLOAD_DIR: './test-uploads',
    EXPORT_DIR: './test-exports',
    STORAGE_TYPE: 'local',
    NODE_ENV: 'test',
  },
}));

vi.mock('fs/promises', () => {
  const mod = {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('')),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ size: 0 }),
    unlink: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue({
      read: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    rm: vi.fn().mockResolvedValue(undefined),
  };
  return { ...mod, default: mod };
});

vi.mock('archiver', () => ({
  default: vi.fn(() => ({
    directory: vi.fn(),
    on: vi.fn(),
    pipe: vi.fn(),
    finalize: vi.fn().mockResolvedValue(undefined),
    readable: false,
    writable: false,
    destroy: vi.fn(),
    removeAllListeners: vi.fn(),
  })),
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
  })),
}));

vi.mock('../visualization/visualizationGenerator', () => ({
  VisualizationGenerator: vi.fn(),
}));

vi.mock('../metrics/metricsCalculator', () => ({
  MetricsCalculator: vi.fn(),
}));

vi.mock('../export/formatConverter', () => ({
  FormatConverter: vi.fn(),
  resolveImageDimensions: vi.fn().mockReturnValue({ width: 100, height: 100 }),
}));

vi.mock('../export/mtMetricsExporter', () => ({
  computeMTMetrics: vi.fn().mockResolvedValue({ rows: [], skipped: [] }),
  computeMTGeometry: vi.fn().mockReturnValue([]),
  writeMTMetrics: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../export/exportDocs', () => ({
  generateReadme: vi.fn().mockReturnValue('readme'),
  generateMetricsGuide: vi.fn().mockReturnValue('guide'),
  generateAnnotationGuides: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../export/exportFileOperations', async () => {
  const real = await vi.importActual<
    typeof import('../export/exportFileOperations')
  >('../export/exportFileOperations');
  return {
    ...real,
    createZipArchive: vi.fn().mockResolvedValue('/tmp/export.zip'),
  };
});

vi.mock('../../utils/batchProcessor', () => ({
  batchProcessor: {
    processBatch: vi.fn(
      async (
        items: unknown[],
        processor: (item: unknown) => Promise<unknown>
      ) => Promise.all(items.map(processor))
    ),
  },
}));

vi.mock('../../utils/concurrency', () => ({
  mapWithConcurrency: vi.fn(
    async (
      items: unknown[],
      _c: number,
      processor: (item: unknown) => Promise<unknown>
    ) => Promise.all(items.map(processor))
  ),
}));

vi.mock('../../types/validation', () => ({
  isMicrotubuleProject: (t: string | undefined | null) => t === 'microtubules',
  coerceProjectType: vi.fn((t: string) => t ?? 'spheroid'),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { ExportService, type ExportJob } from '../exportService';
import { MetricsCalculator } from '../metrics/metricsCalculator';
import { FormatConverter } from '../export/formatConverter';
import { VisualizationGenerator } from '../visualization/visualizationGenerator';
import { prisma } from '../../db';
import { logger } from '../../utils/logger';

const MockMetricsCalculator = MetricsCalculator as unknown as ReturnType<
  typeof vi.fn
>;
const MockFormatConverter = FormatConverter as unknown as ReturnType<
  typeof vi.fn
>;
const MockVizGen = VisualizationGenerator as unknown as ReturnType<
  typeof vi.fn
>;

// ─── Shared helpers ───────────────────────────────────────────────────────────

const JOB_ID = 'export-job-id';

const resetSingleton = () => {
  (ExportService as unknown as { instance: unknown }).instance = undefined;
};

/**
 * Fresh singleton with the three constructor collaborators stubbed. The stubs
 * must be (re)wired here because vitest's `restoreMocks` clears the factory
 * implementations before every test, and the ExportService constructor `new`s
 * all three collaborators.
 */
function makeService(): ExportService {
  resetSingleton();
  MockMetricsCalculator.mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.calculateAllMetrics = vi.fn().mockResolvedValue([]);
    this.calculateAllImageMetrics = vi.fn().mockResolvedValue([]);
    this.exportPolygonMetricsToExcel = vi.fn().mockResolvedValue(undefined);
    this.exportSpermToExcel = vi.fn().mockResolvedValue(true);
    this.exportToExcel = vi.fn().mockResolvedValue(undefined);
    this.exportToCSV = vi.fn().mockResolvedValue(undefined);
  });
  MockFormatConverter.mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.convertToCOCO = vi.fn().mockResolvedValue({});
    this.convertToYOLO = vi
      .fn()
      .mockResolvedValue({ content: '', warnings: [] });
    this.convertToJSON = vi.fn().mockResolvedValue({});
  });
  MockVizGen.mockImplementation(function (this: Record<string, unknown>) {
    this.generateVisualization = vi.fn().mockResolvedValue('success');
  });
  return ExportService.getInstance();
}

const getJobs = (svc: ExportService): Map<string, ExportJob> =>
  (svc as unknown as { exportJobs: Map<string, ExportJob> }).exportJobs;

const seedJob = (
  svc: ExportService,
  overrides: Partial<ExportJob> = {}
): ExportJob => {
  const job: ExportJob = {
    id: 'seed-job',
    projectId: 'proj-1',
    userId: 'user-1',
    status: 'completed',
    progress: 100,
    createdAt: new Date(),
    options: {},
    ...overrides,
  };
  getJobs(svc).set(job.id, job);
  return job;
};

/**
 * Make the background processExportJob (which re-checks access) exit
 * immediately so it never races the assertions. startExportJob's own guard
 * sees the first `true`; processExportJob's guard sees the second `false`.
 */
const failBackground = () => {
  mockHasProjectAccess
    .mockResolvedValueOnce({ hasAccess: true })
    .mockResolvedValueOnce({ hasAccess: false });
};

// ─── getInstance ──────────────────────────────────────────────────────────────

describe('ExportService — getInstance', () => {
  afterEach(resetSingleton);

  it('returns the same singleton on repeated calls', () => {
    resetSingleton();
    const a = ExportService.getInstance();
    const b = ExportService.getInstance();
    expect(a).toBe(b);
  });
});

// ─── startExportJob ───────────────────────────────────────────────────────────

describe('ExportService — startExportJob', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
    mockHasProjectAccess.mockResolvedValue({ hasAccess: true });
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  it('creates a pending job record and returns the jobId', async () => {
    failBackground();
    const id = await service.startExportJob('proj-1', 'user-1', {
      annotationFormats: ['json'],
    });

    expect(id).toBe(JOB_ID);
    const job = getJobs(service).get(JOB_ID);
    expect(job).toBeDefined();
    expect(job!.projectId).toBe('proj-1');
    expect(job!.userId).toBe('user-1');
    expect(typeof job!.progress).toBe('number');
  });

  it('throws "Access denied" when the user has no project access', async () => {
    mockHasProjectAccess.mockResolvedValue({ hasAccess: false });
    await expect(
      service.startExportJob('proj-1', 'user-1', {})
    ).rejects.toThrow('Access denied');
  });

  it('throws "Rate limit exceeded" when the user already has a pending job', async () => {
    seedJob(service, { id: 'existing', status: 'pending', userId: 'user-1' });
    await expect(
      service.startExportJob('proj-1', 'user-1', {})
    ).rejects.toThrow('Rate limit exceeded');
  });

  it('does not rate-limit a DIFFERENT user while the first is processing', async () => {
    seedJob(service, { id: 'u1-job', status: 'processing', userId: 'user-1' });
    failBackground();
    const id = await service.startExportJob('proj-1', 'user-2', {});
    expect(id).toBe(JOB_ID);
  });

  it('uses a supplied projectName without a DB title lookup', async () => {
    failBackground();
    await service.startExportJob('proj-1', 'user-1', {}, 'Explicit Name');

    const job = getJobs(service).get(JOB_ID);
    expect(job!.projectName).toBe('Explicit Name');
    const titleCall = vi
      .mocked(prisma.project.findUnique)
      .mock.calls.find(
        c => (c[0] as { select?: { title?: boolean } }).select?.title === true
      );
    expect(titleCall).toBeUndefined();
  });

  it('fetches projectName from the DB when none is supplied', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({
      title: 'DB Project Name',
    } as never);
    failBackground();

    await service.startExportJob('proj-1', 'user-1', {});
    expect(getJobs(service).get(JOB_ID)!.projectName).toBe('DB Project Name');
  });

  it('still creates the job when the projectName DB lookup throws', async () => {
    vi.mocked(prisma.project.findUnique).mockRejectedValueOnce(
      new Error('DB offline')
    );
    const id = await service.startExportJob('proj-1', 'user-1', {});
    expect(typeof id).toBe('string');
    expect(getJobs(service).has(id)).toBe(true);
  });
});

// ─── hasActiveJobForUser (via startExportJob) ────────────────────────────────

describe('ExportService — per-user active-job guard', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
    mockHasProjectAccess.mockResolvedValue({ hasAccess: true });
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      title: 'T',
    } as never);
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  it('a "processing" job blocks a new export for the same user', async () => {
    seedJob(service, { id: 'active', status: 'processing', userId: 'u' });
    await expect(service.startExportJob('proj-1', 'u', {})).rejects.toThrow(
      'Rate limit exceeded'
    );
  });

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'a "%s" (terminal) job does NOT block a new export',
    async status => {
      seedJob(service, { id: `${status}-job`, status, userId: 'u' });
      failBackground();
      const id = await service.startExportJob('proj-1', 'u', {});
      expect(typeof id).toBe('string');
    }
  );
});

// ─── getJobStatus / getExportFilePath / getExportJob ─────────────────────────

describe('ExportService — job read methods', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
    mockHasProjectAccess.mockResolvedValue({ hasAccess: true });
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const plant = (overrides: Partial<ExportJob> = {}): ExportJob =>
    seedJob(service, {
      id: 'job-read',
      projectId: 'proj-r',
      userId: 'user-r',
      status: 'completed',
      progress: 100,
      filePath: '/tmp/file.zip',
      ...overrides,
    });

  // getJobStatus
  it('getJobStatus returns the job when access + projectId match', async () => {
    const job = plant();
    expect(await service.getJobStatus('job-read', 'proj-r', 'user-r')).toEqual(
      job
    );
  });

  it('getJobStatus returns null for an unknown jobId', async () => {
    expect(await service.getJobStatus('nope', 'proj-r', 'user-r')).toBeNull();
  });

  it('getJobStatus returns null when the projectId does not match', async () => {
    plant();
    expect(
      await service.getJobStatus('job-read', 'wrong-proj', 'user-r')
    ).toBeNull();
  });

  it('getJobStatus returns null when access is denied', async () => {
    mockHasProjectAccess.mockResolvedValueOnce({ hasAccess: false });
    plant();
    expect(
      await service.getJobStatus('job-read', 'proj-r', 'user-r')
    ).toBeNull();
  });

  // getExportFilePath
  it('getExportFilePath returns the filePath for a completed job', async () => {
    plant();
    expect(
      await service.getExportFilePath('job-read', 'proj-r', 'user-r')
    ).toBe('/tmp/file.zip');
  });

  it('getExportFilePath returns null when the job has no filePath', async () => {
    plant({ filePath: undefined });
    expect(
      await service.getExportFilePath('job-read', 'proj-r', 'user-r')
    ).toBeNull();
  });

  it('getExportFilePath returns null for an unknown jobId', async () => {
    expect(
      await service.getExportFilePath('nope', 'proj-r', 'user-r')
    ).toBeNull();
  });

  it('getExportFilePath returns null when access is denied', async () => {
    mockHasProjectAccess.mockResolvedValueOnce({ hasAccess: false });
    plant();
    expect(
      await service.getExportFilePath('job-read', 'proj-r', 'user-r')
    ).toBeNull();
  });

  // getExportJob
  it('getExportJob returns the full job when access + projectId match', async () => {
    const job = plant();
    expect(await service.getExportJob('job-read', 'proj-r', 'user-r')).toEqual(
      job
    );
  });

  it('getExportJob returns null when the projectId does not match', async () => {
    plant();
    expect(
      await service.getExportJob('job-read', 'other-proj', 'user-r')
    ).toBeNull();
  });

  it('getExportJob returns null when access is denied', async () => {
    mockHasProjectAccess.mockResolvedValueOnce({ hasAccess: false });
    plant();
    expect(
      await service.getExportJob('job-read', 'proj-r', 'user-r')
    ).toBeNull();
  });
});

// ─── cancelJob ───────────────────────────────────────────────────────────────

describe('ExportService — cancelJob', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
    mockHasProjectAccess.mockResolvedValue({ hasAccess: true });
    service.setWebSocketService({ emitToUser: mockEmitToUser } as never);
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const plant = (overrides: Partial<ExportJob> = {}): ExportJob =>
    seedJob(service, {
      id: 'c-job',
      projectId: 'proj-c',
      userId: 'user-c',
      status: 'pending',
      progress: 42,
      ...overrides,
    });

  it('transitions a pending job to cancelled and emits export:cancelled', async () => {
    plant({ status: 'pending' });
    await service.cancelJob('c-job', 'proj-c', 'user-c');

    const job = getJobs(service).get('c-job');
    expect(job!.status).toBe('cancelled');
    expect(job!.completedAt).toBeInstanceOf(Date);
    expect(mockEmitToUser).toHaveBeenCalledWith(
      'user-c',
      'export:cancelled',
      expect.objectContaining({ jobId: 'c-job' })
    );
  });

  it('transitions a processing job to cancelled', async () => {
    plant({ status: 'processing' });
    await service.cancelJob('c-job', 'proj-c', 'user-c');
    expect(getJobs(service).get('c-job')!.status).toBe('cancelled');
  });

  it('is idempotent when the job is already completed (no WS, status kept)', async () => {
    plant({ status: 'completed' });
    await service.cancelJob('c-job', 'proj-c', 'user-c');
    expect(getJobs(service).get('c-job')!.status).toBe('completed');
    expect(mockEmitToUser).not.toHaveBeenCalled();
  });

  it('is idempotent when the job is already cancelled', async () => {
    plant({ status: 'cancelled', completedAt: new Date() });
    const before = getJobs(service).get('c-job')!.completedAt;
    await service.cancelJob('c-job', 'proj-c', 'user-c');
    expect(getJobs(service).get('c-job')!.completedAt).toEqual(before);
  });

  it('silently no-ops when access is denied (job untouched)', async () => {
    mockHasProjectAccess.mockResolvedValueOnce({ hasAccess: false });
    plant({ status: 'pending' });
    await expect(
      service.cancelJob('c-job', 'proj-c', 'stranger')
    ).resolves.toBeUndefined();
    expect(getJobs(service).get('c-job')!.status).toBe('pending');
  });

  it('silently no-ops for an unknown jobId', async () => {
    await expect(
      service.cancelJob('no-such', 'proj-c', 'user-c')
    ).resolves.toBeUndefined();
  });

  it('silently no-ops when the projectId does not match', async () => {
    plant({ status: 'pending' });
    await service.cancelJob('c-job', 'wrong-project', 'user-c');
    expect(getJobs(service).get('c-job')!.status).toBe('pending');
  });
});

// ─── getExportHistory ─────────────────────────────────────────────────────────

describe('ExportService — getExportHistory', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
    mockHasProjectAccess.mockResolvedValue({ hasAccess: true });
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const addJob = (id: string, createdAt: Date, projectId = 'proj-h'): void => {
    seedJob(service, {
      id,
      projectId,
      userId: 'user-h',
      status: 'completed',
      createdAt,
    });
  };

  it('returns an empty array when the project has no jobs', async () => {
    expect(await service.getExportHistory('proj-h', 'user-h')).toEqual([]);
  });

  it('returns jobs newest-first', async () => {
    addJob('older', new Date('2024-01-01'));
    addJob('newer', new Date('2024-06-01'));

    const result = await service.getExportHistory('proj-h', 'user-h');
    expect(result[0].id).toBe('newer');
    expect(result[1].id).toBe('older');
  });

  it('caps the output at 10 entries and excludes other projects', async () => {
    for (let i = 0; i < 12; i++) {
      addJob(`job-${i}`, new Date(Date.now() - i * 1000));
    }
    addJob('other', new Date(), 'proj-other');

    const result = await service.getExportHistory('proj-h', 'user-h');
    expect(result).toHaveLength(10);
    expect(result.every(j => j.projectId === 'proj-h')).toBe(true);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].createdAt.getTime()).toBeGreaterThanOrEqual(
        result[i + 1].createdAt.getTime()
      );
    }
  });

  it('returns an empty array when access is denied', async () => {
    mockHasProjectAccess.mockResolvedValueOnce({ hasAccess: false });
    addJob('mine', new Date());
    expect(await service.getExportHistory('proj-h', 'stranger')).toEqual([]);
  });
});

// ─── cleanupOldJobs ───────────────────────────────────────────────────────────

describe('ExportService — cleanupOldJobs', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const callCleanup = (svc: ExportService) =>
    (svc as unknown as { cleanupOldJobs(): void }).cleanupOldJobs();

  it('evicts jobs older than the 24h TTL and keeps fresh ones', () => {
    const jobs = getJobs(service);
    seedJob(service, {
      id: 'old-job',
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    seedJob(service, {
      id: 'fresh-job',
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    callCleanup(service);

    expect(jobs.has('old-job')).toBe(false);
    expect(jobs.has('fresh-job')).toBe(true);
    expect(vi.mocked(logger.info)).toHaveBeenCalled();
  });

  it('does nothing (and does not log) when there is nothing to clean', () => {
    vi.clearAllMocks();
    expect(() => callCleanup(service)).not.toThrow();
    expect(vi.mocked(logger.info)).not.toHaveBeenCalled();
  });
});

// ─── destroy ──────────────────────────────────────────────────────────────────

describe('ExportService — destroy', () => {
  afterEach(resetSingleton);

  it('clears the cleanup interval', () => {
    const svc = makeService();
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    svc.destroy();
    expect(clearSpy).toHaveBeenCalledOnce();
    clearSpy.mockRestore();
  });

  it('is idempotent across multiple calls', () => {
    const svc = makeService();
    expect(() => {
      svc.destroy();
      svc.destroy();
    }).not.toThrow();
  });
});

// ─── sendToUser (WS dispatch) ─────────────────────────────────────────────────

describe('ExportService — sendToUser', () => {
  let service: ExportService;
  let emitToUser: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
    emitToUser = vi.fn();
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const callSendToUser = (
    userId: string,
    event: string,
    data: Record<string, unknown>
  ) =>
    (
      service as unknown as {
        sendToUser(
          userId: string,
          event: string,
          data: Record<string, unknown>
        ): void;
      }
    ).sendToUser(userId, event, data);

  it('forwards the event and payload to wsService.emitToUser', () => {
    service.setWebSocketService({ emitToUser } as never);
    callSendToUser('user-1', 'export:started', { jobId: 'j1' });
    expect(emitToUser).toHaveBeenCalledWith('user-1', 'export:started', {
      jobId: 'j1',
    });
  });

  it('logs a warning and does not throw when no wsService is set', () => {
    expect(() =>
      callSendToUser('u', 'export:started', { jobId: 'j' })
    ).not.toThrow();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('WebSocketService not available'),
      expect.any(String),
      expect.objectContaining({ userId: 'u', event: 'export:started' })
    );
  });

  it('swallows errors thrown by emitToUser', () => {
    service.setWebSocketService({
      emitToUser: vi.fn(() => {
        throw new Error('ws down');
      }),
    } as never);
    expect(() =>
      callSendToUser('user-1', 'export:completed', { jobId: 'j1', warnings: [] })
    ).not.toThrow();
  });
});

// ─── updateJobProgress ────────────────────────────────────────────────────────

describe('ExportService — updateJobProgress', () => {
  let service: ExportService;
  let emitToUser: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
    emitToUser = vi.fn();
    service.setWebSocketService({ emitToUser } as never);
    seedJob(service, {
      id: 'up-job',
      projectId: 'proj-u',
      userId: 'user-u',
      status: 'processing',
      progress: 0,
    });
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const callUpdate = (
    jobId: string,
    progress: number,
    stage?: string,
    stageProgress?: { current: number; total: number; currentItem?: string }
  ) =>
    (
      service as unknown as {
        updateJobProgress(
          jobId: string,
          progress: number,
          stage?: string,
          stageProgress?: {
            current: number;
            total: number;
            currentItem?: string;
          }
        ): void;
      }
    ).updateJobProgress(jobId, progress, stage, stageProgress);

  it('updates the job progress field', () => {
    callUpdate('up-job', 42);
    expect(getJobs(service).get('up-job')!.progress).toBe(42);
  });

  it('emits enriched progress data with phase=processing below 90%', () => {
    callUpdate('up-job', 50, 'images', { current: 3, total: 10 });
    expect(emitToUser).toHaveBeenCalledWith(
      'user-u',
      'export:progress',
      expect.objectContaining({
        jobId: 'up-job',
        progress: 50,
        phase: 'processing',
        stage: 'images',
        stageProgress: { current: 3, total: 10 },
      })
    );
  });

  it('reports phase=downloading at or above 90%', () => {
    callUpdate('up-job', 95, 'compression');
    expect(emitToUser.mock.calls[0][2].phase).toBe('downloading');
  });

  it('is a no-op for an unknown jobId', () => {
    callUpdate('no-such-job', 50);
    expect(emitToUser).not.toHaveBeenCalled();
  });
});
