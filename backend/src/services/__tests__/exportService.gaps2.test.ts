/**
 * exportService.gaps2.test.ts
 *
 * Covers paths NOT already tested in exportService.test.ts or
 * exportService.gaps.test.ts:
 *
 *   1. Job lifecycle — startExportJob: pending→processing status, WS events,
 *      per-user concurrency cap, access-denied guard, project-name fallback.
 *   2. getJobStatus / getExportFilePath / getExportJob — access guard + match
 *      logic (project-id gating, missing job, completed job with filePath).
 *   3. cancelJob — status transitions (pending → cancelled, idempotent on
 *      already-completed/cancelled, silently skips when no access).
 *   4. getExportHistory — paging limit (≤10), sorted newest-first, access guard.
 *   5. hasActiveJobForUser — blocks second concurrent job from same user.
 *   6. sendToUser — all four WS event paths (started, progress, completed,
 *      failed) and the no-ws-service fallback path.
 *   7. updateJobProgress — enriched progressData shape sent via WS.
 *   8. generateVisualization skips — image without segmentation, image without
 *      polygons, unparsable polygon JSON, invalid/empty originalPath.
 *   9. generateDocumentation — calls all three doc generators + writes
 *      metadata.json with the expected shape.
 *
 * Real FS / archiver / sharp / Prisma are never touched — all I/O is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — all vi.mock() factories use ONLY inline vi.fn() calls.
// ---------------------------------------------------------------------------

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

vi.mock('../sharingService', () => ({
  hasProjectAccess: vi.fn().mockResolvedValue({ hasAccess: true }),
}));

vi.mock('../websocketService', () => ({
  WebSocketService: {
    getInstance: vi.fn(() => ({ emitToUser: vi.fn() })),
  },
}));

vi.mock('uuid', () => ({ v4: vi.fn(() => 'gaps2-job-id') }));

vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
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
    metadata: vi.fn().mockResolvedValue({ width: 200, height: 150 }),
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
  computeMTMetrics: vi.fn().mockResolvedValue([]),
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
  coerceProjectType: vi.fn((t: string) => t ?? 'spheroid'),
}));

// ---------------------------------------------------------------------------
// Imports (after all mocks)
// ---------------------------------------------------------------------------
import { ExportService, type ExportJob } from '../exportService';
import * as SharingService from '../sharingService';
import { prisma } from '../../db';
import { VisualizationGenerator } from '../visualization/visualizationGenerator';
import { MetricsCalculator } from '../metrics/metricsCalculator';
import { FormatConverter } from '../export/formatConverter';
import {
  generateReadme,
  generateMetricsGuide,
  generateAnnotationGuides,
} from '../export/exportDocs';
import * as fs from 'fs/promises';

const MockVizGen = VisualizationGenerator as unknown as ReturnType<
  typeof vi.fn
>;
const MockMetricsCalculator = MetricsCalculator as unknown as ReturnType<
  typeof vi.fn
>;
const MockFormatConverter = FormatConverter as unknown as ReturnType<
  typeof vi.fn
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const resetSingleton = () => {
  (ExportService as unknown as { instance: unknown }).instance = undefined;
};

const makeService = (): ExportService => {
  resetSingleton();
  return ExportService.getInstance();
};

const getJobs = (svc: ExportService): Map<string, ExportJob> =>
  (svc as unknown as { exportJobs: Map<string, ExportJob> }).exportJobs;

function makeMinimalImage(
  overrides: Partial<{
    id: string;
    name: string;
    width: number | null;
    height: number | null;
    originalPath: string;
    projectId: string;
    parentVideoId: string | null;
    frameIndex: number | null;
    isVideoContainer: boolean;
    segmentation: null | {
      id: string;
      imageId: string;
      model: string;
      threshold: number;
      confidence: number | null;
      processingTime: number | null;
      imageWidth: number | null;
      imageHeight: number | null;
      polygons: string;
      createdAt: Date;
      updatedAt: Date;
    };
  }> = {}
) {
  return {
    id: 'img-a',
    name: 'photo.png',
    width: 100,
    height: 100,
    originalPath: 'projects/p/images/img-a/original.png',
    thumbnailPath: null,
    segmentationThumbnailPath: null,
    fileSize: 1000,
    mimeType: 'image/png',
    projectId: 'proj-1',
    segmentationStatus: 'segmented',
    createdAt: new Date(),
    updatedAt: new Date(),
    isVideoContainer: false,
    parentVideoId: null,
    frameIndex: null,
    segmentation: {
      id: 'seg-a',
      imageId: 'img-a',
      model: 'hrnet',
      threshold: 0.5,
      confidence: 0.9,
      processingTime: 200,
      imageWidth: 100,
      imageHeight: 100,
      polygons: JSON.stringify([
        { points: [{ x: 0, y: 0 }], geometry: 'polygon' },
      ]),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    ...overrides,
  };
}

// Wire minimal stub implementations for calculator / converter / viz
function resetMockImpls(): {
  mockVizGenerate: ReturnType<typeof vi.fn>;
  mockCalcAll: ReturnType<typeof vi.fn>;
  mockCalcImage: ReturnType<typeof vi.fn>;
  mockExportPoly: ReturnType<typeof vi.fn>;
  mockExportSperm: ReturnType<typeof vi.fn>;
  mockExportDI: ReturnType<typeof vi.fn>;
  mockExportCSV: ReturnType<typeof vi.fn>;
  mockConvertCoco: ReturnType<typeof vi.fn>;
  mockConvertYolo: ReturnType<typeof vi.fn>;
  mockConvertJson: ReturnType<typeof vi.fn>;
} {
  const mockVizGenerate = vi.fn().mockResolvedValue('success');
  MockVizGen.mockImplementation(function (this: Record<string, unknown>) {
    this.generateVisualization = mockVizGenerate;
  });

  const mockCalcAll = vi.fn().mockResolvedValue([]);
  const mockCalcImage = vi.fn().mockResolvedValue([]);
  const mockExportPoly = vi.fn().mockResolvedValue(undefined);
  const mockExportSperm = vi.fn().mockResolvedValue(true);
  const mockExportDI = vi.fn().mockResolvedValue(undefined);
  const mockExportCSV = vi.fn().mockResolvedValue(undefined);
  MockMetricsCalculator.mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.calculateAllMetrics = mockCalcAll;
    this.calculateAllImageMetrics = mockCalcImage;
    this.exportPolygonMetricsToExcel = mockExportPoly;
    this.exportSpermToExcel = mockExportSperm;
    this.exportToExcel = mockExportDI;
    this.exportToCSV = mockExportCSV;
  });

  const mockConvertCoco = vi.fn().mockResolvedValue({});
  const mockConvertYolo = vi
    .fn()
    .mockResolvedValue({ content: '', warnings: [] });
  const mockConvertJson = vi.fn().mockResolvedValue({});
  MockFormatConverter.mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.convertToCOCO = mockConvertCoco;
    this.convertToYOLO = mockConvertYolo;
    this.convertToJSON = mockConvertJson;
  });

  return {
    mockVizGenerate,
    mockCalcAll,
    mockCalcImage,
    mockExportPoly,
    mockExportSperm,
    mockExportDI,
    mockExportCSV,
    mockConvertCoco,
    mockConvertYolo,
    mockConvertJson,
  };
}

// ---------------------------------------------------------------------------
// 1. Job lifecycle — startExportJob
//
// NOTE: processExportJob runs as a fire-and-forget background task.  To avoid
// waiting for it (which would time out or race), we make SharingService reject
// the second access check inside processExportJob immediately so the
// background task exits early (with "Access denied") rather than hanging.
// The job map state we care about is set synchronously by startExportJob
// before processExportJob is called.
// ---------------------------------------------------------------------------

describe('ExportService — startExportJob', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  /** Make processExportJob fail immediately so it doesn't race. */
  const failBackground = () => {
    // The background task calls hasProjectAccess a second time.
    // Reject it so the task throws and exits immediately.
    vi.mocked(SharingService.hasProjectAccess)
      .mockResolvedValueOnce({ hasAccess: true }) // startExportJob guard
      .mockResolvedValueOnce({ hasAccess: false }); // processExportJob guard → throws
  };

  it('creates a job record and returns the jobId', async () => {
    failBackground();

    const id = await service.startExportJob('proj-1', 'user-1', {});
    expect(id).toBe('gaps2-job-id');

    const job = getJobs(service).get('gaps2-job-id');
    expect(job).toBeDefined();
    expect(job!.projectId).toBe('proj-1');
    expect(job!.userId).toBe('user-1');
    // The record is inserted before processExportJob runs
    expect(typeof job!.progress).toBe('number');
  });

  it('stores the provided projectName without fetching from DB for the title', async () => {
    // DB is only queried for project title when projectName is omitted.
    // When it IS provided the select{title} call must NOT happen.
    failBackground();

    await service.startExportJob('proj-1', 'user-1', {}, 'My Dataset');

    const job = getJobs(service).get('gaps2-job-id');
    expect(job!.projectName).toBe('My Dataset');
    // project.findUnique should NOT have been called for the title lookup
    // (it may be called by processExportJob for the full project query, but
    //  that first mock already returned false-access → early exit)
    // Assert that no call was made with select:{title:true}
    const titleCall = vi
      .mocked(prisma.project.findUnique)
      .mock.calls.find(
        c => (c[0] as { select?: { title?: boolean } }).select?.title === true
      );
    expect(titleCall).toBeUndefined();
  });

  it('throws Access denied when SharingService rejects access', async () => {
    vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
      hasAccess: false,
    });

    await expect(
      service.startExportJob('proj-1', 'user-1', {})
    ).rejects.toThrow('Access denied');
  });

  it('throws Rate limit exceeded when user already has a pending job', async () => {
    vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
      hasAccess: true,
    });
    // Seed a pending job for the same user
    getJobs(service).set('existing-job', {
      id: 'existing-job',
      projectId: 'proj-1',
      userId: 'user-1',
      status: 'pending',
      progress: 0,
      createdAt: new Date(),
      options: {},
    });

    await expect(
      service.startExportJob('proj-1', 'user-1', {})
    ).rejects.toThrow('Rate limit exceeded');
  });

  it('allows a second job for a DIFFERENT user even if first user is processing', async () => {
    // First two hasProjectAccess calls: user-2's startExportJob guard + processExportJob guard
    vi.mocked(SharingService.hasProjectAccess)
      .mockResolvedValueOnce({ hasAccess: true }) // user-2 startExportJob guard
      .mockResolvedValueOnce({ hasAccess: false }); // user-2 processExportJob → early exit

    getJobs(service).set('u1-job', {
      id: 'u1-job',
      projectId: 'proj-1',
      userId: 'user-1',
      status: 'processing',
      progress: 50,
      createdAt: new Date(),
      options: {},
    });

    // user-2 should NOT be rate-limited
    const id = await service.startExportJob('proj-1', 'user-2', {});
    expect(id).toBe('gaps2-job-id');
  });

  it('fetches projectName from DB when not provided', async () => {
    // First call: startExportJob → hasProjectAccess (allow)
    vi.mocked(SharingService.hasProjectAccess)
      .mockResolvedValueOnce({ hasAccess: true })
      .mockResolvedValueOnce({ hasAccess: false }); // processExportJob → early exit

    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce({
      title: 'DB Project Name',
    } as never);

    await service.startExportJob('proj-1', 'user-1', {});

    const job = getJobs(service).get('gaps2-job-id');
    expect(job!.projectName).toBe('DB Project Name');
  });
});

