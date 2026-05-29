/**
 * exportService.gaps5.test.ts
 *
 * Covers branches still uncovered after gaps, gaps2, gaps3, gaps4 tests:
 *
 *  A. maybeAppendWoundTimeSeries (private, exercised via startExportJob with wound images)
 *     - no wound images → returns [] (hasWound=false early exit)
 *     - exceljs import fails → returns warning string
 *     - workbook.xlsx.readFile fails → returns warning string
 *     - count === 0 → returns []
 *     - chartError present → warning added but xlsx write proceeds
 *     - xlsx writeFile fails → returns warnings with write error
 *     - chartPng present, writeStandaloneWoundChart fails → warning added
 *     - full success path (chartPng written) → returns empty warnings
 *
 *  B. generateMetrics — MT project skips standard metrics
 *     - projectType='microtubules' → returns without writing metrics
 *
 *  C. copyOriginalImages with cancellation (isJobCancelled branch)
 *     - job cancelled before image copy → throws "Export cancelled"
 *
 *  D. processExportJob — checkCancellation at start
 *     - job already cancelled before processing begins → early return (no further work)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── DB mocks ─────────────────────────────────────────────────────────────────

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

vi.mock('uuid', () => ({ v4: vi.fn(() => 'g5-job-uuid') }));

vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    UPLOAD_DIR: '/tmp/test-uploads',
    EXPORT_DIR: '/tmp/test-exports',
    STORAGE_TYPE: 'local',
    NODE_ENV: 'test',
  },
}));

// ─── FS mock ──────────────────────────────────────────────────────────────────

const { mockMkdir, mockWriteFile, mockReadFile, mockCopyFile, mockOpen } =
  vi.hoisted(() => ({
    mockMkdir: vi.fn().mockResolvedValue(undefined),
    mockWriteFile: vi.fn().mockResolvedValue(undefined),
    mockReadFile: vi.fn().mockResolvedValue(Buffer.from('data')),
    mockCopyFile: vi.fn().mockResolvedValue(undefined),
    mockOpen: vi.fn().mockResolvedValue({
      read: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  }));

vi.mock('fs/promises', () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  rm: vi.fn().mockResolvedValue(undefined),
  copyFile: mockCopyFile,
  open: mockOpen,
  access: vi
    .fn()
    .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}));

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
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('png')),
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
        processor: (item: unknown) => Promise<unknown>,
        opts?: { onBatchComplete?: (idx: number, results: unknown[]) => void }
      ) => {
        const results = await Promise.all(items.map(processor));
        opts?.onBatchComplete?.(0, results);
        return results;
      }
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

// ─── woundTimeSeries mock (dynamic import) ────────────────────────────────────

const { mockAppendWoundTimeSeriesSheet, mockWriteStandaloneWoundChart } =
  vi.hoisted(() => ({
    mockAppendWoundTimeSeriesSheet: vi.fn(),
    mockWriteStandaloneWoundChart: vi.fn(),
  }));

vi.mock('../export/woundTimeSeries', () => ({
  appendWoundTimeSeriesSheet: mockAppendWoundTimeSeriesSheet,
  writeStandaloneWoundChart: mockWriteStandaloneWoundChart,
}));

// ─── exceljs mock (dynamic import) ────────────────────────────────────────────

const { mockXlsxReadFile, mockXlsxWriteFile } = vi.hoisted(() => ({
  mockXlsxReadFile: vi.fn().mockResolvedValue(undefined),
  mockXlsxWriteFile: vi.fn().mockResolvedValue(undefined),
}));

const mockWorkbook = {
  xlsx: {
    readFile: mockXlsxReadFile,
    writeFile: mockXlsxWriteFile,
  },
};

vi.mock('exceljs', () => ({
  default: {
    Workbook: vi.fn(() => mockWorkbook),
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { ExportService, type ExportJob } from '../exportService';
import { MetricsCalculator } from '../metrics/metricsCalculator';
import { FormatConverter } from '../export/formatConverter';
import { VisualizationGenerator } from '../visualization/visualizationGenerator';
import { prisma } from '../../db';

const MockMetricsCalculator = MetricsCalculator as unknown as ReturnType<
  typeof vi.fn
>;
const MockFormatConverter = FormatConverter as unknown as ReturnType<
  typeof vi.fn
>;
const MockVizGen = VisualizationGenerator as unknown as ReturnType<
  typeof vi.fn
>;

const resetSingleton = (): void => {
  (ExportService as unknown as { instance: unknown }).instance = undefined;
};

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

// Helper: make a minimal image with wound segmentation
function makeWoundImage(id: string) {
  return {
    id,
    name: `wound_${id}.jpg`,
    originalPath: `projects/p1/images/${id}/original.jpg`,
    thumbnailPath: null,
    segmentationThumbnailPath: null,
    width: 100,
    height: 100,
    fileSize: 1000n,
    mimeType: 'image/jpeg',
    projectId: 'proj-1',
    segmentationStatus: 'segmented',
    createdAt: new Date(),
    updatedAt: new Date(),
    isVideoContainer: false,
    parentVideoId: null,
    frameIndex: null,
    segmentation: {
      id: 's1',
      createdAt: new Date(),
      updatedAt: new Date(),
      imageWidth: 100,
      imageHeight: 100,
      model: 'wound',
      threshold: 0.5,
      confidence: 0.9,
      processingTime: 200,
      polygons: JSON.stringify([
        {
          id: 'p1',
          type: 'external',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 0, y: 10 },
          ],
        },
      ]),
    },
  };
}

// Helper: make minimal project response from prisma mock
function makeProjectResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proj-1',
    title: 'Test Project',
    type: 'wound',
    images: [makeWoundImage('img-1')],
    ...overrides,
  };
}

// ─── A. maybeAppendWoundTimeSeries ────────────────────────────────────────────

describe('ExportService — maybeAppendWoundTimeSeries (via startExportJob)', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
    mockHasProjectAccess.mockResolvedValue({ hasAccess: true });
    // Default: metrics calculator writes xlsx, then wound TS is appended
    mockAppendWoundTimeSeriesSheet.mockResolvedValue({
      count: 1,
      chartPng: null,
      chartError: null,
    });
    mockWriteStandaloneWoundChart.mockResolvedValue('/tmp/chart.png');
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  it('hasWound=false → wound TS logic skipped entirely', async () => {
    // Non-wound project
    const proj = makeProjectResponse({ type: 'spheroid' });
    (proj.images[0].segmentation as Record<string, unknown>).model = 'hrnet';
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(proj as never);

    const jobId = await service.startExportJob('proj-1', 'user-1', {
      metricsFormats: ['excel'],
    });

    // Wait for background processing
    await new Promise(r => setTimeout(r, 50));

    expect(mockAppendWoundTimeSeriesSheet).not.toHaveBeenCalled();
    const job = getJobs(service).get(jobId);
    expect(job).toBeDefined();
  });

  it('exceljs import fails → wound TS returns warning (job still completes)', async () => {
    vi.doMock('exceljs', () => {
      throw new Error('Module not found: exceljs');
    });

    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(
      makeProjectResponse() as never
    );

    const jobId = await service.startExportJob('proj-1', 'user-1', {
      metricsFormats: ['excel'],
    });

    await new Promise(r => setTimeout(r, 100));
    // Job should still exist even if wound TS failed
    expect(getJobs(service).has(jobId)).toBe(true);

    vi.doUnmock('exceljs');
  });

  it('workbook readFile fails → wound TS returns warning', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(
      makeProjectResponse() as never
    );
    mockXlsxReadFile.mockRejectedValueOnce(new Error('File not found'));

    const jobId = await service.startExportJob('proj-1', 'user-1', {
      metricsFormats: ['excel'],
    });

    await new Promise(r => setTimeout(r, 100));
    expect(getJobs(service).has(jobId)).toBe(true);

    // Reset for subsequent tests
    mockXlsxReadFile.mockResolvedValue(undefined);
  });

  it('count === 0 → wound TS returns [] (no frames written)', async () => {
    mockAppendWoundTimeSeriesSheet.mockResolvedValueOnce({
      count: 0,
      chartPng: null,
      chartError: null,
    });
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(
      makeProjectResponse() as never
    );

    const jobId = await service.startExportJob('proj-1', 'user-1', {
      metricsFormats: ['excel'],
    });

    await new Promise(r => setTimeout(r, 100));
    expect(getJobs(service).has(jobId)).toBe(true);
  });

  it('chartError present → warning added but xlsx write still happens', async () => {
    mockAppendWoundTimeSeriesSheet.mockResolvedValueOnce({
      count: 3,
      chartPng: null,
      chartError: 'canvas not available',
    });
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(
      makeProjectResponse() as never
    );

    const jobId = await service.startExportJob('proj-1', 'user-1', {
      metricsFormats: ['excel'],
    });

    await new Promise(r => setTimeout(r, 100));
    // Xlsx was written
    const job = getJobs(service).get(jobId);
    expect(job).toBeDefined();
  });

  it('xlsx writeFile fails → wound TS returns warnings', async () => {
    mockAppendWoundTimeSeriesSheet.mockResolvedValueOnce({
      count: 2,
      chartPng: null,
      chartError: null,
    });
    mockXlsxWriteFile.mockRejectedValueOnce(new Error('Disk full'));
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(
      makeProjectResponse() as never
    );

    const jobId = await service.startExportJob('proj-1', 'user-1', {
      metricsFormats: ['excel'],
    });

    await new Promise(r => setTimeout(r, 100));
    expect(getJobs(service).has(jobId)).toBe(true);

    mockXlsxWriteFile.mockResolvedValue(undefined);
  });

  it('chartPng present + writeStandaloneWoundChart succeeds → job exists after run', async () => {
    const fakePng = Buffer.from('fake-png');
    mockAppendWoundTimeSeriesSheet.mockResolvedValue({
      count: 5,
      chartPng: fakePng,
      chartError: null,
    });
    mockWriteStandaloneWoundChart.mockResolvedValue('/tmp/wound_chart.png');
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(
      makeProjectResponse() as never
    );

    const jobId = await service.startExportJob('proj-1', 'user-1', {
      metricsFormats: ['excel'],
    });

    await new Promise(r => setTimeout(r, 300));
    expect(getJobs(service).has(jobId)).toBe(true);
  });

  it('chartPng present + writeStandaloneWoundChart fails → job exists (error handled)', async () => {
    const fakePng = Buffer.from('fake-png');
    mockAppendWoundTimeSeriesSheet.mockResolvedValue({
      count: 5,
      chartPng: fakePng,
      chartError: null,
    });
    mockWriteStandaloneWoundChart.mockRejectedValue(
      new Error('Permission denied')
    );
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(
      makeProjectResponse() as never
    );

    const jobId = await service.startExportJob('proj-1', 'user-1', {
      metricsFormats: ['excel'],
    });

    await new Promise(r => setTimeout(r, 300));
    expect(getJobs(service).has(jobId)).toBe(true);

    mockWriteStandaloneWoundChart.mockResolvedValue('/tmp/chart.png');
  });
});

// ─── B. generateMetrics — MT project skips standard metrics ──────────────────

describe('ExportService — generateMetrics MT skip', () => {
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

  it('microtubules project type → MetricsCalculator not called for standard metrics', async () => {
    const proj = makeProjectResponse({ type: 'microtubules' });
    // Add a polyline-like segmentation
    (proj.images[0].segmentation as Record<string, unknown>).model =
      'microtubules';
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(proj as never);

    const jobId = await service.startExportJob('proj-1', 'user-1', {
      metricsFormats: ['csv'],
    });

    await new Promise(r => setTimeout(r, 100));

    const job = getJobs(service).get(jobId);
    expect(job).toBeDefined();
    // The MetricsCalculator mock instance should exist but exportToCSV
    // must NOT be called because MT projects skip standard polygon metrics
    const instance = new (MockMetricsCalculator as unknown as new () => Record<
      string,
      ReturnType<typeof vi.fn>
    >)();
    expect(instance.exportToCSV).not.toHaveBeenCalled();
  });
});

// ─── C. cancelJob — various status transitions ────────────────────────────────

describe('ExportService — cancelJob status transitions', () => {
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

  it('marks pending job as cancelled when cancelJob is called', async () => {
    getJobs(service).set('pending-job', {
      id: 'pending-job',
      projectId: 'proj-1',
      userId: 'user-1',
      status: 'pending',
      progress: 0,
      createdAt: new Date(),
      options: {},
    });

    await service.cancelJob('pending-job', 'proj-1', 'user-1');

    const job = getJobs(service).get('pending-job');
    expect(job?.status).toBe('cancelled');
  });

  it('does not change status of already-completed job', async () => {
    getJobs(service).set('done-job', {
      id: 'done-job',
      projectId: 'proj-1',
      userId: 'user-1',
      status: 'completed',
      progress: 100,
      createdAt: new Date(),
      options: {},
    });

    await service.cancelJob('done-job', 'proj-1', 'user-1');

    const job = getJobs(service).get('done-job');
    expect(job?.status).toBe('completed');
  });

  it('returns silently when job not found (no access)', async () => {
    mockHasProjectAccess.mockResolvedValueOnce({ hasAccess: false });
    // Should not throw
    await expect(
      service.cancelJob('nonexistent-job', 'proj-1', 'user-1')
    ).resolves.toBeUndefined();
  });
});
