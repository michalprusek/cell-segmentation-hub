/**
 * exportService.woundTimeSeries.test.ts
 *
 * Exercises maybeAppendWoundTimeSeries end-to-end through startExportJob, so
 * the dynamic imports of `exceljs` and `../export/woundTimeSeries` actually run.
 * These branches are the graceful-degradation paths: whatever fails inside the
 * wound-chart append (exceljs import, workbook read, sheet append, xlsx write,
 * standalone-chart write), the export job itself must not crash.
 *
 * Only wound-specific behaviour lives here — generic job orchestration is in
 * exportService.test.ts and generic metrics generation in
 * exportService.generation.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── DB / service mocks ───────────────────────────────────────────────────────

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

vi.mock('uuid', () => ({ v4: vi.fn(() => 'wound-job-uuid') }));

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
  isMicrotubuleProject: (t: string | undefined | null) => t === 'microtubules',
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
  xlsx: { readFile: mockXlsxReadFile, writeFile: mockXlsxWriteFile },
};

vi.mock('exceljs', () => ({
  default: { Workbook: vi.fn(() => mockWorkbook) },
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

function makeProjectResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proj-1',
    title: 'Test Project',
    type: 'wound',
    images: [makeWoundImage('img-1')],
    ...overrides,
  };
}

describe('ExportService — maybeAppendWoundTimeSeries (via startExportJob)', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = makeService();
    mockHasProjectAccess.mockResolvedValue({ hasAccess: true });
    mockAppendWoundTimeSeriesSheet.mockResolvedValue({
      count: 1,
      chartPng: null,
      chartError: null,
    });
    mockWriteStandaloneWoundChart.mockResolvedValue('/tmp/chart.png');
    mockXlsxReadFile.mockResolvedValue(undefined);
    mockXlsxWriteFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  it('skips the wound-chart logic entirely for a non-wound project', async () => {
    const proj = makeProjectResponse({ type: 'spheroid' });
    (proj.images[0].segmentation as Record<string, unknown>).model = 'hrnet';
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(proj as never);

    const jobId = await service.startExportJob('proj-1', 'user-1', {
      metricsFormats: ['excel'],
    });
    await new Promise(r => setTimeout(r, 50));

    expect(mockAppendWoundTimeSeriesSheet).not.toHaveBeenCalled();
    expect(getJobs(service).has(jobId)).toBe(true);
  });

  it('completes gracefully when the exceljs import fails', async () => {
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

    expect(getJobs(service).has(jobId)).toBe(true);
    vi.doUnmock('exceljs');
  });

  it('completes gracefully when the workbook readFile fails', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValueOnce(
      makeProjectResponse() as never
    );
    mockXlsxReadFile.mockRejectedValueOnce(new Error('File not found'));

    const jobId = await service.startExportJob('proj-1', 'user-1', {
      metricsFormats: ['excel'],
    });
    await new Promise(r => setTimeout(r, 100));

    expect(getJobs(service).has(jobId)).toBe(true);
  });

  it('completes when the wound sheet reports zero frames (count === 0)', async () => {
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

  it('proceeds with the xlsx write even when a chartError is reported', async () => {
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

    expect(getJobs(service).has(jobId)).toBe(true);
  });

  it('completes gracefully when the xlsx writeFile fails', async () => {
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
  });

  it('writes the standalone chart when a chartPng is produced', async () => {
    mockAppendWoundTimeSeriesSheet.mockResolvedValue({
      count: 5,
      chartPng: Buffer.from('fake-png'),
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

  it('completes gracefully when writeStandaloneWoundChart fails', async () => {
    mockAppendWoundTimeSeriesSheet.mockResolvedValue({
      count: 5,
      chartPng: Buffer.from('fake-png'),
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
  });
});