// ---------------------------------------------------------------------------
// 2. getJobStatus / getExportFilePath / getExportJob
// ---------------------------------------------------------------------------

describe('ExportService — job query methods', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
    vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
      hasAccess: true,
    });
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const seedJob = (overrides: Partial<ExportJob> = {}): ExportJob => {
    const job: ExportJob = {
      id: 'q-job-1',
      projectId: 'proj-q',
      userId: 'user-q',
      status: 'completed',
      progress: 100,
      createdAt: new Date(),
      completedAt: new Date(),
      options: {},
      filePath: '/tmp/exports/q-job-1.zip',
      ...overrides,
    };
    getJobs(service).set(job.id, job);
    return job;
  };

  // getJobStatus
  it('getJobStatus returns the job when projectId matches', async () => {
    seedJob();
    const result = await service.getJobStatus('q-job-1', 'proj-q', 'user-q');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('q-job-1');
  });

  it('getJobStatus returns null for unknown jobId', async () => {
    const result = await service.getJobStatus('no-such', 'proj-q', 'user-q');
    expect(result).toBeNull();
  });

  it('getJobStatus returns null when projectId does not match', async () => {
    seedJob();
    const result = await service.getJobStatus(
      'q-job-1',
      'wrong-proj',
      'user-q'
    );
    expect(result).toBeNull();
  });

  it('getJobStatus returns null when access is denied', async () => {
    vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
      hasAccess: false,
    });
    seedJob();
    const result = await service.getJobStatus('q-job-1', 'proj-q', 'user-q');
    expect(result).toBeNull();
  });

  // getExportFilePath
  it('getExportFilePath returns filePath for completed job', async () => {
    seedJob();
    const fp = await service.getExportFilePath('q-job-1', 'proj-q', 'user-q');
    expect(fp).toBe('/tmp/exports/q-job-1.zip');
  });

  it('getExportFilePath returns null when job has no filePath', async () => {
    seedJob({ filePath: undefined });
    const fp = await service.getExportFilePath('q-job-1', 'proj-q', 'user-q');
    expect(fp).toBeNull();
  });

  it('getExportFilePath returns null for unknown jobId', async () => {
    const fp = await service.getExportFilePath('nope', 'proj-q', 'user-q');
    expect(fp).toBeNull();
  });

  it('getExportFilePath returns null when access is denied', async () => {
    vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
      hasAccess: false,
    });
    seedJob();
    const fp = await service.getExportFilePath('q-job-1', 'proj-q', 'user-q');
    expect(fp).toBeNull();
  });

  // getExportJob
  it('getExportJob returns the full job object', async () => {
    const j = seedJob();
    const result = await service.getExportJob('q-job-1', 'proj-q', 'user-q');
    expect(result).toMatchObject({ id: j.id, status: 'completed' });
  });

  it('getExportJob returns null when projectId mismatches', async () => {
    seedJob();
    const result = await service.getExportJob(
      'q-job-1',
      'other-proj',
      'user-q'
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. cancelJob — status transitions
// ---------------------------------------------------------------------------

describe('ExportService — cancelJob', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
    vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
      hasAccess: true,
    });
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const seedJob = (status: ExportJob['status']): void => {
    getJobs(service).set('c-job', {
      id: 'c-job',
      projectId: 'proj-c',
      userId: 'user-c',
      status,
      progress: 42,
      createdAt: new Date(),
      options: {},
    });
  };

  it('transitions a pending job to cancelled', async () => {
    seedJob('pending');
    await service.cancelJob('c-job', 'proj-c', 'user-c');

    const job = getJobs(service).get('c-job');
    expect(job!.status).toBe('cancelled');
    expect(job!.completedAt).toBeInstanceOf(Date);
  });

  it('transitions a processing job to cancelled', async () => {
    seedJob('processing');
    await service.cancelJob('c-job', 'proj-c', 'user-c');

    const job = getJobs(service).get('c-job');
    expect(job!.status).toBe('cancelled');
  });

  it('is idempotent: does nothing if job is already completed', async () => {
    seedJob('completed');
    await service.cancelJob('c-job', 'proj-c', 'user-c');
    expect(getJobs(service).get('c-job')!.status).toBe('completed');
  });

  it('is idempotent: does nothing if job is already cancelled', async () => {
    seedJob('cancelled');
    const before = getJobs(service).get('c-job')!.completedAt;
    await service.cancelJob('c-job', 'proj-c', 'user-c');
    expect(getJobs(service).get('c-job')!.completedAt).toEqual(before);
  });

  it('silently skips when access is denied', async () => {
    vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
      hasAccess: false,
    });
    seedJob('pending');
    await service.cancelJob('c-job', 'proj-c', 'user-c');
    // job should NOT be mutated
    expect(getJobs(service).get('c-job')!.status).toBe('pending');
  });

  it('silently skips unknown jobId (no error thrown)', async () => {
    await expect(
      service.cancelJob('no-such', 'proj-c', 'user-c')
    ).resolves.toBeUndefined();
  });

  it('silently skips when projectId does not match the stored job', async () => {
    seedJob('pending');
    await service.cancelJob('c-job', 'wrong-project', 'user-c');
    expect(getJobs(service).get('c-job')!.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// 4. getExportHistory
// ---------------------------------------------------------------------------

describe('ExportService — getExportHistory', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
    vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
      hasAccess: true,
    });
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const addJob = (id: string, createdAt: Date, projectId = 'proj-h'): void => {
    getJobs(service).set(id, {
      id,
      projectId,
      userId: 'user-h',
      status: 'completed',
      progress: 100,
      createdAt,
      options: {},
    });
  };

  it('returns empty array when no jobs exist for project', async () => {
    const result = await service.getExportHistory('proj-h', 'user-h');
    expect(result).toEqual([]);
  });

  it('returns jobs sorted newest-first', async () => {
    addJob('older', new Date('2024-01-01'));
    addJob('newer', new Date('2024-06-01'));

    const result = await service.getExportHistory('proj-h', 'user-h');
    expect(result[0].id).toBe('newer');
    expect(result[1].id).toBe('older');
  });

  it('caps output at 10 entries even when more exist', async () => {
    for (let i = 0; i < 15; i++) {
      addJob(`job-${i}`, new Date(2024, 0, i + 1));
    }

    const result = await service.getExportHistory('proj-h', 'user-h');
    expect(result.length).toBe(10);
  });

  it('excludes jobs belonging to a different project', async () => {
    addJob('mine', new Date(), 'proj-h');
    addJob('other', new Date(), 'proj-other');

    const result = await service.getExportHistory('proj-h', 'user-h');
    expect(result.every(j => j.projectId === 'proj-h')).toBe(true);
    expect(result.length).toBe(1);
  });

  it('returns empty array when access is denied', async () => {
    vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
      hasAccess: false,
    });
    addJob('mine', new Date(), 'proj-h');

    const result = await service.getExportHistory('proj-h', 'user-h');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. sendToUser — WS event dispatch paths
// ---------------------------------------------------------------------------

describe('ExportService — sendToUser WS events', () => {
  let service: ExportService;
  let emitToUser: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
    emitToUser = vi.fn();
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const callSendToUser = (
    svc: ExportService,
    userId: string,
    event: string,
    data: Record<string, unknown>
  ) =>
    (
      svc as unknown as {
        sendToUser: (
          userId: string,
          event: string,
          data: Record<string, unknown>
        ) => void;
      }
    ).sendToUser(userId, event, data);

  it('calls wsService.emitToUser for export:started', () => {
    service.setWebSocketService({ emitToUser } as never);
    callSendToUser(service, 'user-1', 'export:started', { jobId: 'j1' });
    expect(emitToUser).toHaveBeenCalledWith('user-1', 'export:started', {
      jobId: 'j1',
    });
  });

  it('calls wsService.emitToUser for export:progress', () => {
    service.setWebSocketService({ emitToUser } as never);
    callSendToUser(service, 'user-1', 'export:progress', { progress: 50 });
    expect(emitToUser).toHaveBeenCalledWith('user-1', 'export:progress', {
      progress: 50,
    });
  });

  it('calls wsService.emitToUser for export:completed', () => {
    service.setWebSocketService({ emitToUser } as never);
    callSendToUser(service, 'user-1', 'export:completed', {
      jobId: 'j1',
      warnings: [],
    });
    expect(emitToUser).toHaveBeenCalledWith('user-1', 'export:completed', {
      jobId: 'j1',
      warnings: [],
    });
  });

  it('calls wsService.emitToUser for export:failed', () => {
    service.setWebSocketService({ emitToUser } as never);
    callSendToUser(service, 'user-1', 'export:failed', {
      jobId: 'j1',
      error: 'boom',
    });
    expect(emitToUser).toHaveBeenCalledWith('user-1', 'export:failed', {
      jobId: 'j1',
      error: 'boom',
    });
  });

  it('does not throw when wsService is not set (no-ws path)', () => {
    // wsService is null by default on a fresh instance
    expect(() =>
      callSendToUser(service, 'user-1', 'export:started', { jobId: 'j1' })
    ).not.toThrow();
  });

  it('does not throw when emitToUser itself throws', () => {
    service.setWebSocketService({
      emitToUser: vi.fn().mockImplementation(() => {
        throw new Error('ws down');
      }),
    } as never);
    expect(() =>
      callSendToUser(service, 'user-1', 'export:completed', {
        jobId: 'j1',
        warnings: [],
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. updateJobProgress — enriched WS progress data shape
// ---------------------------------------------------------------------------

describe('ExportService — updateJobProgress', () => {
  let service: ExportService;
  let emitToUser: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
    emitToUser = vi.fn();
    service.setWebSocketService({ emitToUser } as never);
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const callUpdate = (
    svc: ExportService,
    jobId: string,
    progress: number,
    stage?:
      | 'images'
      | 'visualizations'
      | 'annotations'
      | 'metrics'
      | 'compression',
    stageProgress?: { current: number; total: number; currentItem?: string }
  ) =>
    (
      svc as unknown as {
        updateJobProgress: (
          jobId: string,
          progress: number,
          stage?: string,
          stageProgress?: {
            current: number;
            total: number;
            currentItem?: string;
          }
        ) => void;
      }
    ).updateJobProgress(jobId, progress, stage, stageProgress);

  const seedJob = (): void => {
    getJobs(service).set('up-job', {
      id: 'up-job',
      projectId: 'proj-u',
      userId: 'user-u',
      status: 'processing',
      progress: 0,
      createdAt: new Date(),
      options: {},
    });
  };

  it('updates the job progress field', () => {
    seedJob();
    callUpdate(service, 'up-job', 42);
    expect(getJobs(service).get('up-job')!.progress).toBe(42);
  });

  it('sends enriched progress data over WS including phase=processing', () => {
    seedJob();
    callUpdate(service, 'up-job', 50, 'images', { current: 3, total: 10 });
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

  it('sends phase=downloading when progress ≥ 90', () => {
    seedJob();
    callUpdate(service, 'up-job', 95, 'compression');
    const call = emitToUser.mock.calls[0];
    expect(call[2].phase).toBe('downloading');
  });

  it('is a no-op for unknown jobId', () => {
    // Should not throw
    callUpdate(service, 'no-such-job', 50);
    expect(emitToUser).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. generateVisualization skip paths
// ---------------------------------------------------------------------------

describe('ExportService — generateVisualizations skip paths', () => {
  let service: ExportService;
  let mockVizGenerate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = resetMockImpls();
    mockVizGenerate = mocks.mockVizGenerate;
    service = makeService();
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const callGenerateViz = (
    svc: ExportService,
    images: ReturnType<typeof makeMinimalImage>[],
    jobId?: string
  ) =>
    (
      svc as unknown as {
        generateVisualizations: (
          images: unknown[],
          exportDir: string,
          options: unknown,
          jobId?: string,
          onProgress?: () => void
        ) => Promise<void>;
      }
    ).generateVisualizations(images, '/tmp/viz', undefined, jobId);

  it('skips image with no segmentation (returns without calling generate)', async () => {
    await callGenerateViz(service, [makeMinimalImage({ segmentation: null })]);
    expect(mockVizGenerate).not.toHaveBeenCalled();
  });

  it('skips image with segmentation but null polygons', async () => {
    await callGenerateViz(service, [
      makeMinimalImage({
        segmentation: {
          ...makeMinimalImage().segmentation!,
          polygons: null as unknown as string,
        },
      }),
    ]);
    expect(mockVizGenerate).not.toHaveBeenCalled();
  });

  it('skips image when polygon JSON is unparsable', async () => {
    await callGenerateViz(service, [
      makeMinimalImage({
        segmentation: {
          ...makeMinimalImage().segmentation!,
          polygons: '{{{not valid json',
        },
      }),
    ]);
    expect(mockVizGenerate).not.toHaveBeenCalled();
  });

  it('skips image with empty originalPath', async () => {
    await callGenerateViz(service, [makeMinimalImage({ originalPath: '' })]);
    expect(mockVizGenerate).not.toHaveBeenCalled();
  });

  it('calls generate for a valid image and counts it as processed', async () => {
    mockVizGenerate.mockResolvedValue('success');
    await callGenerateViz(service, [makeMinimalImage()]);
    expect(mockVizGenerate).toHaveBeenCalledOnce();
  });

  it('names video-frame visualizations with _frame_NNNN suffix to avoid collisions', async () => {
    mockVizGenerate.mockResolvedValue('success');
    await callGenerateViz(service, [
      makeMinimalImage({
        name: 'clip.nd2',
        parentVideoId: 'vid-1',
        frameIndex: 7,
      }),
    ]);
    const callArgs = mockVizGenerate.mock.calls[0];
    const vizPath: string = callArgs[2];
    expect(vizPath).toMatch(/_frame_0007_viz\.png$/);
  });

  it('throws "Export cancelled by user" when job is cancelled', async () => {
    getJobs(service).set('viz-cancel', {
      id: 'viz-cancel',
      projectId: 'p',
      userId: 'u',
      status: 'cancelled',
      progress: 0,
      createdAt: new Date(),
      options: {},
    });

    await expect(
      callGenerateViz(service, [makeMinimalImage()], 'viz-cancel')
    ).rejects.toThrow('Export cancelled by user');
  });
});

// ---------------------------------------------------------------------------
// 8. generateDocumentation
// ---------------------------------------------------------------------------

describe('ExportService — generateDocumentation', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const callGenerateDoc = (
    svc: ExportService,
    project: {
      id: string;
      title: string;
      type: string | null;
      images: ReturnType<typeof makeMinimalImage>[];
    },
    options: Record<string, unknown>
  ) =>
    (
      svc as unknown as {
        generateDocumentation: (
          project: unknown,
          exportDir: string,
          options: unknown
        ) => Promise<void>;
      }
    ).generateDocumentation(project, '/tmp/doc', options);

  const minimalProject = {
    id: 'proj-d',
    title: 'Doc Project',
    type: 'spheroid' as string | null,
    images: [makeMinimalImage()],
  };

  it('calls generateReadme with the project and options', async () => {
    await callGenerateDoc(service, minimalProject, {
      includeDocumentation: true,
    });
    expect(generateReadme).toHaveBeenCalledWith(minimalProject, {
      includeDocumentation: true,
    });
  });

  it('calls generateMetricsGuide with the project type', async () => {
    await callGenerateDoc(service, minimalProject, {});
    expect(generateMetricsGuide).toHaveBeenCalledOnce();
  });

  it('calls generateAnnotationGuides', async () => {
    await callGenerateDoc(service, minimalProject, {});
    expect(generateAnnotationGuides).toHaveBeenCalledOnce();
  });

  it('writes README.md, metadata.json and metrics_guide.md', async () => {
    await callGenerateDoc(service, minimalProject, {});

    const writtenPaths = vi
      .mocked(fs.writeFile)
      .mock.calls.map(c => String(c[0]));
    expect(writtenPaths.some(p => p.endsWith('README.md'))).toBe(true);
    expect(writtenPaths.some(p => p.endsWith('metadata.json'))).toBe(true);
    expect(writtenPaths.some(p => p.endsWith('metrics_guide.md'))).toBe(true);
  });

  it('metadata.json contains the expected top-level fields', async () => {
    await callGenerateDoc(service, minimalProject, {
      annotationFormats: ['coco'],
    });

    const metadataCall = vi
      .mocked(fs.writeFile)
      .mock.calls.find(c => String(c[0]).endsWith('metadata.json'));
    expect(metadataCall).toBeDefined();
    const parsed = JSON.parse(String(metadataCall![1]));
    expect(parsed).toMatchObject({
      projectId: 'proj-d',
      projectName: 'Doc Project',
      imageCount: 1,
      version: '1.0.0',
    });
    expect(typeof parsed.exportDate).toBe('string');
    expect(parsed.exportOptions).toMatchObject({ annotationFormats: ['coco'] });
  });
});

// ---------------------------------------------------------------------------
// 9. hasActiveJobForUser (private guard via startExportJob)
// ---------------------------------------------------------------------------

describe('ExportService — hasActiveJobForUser concurrency guard', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
    vi.mocked(SharingService.hasProjectAccess).mockResolvedValue({
      hasAccess: true,
    });
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  it('blocks when user has a processing job', async () => {
    getJobs(service).set('active-job', {
      id: 'active-job',
      projectId: 'proj-1',
      userId: 'user-a',
      status: 'processing',
      progress: 25,
      createdAt: new Date(),
      options: {},
    });

    await expect(
      service.startExportJob('proj-1', 'user-a', {})
    ).rejects.toThrow('Rate limit exceeded');
  });

  it('allows when user only has completed/cancelled jobs', async () => {
    // Make processExportJob exit early to avoid hanging
    vi.mocked(SharingService.hasProjectAccess)
      .mockResolvedValueOnce({ hasAccess: true }) // startExportJob guard
      .mockResolvedValueOnce({ hasAccess: false }); // processExportJob → early exit

    getJobs(service).set('done-job', {
      id: 'done-job',
      projectId: 'proj-1',
      userId: 'user-a',
      status: 'completed',
      progress: 100,
      createdAt: new Date(),
      options: {},
    });

    // Should NOT throw
    await expect(service.startExportJob('proj-1', 'user-a', {})).resolves.toBe(
      'gaps2-job-id'
    );
  });

  it('allows when user has a failed job (terminal state)', async () => {
    vi.mocked(SharingService.hasProjectAccess)
      .mockResolvedValueOnce({ hasAccess: true })
      .mockResolvedValueOnce({ hasAccess: false });

    getJobs(service).set('fail-job', {
      id: 'fail-job',
      projectId: 'proj-1',
      userId: 'user-a',
      status: 'failed',
      progress: 0,
      createdAt: new Date(),
      options: {},
    });

    await expect(service.startExportJob('proj-1', 'user-a', {})).resolves.toBe(
      'gaps2-job-id'
    );
  });
});
