/**
 * segmentationService.test.ts — consolidated core coverage.
 *
 * Merges the former *.gaps, *.gaps3, *.gaps4, *.gaps5, *.batch-fix,
 * *.resolveChannelPath and *.ssot files into one coherent suite organised by
 * concern:
 *   - saveSegmentationResults  (polygon validation / filtering / persistence)
 *   - getSegmentationResults   (single-image read mapping)
 *   - getBatchSegmentationResults
 *   - updateSegmentationResults (manual edit + cross-frame propagation)
 *   - deleteSegmentationResults
 *   - getProjectSegmentationStats
 *   - requestSegmentation       (HTTP error branches)
 *   - requestBatchSegmentation  (result-index alignment + error branches)
 *   - batchProcess
 *   - checkServiceHealth
 *   - resolveChannelPath        (pure channel-path util)
 *   - polygon-field SSOT round-trip
 *
 * Concurrency/pooling lives in *.concurrent; track-ops in *.trackOps; sperm
 * polyline round-trips in *.sperm.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    STORAGE_TYPE: 'local',
    STORAGE_LOCAL_PATH: '/tmp/test-storage',
    UPLOAD_DIR: '/tmp/uploads',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../storage/index', () => ({
  getStorageProvider: vi.fn(() => ({
    getBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')),
    store: vi.fn(),
    saveFile: vi.fn(),
    deleteFile: vi.fn(),
  })),
}));

vi.mock('../segmentationThumbnailService');
// Plain class inside the factory (methods created per instance) so
// restoreMocks:true cannot wipe the body between tests, and each service
// instance gets its own controllable generateAllThumbnails().
vi.mock('../thumbnailManager', () => ({
  ThumbnailManager: class {
    generateAllThumbnails = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('../imageService');

// Single hoisted axios client for the HTTP-touching paths (requestSegmentation,
// requestBatchSegmentation, batchProcess, checkServiceHealth).
const { mockHttpClientPost, mockHttpClientGet } = vi.hoisted(() => ({
  mockHttpClientPost: vi.fn(),
  mockHttpClientGet: vi.fn(),
}));

const mockHttpClient = {
  get: mockHttpClientGet,
  post: mockHttpClientPost,
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
};

vi.mock('axios', () => ({
  default: { create: vi.fn(() => mockHttpClient) },
}));

import { SegmentationService } from '../segmentationService';
import type { SegmentationPolygon } from '../segmentationService';
import { ImageService } from '../imageService';
import { logger } from '../../utils/logger';
import { resolveChannelPath } from '../../utils/channelPath';
import {
  PolygonValidator,
  OPTIONAL_POLYGON_FIELDS,
} from '../../utils/polygonValidation';

// ─── shared fixtures / helpers ────────────────────────────────────────────────

function makePrisma() {
  return {
    segmentation: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(() => ({ __op: 'update' })),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    image: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    project: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
    $queryRaw: vi.fn(),
  };
}

function makeImageService() {
  return {
    getImageById: vi.fn(),
    updateSegmentationStatus: vi.fn().mockResolvedValue(undefined),
  };
}

function makeService(prisma = makePrisma(), imageService = makeImageService()) {
  const svc = new SegmentationService(
    prisma as unknown as PrismaClient,
    imageService as unknown as ImageService
  );
  return { svc, prisma, imageService };
}

const makePolygon = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: 'poly-1',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  type: 'external',
  area: 50,
  confidence: 0.9,
  ...overrides,
});

function makeImage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'img-1',
    name: 'test.jpg',
    originalPath: 'projects/p1/images/img-1/original.jpg',
    mimeType: 'image/jpeg',
    width: 100,
    height: 100,
    projectId: 'proj-1',
    parentVideoId: null,
    ...overrides,
  };
}

function makeSegResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    polygons: [
      {
        id: 'p1',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
        ],
        type: 'external',
        confidence: 0.9,
        area: 50,
      },
    ],
    polylines: [],
    model_used: 'hrnet',
    threshold_used: 0.5,
    confidence: 0.9,
    processing_time: 200,
    image_size: { width: 100, height: 100 },
    ...overrides,
  };
}

// getProjectSegmentationStats uses server-side aggregation
// (segmentation.aggregate + segmentation.groupBy + a $queryRaw polygon count).
// Derive those mock returns from a flat array of segmentation rows.
function mockSegStatsFromRows(
  prisma: ReturnType<typeof makePrisma>,
  rows: Array<{
    polygons?: string;
    confidence?: number | null;
    model?: string | null;
  }>
) {
  const count = rows.length;
  // Prisma's _avg ignores NULLs: average only the non-null confidences (and
  // return null when there are none). Dividing by all rows would diverge from
  // the real nullable-field aggregate and could hide bugs.
  const confidences = rows
    .map(r => r.confidence)
    .filter((c): c is number => c != null);
  const avgConfidence = confidences.length
    ? confidences.reduce((s, c) => s + c, 0) / confidences.length
    : null;
  prisma.segmentation.aggregate.mockResolvedValue({
    _avg: { confidence: avgConfidence },
    _count: { _all: count },
  });

  const modelCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.model) {
      modelCounts.set(r.model, (modelCounts.get(r.model) ?? 0) + 1);
    }
  }
  prisma.segmentation.groupBy.mockResolvedValue(
    [...modelCounts].map(([model, c]) => ({ model, _count: { _all: c } }))
  );

  const totalPolygons = rows.reduce((s, r) => {
    try {
      const parsed = JSON.parse(r.polygons ?? '[]');
      return s + (Array.isArray(parsed) ? parsed.length : 0);
    } catch {
      return s;
    }
  }, 0);
  prisma.$queryRaw.mockResolvedValue([{ total: BigInt(totalPolygons) }]);
}

// ═══════════════════════════════════════════════════════════════════════════
// saveSegmentationResults — polygon validation / filtering / persistence
// ═══════════════════════════════════════════════════════════════════════════

describe('SegmentationService — saveSegmentationResults', () => {
  let svc: SegmentationService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ svc, prisma } = makeService());
    prisma.segmentation.upsert.mockResolvedValue({ id: 'seg-1' });
  });

  const save = (
    polygons: unknown[],
    model = 'hrnet',
    processingTime: number | null = null,
    w: number | null = null,
    h: number | null = null
  ) =>
    svc.saveSegmentationResults(
      'img-1',
      polygons as unknown as SegmentationPolygon[],
      model,
      0.5,
      null,
      processingTime,
      w,
      h,
      'user-1'
    );

  const savedPolys = () =>
    JSON.parse(prisma.segmentation.upsert.mock.calls[0][0].update.polygons);

  it('upserts once with width/height and the requested model', async () => {
    await save([makePolygon()], 'hrnet', 2000, 800, 600);
    expect(prisma.segmentation.upsert).toHaveBeenCalledOnce();
    const call = prisma.segmentation.upsert.mock.calls[0][0];
    expect(call.update.imageWidth).toBe(800);
    expect(call.update.imageHeight).toBe(600);
    expect(call.create.model).toBe('hrnet');
  });

  it('filters out polygons with fewer than 3 points', async () => {
    const bad = makePolygon({
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    });
    const good = makePolygon({ id: 'poly-good' });
    await save([bad, good]);
    const saved = savedPolys();
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('poly-good');
  });

  it('accepts a polyline with exactly 2 points (geometry=polyline minPoints=2)', async () => {
    const twoPointPolyline = makePolygon({
      id: 'line-1',
      geometry: 'polyline',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
    });
    await save([twoPointPolyline], 'sperm');
    const saved = savedPolys();
    expect(saved).toHaveLength(1);
    expect(saved[0].geometry).toBe('polyline');
  });

  it('filters out polygons with invalid point coordinates (NaN)', async () => {
    const nan = makePolygon({
      points: [
        { x: NaN, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    });
    const good = makePolygon({ id: 'poly-ok' });
    await save([nan, good]);
    const saved = savedPolys();
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('poly-ok');
  });

  it('filters out polygons with Infinity coordinates', async () => {
    const inf = makePolygon({
      id: 'inf-poly',
      points: [
        { x: Infinity, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    });
    const good = makePolygon({ id: 'ok-poly' });
    await save([inf, good]);
    const saved = savedPolys();
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('ok-poly');
  });

  it('filters out polygons with an invalid type', async () => {
    const badType = makePolygon({ type: 'unknown' });
    const good = makePolygon({ id: 'good' });
    await save([badType, good]);
    const saved = savedPolys();
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('good');
  });

  it('filters out an internal polygon whose parentIds contains a non-string element', async () => {
    const badInternal = makePolygon({
      id: 'bad-internal',
      type: 'internal',
      parentIds: [42 as unknown as string],
    });
    const good = makePolygon({ id: 'good-ext' });
    await save([badInternal, good]);
    const saved = savedPolys();
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('good-ext');
  });

  it('clears invalid (dangling) parent_id references', async () => {
    const internal = makePolygon({
      id: 'internal-1',
      type: 'internal',
      parentIds: ['does-not-exist'],
    });
    await save([internal]);
    const saved = savedPolys();
    expect(saved[0].parent_id).toBeUndefined();
  });

  it('merges polylines (sperm model) preserving geometry/partClass/instanceId', async () => {
    const polygon = makePolygon({ id: 'closed-1' });
    const polyline = {
      id: 'open-1',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
      type: 'external',
      area: 0,
      confidence: 0.8,
      geometry: 'polyline',
      partClass: 'head',
      instanceId: 'sperm-1',
    };
    await save([polygon, polyline], 'sperm');
    const saved = savedPolys();
    const savedPolyline = saved.find((p: any) => p.id === 'open-1');
    expect(savedPolyline).toBeDefined();
    expect(savedPolyline.geometry).toBe('polyline');
    expect(savedPolyline.partClass).toBe('head');
    expect(savedPolyline.instanceId).toBe('sperm-1');
  });

  it('auto-assigns an id to polygons that arrive without one', async () => {
    const noId = {
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ],
      type: 'external',
      area: 12,
      confidence: 0.7,
    };
    await save([noId]);
    expect(savedPolys()[0].id).toBe('polygon_1');
  });

  it('stores zero dimensions when width/height are null', async () => {
    await save([makePolygon()]);
    const call = prisma.segmentation.upsert.mock.calls[0][0];
    expect(call.update.imageWidth).toBe(0);
    expect(call.update.imageHeight).toBe(0);
  });

  it('stores processingTime as null when input is null', async () => {
    await save([makePolygon()]);
    const call = prisma.segmentation.upsert.mock.calls[0][0];
    expect(call.update.processingTime).toBeNull();
    expect(call.create.processingTime).toBeNull();
  });

  it('computes averageConfidence correctly across multiple polygons', async () => {
    await save([
      makePolygon({ id: 'p1', confidence: 1.0 }),
      makePolygon({ id: 'p2', confidence: 0.6 }),
    ]);
    const call = prisma.segmentation.upsert.mock.calls[0][0];
    // averageConfidence = (1.0 + 0.6) / 2 = 0.8
    expect(call.update.confidence).toBeCloseTo(0.8, 5);
    expect(call.create.confidence).toBeCloseTo(0.8, 5);
  });

  it('averageConfidence is 0 when no polygons pass validation', async () => {
    await save([makePolygon({ type: 'bad_type' })]);
    expect(prisma.segmentation.upsert.mock.calls[0][0].create.confidence).toBe(
      0
    );
  });

  it('swallows a thumbnail-generation error without throwing', async () => {
    const { svc: svc2, prisma: prisma2 } = makeService();
    prisma2.segmentation.upsert.mockResolvedValue({ id: 'seg-thumb' });
    (
      svc2 as unknown as {
        thumbnailManager: { generateAllThumbnails: ReturnType<typeof vi.fn> };
      }
    ).thumbnailManager.generateAllThumbnails.mockRejectedValueOnce(
      new Error('thumb error')
    );

    await expect(
      svc2.saveSegmentationResults(
        'img-1',
        [makePolygon() as unknown as SegmentationPolygon],
        'hrnet',
        0.5,
        null,
        null,
        100,
        100,
        'user-1'
      )
    ).resolves.toBeUndefined();
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      expect.stringContaining('thumbnails'),
      expect.any(Error),
      expect.any(String),
      expect.any(Object)
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getSegmentationResults — single-image read mapping
// ═══════════════════════════════════════════════════════════════════════════

describe('SegmentationService — getSegmentationResults', () => {
  const imageId = 'img-get-1';
  const userId = 'user-get-1';
  let svc: SegmentationService;
  let prisma: ReturnType<typeof makePrisma>;
  let imageService: ReturnType<typeof makeImageService>;

  const makeSegRow = (
    polygons: unknown[],
    extra: Record<string, unknown> = {}
  ) => ({
    id: 'seg-row-1',
    imageId,
    polygons: JSON.stringify(polygons),
    model: 'hrnet',
    threshold: 0.5,
    confidence: 0.85,
    processingTime: 3000,
    imageWidth: 1024,
    imageHeight: 768,
    updatedAt: new Date('2026-01-01T12:00:00Z'),
    ...extra,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    ({ svc, prisma, imageService } = makeService());
    imageService.getImageById.mockResolvedValue({ id: imageId, name: 'test.png' });
  });

  it('returns null when imageService returns null (no access)', async () => {
    imageService.getImageById.mockResolvedValue(null);
    expect(await svc.getSegmentationResults(imageId, userId)).toBeNull();
  });

  it('returns null and logs debug when no segmentation row exists', async () => {
    prisma.segmentation.findUnique.mockResolvedValue(null);
    const result = await svc.getSegmentationResults(imageId, userId);
    expect(result).toBeNull();
    expect(logger.debug).toHaveBeenCalledWith(
      'No segmentation data found for image',
      'SegmentationService',
      { imageId }
    );
  });

  it('returns [] polygons and logs a parse error on malformed JSON', async () => {
    prisma.segmentation.findUnique.mockResolvedValue({
      imageId,
      polygons: 'invalid-json{',
      model: 'hrnet',
      threshold: 0.5,
      confidence: 0.8,
      processingTime: 2000,
      imageWidth: 800,
      imageHeight: 600,
    });
    const result = await svc.getSegmentationResults(imageId, userId);
    expect(result).toBeDefined();
    expect(result?.polygons).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to parse polygons JSON',
      expect.any(Error),
      'PolygonValidator',
      expect.objectContaining({ imageId })
    );
  });

  it('preserves trackId and name on polylines (MT cross-frame identity)', async () => {
    prisma.segmentation.findUnique.mockResolvedValue(
      makeSegRow([
        {
          id: 'mt-1',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          type: 'external',
          area: 0,
          confidence: 0.9,
          geometry: 'polyline',
          trackId: 'track-abc',
          name: 'MT-1',
        },
      ])
    );
    const poly = (await svc.getSegmentationResults(imageId, userId))!.polygons[0];
    expect(poly.trackId).toBe('track-abc');
    expect(poly.name).toBe('MT-1');
  });

  it('strips _embedding from the response (server-only blob)', async () => {
    prisma.segmentation.findUnique.mockResolvedValue(
      makeSegRow([
        {
          id: 'mt-2',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          type: 'external',
          area: 0,
          confidence: 0.9,
          geometry: 'polyline',
          trackId: 'track-xyz',
          _embedding: Array(32).fill(0.1),
        },
      ])
    );
    const poly = (await svc.getSegmentationResults(imageId, userId))!
      .polygons[0] as any;
    expect(poly._embedding).toBeUndefined();
    expect(poly.trackId).toBe('track-xyz');
  });

  it('converts parent_id to a parentIds array', async () => {
    prisma.segmentation.findUnique.mockResolvedValue(
      makeSegRow([
        {
          id: 'int-1',
          points: [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 2 },
          ],
          type: 'internal',
          area: 4,
          confidence: 0.8,
          parent_id: 'ext-parent-1',
        },
      ])
    );
    const result = await svc.getSegmentationResults(imageId, userId);
    expect(result!.polygons[0].parentIds).toEqual(['ext-parent-1']);
  });

  it('propagates partClass and instanceId on polylines (sperm fields)', async () => {
    prisma.segmentation.findUnique.mockResolvedValue(
      makeSegRow([
        {
          id: 's-1',
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
          ],
          type: 'external',
          area: 0,
          confidence: 0.85,
          geometry: 'polyline',
          partClass: 'head',
          instanceId: 'sperm-42',
        },
      ])
    );
    const poly = (await svc.getSegmentationResults(imageId, userId))!.polygons[0];
    expect(poly.partClass).toBe('head');
    expect(poly.instanceId).toBe('sperm-42');
    expect((poly as any).geometry).toBe('polyline');
  });

  it('surfaces updatedAt as an ISO string (resegment poll)', async () => {
    prisma.segmentation.findUnique.mockResolvedValue(makeSegRow([makePolygon()]));
    const result = await svc.getSegmentationResults(imageId, userId);
    expect(result!.updatedAt).toBe('2026-01-01T12:00:00.000Z');
  });

  it('surfaces imageWidth / imageHeight from the DB row', async () => {
    prisma.segmentation.findUnique.mockResolvedValue(makeSegRow([makePolygon()]));
    const result = await svc.getSegmentationResults(imageId, userId);
    expect(result!.imageWidth).toBe(1024);
    expect(result!.imageHeight).toBe(768);
    expect(result!.image_size).toEqual({ width: 1024, height: 768 });
  });

  it('returns imageWidth/imageHeight = 0 when the DB values are null', async () => {
    prisma.segmentation.findUnique.mockResolvedValue(
      makeSegRow([makePolygon()], { imageWidth: null, imageHeight: null })
    );
    const result = await svc.getSegmentationResults(imageId, userId);
    expect(result!.imageWidth).toBe(0);
    expect(result!.imageHeight).toBe(0);
    expect(result!.image_size).toEqual({ width: 0, height: 0 });
  });

  it('converts processingTime from ms (DB) to seconds (response)', async () => {
    prisma.segmentation.findUnique.mockResolvedValue(
      makeSegRow([makePolygon()], { processingTime: 4500 })
    );
    const result = await svc.getSegmentationResults(imageId, userId);
    expect(result!.processing_time).toBe(4.5);
  });

  it('returns processing_time = null when processingTime is null in the DB', async () => {
    prisma.segmentation.findUnique.mockResolvedValue(
      makeSegRow([makePolygon()], { processingTime: null })
    );
    const result = await svc.getSegmentationResults(imageId, userId);
    expect(result!.processing_time).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getBatchSegmentationResults
// ═══════════════════════════════════════════════════════════════════════════

describe('SegmentationService — getBatchSegmentationResults', () => {
  const userId = 'test-user-id';
  const imageIds = ['img-1', 'img-2', 'img-3'];
  let svc: SegmentationService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ svc, prisma } = makeService());
  });

  it('fetches batch segmentation results with valid JSON data', async () => {
    prisma.image.findMany.mockResolvedValue([
      { id: 'img-1' },
      { id: 'img-2' },
      { id: 'img-3' },
    ]);

    const mockPolygons = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        area: 100,
        confidence: 0.95,
        type: 'external',
      },
    ];

    prisma.segmentation.findMany.mockResolvedValue([
      {
        imageId: 'img-1',
        polygons: JSON.stringify(mockPolygons),
        model: 'hrnet',
        threshold: 0.5,
        confidence: 0.95,
        processingTime: 2500,
        imageWidth: 800,
        imageHeight: 600,
      },
      {
        imageId: 'img-2',
        polygons: JSON.stringify([]),
        model: 'hrnet',
        threshold: 0.5,
        confidence: null,
        processingTime: 1200,
        imageWidth: 1024,
        imageHeight: 768,
      },
    ]);

    const results = await svc.getBatchSegmentationResults(imageIds, userId);

    expect(prisma.image.findMany).toHaveBeenCalledWith({
      where: { id: { in: imageIds }, project: { userId } },
      select: { id: true },
    });
    expect(prisma.segmentation.findMany).toHaveBeenCalledWith({
      where: { imageId: { in: ['img-1', 'img-2', 'img-3'] } },
    });

    expect(results['img-1']).toMatchObject({
      success: true,
      polygons: expect.arrayContaining([
        expect.objectContaining({
          points: mockPolygons[0].points,
          area: mockPolygons[0].area,
          confidence: mockPolygons[0].confidence,
          type: mockPolygons[0].type,
        }),
      ]),
      model_used: 'hrnet',
      threshold_used: 0.5,
      confidence: 0.95,
      processing_time: 2.5,
      image_size: { width: 800, height: 600 },
      imageWidth: 800,
      imageHeight: 600,
    });
    expect(results['img-2']).toEqual({
      success: true,
      polygons: [],
      model_used: 'hrnet',
      threshold_used: 0.5,
      confidence: null,
      processing_time: 1.2,
      image_size: { width: 1024, height: 768 },
      imageWidth: 1024,
      imageHeight: 768,
    });
    expect(results['img-3']).toBeNull();
  });

  it('handles null segmentation results gracefully', async () => {
    prisma.image.findMany.mockResolvedValue([{ id: 'img-1' }, { id: 'img-2' }]);
    prisma.segmentation.findMany.mockResolvedValue([
      {
        imageId: 'img-1',
        polygons: null,
        model: 'hrnet',
        threshold: 0.5,
        confidence: null,
        processingTime: null,
        imageWidth: null,
        imageHeight: null,
      },
    ]);

    const results = await svc.getBatchSegmentationResults(
      ['img-1', 'img-2'],
      userId
    );

    expect(results['img-1']).toEqual({
      success: true,
      polygons: [],
      model_used: 'hrnet',
      threshold_used: 0.5,
      confidence: null,
      processing_time: null,
      image_size: { width: 0, height: 0 },
      imageWidth: 0,
      imageHeight: 0,
    });
    expect(results['img-2']).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('handles malformed JSON polygons gracefully', async () => {
    prisma.image.findMany.mockResolvedValue([{ id: 'img-1' }, { id: 'img-2' }]);
    prisma.segmentation.findMany.mockResolvedValue([
      {
        imageId: 'img-1',
        polygons: 'invalid-json{',
        model: 'hrnet',
        threshold: 0.5,
        confidence: 0.8,
        processingTime: 3000,
        imageWidth: 800,
        imageHeight: 600,
      },
      {
        imageId: 'img-2',
        polygons: 'null',
        model: 'unet',
        threshold: 0.3,
        confidence: 0.7,
        processingTime: 2000,
        imageWidth: 1024,
        imageHeight: 768,
      },
    ]);

    const results = await svc.getBatchSegmentationResults(
      ['img-1', 'img-2'],
      userId
    );

    expect(results['img-1']).toEqual({
      success: true,
      polygons: [],
      model_used: 'hrnet',
      threshold_used: 0.5,
      confidence: 0.8,
      processing_time: 3,
      image_size: { width: 800, height: 600 },
      imageWidth: 800,
      imageHeight: 600,
    });
    expect(results['img-2']).toEqual({
      success: true,
      polygons: [],
      model_used: 'unet',
      threshold_used: 0.3,
      confidence: 0.7,
      processing_time: 2,
      image_size: { width: 1024, height: 768 },
      imageWidth: 1024,
      imageHeight: 768,
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to parse polygons JSON',
      expect.any(Error),
      'PolygonValidator',
      expect.objectContaining({ imageId: 'img-1' })
    );
  });

  it('respects user access permissions (inaccessible images absent, accessible-but-unsegmented null)', async () => {
    prisma.image.findMany.mockResolvedValue([{ id: 'img-1' }, { id: 'img-3' }]);
    prisma.segmentation.findMany.mockResolvedValue([
      {
        imageId: 'img-1',
        polygons: JSON.stringify([]),
        model: 'hrnet',
        threshold: 0.5,
        confidence: 0.8,
        processingTime: 1000,
        imageWidth: 800,
        imageHeight: 600,
      },
    ]);

    const results = await svc.getBatchSegmentationResults(imageIds, userId);
    expect(results['img-1']).toBeDefined();
    expect(results['img-2']).toBeUndefined(); // not accessible → absent
    expect(results['img-3']).toBeNull(); // accessible but no segmentation
  });

  it('handles different batch sizes efficiently', async () => {
    prisma.image.findMany.mockResolvedValue([{ id: 'img-1' }]);
    prisma.segmentation.findMany.mockResolvedValue([]);
    let results = await svc.getBatchSegmentationResults(['img-1'], userId);
    expect(Object.keys(results)).toHaveLength(1);

    const largeImageIds = Array.from({ length: 100 }, (_, i) => `img-${i}`);
    prisma.image.findMany.mockResolvedValue(largeImageIds.map(id => ({ id })));
    prisma.segmentation.findMany.mockResolvedValue([]);
    results = await svc.getBatchSegmentationResults(largeImageIds, userId);
    expect(Object.keys(results)).toHaveLength(100);
    Object.values(results).forEach(result => expect(result).toBeNull());
  });

  it('handles an empty imageIds array', async () => {
    prisma.image.findMany.mockResolvedValue([]);
    prisma.segmentation.findMany.mockResolvedValue([]);
    const results = await svc.getBatchSegmentationResults([], userId);
    expect(results).toEqual({});
    expect(prisma.image.findMany).toHaveBeenCalledWith({
      where: { id: { in: [] }, project: { userId } },
      select: { id: true },
    });
  });

  it('propagates database errors (and logs with context)', async () => {
    const databaseError = new Error('Database connection failed');
    prisma.image.findMany.mockRejectedValue(databaseError);

    await expect(
      svc.getBatchSegmentationResults(imageIds, userId)
    ).rejects.toThrow('Database connection failed');
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to batch fetch segmentation results',
      databaseError,
      'SegmentationService',
      { imageCount: 3, userId }
    );
  });

  it('processes complex polygon data (parent_id → parentIds)', async () => {
    const complexPolygons = [
      {
        points: [
          { x: 10.5, y: 20.3 },
          { x: 30.7, y: 25.1 },
          { x: 35.2, y: 45.8 },
          { x: 15.9, y: 40.4 },
        ],
        area: 625.75,
        confidence: 0.92,
        type: 'external',
        parent_id: null,
      },
      {
        points: [
          { x: 20, y: 30 },
          { x: 25, y: 30 },
          { x: 25, y: 35 },
          { x: 20, y: 35 },
        ],
        area: 25,
        confidence: 0.88,
        type: 'internal',
        parent_id: 'polygon-1',
      },
    ];

    prisma.image.findMany.mockResolvedValue([{ id: 'img-1' }]);
    prisma.segmentation.findMany.mockResolvedValue([
      {
        imageId: 'img-1',
        polygons: JSON.stringify(complexPolygons),
        model: 'cbam_resunet',
        threshold: 0.7,
        confidence: 0.9,
        processingTime: 5500,
        imageWidth: 1920,
        imageHeight: 1080,
      },
    ]);

    const results = await svc.getBatchSegmentationResults(['img-1'], userId);
    const resultPolygons = (results['img-1'] as any).polygons;
    expect(resultPolygons).toHaveLength(2);
    expect(resultPolygons[0].points).toHaveLength(4);
    expect(resultPolygons[0].area).toBe(625.75);
    expect(resultPolygons[1].type).toBe('internal');
    expect(resultPolygons[1].parentIds).toEqual(['polygon-1']);
  });

  it('logs debug information on success', async () => {
    prisma.image.findMany.mockResolvedValue([{ id: 'img-1' }]);
    prisma.segmentation.findMany.mockResolvedValue([
      {
        imageId: 'img-1',
        polygons: JSON.stringify([]),
        model: 'hrnet',
        threshold: 0.5,
        confidence: 0.8,
        processingTime: 1000,
        imageWidth: 800,
        imageHeight: 600,
      },
    ]);

    await svc.getBatchSegmentationResults(['img-1'], userId);
    expect(logger.debug).toHaveBeenCalledWith(
      'Batch segmentation results fetched successfully',
      'SegmentationService',
      { requestedImages: 1, accessibleImages: 1, resultsFound: 1 }
    );
  });

  it('preserves trackId and name in the batch response', async () => {
    prisma.image.findMany.mockResolvedValue([{ id: 'img-mt' }]);
    prisma.segmentation.findMany.mockResolvedValue([
      {
        imageId: 'img-mt',
        polygons: JSON.stringify([
          {
            id: 'mt-batch',
            points: [
              { x: 0, y: 0 },
              { x: 5, y: 5 },
            ],
            type: 'external',
            area: 0,
            confidence: 0.9,
            geometry: 'polyline',
            trackId: 'track-batch',
            name: 'MT-batch',
          },
        ]),
        model: 'microtubule',
        threshold: 0.5,
        confidence: 0.9,
        processingTime: null,
        imageWidth: 512,
        imageHeight: 512,
      },
    ]);

    const results = await svc.getBatchSegmentationResults(['img-mt'], userId);
    const poly = (results['img-mt'] as any).polygons[0];
    expect(poly.trackId).toBe('track-batch');
    expect(poly.name).toBe('MT-batch');
  });

  it('strips _embedding from the batch response', async () => {
    prisma.image.findMany.mockResolvedValue([{ id: 'img-emb' }]);
    prisma.segmentation.findMany.mockResolvedValue([
      {
        imageId: 'img-emb',
        polygons: JSON.stringify([
          {
            id: 'poly-emb',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
            type: 'external',
            area: 0,
            confidence: 0.9,
            geometry: 'polyline',
            trackId: 'track-emb',
            _embedding: [0.1, 0.2, 0.3],
          },
        ]),
        model: 'microtubule',
        threshold: 0.5,
        confidence: 0.9,
        processingTime: 3000,
        imageWidth: 200,
        imageHeight: 200,
      },
    ]);

    const results = await svc.getBatchSegmentationResults(['img-emb'], userId);
    expect((results['img-emb'] as any).polygons[0]._embedding).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// updateSegmentationResults — manual edit + cross-frame propagation
// ═══════════════════════════════════════════════════════════════════════════

describe('SegmentationService — updateSegmentationResults', () => {
  const imageId = 'img-upd-1';
  const userId = 'user-upd-1';
  let svc: SegmentationService;
  let prisma: ReturnType<typeof makePrisma>;
  let imageService: ReturnType<typeof makeImageService>;

  const makePolygons = () => [
    {
      id: 'p-1',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ],
      type: 'external' as const,
      area: 12,
      confidence: 0.88,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    ({ svc, prisma, imageService } = makeService());
    imageService.getImageById.mockResolvedValue({
      id: imageId,
      name: 'test.png',
      projectId: 'proj-1',
      parentVideoId: null,
    });
  });

  it('throws when the image is not found (no access)', async () => {
    imageService.getImageById.mockResolvedValue(null);
    await expect(
      svc.updateSegmentationResults(imageId, makePolygons() as any, userId)
    ).rejects.toThrow('Image not found or no access');
  });

  it('creates a new segmentation row when none exists', async () => {
    prisma.segmentation.findUnique.mockResolvedValue(null);
    prisma.segmentation.create.mockResolvedValue({
      id: 'new-seg-1',
      imageId,
      model: 'manual',
      threshold: 0.5,
      confidence: 0.88,
      imageWidth: null,
      imageHeight: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await svc.updateSegmentationResults(
      imageId,
      makePolygons() as any,
      userId
    );
    expect(prisma.segmentation.create).toHaveBeenCalledOnce();
    expect(prisma.segmentation.create.mock.calls[0][0].data.model).toBe('manual');
    expect(result.status).toBe('completed');
  });

  it('creates a segmentation with dimensions when provided', async () => {
    prisma.segmentation.findUnique.mockResolvedValue(null);
    prisma.segmentation.create.mockResolvedValue({
      id: 'seg-dim',
      imageId,
      model: 'manual',
      threshold: 0.5,
      confidence: 0.88,
      imageWidth: 1024,
      imageHeight: 768,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await svc.updateSegmentationResults(
      imageId,
      makePolygons() as any,
      userId,
      1024,
      768
    );
    const createCall = prisma.segmentation.create.mock.calls[0][0].data;
    expect(createCall.imageWidth).toBe(1024);
    expect(createCall.imageHeight).toBe(768);
    expect(result.imageWidth).toBe(1024);
  });

  it('updates an existing segmentation and runs a transaction', async () => {
    prisma.segmentation.findUnique.mockResolvedValue({
      id: 'existing-seg-1',
      imageId,
      polygons: JSON.stringify([makePolygon()]),
      model: 'hrnet',
      threshold: 0.5,
      confidence: 0.9,
      imageWidth: 800,
      imageHeight: 600,
    });
    prisma.image.findMany.mockResolvedValue([]); // no siblings
    prisma.$transaction.mockResolvedValue([
      {
        id: 'existing-seg-1',
        imageId,
        model: 'hrnet',
        threshold: 0.5,
        confidence: 0.88,
        imageWidth: 800,
        imageHeight: 600,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await svc.updateSegmentationResults(
      imageId,
      makePolygons() as any,
      userId
    );
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(result.id).toBe('existing-seg-1');
    expect(result.status).toBe('completed');
  });

  it('converts a parentIds array to parent_id in the DB polygon', async () => {
    prisma.segmentation.findUnique.mockResolvedValue(null);
    prisma.segmentation.create.mockResolvedValue({
      id: 'seg-parent',
      imageId,
      model: 'manual',
      threshold: 0.5,
      confidence: 0.8,
      imageWidth: null,
      imageHeight: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await svc.updateSegmentationResults(
      imageId,
      [
        {
          id: 'int-p',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
          ],
          type: 'internal' as const,
          area: 1,
          confidence: 0.75,
          parentIds: ['ext-id-1'],
        },
      ] as any,
      userId
    );

    const dbPolygons = JSON.parse(
      prisma.segmentation.create.mock.calls[0][0].data.polygons
    );
    expect(dbPolygons[0].parent_id).toBe('ext-id-1');
    expect(dbPolygons[0].parentIds).toBeUndefined();
  });

  it('preserves trackId and name on update (MT cross-frame identity)', async () => {
    prisma.segmentation.findUnique.mockResolvedValue(null);
    prisma.segmentation.create.mockResolvedValue({
      id: 'seg-mt',
      imageId,
      model: 'manual',
      threshold: 0.5,
      confidence: 0.9,
      imageWidth: null,
      imageHeight: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await svc.updateSegmentationResults(
      imageId,
      [
        {
          id: 'mt-poly',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          type: 'external' as const,
          area: 0,
          confidence: 0.9,
          geometry: 'polyline' as const,
          trackId: 'track-42',
          name: 'MT-42',
        },
      ] as any,
      userId
    );

    const dbPolygons = JSON.parse(
      prisma.segmentation.create.mock.calls[0][0].data.polygons
    );
    expect(dbPolygons[0].trackId).toBe('track-42');
    expect(dbPolygons[0].name).toBe('MT-42');
  });

  it('propagates track renames and deletes to sibling frames', async () => {
    imageService.getImageById.mockResolvedValue({
      id: imageId,
      name: 'frame.png',
      projectId: 'proj-vid',
      parentVideoId: 'vid-1',
    });

    const previousPolygons = [
      {
        id: 'mt-a',
        trackId: 'track-1',
        name: 'MT-old',
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
        type: 'external',
        geometry: 'polyline',
        area: 0,
        confidence: 0.9,
      },
      {
        id: 'mt-b',
        trackId: 'track-2',
        name: 'MT-B',
        points: [
          { x: 1, y: 1 },
          { x: 6, y: 6 },
        ],
        type: 'external',
        geometry: 'polyline',
        area: 0,
        confidence: 0.9,
      },
    ];
    prisma.segmentation.findUnique.mockResolvedValue({
      id: 'seg-vid-1',
      imageId,
      polygons: JSON.stringify(previousPolygons),
      model: 'microtubule',
      threshold: 0.5,
      confidence: 0.9,
      imageWidth: 512,
      imageHeight: 512,
    });

    const siblingPolygons = [
      {
        id: 'sib-a',
        trackId: 'track-1',
        name: 'MT-old',
        points: [
          { x: 2, y: 2 },
          { x: 7, y: 7 },
        ],
        type: 'external',
        geometry: 'polyline',
        area: 0,
        confidence: 0.85,
      },
      {
        id: 'sib-b',
        trackId: 'track-2',
        name: 'MT-B',
        points: [
          { x: 3, y: 3 },
          { x: 8, y: 8 },
        ],
        type: 'external',
        geometry: 'polyline',
        area: 0,
        confidence: 0.85,
      },
    ];
    prisma.image.findMany.mockResolvedValue([
      {
        id: 'sibling-frame-1',
        segmentation: {
          id: 'seg-sib-1',
          polygons: JSON.stringify(siblingPolygons),
        },
      },
    ]);

    // New polygons: track-1 renamed, track-2 deleted.
    const newPolys = [
      {
        id: 'mt-a',
        trackId: 'track-1',
        name: 'MT-renamed',
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
        type: 'external' as const,
        geometry: 'polyline' as const,
        area: 0,
        confidence: 0.9,
      },
    ];

    prisma.$transaction.mockResolvedValue([
      {
        id: 'seg-vid-1',
        imageId,
        model: 'microtubule',
        threshold: 0.5,
        confidence: 0.9,
        imageWidth: 512,
        imageHeight: 512,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await svc.updateSegmentationResults(
      imageId,
      newPolys as any,
      userId
    );

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    // main update + at least one sibling update
    expect(prisma.$transaction.mock.calls[0][0].length).toBeGreaterThanOrEqual(2);
    expect(result.id).toBe('seg-vid-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// deleteSegmentationResults
// ═══════════════════════════════════════════════════════════════════════════

describe('SegmentationService — deleteSegmentationResults', () => {
  let svc: SegmentationService;
  let prisma: ReturnType<typeof makePrisma>;
  let imageService: ReturnType<typeof makeImageService>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ svc, prisma, imageService } = makeService());
  });

  it('deletes segmentation and resets image status', async () => {
    imageService.getImageById.mockResolvedValue({ id: 'img-del', name: 'x.png' });
    prisma.segmentation.deleteMany.mockResolvedValue({ count: 1 });

    await svc.deleteSegmentationResults('img-del', 'user-1');
    expect(prisma.segmentation.deleteMany).toHaveBeenCalledWith({
      where: { imageId: 'img-del' },
    });
    expect(imageService.updateSegmentationStatus).toHaveBeenCalledWith(
      'img-del',
      'no_segmentation',
      'user-1'
    );
  });

  it('throws when the image is not found or no access', async () => {
    imageService.getImageById.mockResolvedValue(null);
    await expect(
      svc.deleteSegmentationResults('bad-img', 'user-1')
    ).rejects.toThrow('Image not found or no access');
    expect(prisma.segmentation.deleteMany).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getProjectSegmentationStats
// ═══════════════════════════════════════════════════════════════════════════

describe('SegmentationService — getProjectSegmentationStats', () => {
  let svc: SegmentationService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ svc, prisma } = makeService());
  });

  it('throws when the project is not found', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(
      svc.getProjectSegmentationStats('bad-proj', 'user-1')
    ).rejects.toThrow('Project not found or no access');
  });

  it('tallies model usage counts and average confidence', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'proj-1' });
    prisma.image.count.mockResolvedValue(5);
    mockSegStatsFromRows(prisma, [
      {
        polygons: JSON.stringify([makePolygon(), makePolygon()]),
        confidence: 0.9,
        model: 'hrnet',
      },
      { polygons: JSON.stringify([makePolygon()]), confidence: 0.8, model: 'hrnet' },
      {
        polygons: JSON.stringify([makePolygon()]),
        confidence: 0.7,
        model: 'cbam_resunet',
      },
    ]);

    const stats = await svc.getProjectSegmentationStats('proj-1', 'user-1');
    expect(stats.totalImages).toBe(5);
    expect(stats.processedImages).toBe(3);
    expect(stats.totalPolygons).toBe(4);
    expect(stats.models.hrnet).toBe(2);
    expect(stats.models.cbam_resunet).toBe(1);
    expect(stats.averageConfidence).toBeCloseTo((0.9 + 0.8 + 0.7) / 3, 5);
  });

  it('returns zeros when no segmentation data exists', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'proj-empty' });
    prisma.image.count.mockResolvedValue(3);
    mockSegStatsFromRows(prisma, []);

    const stats = await svc.getProjectSegmentationStats('proj-empty', 'user-1');
    expect(stats.processedImages).toBe(0);
    expect(stats.totalPolygons).toBe(0);
    expect(stats.averageConfidence).toBe(0);
    expect(stats.models).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// requestSegmentation — HTTP error branches
// ═══════════════════════════════════════════════════════════════════════════

describe('SegmentationService — requestSegmentation HTTP error branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const axiosErr = (extra: Record<string, unknown>) =>
    Object.assign(new Error((extra.message as string) ?? 'err'), {
      isAxiosError: true,
      response: undefined,
      config: {},
      ...extra,
    });

  it('throws "Image not found" when getImageById returns null', async () => {
    const { svc, imageService } = makeService();
    imageService.getImageById.mockResolvedValueOnce(null);
    await expect(
      svc.requestSegmentation({
        imageId: 'img-missing',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow('Image not found or no access');
  });

  it('throws model incompatibility when the model is not allowed for the project type', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValueOnce(makeImage());
    prisma.project.findUnique.mockResolvedValueOnce({ type: 'wound' });
    await expect(
      svc.requestSegmentation({
        imageId: 'img-1',
        model: 'sperm' as never,
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow(/not compatible with project type/);
  });

  it('throws "ML service unavailable" on ECONNREFUSED', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValueOnce(makeImage());
    prisma.project.findUnique.mockResolvedValueOnce({ type: 'spheroid' });
    mockHttpClientPost.mockRejectedValueOnce(
      axiosErr({ message: 'connection refused', code: 'ECONNREFUSED' })
    );
    await expect(
      svc.requestSegmentation({
        imageId: 'img-1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow('ML service unavailable');
  });

  it('throws "ML service not responding" on ETIMEDOUT', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValueOnce(makeImage());
    prisma.project.findUnique.mockResolvedValueOnce({ type: 'spheroid' });
    mockHttpClientPost.mockRejectedValueOnce(
      axiosErr({ message: 'timed out', code: 'ETIMEDOUT' })
    );
    await expect(
      svc.requestSegmentation({
        imageId: 'img-1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow('ML service not responding');
  });

  it('throws "Invalid image" for HTTP 400', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValueOnce(makeImage());
    prisma.project.findUnique.mockResolvedValueOnce({ type: 'spheroid' });
    mockHttpClientPost.mockRejectedValueOnce(
      axiosErr({
        message: 'bad request',
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: { detail: 'bad image format' },
        },
      })
    );
    await expect(
      svc.requestSegmentation({
        imageId: 'img-1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow('Invalid image or segmentation parameters');
  });

  it('throws "Segmentation service error" for HTTP 500', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValueOnce(makeImage());
    prisma.project.findUnique.mockResolvedValueOnce({ type: 'spheroid' });
    mockHttpClientPost.mockRejectedValueOnce(
      axiosErr({
        message: 'internal error',
        response: {
          status: 500,
          statusText: 'Internal Server Error',
          data: { detail: 'oops' },
        },
      })
    );
    await expect(
      svc.requestSegmentation({
        imageId: 'img-1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow('Segmentation service error');
  });

  it('throws a generic "Segmentation error" for an unknown (non-axios) error', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValueOnce(makeImage());
    prisma.project.findUnique.mockResolvedValueOnce({ type: 'spheroid' });
    mockHttpClientPost.mockRejectedValueOnce(
      Object.assign(new Error('weird failure'), {
        isAxiosError: false,
        response: undefined,
        config: {},
      })
    );
    await expect(
      svc.requestSegmentation({
        imageId: 'img-1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow('Segmentation error: weird failure');
  });

  it('logs but does not re-throw when updateSegmentationStatus fails inside the error handler', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValueOnce(makeImage());
    prisma.project.findUnique.mockResolvedValueOnce({ type: 'spheroid' });
    imageService.updateSegmentationStatus
      .mockResolvedValueOnce(undefined) // 'processing'
      .mockRejectedValueOnce(new Error('WS down')); // 'failed' inside catch
    mockHttpClientPost.mockRejectedValueOnce(
      Object.assign(new Error('weird failure'), {
        isAxiosError: false,
        response: undefined,
        config: {},
      })
    );
    // The original segmentation error propagates, not the WS error.
    await expect(
      svc.requestSegmentation({
        imageId: 'img-1',
        model: 'hrnet',
        threshold: 0.5,
        userId: 'user-1',
      })
    ).rejects.toThrow('Segmentation error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// requestBatchSegmentation — result-index alignment + error branches
// ═══════════════════════════════════════════════════════════════════════════

describe('SegmentationService — requestBatchSegmentation', () => {
  let svc: SegmentationService;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ svc } = makeService());
  });

  it('maps results correctly when a middle image is invalid', async () => {
    const images = [
      makeImage({ id: 'img1', originalPath: 'path/to/image1.jpg' }),
      makeImage({ id: 'img2', originalPath: null }), // invalid
      makeImage({ id: 'img3', originalPath: 'path/to/image3.jpg' }),
    ];
    mockHttpClientPost.mockResolvedValueOnce({
      data: {
        results: [
          {
            success: true,
            polygons: [{ points: [[0, 0], [100, 0], [100, 100], [0, 100]] }],
            model_used: 'hrnet',
            threshold_used: 0.5,
            confidence: 0.95,
            processing_time: 0.5,
            image_size: { width: 1024, height: 768 },
          },
          {
            success: true,
            polygons: [{ points: [[50, 50], [150, 50], [150, 150], [50, 150]] }],
            model_used: 'hrnet',
            threshold_used: 0.5,
            confidence: 0.92,
            processing_time: 0.6,
            image_size: { width: 1024, height: 768 },
          },
        ],
        processing_time: 1.1,
      },
    });

    const results = await svc.requestBatchSegmentation(images as never[]);
    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[0].confidence).toBe(0.95);
    expect(results[1].success).toBe(false);
    expect(results[1].polygons).toHaveLength(0);
    expect(results[1].error).toBe('Image skipped or invalid');
    // Third image must get the SECOND ML result, not undefined.
    expect(results[2].success).toBe(true);
    expect(results[2].confidence).toBe(0.92);
  });

  it('maps the last image correctly when the first images are invalid', async () => {
    const images = [
      makeImage({ id: 'img1', originalPath: null }),
      makeImage({ id: 'img2', originalPath: undefined }),
      makeImage({ id: 'img3', originalPath: 'path/to/image3.jpg' }),
    ];
    mockHttpClientPost.mockResolvedValueOnce({
      data: {
        results: [
          {
            success: true,
            polygons: [
              { points: [[0, 0], [100, 0], [100, 100], [0, 100]] },
              { points: [[200, 200], [300, 200], [300, 300], [200, 300]] },
            ],
            model_used: 'hrnet',
            threshold_used: 0.5,
            confidence: 0.98,
            processing_time: 0.8,
            image_size: { width: 1024, height: 768 },
          },
        ],
        processing_time: 0.8,
      },
    });

    const results = await svc.requestBatchSegmentation(images as never[]);
    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(false);
    expect(results[2].success).toBe(true);
    expect(results[2].polygons).toHaveLength(2);
    expect(results[2].confidence).toBe(0.98);
    expect(results[2].model_used).toBe('hrnet');
  });

  it('maps mixed valid/invalid images across a larger batch', async () => {
    const images = [
      makeImage({ id: 'img0', originalPath: 'path/0.jpg' }),
      makeImage({ id: 'img1', originalPath: null }),
      makeImage({ id: 'img2', originalPath: 'path/2.jpg' }),
      makeImage({ id: 'img3', originalPath: undefined }),
      makeImage({ id: 'img4', originalPath: 'path/4.jpg' }),
    ];
    mockHttpClientPost.mockResolvedValueOnce({
      data: {
        results: [
          { success: true, polygons: [{ points: [[0, 0]] }], confidence: 0.91 },
          { success: true, polygons: [{ points: [[1, 1]] }], confidence: 0.92 },
          { success: true, polygons: [{ points: [[2, 2]] }], confidence: 0.93 },
        ],
      },
    });

    const results = await svc.requestBatchSegmentation(images as never[]);
    expect(results).toHaveLength(5);
    expect(results[0].confidence).toBe(0.91);
    expect(results[1].success).toBe(false);
    expect(results[2].confidence).toBe(0.92);
    expect(results[3].success).toBe(false);
    expect(results[4].success).toBe(true);
    expect(results[4].confidence).toBe(0.93);
    expect(results[4].polygons).toHaveLength(1);
  });

  it('returns all-failed results when every image is invalid', async () => {
    const images = [
      makeImage({ id: 'img1', originalPath: null }),
      makeImage({ id: 'img2', originalPath: undefined }),
      makeImage({ id: 'img3', originalPath: '' }),
    ];
    mockHttpClientPost.mockResolvedValueOnce({
      data: { results: [], processing_time: 0 },
    });

    const results = await svc.requestBatchSegmentation(images as never[]);
    expect(results).toHaveLength(3);
    results.forEach(result => {
      expect(result.success).toBe(false);
      expect(result.error).toBe('Image skipped or invalid');
    });
  });

  it('returns failed results for all images on an Axios error', async () => {
    const images = [
      makeImage({ id: 'img-1', originalPath: 'p.jpg' }),
      makeImage({ id: 'img-2', originalPath: 'p2.jpg' }),
    ];
    mockHttpClientPost.mockRejectedValueOnce(
      Object.assign(new Error('network error'), {
        isAxiosError: true,
        response: undefined,
        config: {},
      })
    );

    const results = await svc.requestBatchSegmentation(
      images as never[],
      'hrnet',
      0.5,
      true
    );
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(false);
    expect(results[0].error).toBeDefined();
  });

  it('returns failed results on a non-axios error', async () => {
    const images = [makeImage({ id: 'img-1', originalPath: 'p.jpg' })];
    mockHttpClientPost.mockRejectedValueOnce(new Error('generic fail'));
    const results = await svc.requestBatchSegmentation(images as never[]);
    expect(results[0].success).toBe(false);
  });

  it('returns failed results when the ML response lacks data.results', async () => {
    const images = [makeImage({ id: 'img-1', originalPath: 'p.jpg' })];
    mockHttpClientPost.mockResolvedValueOnce({
      data: { notResults: true },
      status: 200,
    });
    const results = await svc.requestBatchSegmentation(images as never[]);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeDefined();
  });

  it('warns and stops when there are more ML results than valid images', async () => {
    const images = [makeImage({ id: 'img-1', originalPath: 'p.jpg' })];
    mockHttpClientPost.mockResolvedValueOnce({
      data: {
        results: [
          {
            success: true,
            polygons: [{ id: 'p1', points: [[0, 0], [1, 0], [0, 1]], type: 'external' }],
            model_used: 'hrnet',
            threshold_used: 0.5,
            confidence: 0.9,
            processing_time: 100,
            image_size: { width: 100, height: 100 },
          },
          {
            success: true,
            polygons: [],
            model_used: 'hrnet',
            threshold_used: 0.5,
            confidence: 0.9,
            processing_time: 100,
            image_size: { width: 100, height: 100 },
          },
        ],
        processing_time: 200,
      },
    });
    const results = await svc.requestBatchSegmentation(images as never[]);
    expect(results).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// batchProcess
// ═══════════════════════════════════════════════════════════════════════════

describe('SegmentationService — batchProcess', () => {
  const upsertRow = {
    id: 's1',
    imageId: 'img-1',
    polygons: '[]',
    model: 'hrnet',
    threshold: 0.5,
    confidence: 0.9,
    imageWidth: 100,
    imageHeight: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
    processingTime: 200,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts all successes when every image succeeds', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById.mockResolvedValue(makeImage());
    prisma.project.findUnique.mockResolvedValue({ type: 'spheroid' });
    mockHttpClientPost.mockResolvedValue({ data: makeSegResult() });
    prisma.segmentation.upsert.mockResolvedValue(upsertRow);

    const result = await svc.batchProcess(['img-1', 'img-2'], 'hrnet', 0.5, 'user-1');
    expect(result.successful).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].success).toBe(true);
  });

  it('increments the failed count when an image is not found', async () => {
    const { svc, imageService, prisma } = makeService();
    imageService.getImageById
      .mockResolvedValueOnce(makeImage())
      .mockResolvedValueOnce(null); // second image not found
    prisma.project.findUnique.mockResolvedValue({ type: 'spheroid' });
    mockHttpClientPost.mockResolvedValue({ data: makeSegResult() });
    prisma.segmentation.upsert.mockResolvedValue(upsertRow);

    const result = await svc.batchProcess(['img-1', 'img-2'], 'hrnet', 0.5, 'user-1');
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[1].success).toBe(false);
    expect(result.results[1].error).toMatch(/Image not found/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// checkServiceHealth
// ═══════════════════════════════════════════════════════════════════════════

describe('SegmentationService — checkServiceHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false and logs when the HTTP client throws', async () => {
    const { svc } = makeService();
    mockHttpClientGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await svc.checkServiceHealth()).toBe(false);
    expect(vi.mocked(logger.error)).toHaveBeenCalled();
  });

  it('returns false when the health response is not "healthy"', async () => {
    const { svc } = makeService();
    mockHttpClientGet.mockResolvedValueOnce({ data: { status: 'degraded' } });
    expect(await svc.checkServiceHealth()).toBe(false);
  });

  it('returns true when the health response says "healthy"', async () => {
    const { svc } = makeService();
    mockHttpClientGet.mockResolvedValueOnce({ data: { status: 'healthy' } });
    expect(await svc.checkServiceHealth()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// resolveChannelPath — pure channel-path util
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveChannelPath', () => {
  it('returns the original path unchanged when channel is undefined', () => {
    const p = 'projects/p1/images/v1/frames/0010/640_nm.png';
    expect(resolveChannelPath(p, undefined)).toBe(p);
  });

  it('returns the original path unchanged when channel is null', () => {
    const p = 'projects/p1/images/v1/frames/0010/640_nm.png';
    expect(resolveChannelPath(p, null)).toBe(p);
  });

  it('returns the original path unchanged when channel is empty string', () => {
    const p = 'projects/p1/images/v1/frames/0010/640_nm.png';
    expect(resolveChannelPath(p, '')).toBe(p);
  });

  it('swaps the channel segment for a frame path', () => {
    const p = 'projects/p1/images/v1/frames/0010/640_nm.png';
    expect(resolveChannelPath(p, '488_nm')).toBe(
      'projects/p1/images/v1/frames/0010/488_nm.png'
    );
  });

  it('preserves the extension when swapping channels', () => {
    const p = 'projects/p1/images/v1/frames/0050/ch_0.tif';
    expect(resolveChannelPath(p, 'ch_1')).toBe(
      'projects/p1/images/v1/frames/0050/ch_1.tif'
    );
  });

  it('handles multi-digit frame indices', () => {
    const p = 'projects/p1/images/v1/frames/12345/488_nm.png';
    expect(resolveChannelPath(p, '640_nm')).toBe(
      'projects/p1/images/v1/frames/12345/640_nm.png'
    );
  });

  it('is a no-op for non-frame paths (standalone image)', () => {
    const p = 'projects/p1/images/img1/original.png';
    expect(resolveChannelPath(p, '488_nm')).toBe(p);
  });

  it('is a no-op for paths without a /frames/ segment', () => {
    const p = 'projects/p1/images/v1/thumbnail.jpg';
    expect(resolveChannelPath(p, '488_nm')).toBe(p);
  });

  it('regression: the exact path shape we saw in production', () => {
    const p =
      'projects/ff6b0bde-bc68-4b69-ac06-8cb178696494/images/1f43f42e-7c49-4209-aec4-d945840db885/frames/0097/640_nm.png';
    expect(resolveChannelPath(p, '488_nm')).toBe(
      'projects/ff6b0bde-bc68-4b69-ac06-8cb178696494/images/1f43f42e-7c49-4209-aec4-d945840db885/frames/0097/488_nm.png'
    );
  });

  it('only rewrites the last /frames/<n>/ segment', () => {
    const p = 'projects/p1/images/v1/frames/0001/488_nm.png';
    expect(resolveChannelPath(p, '640_nm')).toBe(
      'projects/p1/images/v1/frames/0001/640_nm.png'
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// polygon-field SSOT round-trip
// ═══════════════════════════════════════════════════════════════════════════

describe('polygon-field SSOT round-trip', () => {
  const IMAGE_ID = 'img-ssot-1';
  const USER_ID = 'user-ssot-1';
  let svc: SegmentationService;
  let prisma: ReturnType<typeof makePrisma>;
  let imageService: ReturnType<typeof makeImageService>;

  /** A polygon carrying every optional field plus an _embedding blob. */
  const fullPolygon = (): Record<string, unknown> => ({
    id: 'poly-1',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    type: 'external',
    area: 42,
    confidence: 0.9,
    geometry: 'polyline',
    partClass: 'head',
    instanceId: 'sperm-7',
    trackId: 'track-99',
    name: 'Tail A',
    _embedding: [
      [1, 2, 3],
      [4, 5, 6],
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    ({ svc, prisma, imageService } = makeService());
    imageService.getImageById.mockResolvedValue({
      id: IMAGE_ID,
      projectId: 'proj-1',
      parentVideoId: null,
      originalPath: '/x.png',
    });
    prisma.image.findMany.mockResolvedValue([]);
  });

  it('OPTIONAL_POLYGON_FIELDS registers all metadata fields and NOT _embedding', () => {
    const keys = OPTIONAL_POLYGON_FIELDS.map(f => f.key);
    expect(keys).toEqual(
      expect.arrayContaining(['partClass', 'instanceId', 'trackId', 'name'])
    );
    expect(keys).not.toContain('_embedding');
  });

  it('save → getSegmentationResults preserves every optional field and strips _embedding', async () => {
    let storedJson = '';
    prisma.segmentation.upsert.mockImplementation(async (args: any) => {
      storedJson = args.create.polygons;
      return { id: 'seg-1' };
    });

    await svc.saveSegmentationResults(
      IMAGE_ID,
      [fullPolygon() as unknown as SegmentationPolygon],
      'sperm',
      0.5,
      null,
      1000,
      640,
      480,
      USER_ID,
      false
    );

    // The DB JSON carries the optional fields AND _embedding (server-side).
    const stored = JSON.parse(storedJson) as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(stored[0].partClass).toBe('head');
    expect(stored[0].instanceId).toBe('sperm-7');
    expect(stored[0].trackId).toBe('track-99');
    expect(stored[0].name).toBe('Tail A');
    expect(stored[0].geometry).toBe('polyline');
    expect(stored[0]._embedding).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);

    // Serve it back: optional fields survive, _embedding is stripped.
    prisma.segmentation.findUnique.mockResolvedValue({
      polygons: storedJson,
      model: 'sperm',
      threshold: 0.5,
      confidence: 0.9,
      processingTime: 1000,
      imageWidth: 640,
      imageHeight: 480,
      updatedAt: new Date(),
    });

    const served = await svc.getSegmentationResults(IMAGE_ID, USER_ID);
    expect(served).not.toBeNull();
    const p = served!.polygons[0] as Record<string, unknown>;
    expect(p.partClass).toBe('head');
    expect(p.instanceId).toBe('sperm-7');
    expect(p.trackId).toBe('track-99');
    expect(p.name).toBe('Tail A');
    expect(p.geometry).toBe('polyline');
    expect(p._embedding).toBeUndefined();
  });

  it('updateSegmentationResults → getSegmentationResults round-trips fields, converts parentIds, strips _embedding', async () => {
    let updatedJson = '';
    prisma.segmentation.findUnique.mockResolvedValue({
      id: 'seg-1',
      polygons: '[]',
      model: 'manual',
      threshold: 0.5,
    });
    prisma.segmentation.update.mockImplementation((args: any) => {
      updatedJson = args.data.polygons;
      return { __op: 'update' };
    });
    prisma.$transaction.mockImplementation(async (ops: any[]) =>
      ops.map(() => ({
        id: 'seg-1',
        imageId: IMAGE_ID,
        model: 'manual',
        threshold: 0.5,
        confidence: 0.9,
        imageWidth: 640,
        imageHeight: 480,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );

    const wirePoly = {
      ...fullPolygon(),
      type: 'internal',
      parentIds: ['parent-xyz'],
    };

    await svc.updateSegmentationResults(
      IMAGE_ID,
      [wirePoly as unknown as SegmentationPolygon],
      USER_ID,
      640,
      480
    );

    // DB JSON: parentIds[] collapsed to parent_id, fields + _embedding kept.
    const stored = JSON.parse(updatedJson) as Array<Record<string, unknown>>;
    expect(stored[0].parent_id).toBe('parent-xyz');
    expect(stored[0].parentIds).toBeUndefined();
    expect(stored[0].partClass).toBe('head');
    expect(stored[0].trackId).toBe('track-99');
    expect(stored[0].name).toBe('Tail A');
    expect(stored[0]._embedding).toBeDefined();

    // Serve it: parent_id -> parentIds[], _embedding stripped.
    prisma.segmentation.findUnique.mockResolvedValue({
      polygons: updatedJson,
      model: 'manual',
      threshold: 0.5,
      confidence: 0.9,
      processingTime: null,
      imageWidth: 640,
      imageHeight: 480,
      updatedAt: new Date(),
    });

    const served = await svc.getSegmentationResults(IMAGE_ID, USER_ID);
    const p = served!.polygons[0] as Record<string, unknown>;
    expect(p.parentIds).toEqual(['parent-xyz']);
    expect(p.partClass).toBe('head');
    expect(p.trackId).toBe('track-99');
    expect(p.name).toBe('Tail A');
    expect((p as { parent_id?: unknown }).parent_id).toBeUndefined();
    expect(p._embedding).toBeUndefined();
  });

  it('validator drops unknown/junk fields from untrusted input (security boundary)', () => {
    const dirty = {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      type: 'external',
      trackId: 'keep-me',
      arbitraryJunk: { nested: true },
      _embedding: [[9, 9, 9]],
    };
    const result = PolygonValidator.validateSinglePolygon(dirty, 0) as Record<
      string,
      unknown
    >;
    expect(result).not.toBeNull();
    expect(result.trackId).toBe('keep-me');
    expect(result.arbitraryJunk).toBeUndefined();
    expect(result._embedding).toBeUndefined();
  });
});
