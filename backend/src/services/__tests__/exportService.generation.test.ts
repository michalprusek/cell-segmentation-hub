/**
 * exportService.generation.test.ts — Export content generation.
 *
 * Covers the private "produce the export artefacts" methods of ExportService:
 *   - Pure helpers: sanitizeFilename, getProgressMessage
 *   - createFolderStructure
 *   - copyOriginalImagesWithProgress (skip / path-traversal / failure / cancel)
 *   - generateMetrics dispatch by project type (spheroid / DI / sperm / MT)
 *       + sperm Excel orchestration (scale, fallback, JSON passthrough)
 *       + image-dimension backfill via sharp
 *   - generateAnnotations (COCO / YOLO / JSON + cancellation)
 *   - generateVisualizations (skip paths, frame naming, labelPrefix)
 *   - generateDocumentation (README / metadata / guides)
 *   - generateMicrotubuleMetrics (intensity + geometry fallback + warnings)
 *   - maybeAppendWoundTimeSeries non-wound fast path
 *
 * The wound-time-series success/error branches (which drive the exceljs +
 * woundTimeSeries dynamic imports) live in exportService.woundTimeSeries.test.ts.
 * Job orchestration lives in exportService.test.ts.
 *
 * All I/O (FS / archiver / sharp / Prisma / ML) is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

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

vi.mock('uuid', () => ({ v4: vi.fn(() => 'gen-job-id') }));

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

vi.mock('fs/promises', () => {
  const mod = {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('data')),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ size: 100 }),
    unlink: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue({
      read: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    rm: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockRejectedValue({ code: 'ENOENT' }),
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
    metadata: vi.fn().mockResolvedValue({ width: 640, height: 480 }),
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

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { ExportService, type ExportJob } from '../exportService';
import {
  sanitizeFilename,
  getProgressMessage,
} from '../export/exportFileOperations';
import { MetricsCalculator } from '../metrics/metricsCalculator';
import {
  FormatConverter,
  resolveImageDimensions,
} from '../export/formatConverter';
import { VisualizationGenerator } from '../visualization/visualizationGenerator';
import {
  computeMTMetrics,
  computeMTGeometry,
  writeMTMetrics,
} from '../export/mtMetricsExporter';
import {
  generateReadme,
  generateMetricsGuide,
  generateAnnotationGuides,
} from '../export/exportDocs';
import { prisma } from '../../db';
import sharp from 'sharp';
import * as fs from 'fs/promises';

const MockMetricsCalculator = MetricsCalculator as unknown as ReturnType<
  typeof vi.fn
>;
const MockFormatConverter = FormatConverter as unknown as ReturnType<
  typeof vi.fn
>;
const MockVizGen = VisualizationGenerator as unknown as ReturnType<
  typeof vi.fn
>;
const mockResolveImageDimensions =
  resolveImageDimensions as unknown as ReturnType<typeof vi.fn>;

// ─── Per-test spies (wired in resetMockImpls) ─────────────────────────────────

let mockCalculateAllMetrics: ReturnType<typeof vi.fn>;
let mockCalculateAllImageMetrics: ReturnType<typeof vi.fn>;
let mockExportToExcel: ReturnType<typeof vi.fn>;
let mockExportToCSV: ReturnType<typeof vi.fn>;
let mockExportPolygonMetricsToExcel: ReturnType<typeof vi.fn>;
let mockExportSpermToExcel: ReturnType<typeof vi.fn>;
let mockConvertToCOCO: ReturnType<typeof vi.fn>;
let mockConvertToYOLO: ReturnType<typeof vi.fn>;
let mockConvertToJSON: ReturnType<typeof vi.fn>;
let mockVizGenerate: ReturnType<typeof vi.fn>;

function resetMockImpls(): void {
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

  mockVizGenerate = vi.fn().mockResolvedValue('success');
  MockVizGen.mockImplementation(function (this: Record<string, unknown>) {
    this.generateVisualization = mockVizGenerate;
  });

  mockResolveImageDimensions.mockReturnValue({ width: 100, height: 100 });
}

/** Reset the MT-exporter mocks to a known clean default (avoids once-leakage). */
function resetMtMocks(): void {
  vi.mocked(computeMTMetrics).mockReset().mockResolvedValue({
    rows: [],
    skipped: [],
  });
  vi.mocked(computeMTGeometry).mockReset().mockReturnValue([]);
  vi.mocked(writeMTMetrics).mockReset().mockResolvedValue(undefined);
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

const resetSingleton = () => {
  (ExportService as unknown as { instance: unknown }).instance = undefined;
};

const makeService = (): ExportService => {
  resetSingleton();
  return ExportService.getInstance();
};

const getJobs = (svc: ExportService): Map<string, ExportJob> =>
  (svc as unknown as { exportJobs: Map<string, ExportJob> }).exportJobs;

const seedCancelledJob = (svc: ExportService, id: string): void => {
  getJobs(svc).set(id, {
    id,
    projectId: 'p',
    userId: 'u',
    status: 'cancelled',
    progress: 0,
    createdAt: new Date(),
    options: {},
  });
};

const seedProcessingJob = (svc: ExportService, id: string): void => {
  getJobs(svc).set(id, {
    id,
    projectId: 'p',
    userId: 'u',
    status: 'processing',
    progress: 50,
    createdAt: new Date(),
    options: {},
  });
};

/** Minimal image row understood by the private generation methods. */
function makeImage(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id: 'img-1',
    name: 'image.png',
    width: 100,
    height: 100,
    originalPath: 'projects/p/images/img-1/original.png',
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

/** Image whose segmentation carries sperm polylines. */
const spermPolyline = (
  partClass: 'head' | 'midpiece' | 'tail',
  instanceId = 'sperm_1'
) => ({
  id: `pl-${partClass}`,
  type: 'external',
  geometry: 'polyline',
  partClass,
  instanceId,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
});

const makeSpermImage = (id: string, polylines: unknown[]) =>
  makeImage({
    id,
    name: `${id}.png`,
    segmentation: {
      id: `seg-${id}`,
      imageId: id,
      model: 'sperm',
      threshold: 0.5,
      confidence: 0.9,
      processingTime: 200,
      imageWidth: 100,
      imageHeight: 100,
      polygons: JSON.stringify(polylines),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

// ─── Private-method call wrappers ─────────────────────────────────────────────

const EXPORT_DIR = '/tmp/fake-export';

const callGenerateMetrics = (
  svc: ExportService,
  projectType: string,
  formats: string[],
  images: Record<string, unknown>[],
  opts: Record<string, unknown> = {},
  jobId?: string
) =>
  (
    svc as unknown as {
      generateMetrics(
        images: unknown[],
        exportDir: string,
        formats: string[],
        projectName: string,
        projectType: string,
        options: Record<string, unknown>,
        jobId?: string
      ): Promise<void>;
    }
  ).generateMetrics(
    images,
    EXPORT_DIR,
    formats,
    'Test Project',
    projectType,
    opts,
    jobId
  );

const callGenerateAnnotations = (
  svc: ExportService,
  formats: string[],
  images: Record<string, unknown>[],
  jobId?: string
) =>
  (
    svc as unknown as {
      generateAnnotations(
        images: unknown[],
        exportDir: string,
        formats: string[],
        jobId?: string
      ): Promise<void>;
    }
  ).generateAnnotations(images, EXPORT_DIR, formats, jobId);

const callGenerateViz = (
  svc: ExportService,
  images: Record<string, unknown>[],
  jobId?: string
) =>
  (
    svc as unknown as {
      generateVisualizations(
        images: unknown[],
        exportDir: string,
        options: unknown,
        jobId?: string,
        onProgress?: () => void
      ): Promise<void>;
    }
  ).generateVisualizations(images, '/tmp/viz', undefined, jobId);

const callGenerateMT = (
  svc: ExportService,
  images: Record<string, unknown>[],
  options: Record<string, unknown>,
  jobId?: string
) =>
  (
    svc as unknown as {
      generateMicrotubuleMetrics(
        images: unknown[],
        exportDir: string,
        options: unknown,
        jobId?: string
      ): Promise<void>;
    }
  ).generateMicrotubuleMetrics(images, '/tmp/mt', options, jobId);

// ═══════════════════════════════════════════════════════════════════════════
// Pure helpers
// ═══════════════════════════════════════════════════════════════════════════

describe('sanitizeFilename', () => {
  it('passes clean names through unchanged', () => {
    expect(sanitizeFilename('my_project')).toBe('my_project');
  });

  it('replaces Windows-unsafe characters with underscore', () => {
    expect(sanitizeFilename('a:b/c<d')).toBe('a_b_c_d');
  });

  it('strips leading and trailing dots', () => {
    expect(sanitizeFilename('..file..')).toBe('file');
  });

  it('returns "export" for empty / whitespace input', () => {
    expect(sanitizeFilename('')).toBe('export');
    expect(sanitizeFilename('   ')).toBe('export');
  });

  it('returns "export" for non-string input', () => {
    // @ts-expect-error runtime guard
    expect(sanitizeFilename(null)).toBe('export');
  });

  it('truncates names longer than 100 characters', () => {
    expect(sanitizeFilename('a'.repeat(120)).length).toBeLessThanOrEqual(100);
  });

  it('appends _export to Windows reserved device names', () => {
    expect(sanitizeFilename('CON')).toBe('CON_export');
    expect(sanitizeFilename('nul')).toBe('nul_export');
    expect(sanitizeFilename('COM3')).toBe('COM3_export');
  });
});

describe('getProgressMessage', () => {
  it('returns a generic message when no stage is given', () => {
    expect(getProgressMessage(42)).toBe('Processing... 42%');
  });

  it('returns the stage message without detail', () => {
    expect(getProgressMessage(10, 'images')).toBe(
      'Copying original images... 10%'
    );
    expect(getProgressMessage(20, 'visualizations')).toBe(
      'Generating visualizations... 20%'
    );
    expect(getProgressMessage(30, 'annotations')).toBe(
      'Creating annotation files... 30%'
    );
    expect(getProgressMessage(40, 'metrics')).toBe('Calculating metrics... 40%');
    expect(getProgressMessage(95, 'compression')).toBe('Creating archive... 95%');
  });

  it('includes item progress when supplied', () => {
    const msg = getProgressMessage(50, 'images', { current: 3, total: 10 });
    expect(msg).toContain('3/10');
    expect(msg).toContain('50%');
    expect(msg).toContain('Copying original images');
  });

  it('includes the currentItem suffix when provided', () => {
    const msg = getProgressMessage(60, 'visualizations', {
      current: 2,
      total: 5,
      currentItem: 'img_01.png',
    });
    expect(msg).toContain('img_01.png');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// createFolderStructure
// ═══════════════════════════════════════════════════════════════════════════

describe('ExportService — createFolderStructure', () => {
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

  it('creates every required export subdirectory', async () => {
    await (
      service as unknown as {
        createFolderStructure(exportDir: string): Promise<void>;
      }
    ).createFolderStructure('/tmp/export-dir');

    const mkdirCalls = vi.mocked(fs.mkdir).mock.calls.map(c => String(c[0]));
    for (const suffix of [
      'images',
      'visualizations',
      'annotations/coco',
      'annotations/yolo',
      'annotations/json',
      'metrics',
      'documentation',
    ]) {
      expect(mkdirCalls.some(p => p.endsWith(suffix))).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// copyOriginalImagesWithProgress
// ═══════════════════════════════════════════════════════════════════════════

describe('ExportService — copyOriginalImagesWithProgress', () => {
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

  const callCopy = (images: Record<string, unknown>[], jobId?: string) =>
    (
      service as unknown as {
        copyOriginalImagesWithProgress(
          images: unknown[],
          exportDir: string,
          onProgress?: unknown,
          jobId?: string
        ): Promise<void>;
      }
    ).copyOriginalImagesWithProgress(images, '/tmp/export', undefined, jobId);

  it('skips an image with a null/empty originalPath', async () => {
    await callCopy([makeImage({ originalPath: null })]);
    expect(vi.mocked(fs.copyFile)).not.toHaveBeenCalled();
  });

  it('skips an image whose path escapes the upload directory', async () => {
    await callCopy([makeImage({ originalPath: '../../etc/passwd' })]);
    expect(vi.mocked(fs.copyFile)).not.toHaveBeenCalled();
  });

  it('swallows a copyFile failure without throwing', async () => {
    vi.mocked(fs.copyFile).mockRejectedValueOnce(new Error('ENOENT'));
    await expect(callCopy([makeImage()])).resolves.toBeUndefined();
  });

  it('copies a valid image via fs.copyFile', async () => {
    await expect(callCopy([makeImage()])).resolves.toBeUndefined();
    expect(vi.mocked(fs.copyFile)).toHaveBeenCalledOnce();
  });

  it('throws "Export cancelled by user" when the job is cancelled', async () => {
    seedCancelledJob(service, 'copy-cancel');
    await expect(callCopy([makeImage()], 'copy-cancel')).rejects.toThrow(
      'Export cancelled by user'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// generateMetrics — project-type dispatch
// ═══════════════════════════════════════════════════════════════════════════

describe('ExportService — generateMetrics dispatch', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    resetMtMocks();
    service = makeService();
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  it('skips standard metric calculation entirely for microtubules projects', async () => {
    await callGenerateMetrics(service, 'microtubules', ['excel', 'csv'], [
      makeImage(),
    ]);

    expect(mockCalculateAllMetrics).not.toHaveBeenCalled();
    expect(mockExportPolygonMetricsToExcel).not.toHaveBeenCalled();
    expect(mockExportToExcel).not.toHaveBeenCalled();
    expect(mockExportSpermToExcel).not.toHaveBeenCalled();
  });

  it('routes a spheroid project to exportPolygonMetricsToExcel', async () => {
    await callGenerateMetrics(service, 'spheroid', ['excel'], [makeImage()]);

    expect(mockCalculateAllMetrics).toHaveBeenCalledOnce();
    expect(mockExportPolygonMetricsToExcel).toHaveBeenCalledOnce();
    expect(mockExportToExcel).not.toHaveBeenCalled();
    expect(mockExportSpermToExcel).not.toHaveBeenCalled();
  });

  it('routes a spheroid_invasive project to exportToExcel (DI sheet)', async () => {
    await callGenerateMetrics(service, 'spheroid_invasive', ['excel'], [
      makeImage(),
    ]);

    expect(mockExportToExcel).toHaveBeenCalledOnce();
    expect(mockExportPolygonMetricsToExcel).not.toHaveBeenCalled();
    expect(mockExportSpermToExcel).not.toHaveBeenCalled();
  });

  it('writes CSV via exportToCSV for a non-MT project', async () => {
    await callGenerateMetrics(service, 'spheroid', ['csv'], [makeImage()]);
    expect(mockExportToCSV).toHaveBeenCalledOnce();
    expect(mockExportPolygonMetricsToExcel).not.toHaveBeenCalled();
  });

  it('writes metrics.json via fs.writeFile for a non-MT project', async () => {
    await callGenerateMetrics(service, 'spheroid', ['json'], [makeImage()]);
    const jsonCall = vi
      .mocked(fs.writeFile)
      .mock.calls.find(([p]) => String(p).endsWith('metrics.json'));
    expect(jsonCall).toBeDefined();
  });

  it('throws "Export cancelled by user" when the job is cancelled before calculation', async () => {
    seedCancelledJob(service, 'cancel-job');
    await expect(
      callGenerateMetrics(service, 'spheroid', ['excel'], [makeImage()], {}, 'cancel-job')
    ).rejects.toThrow('Export cancelled by user');
    expect(mockCalculateAllMetrics).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// generateMetrics — sperm Excel orchestration
// ═══════════════════════════════════════════════════════════════════════════

describe('ExportService — generateMetrics sperm orchestration', () => {
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

  it('routes sperm projects to exportSpermToExcel when it succeeds', async () => {
    mockExportSpermToExcel.mockResolvedValue(true);
    await callGenerateMetrics(service, 'sperm', ['excel'], [
      makeSpermImage('img1', [
        spermPolyline('head'),
        spermPolyline('midpiece'),
        spermPolyline('tail'),
      ]),
    ]);

    expect(mockExportSpermToExcel).toHaveBeenCalledOnce();
    expect(mockExportPolygonMetricsToExcel).not.toHaveBeenCalled();
    expect(mockExportToExcel).not.toHaveBeenCalled();
  });

  it('falls back to polygon-metrics Excel and warns when sperm export returns false', async () => {
    mockExportSpermToExcel.mockResolvedValue(false);
    await callGenerateMetrics(
      service,
      'sperm',
      ['excel'],
      [makeSpermImage('img1', [])],
      {},
      'sperm-fallback'
    );

    expect(mockExportSpermToExcel).toHaveBeenCalledOnce();
    expect(mockExportPolygonMetricsToExcel).toHaveBeenCalledOnce();
  });

  it('propagates pixelToMicrometerScale to exportSpermToExcel', async () => {
    mockExportSpermToExcel.mockResolvedValue(true);
    await callGenerateMetrics(
      service,
      'sperm',
      ['excel'],
      [makeSpermImage('img1', [spermPolyline('head')])],
      { pixelToMicrometerScale: 2.5 }
    );

    expect(mockExportSpermToExcel).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringMatching(/metrics\.xlsx$/),
      2.5
    );
  });

  it('passes scale=undefined when no scale option is provided', async () => {
    mockExportSpermToExcel.mockResolvedValue(true);
    await callGenerateMetrics(service, 'sperm', ['excel'], [
      makeSpermImage('img1', [spermPolyline('head')]),
    ]);

    expect(mockExportSpermToExcel).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      undefined
    );
  });

  it('forwards the image segmentation JSON unchanged to exportSpermToExcel', async () => {
    mockExportSpermToExcel.mockResolvedValue(true);
    const polylines = [spermPolyline('head'), spermPolyline('tail')];
    await callGenerateMetrics(service, 'sperm', ['excel'], [
      makeSpermImage('img-x', polylines),
    ]);

    const passedImages = mockExportSpermToExcel.mock.calls[0]?.[0];
    expect(passedImages).toHaveLength(1);
    expect(passedImages[0].id).toBe('img-x');
    expect(passedImages[0].segmentation.polygons).toBe(
      JSON.stringify(polylines)
    );
  });

  it('handles multiple metrics formats (excel + csv + json) in one call', async () => {
    mockExportSpermToExcel.mockResolvedValue(true);
    await callGenerateMetrics(service, 'sperm', ['excel', 'csv', 'json'], [
      makeSpermImage('img1', [spermPolyline('head')]),
    ]);

    expect(mockExportSpermToExcel).toHaveBeenCalledOnce();
    expect(mockExportToCSV).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(fs.writeFile)
        .mock.calls.some(([p]) => String(p).endsWith('metrics.json'))
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// generateMetrics — image-dimension backfill (sharp)
// ═══════════════════════════════════════════════════════════════════════════

describe('ExportService — generateMetrics dimension backfill', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
    vi.mocked(sharp)
      .mockReset()
      .mockReturnValue({
        metadata: vi.fn().mockResolvedValue({ width: 640, height: 480 }),
      } as never);
    vi.mocked(prisma.image.update).mockResolvedValue({} as never);
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const backfillImage = () =>
    makeImage({ width: null, height: null, originalPath: 'projects/p/img.png' });

  it('calls sharp().metadata() when an image is missing width/height', async () => {
    await callGenerateMetrics(service, 'spheroid', ['json'], [backfillImage()]);
    expect(vi.mocked(sharp)).toHaveBeenCalledOnce();
  });

  it('persists backfilled dimensions via prisma.image.update', async () => {
    await callGenerateMetrics(service, 'spheroid', ['json'], [backfillImage()]);
    expect(vi.mocked(prisma.image.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'img-1' },
        data: { width: 640, height: 480 },
      })
    );
  });

  it('skips backfill when the image already has dimensions', async () => {
    await callGenerateMetrics(service, 'spheroid', ['json'], [makeImage()]);
    expect(vi.mocked(sharp)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.image.update)).not.toHaveBeenCalled();
  });

  it('skips backfill when originalPath is null/empty', async () => {
    await callGenerateMetrics(service, 'spheroid', ['json'], [
      makeImage({ width: null, height: null, originalPath: null }),
    ]);
    expect(vi.mocked(sharp)).not.toHaveBeenCalled();
  });

  it('continues (no persist) when sharp throws', async () => {
    vi.mocked(sharp).mockReturnValueOnce({
      metadata: vi.fn().mockRejectedValueOnce(new Error('unsupported format')),
    } as never);
    await expect(
      callGenerateMetrics(service, 'spheroid', ['json'], [backfillImage()])
    ).resolves.toBeUndefined();
    expect(vi.mocked(prisma.image.update)).not.toHaveBeenCalled();
  });

  it('continues when prisma.image.update throws (dims still used from cache)', async () => {
    vi.mocked(prisma.image.update).mockRejectedValueOnce(
      new Error('DB connection lost')
    );
    await expect(
      callGenerateMetrics(service, 'spheroid', ['json'], [backfillImage()])
    ).resolves.toBeUndefined();
  });

  it('skips persist when sharp returns no width/height', async () => {
    vi.mocked(sharp).mockReturnValueOnce({
      metadata: vi
        .fn()
        .mockResolvedValueOnce({ width: undefined, height: undefined }),
    } as never);
    await callGenerateMetrics(service, 'spheroid', ['json'], [backfillImage()]);
    expect(vi.mocked(prisma.image.update)).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// generateAnnotations — COCO / YOLO / JSON
// ═══════════════════════════════════════════════════════════════════════════

describe('ExportService — generateAnnotations', () => {
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

  it('COCO: uses the segmentation dimensions and writes annotations.json', async () => {
    const image = makeImage({
      segmentation: {
        ...(makeImage().segmentation as Record<string, unknown>),
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
      ]),
      undefined
    );
    expect(
      vi
        .mocked(fs.writeFile)
        .mock.calls.some(([p]) => String(p).endsWith('annotations.json'))
    ).toBe(true);
  });

  it('COCO: falls back to image.width/height when segmentation lacks dimensions', async () => {
    const image = makeImage({
      width: 320,
      height: 240,
      segmentation: {
        ...(makeImage().segmentation as Record<string, unknown>),
        imageWidth: null,
        imageHeight: null,
      },
    });
    await callGenerateAnnotations(service, ['coco'], [image]);

    expect(mockConvertToCOCO).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ width: 320, height: 240 }),
      ]),
      undefined
    );
  });

  it('COCO: an image with no segmentation yields empty segmentationResults', async () => {
    await callGenerateAnnotations(service, ['coco'], [
      makeImage({ segmentation: null }),
    ]);
    expect(mockConvertToCOCO).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ segmentationResults: [] }),
      ]),
      undefined
    );
  });

  it('JSON: calls convertToJSON and writes segmentation_data.json', async () => {
    await callGenerateAnnotations(service, ['json'], [makeImage()]);
    expect(mockConvertToJSON).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(fs.writeFile)
        .mock.calls.some(([p]) => String(p).endsWith('segmentation_data.json'))
    ).toBe(true);
  });

  it('YOLO: skips images with no segmentation', async () => {
    await callGenerateAnnotations(service, ['yolo'], [
      makeImage({ segmentation: null }),
    ]);
    expect(mockConvertToYOLO).not.toHaveBeenCalled();
  });

  it('YOLO: writes a .txt file when segmentation exists', async () => {
    await callGenerateAnnotations(service, ['yolo'], [makeImage()]);
    expect(mockConvertToYOLO).toHaveBeenCalledOnce();
    const yoloCall = vi
      .mocked(fs.writeFile)
      .mock.calls.find(([p]) => String(p).endsWith('.txt'));
    expect(yoloCall).toBeDefined();
    expect(yoloCall?.[1]).toBe('yolo content');
  });

  it('YOLO: skips when resolveImageDimensions returns zero dimensions', async () => {
    mockResolveImageDimensions.mockReturnValueOnce({ width: 0, height: 0 });
    await callGenerateAnnotations(service, ['yolo'], [makeImage()]);
    expect(mockConvertToYOLO).not.toHaveBeenCalled();
  });

  it('processes multiple formats in one call', async () => {
    await callGenerateAnnotations(service, ['coco', 'json'], [makeImage()]);
    expect(mockConvertToCOCO).toHaveBeenCalledOnce();
    expect(mockConvertToJSON).toHaveBeenCalledOnce();
  });

  it('throws "Export cancelled by user" when the job is cancelled', async () => {
    seedCancelledJob(service, 'anno-cancel');
    await expect(
      callGenerateAnnotations(service, ['yolo'], [makeImage()], 'anno-cancel')
    ).rejects.toThrow('Export cancelled by user');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// generateVisualizations — skip paths & naming
// ═══════════════════════════════════════════════════════════════════════════

describe('ExportService — generateVisualizations', () => {
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

  it('skips an image with no segmentation', async () => {
    await callGenerateViz(service, [makeImage({ segmentation: null })]);
    expect(mockVizGenerate).not.toHaveBeenCalled();
  });

  it('skips an image whose segmentation polygons are null', async () => {
    await callGenerateViz(service, [
      makeImage({
        segmentation: {
          ...(makeImage().segmentation as Record<string, unknown>),
          polygons: null,
        },
      }),
    ]);
    expect(mockVizGenerate).not.toHaveBeenCalled();
  });

  it('skips an image with unparsable polygon JSON', async () => {
    await callGenerateViz(service, [
      makeImage({
        segmentation: {
          ...(makeImage().segmentation as Record<string, unknown>),
          polygons: '{{{not valid json',
        },
      }),
    ]);
    expect(mockVizGenerate).not.toHaveBeenCalled();
  });

  it('skips an image with an empty originalPath', async () => {
    await callGenerateViz(service, [makeImage({ originalPath: '' })]);
    expect(mockVizGenerate).not.toHaveBeenCalled();
  });

  it('generates a visualization for a valid image', async () => {
    await callGenerateViz(service, [makeImage()]);
    expect(mockVizGenerate).toHaveBeenCalledOnce();
  });

  it('names video-frame visualizations with a _frame_NNNN suffix', async () => {
    await callGenerateViz(service, [
      makeImage({ name: 'clip.nd2', parentVideoId: 'vid-1', frameIndex: 7 }),
    ]);
    expect(mockVizGenerate.mock.calls[0][2]).toMatch(/_frame_0007_viz\.png$/);
  });

  it('forwards an explicit labelPrefix into each visualization options arg', async () => {
    await (
      service as unknown as {
        generateVisualizations(
          images: unknown[],
          exportDir: string,
          options: unknown,
          jobId: string | undefined,
          onProgress: undefined,
          labelPrefix: string
        ): Promise<void>;
      }
    ).generateVisualizations(
      [makeImage()],
      '/tmp/viz',
      undefined,
      undefined,
      undefined,
      'MT'
    );
    expect(
      (mockVizGenerate.mock.calls[0][3] as { labelPrefix?: string }).labelPrefix
    ).toBe('MT');
  });

  it('defaults labelPrefix to the sperm prefix "S" when not supplied', async () => {
    await callGenerateViz(service, [makeImage()]);
    expect(
      (mockVizGenerate.mock.calls[0][3] as { labelPrefix?: string }).labelPrefix
    ).toBe('S');
  });

  it('throws "Export cancelled by user" when the job is cancelled', async () => {
    seedCancelledJob(service, 'viz-cancel');
    await expect(
      callGenerateViz(service, [makeImage()], 'viz-cancel')
    ).rejects.toThrow('Export cancelled by user');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// generateDocumentation
// ═══════════════════════════════════════════════════════════════════════════

describe('ExportService — generateDocumentation', () => {
  let service: ExportService;

  const project = {
    id: 'proj-d',
    title: 'Doc Project',
    type: 'spheroid' as string | null,
    images: [makeImage()],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const callGenerateDoc = (options: Record<string, unknown>) =>
    (
      service as unknown as {
        generateDocumentation(
          project: unknown,
          exportDir: string,
          options: unknown
        ): Promise<void>;
      }
    ).generateDocumentation(project, '/tmp/doc', options);

  it('calls generateReadme with the project and options', async () => {
    await callGenerateDoc({ includeDocumentation: true });
    expect(generateReadme).toHaveBeenCalledWith(project, {
      includeDocumentation: true,
    });
  });

  it('calls generateAnnotationGuides', async () => {
    await callGenerateDoc({});
    expect(generateAnnotationGuides).toHaveBeenCalledOnce();
  });

  it('writes README.md, metadata.json and metrics_guide.md', async () => {
    await callGenerateDoc({});
    expect(generateMetricsGuide).toHaveBeenCalledOnce();
    const written = vi.mocked(fs.writeFile).mock.calls.map(c => String(c[0]));
    expect(written.some(p => p.endsWith('README.md'))).toBe(true);
    expect(written.some(p => p.endsWith('metadata.json'))).toBe(true);
    expect(written.some(p => p.endsWith('metrics_guide.md'))).toBe(true);
  });

  it('writes metadata.json with the expected top-level fields', async () => {
    await callGenerateDoc({ annotationFormats: ['coco'] });
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

// ═══════════════════════════════════════════════════════════════════════════
// generateMicrotubuleMetrics
// ═══════════════════════════════════════════════════════════════════════════

describe('ExportService — generateMicrotubuleMetrics', () => {
  let service: ExportService;

  const geometryRow = (overrides: Record<string, unknown> = {}) => ({
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
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    resetMtMocks();
    service = makeService();
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  it('always attempts per-channel intensity (empty channel list = all) and adds no "no channel" warning', async () => {
    vi.mocked(computeMTMetrics).mockResolvedValueOnce({
      rows: [geometryRow({ channel: 'ch0', sumIntensity: 1000, label: 'MT1' })],
      skipped: [],
    });
    seedProcessingJob(service, 'mt-job');

    await callGenerateMT(service, [makeImage()], { metricsFormats: ['csv'] }, 'mt-job');

    expect(computeMTMetrics).toHaveBeenCalledOnce();
    expect(vi.mocked(computeMTMetrics).mock.calls[0][2].channels).toEqual([]);
    expect(computeMTGeometry).not.toHaveBeenCalled();
    expect(writeMTMetrics).toHaveBeenCalledOnce();
    const job = getJobs(service).get('mt-job');
    expect(
      (job?.warnings ?? []).some(w => w.includes('no channel was selected'))
    ).toBe(false);
  });

  it('falls back to geometry-only (and still writes) when intensity yields no rows', async () => {
    vi.mocked(computeMTGeometry).mockReturnValueOnce([geometryRow()]);
    await callGenerateMT(service, [makeImage()], { metricsFormats: ['csv'] });

    expect(computeMTGeometry).toHaveBeenCalledOnce();
    expect(writeMTMetrics).toHaveBeenCalledOnce();
  });

  it('falls back to geometry-only and warns when computeMTMetrics throws', async () => {
    vi.mocked(computeMTMetrics).mockRejectedValueOnce(new Error('ML down'));
    vi.mocked(computeMTGeometry).mockReturnValueOnce([geometryRow({ lengthPx: 10 })]);
    seedProcessingJob(service, 'mt-err');

    await callGenerateMT(
      service,
      [makeImage()],
      {
        metricsFormats: ['csv'],
        mtMetrics: { enabled: true, thicknessPx: 3, marginMultiplier: 1.5, channels: ['DAPI'] },
      },
      'mt-err'
    );

    expect(computeMTGeometry).toHaveBeenCalledOnce();
    expect(writeMTMetrics).toHaveBeenCalledOnce();
    expect(
      getJobs(service).get('mt-err')?.warnings?.some(w => w.includes('could not be computed'))
    ).toBe(true);
  });

  it('writes no metrics file and warns when no polylines exist', async () => {
    vi.mocked(computeMTGeometry).mockReturnValueOnce([]);
    seedProcessingJob(service, 'mt-empty');

    await callGenerateMT(service, [makeImage()], { metricsFormats: ['csv'] }, 'mt-empty');

    expect(writeMTMetrics).not.toHaveBeenCalled();
    expect(
      getJobs(service).get('mt-empty')?.warnings?.some(w =>
        w.includes('No microtubule annotations')
      )
    ).toBe(true);
  });

  it('defaults to csv format (with the per-channel totals summary) when metricsFormats is absent', async () => {
    vi.mocked(computeMTGeometry).mockReturnValueOnce([geometryRow({ lengthPx: 5 })]);
    await callGenerateMT(service, [makeImage()], {});

    expect(writeMTMetrics).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.arrayContaining(['csv']),
      expect.any(Array)
    );
  });

  it('throws "Export cancelled by user" when the job is cancelled', async () => {
    seedCancelledJob(service, 'mt-cancel');
    await expect(
      callGenerateMT(service, [makeImage()], { metricsFormats: ['csv'] }, 'mt-cancel')
    ).rejects.toThrow('Export cancelled by user');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// maybeAppendWoundTimeSeries — non-wound fast path
// ═══════════════════════════════════════════════════════════════════════════

describe('ExportService — maybeAppendWoundTimeSeries (non-wound gate)', () => {
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

  it('returns [] immediately when no image has a wound-model segmentation', async () => {
    const result = await (
      service as unknown as {
        maybeAppendWoundTimeSeries(
          images: unknown[],
          excelPath: string,
          exportDir: string,
          jobId?: string
        ): Promise<string[]>;
      }
    ).maybeAppendWoundTimeSeries([makeImage()], '/tmp/metrics.xlsx', '/tmp/export');

    expect(result).toEqual([]);
  });
});
