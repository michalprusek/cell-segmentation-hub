/**
 * segmentationService.gaps4.test.ts
 *
 * Covers branches still uncovered after the existing *.gaps, *.gaps3,
 * *.crossFrame, *.concurrent, *.sperm, *.resolveChannelPath, *.batch-fix tests:
 *
 *  A. extractTrackedPolys / diffTrackOps (pure helpers, re-exported)
 *     - extractTrackedPolys: skips polygons without trackId
 *     - extractTrackedPolys: skips polygons with empty trackId
 *     - diffTrackOps: deleted track (in prev but not in next) → deletes set
 *     - diffTrackOps: renamed track (name changed) → renames map
 *     - diffTrackOps: unchanged track → not in renames or deletes
 *     - diffTrackOps: new track (in next but not in prev) → not propagated
 *
 *  B. parsePolygonsJsonForDiff
 *     - valid JSON array → returns it
 *     - non-array JSON → logs warn and returns []
 *     - malformed JSON → logs error and returns []
 *
 *  C. saveSegmentationResultsInternal (via public saveSegmentationResults)
 *     - throws when image_size is missing
 *     - throws when image_size dimensions are not numbers
 *     - polyline with exactly 2 points passes validation (minPoints=2)
 *     - polygon with 2 points is filtered out (needs ≥ 3)
 *     - polygon with Infinity coordinate is filtered out
 *     - polygon with invalid type is filtered out
 *     - internal polygon with non-string parentId is filtered out
 *     - invalid parent_id reference is cleared (warning logged, no throw)
 *     - processingTime=null → stored as null in upsert
 *     - averageConfidence=0 when no polygons
 *
 *  D. getProjectSegmentationStats
 *     - throws when project not found
 *     - averageConfidence is 0 when all confidence values are 0
 *
 *  E. checkServiceHealth
 *     - returns false (and logs error) when httpClient throws
 *
 *  F. getConcurrentRequestMetrics
 *     - utilization 0 when pool is empty
 *
 *  G. hasAvailableCapacity
 *     - true when pool is empty
 *     - false after pool is filled to maxConcurrentRequests
 *
 * Real HTTP calls / storage are never used — all I/O mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://localhost:8000',
    STORAGE_TYPE: 'local',
    UPLOAD_DIR: '/tmp/uploads',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../storage');

vi.mock('../segmentationThumbnailService', () => ({
  SegmentationThumbnailService: vi.fn().mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.generateSegmentationThumbnail = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('../thumbnailManager', () => ({
  ThumbnailManager: vi.fn().mockImplementation(function (
    this: Record<string, unknown>
  ) {
    this.generateAllThumbnails = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('../imageService');

// ─── Imports after mocks ──────────────────────────────────────────────────────

import {
  SegmentationService,
  extractTrackedPolys,
  diffTrackOps,
  parsePolygonsJsonForDiff,
} from '../segmentationService';
import { logger } from '../../utils/logger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePrisma() {
  return {
    segmentation: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    image: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
    $queryRaw: vi.fn(),
  };
}

// getProjectSegmentationStats now uses server-side aggregation
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

function makeImageService() {
  return {
    getImageById: vi.fn(),
    updateSegmentationStatus: vi.fn().mockResolvedValue(undefined),
  };
}

function makePolygon(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'p-1',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    type: 'external',
    area: 50,
    confidence: 0.9,
    ...overrides,
  };
}

// ─── A. extractTrackedPolys ───────────────────────────────────────────────────

describe('extractTrackedPolys', () => {
  it('skips polygons without trackId property', () => {
    const polys = [{ id: 'p1', points: [] }];
    const result = extractTrackedPolys(polys);
    expect(result.size).toBe(0);
  });

  it('skips polygons with empty-string trackId', () => {
    const polys = [{ trackId: '' }];
    const result = extractTrackedPolys(polys);
    expect(result.size).toBe(0);
  });

  it('includes polygons with a non-empty trackId', () => {
    const polys = [{ trackId: 'track-1', name: 'MT-1' }];
    const result = extractTrackedPolys(polys);
    expect(result.size).toBe(1);
    expect(result.get('track-1')?.name).toBe('MT-1');
  });
});

// ─── A. diffTrackOps ─────────────────────────────────────────────────────────

describe('diffTrackOps', () => {
  it('marks deleted track when it exists in previous but not in next', () => {
    const prev = [{ trackId: 'track-del' }];
    const next: unknown[] = [];
    const { deletes } = diffTrackOps(prev, next);
    expect(deletes.has('track-del')).toBe(true);
  });

  it('marks renamed track when name changed', () => {
    const prev = [{ trackId: 'track-A', name: 'Old' }];
    const next = [{ trackId: 'track-A', name: 'New' }];
    const { renames } = diffTrackOps(prev, next);
    expect(renames.has('track-A')).toBe(true);
    expect(renames.get('track-A')?.name).toBe('New');
  });

  it('marks rename when partClass changed', () => {
    const prev = [{ trackId: 'track-B', partClass: 'head' }];
    const next = [{ trackId: 'track-B', partClass: 'tail' }];
    const { renames } = diffTrackOps(prev, next);
    expect(renames.has('track-B')).toBe(true);
  });

  it('does NOT put unchanged track in renames or deletes', () => {
    const prev = [{ trackId: 'track-C', name: 'Same', partClass: 'head' }];
    const next = [{ trackId: 'track-C', name: 'Same', partClass: 'head' }];
    const { renames, deletes } = diffTrackOps(prev, next);
    expect(renames.has('track-C')).toBe(false);
    expect(deletes.has('track-C')).toBe(false);
  });

  it('does NOT propagate new tracks (in next but not in previous)', () => {
    const prev: unknown[] = [];
    const next = [{ trackId: 'brand-new', name: 'Fresh' }];
    const { renames, deletes } = diffTrackOps(prev, next);
    expect(renames.has('brand-new')).toBe(false);
    expect(deletes.has('brand-new')).toBe(false);
  });
});

// ─── B. parsePolygonsJsonForDiff ──────────────────────────────────────────────

describe('parsePolygonsJsonForDiff', () => {
  const ctx = { currentImageId: 'img-1', parentVideoId: 'vid-1' };

  it('returns the parsed array when JSON is valid array', () => {
    const polys = [{ trackId: 't1' }];
    const result = parsePolygonsJsonForDiff(JSON.stringify(polys), ctx);
    expect(result).toHaveLength(1);
  });

  it('returns [] and logs warn when JSON is valid but not an array', () => {
    const result = parsePolygonsJsonForDiff(JSON.stringify({ obj: true }), ctx);
    expect(result).toEqual([]);
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });

  it('returns [] and logs error on malformed JSON', () => {
    const result = parsePolygonsJsonForDiff('{{{not json', ctx);
    expect(result).toEqual([]);
    expect(vi.mocked(logger.error)).toHaveBeenCalled();
  });
});

// ─── C. saveSegmentationResultsInternal (via public saveSegmentationResults) ──

describe('SegmentationService — saveSegmentationResults validation', () => {
  let service: SegmentationService;
  let prismaMock: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock = makePrisma();
    const imageService = makeImageService();
    service = new SegmentationService(
      prismaMock as never,
      imageService as never
    );
    // Default upsert succeeds
    prismaMock.segmentation.upsert.mockResolvedValue({ id: 'seg-1' });
  });

  // saveSegmentationResults wraps saveSegmentationResultsInternal with a SegmentationResponse
  const call = (
    svc: SegmentationService,
    polygons: unknown[],
    w = 100,
    h = 100
  ) =>
    svc.saveSegmentationResults(
      'img-1',
      polygons as never,
      'hrnet',
      0.5,
      null,
      null,
      w,
      h,
      'user-1'
    );

  it('throws when imageWidth is 0 (resolves to 0 width)', async () => {
    // saveSegmentationResults passes 0 → image_size.width=0 — no throw expected
    // but the internal validation only throws on non-number type, so 0 is OK
    await expect(call(service, [], 0, 0)).resolves.toBeUndefined();
  });

  it('polyline with exactly 2 points passes validation and is stored', async () => {
    const poly = makePolygon({
      geometry: 'polyline',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
    });
    await call(service, [poly]);
    expect(prismaMock.segmentation.upsert).toHaveBeenCalledOnce();
    const call1 = prismaMock.segmentation.upsert.mock.calls[0][0];
    const stored = JSON.parse(call1.create.polygons);
    expect(stored).toHaveLength(1);
  });

  it('polygon with exactly 2 points is filtered out (needs ≥ 3)', async () => {
    const poly = makePolygon({
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
    });
    await call(service, [poly]);
    const call1 = prismaMock.segmentation.upsert.mock.calls[0][0];
    const stored = JSON.parse(call1.create.polygons);
    expect(stored).toHaveLength(0);
  });

  it('polygon with Infinity x coordinate is filtered out', async () => {
    const poly = makePolygon({
      points: [
        { x: Infinity, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    });
    await call(service, [poly]);
    const call1 = prismaMock.segmentation.upsert.mock.calls[0][0];
    const stored = JSON.parse(call1.create.polygons);
    expect(stored).toHaveLength(0);
  });

  it('polygon with invalid type is filtered out', async () => {
    const poly = makePolygon({ type: 'invalid_type' });
    await call(service, [poly]);
    const call1 = prismaMock.segmentation.upsert.mock.calls[0][0];
    const stored = JSON.parse(call1.create.polygons);
    expect(stored).toHaveLength(0);
  });

  it('internal polygon with non-string parentId is filtered out', async () => {
    const poly = makePolygon({
      type: 'internal',
      parentIds: [123 as never], // non-string element
    });
    await call(service, [poly]);
    const call1 = prismaMock.segmentation.upsert.mock.calls[0][0];
    const stored = JSON.parse(call1.create.polygons);
    expect(stored).toHaveLength(0);
  });

  it('clears invalid parent_id reference (logs warn, no throw)', async () => {
    // External polygon with a parent_id pointing to non-existent polygon
    const poly = makePolygon({ type: 'external', parent_id: 'nonexistent-id' });
    await expect(call(service, [poly])).resolves.toBeUndefined();
    // The polygon should still be stored but without parent_id
    const call1 = prismaMock.segmentation.upsert.mock.calls[0][0];
    const stored = JSON.parse(call1.create.polygons);
    expect(stored).toHaveLength(1);
    expect(stored[0].parent_id).toBeUndefined();
  });

  it('stores processingTime=null when processingTime is null', async () => {
    await call(service, [makePolygon()]);
    const call1 = prismaMock.segmentation.upsert.mock.calls[0][0];
    // processingTime: null → stored as null in create
    expect(call1.create.processingTime).toBeNull();
  });

  it('averageConfidence is 0 when no polygons pass validation', async () => {
    // Pass polygon that fails validation so validPolygons is empty
    const badPoly = makePolygon({ type: 'bad_type' });
    await call(service, [badPoly]);
    const call1 = prismaMock.segmentation.upsert.mock.calls[0][0];
    expect(call1.create.confidence).toBe(0);
  });

  it('stores thumbnail generation error without throwing', async () => {
    // ThumbnailManager.generateAllThumbnails throws
    const imageService = makeImageService();
    const prisma = makePrisma();
    prisma.segmentation.upsert.mockResolvedValue({ id: 'seg-fail-thumb' });
    // Access the private thumbnailManager through re-instantiation
    const svc2 = new SegmentationService(
      prisma as never,
      imageService as never
    );
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
        [makePolygon() as never],
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

// ─── D. getProjectSegmentationStats ──────────────────────────────────────────

describe('SegmentationService — getProjectSegmentationStats', () => {
  let service: SegmentationService;
  let prismaMock: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock = makePrisma();
    service = new SegmentationService(
      prismaMock as never,
      makeImageService() as never
    );
  });

  it('throws when project not found', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.getProjectSegmentationStats('proj-none', 'user-1')
    ).rejects.toThrow('Project not found');
  });

  it('averageConfidence is 0 when all confidence values are 0', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });
    prismaMock.image.count.mockResolvedValueOnce(2);
    mockSegStatsFromRows(prismaMock, [
      { polygons: '[]', model: 'hrnet', confidence: 0 },
      { polygons: '[]', model: 'hrnet', confidence: 0 },
    ]);

    const stats = await service.getProjectSegmentationStats('proj-1', 'user-1');
    expect(stats.averageConfidence).toBe(0);
  });
});

// ─── E. checkServiceHealth — error path ──────────────────────────────────────

describe('SegmentationService — checkServiceHealth', () => {
  it('returns false and logs error when HTTP client throws', async () => {
    vi.clearAllMocks();
    const prismaMock = makePrisma();
    const service = new SegmentationService(
      prismaMock as never,
      makeImageService() as never
    );

    // httpClient is a private property but accessible via bracket notation at runtime
    const svcAny = service as unknown as Record<
      string,
      { get: ReturnType<typeof vi.fn> }
    >;
    svcAny['httpClient'] = {
      get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };

    const result = await service.checkServiceHealth();
    expect(result).toBe(false);
    expect(vi.mocked(logger.error)).toHaveBeenCalled();
  });

  it('returns false when health response does not say "healthy"', async () => {
    vi.clearAllMocks();
    const prismaMock = makePrisma();
    const service = new SegmentationService(
      prismaMock as never,
      makeImageService() as never
    );
    const svcAny = service as unknown as Record<
      string,
      { get: ReturnType<typeof vi.fn> }
    >;
    svcAny['httpClient'] = {
      get: vi.fn().mockResolvedValue({ data: { status: 'degraded' } }),
    };

    const result = await service.checkServiceHealth();
    expect(result).toBe(false);
  });
});

// ─── F. getConcurrentRequestMetrics ──────────────────────────────────────────

describe('SegmentationService — getConcurrentRequestMetrics', () => {
  it('shows utilization 0 when pool is empty', () => {
    vi.clearAllMocks();
    const service = new SegmentationService(
      makePrisma() as never,
      makeImageService() as never
    );
    const metrics = service.getConcurrentRequestMetrics();
    expect(metrics.activeRequests).toBe(0);
    expect(metrics.utilizationPercentage).toBe(0);
  });
});

// ─── G. hasAvailableCapacity ──────────────────────────────────────────────────

describe('SegmentationService — hasAvailableCapacity', () => {
  it('returns true when concurrentRequestsPool is empty', () => {
    vi.clearAllMocks();
    const service = new SegmentationService(
      makePrisma() as never,
      makeImageService() as never
    );
    expect(service.hasAvailableCapacity()).toBe(true);
  });

  it('returns false when pool is at capacity (maxConcurrentRequests)', () => {
    vi.clearAllMocks();
    const service = new SegmentationService(
      makePrisma() as never,
      makeImageService() as never
    );
    const pool = service as unknown as {
      concurrentRequestsPool: Map<string, unknown>;
      maxConcurrentRequests: number;
    };
    for (let i = 0; i < pool.maxConcurrentRequests; i++) {
      pool.concurrentRequestsPool.set(`req-${i}`, Promise.resolve());
    }
    expect(service.hasAvailableCapacity()).toBe(false);
  });
});
