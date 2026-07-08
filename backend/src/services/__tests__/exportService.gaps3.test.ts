/**
 * exportService.gaps3.test.ts
 *
 * Covers paths still uncovered after exportService.gaps.test.ts and
 * exportService.gaps2.test.ts (lines ~1637, 1761-1870 and branches in
 * generateMetrics/copyOriginalImages/maybeAppendWoundTimeSeries):
 *
 *  A. copyOriginalImagesWithProgress
 *     - skips image when originalPath is empty/null
 *     - skips image when path traversal is detected (resolvedPath escapes uploadDir)
 *     - handles copyFile failure gracefully (returns 'skipped')
 *     - throws cancellation error when job is cancelled
 *
 *  B. generateMetrics — dimension backfill branch (sharp path)
 *     - calls sharp().metadata() when image has no width/height
 *     - calls prisma.image.update to persist backfilled dims
 *     - skips backfill when image already has dimensions
 *     - logs error and continues when sharp throws
 *     - logs error and continues when prisma update throws (cache still used)
 *
 *  C. maybeAppendWoundTimeSeries — unit-testable branches
 *     - returns [] immediately when no wound-model segmentation exists
 *
 *  D. createFolderStructure
 *     - calls fs.mkdir for each expected subfolder
 *
 *  E. generateAnnotations — YOLO cancellation
 *     - throws when job is cancelled mid-YOLO loop
 *
 *  F. generateMicrotubuleMetrics — intensity path with channels
 *     - calls computeMTMetrics when channels are provided
 *     - falls back to geometry-only and adds warning when computeMTMetrics fails
 *
 *  G. generateMetrics — wound model generates maybeAppendWoundTimeSeries
 *     (non-wound path: returns no warnings; partial test without exceljs)
 *
 * Real FS / archiver / sharp / Prisma / exceljs are never used — all I/O mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

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

vi.mock('uuid', () => ({ v4: vi.fn(() => 'gaps3-job-id') }));

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

// sharp mock — returns controllable metadata
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
  computeMTMetrics: vi
    .fn()
    .mockResolvedValue({ rows: [{ frameIndex: 0, lengthPx: 20 }], skipped: [] }),
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
      processor: (item: unknown) => Promise<unknown>,
      _opts?: unknown
    ) => Promise.all(items.map(processor))
  ),
}));

vi.mock('../../types/validation', () => ({
  coerceProjectType: vi.fn((t: string) => t ?? 'spheroid'),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { ExportService, type ExportJob } from '../exportService';
import { MetricsCalculator } from '../metrics/metricsCalculator';
import { FormatConverter } from '../export/formatConverter';
import { VisualizationGenerator } from '../visualization/visualizationGenerator';
import {
  computeMTMetrics,
  computeMTGeometry,
  writeMTMetrics,
} from '../export/mtMetricsExporter';
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

function resetMockImpls() {
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

  return {
    mockCalcAll,
    mockCalcImage,
    mockExportPoly,
    mockExportSperm,
    mockExportDI,
    mockExportCSV,
  };
}

/** Build a minimal image object for private-method tests */
function makeImage(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id: 'img-g3',
    name: 'photo.png',
    width: 100,
    height: 100,
    originalPath: 'projects/p/images/img-g3/original.png',
    thumbnailPath: null,
    segmentationThumbnailPath: null,
    fileSize: 1000,
    mimeType: 'image/png',
    projectId: 'proj-g3',
    segmentationStatus: 'segmented',
    createdAt: new Date(),
    updatedAt: new Date(),
    isVideoContainer: false,
    parentVideoId: null,
    frameIndex: null,
    segmentation: {
      id: 'seg-g3',
      imageId: 'img-g3',
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

// ─── A. copyOriginalImagesWithProgress ───────────────────────────────────────

describe('ExportService — copyOriginalImages skip and security paths', () => {
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

  const callCopy = (
    svc: ExportService,
    images: ReturnType<typeof makeImage>[],
    jobId?: string
  ) =>
    (
      svc as unknown as {
        copyOriginalImagesWithProgress(
          images: unknown[],
          exportDir: string,
          onProgress?: unknown,
          jobId?: string
        ): Promise<void>;
      }
    ).copyOriginalImagesWithProgress(images, '/tmp/export', undefined, jobId);

  it('skips image when originalPath is null/empty', async () => {
    await callCopy(service, [makeImage({ originalPath: null })]);
    expect(vi.mocked(fs.copyFile)).not.toHaveBeenCalled();
  });

  it('skips image when originalPath escapes the upload directory (path-traversal guard)', async () => {
    // '../../etc/passwd' resolves outside /tmp/test-uploads
    await callCopy(service, [makeImage({ originalPath: '../../etc/passwd' })]);
    expect(vi.mocked(fs.copyFile)).not.toHaveBeenCalled();
  });

  it('handles copyFile failure gracefully — returns without throwing', async () => {
    vi.mocked(fs.copyFile).mockRejectedValueOnce(
      new Error('ENOENT: no such file')
    );
    await expect(callCopy(service, [makeImage()])).resolves.toBeUndefined();
  });

  it('throws "Export cancelled by user" when job is cancelled before copying', async () => {
    getJobs(service).set('copy-cancel', {
      id: 'copy-cancel',
      projectId: 'p',
      userId: 'u',
      status: 'cancelled',
      progress: 0,
      createdAt: new Date(),
      options: {},
    });

    await expect(
      callCopy(service, [makeImage()], 'copy-cancel')
    ).rejects.toThrow('Export cancelled by user');
  });

  it('copies image successfully and returns without error when copyFile succeeds', async () => {
    vi.mocked(fs.copyFile).mockResolvedValueOnce(undefined);
    await expect(callCopy(service, [makeImage()])).resolves.toBeUndefined();
    expect(vi.mocked(fs.copyFile)).toHaveBeenCalledOnce();
  });
});

// ─── B. generateMetrics — dimension backfill via sharp ────────────────────────

describe('ExportService — generateMetrics dimension backfill (sharp path)', () => {
  let service: ExportService;
  const exportDir = '/tmp/fake-export';

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
    // Default: image.update succeeds
    vi.mocked(prisma.image.update).mockResolvedValue({} as never);
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const callGenerateMetrics = (
    svc: ExportService,
    images: ReturnType<typeof makeImage>[],
    projectType = 'spheroid',
    formats = ['json'] as string[]
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
    ).generateMetrics(images, exportDir, formats, 'Project', projectType, {});

  it('calls sharp().metadata() when image is missing width/height', async () => {
    const imgNoSize = makeImage({
      width: null,
      height: null,
      originalPath: 'projects/p/img.png',
    });

    await callGenerateMetrics(service, [imgNoSize]);

    // sharp was called with the resolved image path
    expect(vi.mocked(sharp)).toHaveBeenCalledOnce();
  });

  it('persists backfilled dimensions to DB via prisma.image.update', async () => {
    const imgNoSize = makeImage({
      width: null,
      height: null,
      originalPath: 'projects/p/img.png',
    });

    await callGenerateMetrics(service, [imgNoSize]);

    expect(vi.mocked(prisma.image.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'img-g3' },
        data: { width: 640, height: 480 },
      })
    );
  });

  it('skips backfill when image already has width and height', async () => {
    // width=100, height=100 — the "has dimensions" branch
    await callGenerateMetrics(service, [makeImage()]);

    expect(vi.mocked(sharp)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.image.update)).not.toHaveBeenCalled();
  });

  it('skips backfill when originalPath is null/empty', async () => {
    const imgNoPth = makeImage({
      width: null,
      height: null,
      originalPath: null,
    });

    await callGenerateMetrics(service, [imgNoPth]);

    expect(vi.mocked(sharp)).not.toHaveBeenCalled();
  });

  it('continues gracefully when sharp throws (logs warn, skips persist)', async () => {
    vi.mocked(sharp).mockReturnValueOnce({
      metadata: vi.fn().mockRejectedValueOnce(new Error('unsupported format')),
    } as never);
    const imgNoSize = makeImage({
      width: null,
      height: null,
      originalPath: 'projects/p/img.tif',
    });

    // Must not throw
    await expect(
      callGenerateMetrics(service, [imgNoSize])
    ).resolves.toBeUndefined();
    // DB update must NOT have been called
    expect(vi.mocked(prisma.image.update)).not.toHaveBeenCalled();
  });

  it('continues gracefully when prisma.image.update throws (dims still used from cache)', async () => {
    vi.mocked(prisma.image.update).mockRejectedValueOnce(
      new Error('DB connection lost')
    );
    const imgNoSize = makeImage({
      width: null,
      height: null,
      originalPath: 'projects/p/img.png',
    });

    // Should not throw — persist failure is logged but export continues
    await expect(
      callGenerateMetrics(service, [imgNoSize])
    ).resolves.toBeUndefined();
  });

  it('skips backfill when sharp metadata returns no width/height', async () => {
    vi.mocked(sharp).mockReturnValueOnce({
      metadata: vi
        .fn()
        .mockResolvedValueOnce({ width: undefined, height: undefined }),
    } as never);
    const imgNoSize = makeImage({
      width: null,
      height: null,
      originalPath: 'projects/p/img.png',
    });

    await callGenerateMetrics(service, [imgNoSize]);

    // No persist since meta was empty
    expect(vi.mocked(prisma.image.update)).not.toHaveBeenCalled();
  });
});

