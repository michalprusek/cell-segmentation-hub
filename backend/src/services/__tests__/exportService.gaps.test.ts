/**
 * exportService.gaps.test.ts
 *
 * Covers uncovered paths in exportService.ts:
 *   - generateMetrics project-type dispatch (spheroid / spheroid_invasive / sperm / microtubules)
 *   - sperm fallback to polygon metrics when exportSpermToExcel returns false
 *   - microtubule metrics guard (skips standard polygon calculator)
 *   - generateAnnotations COCO / YOLO / JSON imageDataArray construction
 *   - cleanupOldJobs TTL eviction + MAX_JOBS cap logic
 *   - sanitizeFilename + getProgressMessage (pure helpers)
 *   - destroy() interval teardown
 *
 * Deliberately NOT tested here (infra-bound / already covered):
 *   - Real zip/FS creation (createZipArchive) — needs real filesystem
 *   - maybeAppendWoundTimeSeries — dynamic import of exceljs can't run in Vitest
 *   - processExportJob full pipeline — exercises real fs.mkdir, archiver, sharp
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mocks hoisted above all imports ----
// All vi.mock() factories MUST use inline vi.fn() — no outer const refs.
// Outer mock-spy variables are initialised AFTER the mock is applied (post-hoist).
// We wire them up in beforeEach via MockXxx.mockImplementation().

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

vi.mock('uuid', () => ({ v4: vi.fn(() => 'gaps-job-id') }));

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

// MetricsCalculator — factory returns a stub class; beforeEach wires real spies.
vi.mock('../metrics/metricsCalculator', () => ({
  MetricsCalculator: vi.fn(),
}));

// FormatConverter — same pattern.
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
  generateReadme: vi.fn().mockReturnValue('readme content'),
  generateMetricsGuide: vi.fn().mockReturnValue('guide content'),
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
      _concurrency: number,
      processor: (item: unknown) => Promise<unknown>
    ) => Promise.all(items.map(processor))
  ),
}));

vi.mock('../../types/validation', () => ({
  coerceProjectType: vi.fn((t: string) => t ?? 'spheroid'),
}));

// ---- Imports (after mocks) ----
import { ExportService, type ExportJob } from '../exportService';
import {
  sanitizeFilename,
  getProgressMessage,
} from '../export/exportFileOperations';
import { computeMTGeometry, writeMTMetrics } from '../export/mtMetricsExporter';
import { MetricsCalculator } from '../metrics/metricsCalculator';
import {
  FormatConverter,
  resolveImageDimensions,
} from '../export/formatConverter';
import * as fs from 'fs/promises';

// Cast to constructor mocks so we can call mockImplementation in beforeEach
const MockMetricsCalculator = MetricsCalculator as unknown as ReturnType<
  typeof vi.fn
>;
const MockFormatConverter = FormatConverter as unknown as ReturnType<
  typeof vi.fn
>;
const mockResolveImageDimensions =
  resolveImageDimensions as unknown as ReturnType<typeof vi.fn>;

// Per-test spies — initialised in beforeEach
let mockCalculateAllMetrics: ReturnType<typeof vi.fn>;
let mockCalculateAllImageMetrics: ReturnType<typeof vi.fn>;
let mockExportToExcel: ReturnType<typeof vi.fn>;
let mockExportToCSV: ReturnType<typeof vi.fn>;
let mockExportPolygonMetricsToExcel: ReturnType<typeof vi.fn>;
let mockExportSpermToExcel: ReturnType<typeof vi.fn>;

let mockConvertToCOCO: ReturnType<typeof vi.fn>;
let mockConvertToYOLO: ReturnType<typeof vi.fn>;
let mockConvertToJSON: ReturnType<typeof vi.fn>;

const resetSingleton = () => {
  (ExportService as unknown as { instance: unknown }).instance = undefined;
};

const makeService = () => {
  resetSingleton();
  return ExportService.getInstance();
};

// Reset mock implementations so each test starts fresh
function resetMockImpls() {
  mockCalculateAllMetrics = vi.fn().mockResolvedValue([]);
  mockCalculateAllImageMetrics = vi.fn().mockResolvedValue([]);
  mockExportToExcel = vi.fn().mockResolvedValue(undefined);
  mockExportToCSV = vi.fn().mockResolvedValue(undefined);
  mockExportPolygonMetricsToExcel = vi.fn().mockResolvedValue(undefined);
  mockExportSpermToExcel = vi.fn().mockResolvedValue(false);

  MockMetricsCalculator.mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.calculateAllMetrics = mockCalculateAllMetrics;
    this.calculateAllImageMetrics = mockCalculateAllImageMetrics;
    this.exportToExcel = mockExportToExcel;
    this.exportToCSV = mockExportToCSV;
    this.exportPolygonMetricsToExcel = mockExportPolygonMetricsToExcel;
    this.exportSpermToExcel = mockExportSpermToExcel;
  });

  mockConvertToCOCO = vi.fn().mockResolvedValue({});
  mockConvertToYOLO = vi
    .fn()
    .mockResolvedValue({ content: 'yolo content', warnings: [] });
  mockConvertToJSON = vi.fn().mockResolvedValue({});

  MockFormatConverter.mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.convertToCOCO = mockConvertToCOCO;
    this.convertToYOLO = mockConvertToYOLO;
    this.convertToJSON = mockConvertToJSON;
  });

  mockResolveImageDimensions.mockReturnValue({ width: 100, height: 100 });
}

// ---------------------------------------------------------------------------
// Helper to build a minimal image object understood by the private methods
// ---------------------------------------------------------------------------
function makeImage(
  overrides: Partial<{
    id: string;
    name: string;
    width: number | null;
    height: number | null;
    originalPath: string;
    projectId: string;
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
    isVideoContainer: boolean;
    parentVideoId: string | null;
    frameIndex: number | null;
  }> = {}
) {
  return {
    id: 'img-1',
    name: 'image.png',
    width: 100,
    height: 100,
    originalPath: 'projects/p1/images/img-1/original.png',
    thumbnailPath: null,
    segmentationThumbnailPath: null,
    fileSize: 1000,
    mimeType: 'image/png',
    projectId: 'project-id',
    segmentationStatus: 'segmented',
    createdAt: new Date(),
    updatedAt: new Date(),
    isVideoContainer: false,
    parentVideoId: null,
    frameIndex: null,
    segmentation: {
      id: 'seg-1',
      imageId: 'img-1',
      model: 'hrnet',
      threshold: 0.5,
      confidence: 0.95,
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

// ---------------------------------------------------------------------------
// Pure helper tests — no service instance needed
// ---------------------------------------------------------------------------

describe('sanitizeFilename (pure helper)', () => {
  it('passes through clean names unchanged', () => {
    expect(sanitizeFilename('my_project')).toBe('my_project');
  });

  it('replaces Windows-unsafe chars with underscore', () => {
    expect(sanitizeFilename('a:b/c<d')).toBe('a_b_c_d');
  });

  it('removes leading and trailing dots', () => {
    expect(sanitizeFilename('..file..')).toBe('file');
  });

  it('returns "export" for empty input', () => {
    expect(sanitizeFilename('')).toBe('export');
    expect(sanitizeFilename('   ')).toBe('export');
  });

  it('returns "export" for non-string input', () => {
    // @ts-expect-error testing runtime guard
    expect(sanitizeFilename(null)).toBe('export');
  });

  it('truncates names longer than 100 chars', () => {
    const long = 'a'.repeat(120);
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(100);
  });

  it('appends _export to Windows reserved device names', () => {
    expect(sanitizeFilename('CON')).toBe('CON_export');
    expect(sanitizeFilename('nul')).toBe('nul_export');
    expect(sanitizeFilename('COM3')).toBe('COM3_export');
  });
});

// ---------------------------------------------------------------------------

describe('getProgressMessage (pure helper)', () => {
  it('returns generic message when no stage given', () => {
    expect(getProgressMessage(42)).toBe('Processing... 42%');
  });

  it('returns stage message without detail', () => {
    expect(getProgressMessage(10, 'images')).toBe(
      'Copying original images... 10%'
    );
    expect(getProgressMessage(20, 'visualizations')).toBe(
      'Generating visualizations... 20%'
    );
    expect(getProgressMessage(30, 'annotations')).toBe(
      'Creating annotation files... 30%'
    );
    expect(getProgressMessage(40, 'metrics')).toBe(
      'Calculating metrics... 40%'
    );
    expect(getProgressMessage(95, 'compression')).toBe(
      'Creating archive... 95%'
    );
  });

  it('returns stage message with item progress', () => {
    const msg = getProgressMessage(50, 'images', { current: 3, total: 10 });
    expect(msg).toContain('3/10');
    expect(msg).toContain('50%');
    expect(msg).toContain('Copying original images');
  });

  it('includes currentItem suffix when provided', () => {
    const msg = getProgressMessage(60, 'visualizations', {
      current: 2,
      total: 5,
      currentItem: 'img_01.png',
    });
    expect(msg).toContain('img_01.png');
  });
});

// ---------------------------------------------------------------------------
// generateMetrics dispatch
// ---------------------------------------------------------------------------

describe('ExportService — generateMetrics dispatch', () => {
  let service: ExportService;
  const exportDir = '/tmp/fake-export';
  const projectName = 'Test Project';

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
  });

  afterEach(() => {
    resetSingleton();
  });

  const callGenerateMetrics = (
    svc: ExportService,
    projectType: string,
    formats: string[],
    images: ReturnType<typeof makeImage>[],
    opts: Record<string, unknown> = {},
    jobId?: string
  ) =>
    (
      svc as unknown as {
        generateMetrics: (
          images: unknown[],
          exportDir: string,
          formats: string[],
          projectName: string,
          projectType: string,
          options: Record<string, unknown>,
          jobId?: string
        ) => Promise<void>;
      }
    ).generateMetrics(
      images,
      exportDir,
      formats,
      projectName,
      projectType,
      opts,
      jobId
    );

  it('skips metric calculation entirely for microtubules projects', async () => {
    await callGenerateMetrics(
      service,
      'microtubules',
      ['excel', 'csv'],
      [makeImage({})]
    );

    expect(mockCalculateAllMetrics).not.toHaveBeenCalled();
    expect(mockExportPolygonMetricsToExcel).not.toHaveBeenCalled();
    expect(mockExportToExcel).not.toHaveBeenCalled();
    expect(mockExportSpermToExcel).not.toHaveBeenCalled();
  });

  it('routes spheroid project to exportPolygonMetricsToExcel for excel format', async () => {
    await callGenerateMetrics(service, 'spheroid', ['excel'], [makeImage({})]);

    expect(mockCalculateAllMetrics).toHaveBeenCalledOnce();
    expect(mockExportPolygonMetricsToExcel).toHaveBeenCalledOnce();
    expect(mockExportToExcel).not.toHaveBeenCalled();
    expect(mockExportSpermToExcel).not.toHaveBeenCalled();
  });

  it('routes spheroid_invasive project to exportToExcel (DI sheet)', async () => {
    await callGenerateMetrics(
      service,
      'spheroid_invasive',
      ['excel'],
      [makeImage({})]
    );

    expect(mockExportToExcel).toHaveBeenCalledOnce();
    expect(mockExportPolygonMetricsToExcel).not.toHaveBeenCalled();
    expect(mockExportSpermToExcel).not.toHaveBeenCalled();
  });

  it('routes sperm project to exportSpermToExcel when it succeeds', async () => {
    mockExportSpermToExcel.mockResolvedValueOnce(true);
    await callGenerateMetrics(service, 'sperm', ['excel'], [makeImage({})]);

    expect(mockExportSpermToExcel).toHaveBeenCalledOnce();
    expect(mockExportPolygonMetricsToExcel).not.toHaveBeenCalled();
  });

  it('falls back to polygon metrics when sperm export returns false', async () => {
    // default mock returns false
    await callGenerateMetrics(service, 'sperm', ['excel'], [makeImage({})]);

    expect(mockExportSpermToExcel).toHaveBeenCalledOnce();
    expect(mockExportPolygonMetricsToExcel).toHaveBeenCalledOnce();
  });

  it('writes CSV via exportToCSV for non-MT projects', async () => {
    await callGenerateMetrics(service, 'spheroid', ['csv'], [makeImage({})]);

    expect(mockExportToCSV).toHaveBeenCalledOnce();
    expect(mockExportPolygonMetricsToExcel).not.toHaveBeenCalled();
  });

  it('writes JSON via fs.writeFile for non-MT projects', async () => {
    await callGenerateMetrics(service, 'spheroid', ['json'], [makeImage({})]);

    const writeCalls = vi.mocked(fs.writeFile).mock.calls;
    const jsonCall = writeCalls.find(([p]) =>
      String(p).endsWith('metrics.json')
    );
    expect(jsonCall).toBeDefined();
  });

  it('handles multiple formats in a single call', async () => {
    mockExportSpermToExcel.mockResolvedValueOnce(true);
    await callGenerateMetrics(
      service,
      'sperm',
      ['excel', 'csv', 'json'],
      [makeImage({})]
    );

    expect(mockExportSpermToExcel).toHaveBeenCalledOnce();
    expect(mockExportToCSV).toHaveBeenCalledOnce();
    const writeCalls = vi.mocked(fs.writeFile).mock.calls;
    expect(writeCalls.some(([p]) => String(p).endsWith('metrics.json'))).toBe(
      true
    );
  });

  it('throws "Export cancelled by user" when job is cancelled before calculation', async () => {
    const jobs = (service as unknown as { exportJobs: Map<string, ExportJob> })
      .exportJobs;
    jobs.set('cancel-job', {
      id: 'cancel-job',
      projectId: 'p',
      userId: 'u',
      status: 'cancelled',
      progress: 0,
      createdAt: new Date(),
      options: {},
    });

    await expect(
      callGenerateMetrics(
        service,
        'spheroid',
        ['excel'],
        [makeImage({})],
        {},
        'cancel-job'
      )
    ).rejects.toThrow('Export cancelled by user');

    expect(mockCalculateAllMetrics).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// generateAnnotations dispatch
// ---------------------------------------------------------------------------

describe('ExportService — generateAnnotations dispatch', () => {
  let service: ExportService;
  const exportDir = '/tmp/fake-export';

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
  });

  afterEach(() => {
    resetSingleton();
  });

  const callGenerateAnnotations = (
    svc: ExportService,
    formats: string[],
    images: ReturnType<typeof makeImage>[]
  ) =>
    (
      svc as unknown as {
        generateAnnotations: (
          images: unknown[],
          exportDir: string,
          formats: string[],
          jobId?: string,
          onProgress?: () => void
        ) => Promise<void>;
      }
    ).generateAnnotations(images, exportDir, formats);

  it('COCO: calls convertToCOCO with segmentation dimensions', async () => {
    const image = makeImage({
      segmentation: {
        ...makeImage({}).segmentation!,
        imageWidth: 640,
        imageHeight: 480,
      },
    });
    await callGenerateAnnotations(service, ['coco'], [image]);

    expect(mockConvertToCOCO).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'img-1',
          filename: 'image.png',
          width: 640,
          height: 480,
        }),
      ])
    );
    const writeCalls = vi.mocked(fs.writeFile).mock.calls;
    expect(
      writeCalls.some(([p]) => String(p).endsWith('annotations.json'))
    ).toBe(true);
  });

  it('COCO: falls back to image.width/height when segmentation has no dimensions', async () => {
    const image = makeImage({
      width: 320,
      height: 240,
      segmentation: {
        ...makeImage({}).segmentation!,
        imageWidth: null,
        imageHeight: null,
      },
    });
    await callGenerateAnnotations(service, ['coco'], [image]);

    expect(mockConvertToCOCO).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ width: 320, height: 240 }),
      ])
    );
  });

  it('COCO: image with no segmentation gets empty segmentationResults', async () => {
    await callGenerateAnnotations(
      service,
      ['coco'],
      [makeImage({ segmentation: null })]
    );

    expect(mockConvertToCOCO).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ segmentationResults: [] }),
      ])
    );
  });

  it('JSON: calls convertToJSON and writes segmentation_data.json', async () => {
    await callGenerateAnnotations(service, ['json'], [makeImage({})]);

    expect(mockConvertToJSON).toHaveBeenCalledOnce();
    const writeCalls = vi.mocked(fs.writeFile).mock.calls;
    expect(
      writeCalls.some(([p]) => String(p).endsWith('segmentation_data.json'))
    ).toBe(true);
  });

  it('YOLO: skips images with no segmentation', async () => {
    await callGenerateAnnotations(
      service,
      ['yolo'],
      [makeImage({ segmentation: null })]
    );
    expect(mockConvertToYOLO).not.toHaveBeenCalled();
  });

  it('YOLO: calls convertToYOLO and writes .txt file when segmentation exists', async () => {
    await callGenerateAnnotations(service, ['yolo'], [makeImage({})]);

    expect(mockConvertToYOLO).toHaveBeenCalledOnce();
    const writeCalls = vi.mocked(fs.writeFile).mock.calls;
    const yoloCall = writeCalls.find(([p]) => String(p).endsWith('.txt'));
    expect(yoloCall).toBeDefined();
    expect(yoloCall?.[1]).toBe('yolo content');
  });

  it('YOLO: skips when resolveImageDimensions returns zero dimensions', async () => {
    mockResolveImageDimensions.mockReturnValueOnce({ width: 0, height: 0 });
    await callGenerateAnnotations(service, ['yolo'], [makeImage({})]);
    expect(mockConvertToYOLO).not.toHaveBeenCalled();
  });

  it('processes multiple formats sequentially', async () => {
    await callGenerateAnnotations(service, ['coco', 'json'], [makeImage({})]);
    expect(mockConvertToCOCO).toHaveBeenCalledOnce();
    expect(mockConvertToJSON).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// cleanupOldJobs
// ---------------------------------------------------------------------------

describe('ExportService — cleanupOldJobs', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
  });

  afterEach(() => {
    resetSingleton();
  });

  const callCleanup = (svc: ExportService) =>
    (svc as unknown as { cleanupOldJobs: () => void }).cleanupOldJobs();

  const getJobs = (svc: ExportService) =>
    (svc as unknown as { exportJobs: Map<string, ExportJob> }).exportJobs;

  it('removes jobs older than JOB_TTL_MS (24h)', () => {
    const jobs = getJobs(service);
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    jobs.set('old-job', {
      id: 'old-job',
      projectId: 'p',
      userId: 'u',
      status: 'completed',
      progress: 100,
      createdAt: oldDate,
      options: {},
    });
    jobs.set('new-job', {
      id: 'new-job',
      projectId: 'p',
      userId: 'u',
      status: 'pending',
      progress: 0,
      createdAt: new Date(),
      options: {},
    });

    callCleanup(service);

    expect(jobs.has('old-job')).toBe(false);
    expect(jobs.has('new-job')).toBe(true);
  });

  it('does nothing when there are no jobs', () => {
    expect(getJobs(service).size).toBe(0);
    expect(() => callCleanup(service)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// generateMicrotubuleMetrics
// ---------------------------------------------------------------------------

describe('ExportService — generateMicrotubuleMetrics dispatch', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
  });

  afterEach(() => {
    resetSingleton();
  });

  const callGenerateMT = (
    svc: ExportService,
    images: ReturnType<typeof makeImage>[],
    options: Record<string, unknown>,
    jobId?: string
  ) =>
    (
      svc as unknown as {
        generateMicrotubuleMetrics: (
          images: unknown[],
          exportDir: string,
          options: unknown,
          jobId?: string
        ) => Promise<void>;
      }
    ).generateMicrotubuleMetrics(images, '/tmp/mt-export', options, jobId);

  it('uses geometry-only path when no channels selected and writes metrics', async () => {
    // Return a non-empty row list so writeMTMetrics is called
    vi.mocked(computeMTGeometry).mockReturnValueOnce([
      {
        frameIndex: 0,
        imageId: 'img-1',
        instanceId: 'inst-1',
        trackId: null,
        channel: '',
        lengthPx: 42,
        lengthUm: null,
        areaPx: null,
        areaUm2: null,
        pixelCount: null,
        sumIntensity: null,
        meanIntensity: null,
        stdIntensity: null,
        medianBackground: null,
        signalMinusBackground: null,
      },
    ]);

    await callGenerateMT(service, [makeImage({})], { metricsFormats: ['csv'] });

    expect(computeMTGeometry).toHaveBeenCalledOnce();
    expect(writeMTMetrics).toHaveBeenCalledOnce();
  });

  it('adds warning when no channel is selected', async () => {
    vi.mocked(computeMTGeometry).mockReturnValueOnce([
      {
        frameIndex: 0,
        imageId: 'img-1',
        instanceId: 'inst-1',
        trackId: null,
        channel: '',
        lengthPx: 10,
        lengthUm: null,
        areaPx: null,
        areaUm2: null,
        pixelCount: null,
        sumIntensity: null,
        meanIntensity: null,
        stdIntensity: null,
        medianBackground: null,
        signalMinusBackground: null,
      },
    ]);

    const jobs = (service as unknown as { exportJobs: Map<string, ExportJob> })
      .exportJobs;
    jobs.set('mt-job', {
      id: 'mt-job',
      projectId: 'p',
      userId: 'u',
      status: 'processing',
      progress: 50,
      createdAt: new Date(),
      options: {},
    });

    await callGenerateMT(
      service,
      [makeImage({})],
      { metricsFormats: ['csv'] },
      'mt-job'
    );

    const job = jobs.get('mt-job');
    expect(
      job?.warnings?.some(w => w.includes('no channel was selected'))
    ).toBe(true);
  });

  it('does not write metrics file and adds warning when no polylines exist', async () => {
    vi.mocked(computeMTGeometry).mockReturnValueOnce([]);

    const jobs = (service as unknown as { exportJobs: Map<string, ExportJob> })
      .exportJobs;
    jobs.set('mt-empty', {
      id: 'mt-empty',
      projectId: 'p',
      userId: 'u',
      status: 'processing',
      progress: 50,
      createdAt: new Date(),
      options: {},
    });

    await callGenerateMT(
      service,
      [makeImage({})],
      { metricsFormats: ['csv'] },
      'mt-empty'
    );

    expect(writeMTMetrics).not.toHaveBeenCalled();
    const job = jobs.get('mt-empty');
    expect(
      job?.warnings?.some(w => w.includes('No microtubule annotations'))
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// destroy()
// ---------------------------------------------------------------------------

describe('ExportService — destroy()', () => {
  it('clears the cleanup interval', () => {
    const svc = makeService();
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');

    svc.destroy();

    expect(clearSpy).toHaveBeenCalledOnce();
    clearSpy.mockRestore();
    resetSingleton();
  });

  it('is idempotent on multiple calls', () => {
    const svc = makeService();
    expect(() => {
      svc.destroy();
      svc.destroy();
    }).not.toThrow();
    resetSingleton();
  });
});