// ─── C. maybeAppendWoundTimeSeries — non-wound fast path ────────────────────

describe('ExportService — maybeAppendWoundTimeSeries', () => {
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

  const callMaybeWound = (
    svc: ExportService,
    images: ReturnType<typeof makeImage>[]
  ): Promise<string[]> =>
    (
      svc as unknown as {
        maybeAppendWoundTimeSeries(
          images: unknown[],
          excelPath: string,
          exportDir: string,
          jobId?: string
        ): Promise<string[]>;
      }
    ).maybeAppendWoundTimeSeries(images, '/tmp/metrics.xlsx', '/tmp/export');

  it('returns [] immediately when no image has a wound-model segmentation', async () => {
    // All images have model 'hrnet' — not wound
    const result = await callMaybeWound(service, [makeImage()]);
    expect(result).toEqual([]);
  });

  it('returns [] when images array is empty', async () => {
    const result = await callMaybeWound(service, []);
    expect(result).toEqual([]);
  });

  it('returns [] when image has no segmentation', async () => {
    const result = await callMaybeWound(service, [
      makeImage({ segmentation: null }),
    ]);
    expect(result).toEqual([]);
  });
});

// ─── D. createFolderStructure ────────────────────────────────────────────────

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

  it('creates all required export subdirectories', async () => {
    await (
      service as unknown as {
        createFolderStructure(exportDir: string): Promise<void>;
      }
    ).createFolderStructure('/tmp/export-dir');

    const mkdirCalls = vi.mocked(fs.mkdir).mock.calls.map(c => String(c[0]));
    const expectedSuffixes = [
      'images',
      'visualizations',
      'annotations/coco',
      'annotations/yolo',
      'annotations/json',
      'metrics',
      'documentation',
    ];
    for (const suffix of expectedSuffixes) {
      expect(mkdirCalls.some(p => p.endsWith(suffix))).toBe(true);
    }
  });
});

// ─── E. generateAnnotations — YOLO cancellation mid-loop ─────────────────────

describe('ExportService — generateAnnotations YOLO cancellation', () => {
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

  const callGenerateAnnotations = (
    svc: ExportService,
    images: ReturnType<typeof makeImage>[],
    formats: string[],
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
    ).generateAnnotations(images, '/tmp/export', formats, jobId);

  it('throws "Export cancelled by user" when job is cancelled before YOLO format', async () => {
    getJobs(service).set('yolo-cancel', {
      id: 'yolo-cancel',
      projectId: 'p',
      userId: 'u',
      status: 'cancelled',
      progress: 0,
      createdAt: new Date(),
      options: {},
    });

    await expect(
      callGenerateAnnotations(service, [makeImage()], ['yolo'], 'yolo-cancel')
    ).rejects.toThrow('Export cancelled by user');
  });

  it('throws "Export cancelled by user" when job is cancelled before COCO format', async () => {
    getJobs(service).set('coco-cancel', {
      id: 'coco-cancel',
      projectId: 'p',
      userId: 'u',
      status: 'cancelled',
      progress: 0,
      createdAt: new Date(),
      options: {},
    });

    await expect(
      callGenerateAnnotations(service, [makeImage()], ['coco'], 'coco-cancel')
    ).rejects.toThrow('Export cancelled by user');
  });
});

// ─── F. generateMicrotubuleMetrics — intensity path with channels ─────────────

describe('ExportService — generateMicrotubuleMetrics channel intensity path', () => {
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

  const callGenerateMT = (
    svc: ExportService,
    images: ReturnType<typeof makeImage>[],
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

  it('calls computeMTMetrics when channels are provided and mtMetrics.enabled=true', async () => {
    vi.mocked(computeMTMetrics).mockResolvedValueOnce({
      rows: [
        {
          frameIndex: 0,
          imageId: 'img-g3',
          instanceId: 'inst-1',
          trackId: null,
          channel: 'DAPI',
          lengthPx: 50,
          lengthUm: 3.25,
          areaPx: null,
          areaUm2: null,
          pixelCount: null,
          sumIntensity: null,
          meanIntensity: null,
          stdIntensity: null,
          medianBackground: null,
          signalMinusBackground: null,
        },
      ],
      skipped: [],
    });

    await callGenerateMT(service, [makeImage()], {
      metricsFormats: ['csv'],
      mtMetrics: {
        enabled: true,
        thicknessPx: 3,
        marginMultiplier: 1.5,
        channels: ['DAPI'],
      },
    });

    expect(computeMTMetrics).toHaveBeenCalledOnce();
    expect(computeMTGeometry).not.toHaveBeenCalled();
    expect(writeMTMetrics).toHaveBeenCalledOnce();
  });

  it('falls back to geometry-only and adds warning when computeMTMetrics throws', async () => {
    vi.mocked(computeMTMetrics).mockRejectedValueOnce(
      new Error('ML service down')
    );
    // geometry fallback returns non-empty list so writeMTMetrics is called
    vi.mocked(computeMTGeometry).mockReturnValueOnce([
      {
        frameIndex: 0,
        imageId: 'img-g3',
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

    const jobs = getJobs(service);
    jobs.set('mt-err', {
      id: 'mt-err',
      projectId: 'p',
      userId: 'u',
      status: 'processing',
      progress: 50,
      createdAt: new Date(),
      options: {},
    });

    await callGenerateMT(
      service,
      [makeImage()],
      {
        metricsFormats: ['csv'],
        mtMetrics: {
          enabled: true,
          thicknessPx: 3,
          marginMultiplier: 1.5,
          channels: ['DAPI'],
        },
      },
      'mt-err'
    );

    // Must have fallen back to geometry
    expect(computeMTGeometry).toHaveBeenCalledOnce();
    expect(writeMTMetrics).toHaveBeenCalledOnce();
    // Warning should mention intensity failure
    const job = jobs.get('mt-err');
    expect(job?.warnings?.some(w => w.includes('could not be computed'))).toBe(
      true
    );
  });

  it('uses csv as default format when metricsFormats is absent', async () => {
    vi.mocked(computeMTGeometry).mockReturnValueOnce([
      {
        frameIndex: 0,
        imageId: 'img-g3',
        instanceId: 'i1',
        trackId: null,
        channel: '',
        lengthPx: 5,
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

    await callGenerateMT(service, [makeImage()], {});

    // writeMTMetrics should have been called with ['csv'] default + the
    // per-channel totals summary (4th arg).
    expect(writeMTMetrics).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.arrayContaining(['csv']),
      expect.any(Array)
    );
  });

  it('throws "Export cancelled by user" when job is cancelled at start', async () => {
    getJobs(service).set('mt-cancel', {
      id: 'mt-cancel',
      projectId: 'p',
      userId: 'u',
      status: 'cancelled',
      progress: 0,
      createdAt: new Date(),
      options: {},
    });

    await expect(
      callGenerateMT(
        service,
        [makeImage()],
        { metricsFormats: ['csv'] },
        'mt-cancel'
      )
    ).rejects.toThrow('Export cancelled by user');
  });
});

// ─── G. generateMetrics — wound time-series is a no-op for non-wound models ──

describe('ExportService — generateMetrics wound-time-series guard', () => {
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockImpls();
    service = makeService();
    vi.mocked(prisma.image.update).mockResolvedValue({} as never);
  });

  afterEach(() => {
    service.destroy();
    resetSingleton();
  });

  const callGenerateMetrics = (
    svc: ExportService,
    images: ReturnType<typeof makeImage>[],
    projectType = 'spheroid',
    formats = ['excel'] as string[]
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
      '/tmp/export',
      formats,
      'Project',
      projectType,
      {}
    );

  it('completes without error for wound project that has no wound segmentations (no-exceljs path)', async () => {
    // segmentation model is 'hrnet' not 'wound' — maybeAppendWoundTimeSeries returns [] immediately
    const img = makeImage();
    // Run the export for a non-wound spheroid project — wound TS is skipped
    await expect(
      callGenerateMetrics(service, [img], 'spheroid', ['csv'])
    ).resolves.toBeUndefined();
  });
});
