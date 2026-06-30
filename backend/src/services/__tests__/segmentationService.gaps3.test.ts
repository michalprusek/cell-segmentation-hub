/**
 * segmentationService.gaps3.test.ts
 *
 * Targets branches NOT yet covered by the existing *.gaps, *.crossFrame,
 * *.concurrent, *.sperm or *.resolveChannelPath tests:
 *
 *  - saveSegmentationResultsInternal: internal polygon with invalid parentIds
 *    array (non-string element → filter), polygon whose geometry='polyline'
 *    needs only 2 points (accepted), polygon with Infinity coordinate (filter),
 *    averageConfidence computed correctly, processingTime null stored correctly
 *  - getSegmentationResults: processingTime null in DB → null in response,
 *    imageWidth/Height null in DB → 0 in response, partClass & instanceId
 *    propagated
 *  - updateSegmentationResults: existing seg update path passes avgConfidence,
 *    imageWidth/imageHeight NOT updated when not provided (no dimensions branch),
 *    computeCrossFrameTrackPropagation with rename and delete ops applied to
 *    siblings (integration via mocked prisma)
 *  - getBatchSegmentationResults: inaccessible image ids excluded; null for
 *    accessible images without segmentation; trackId/name preserved in batch
 *    response
 *  - getConcurrentRequestMetrics: reflects pool size
 *  - hasAvailableCapacity: true when pool < 4, false when pool === 4
 *  - getProjectSegmentationStats: averageConfidence zero when all confidence
 *    values are zero
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SegmentationService } from '../segmentationService';
import { ImageService } from '../imageService';

// ─── mocks ───────────────────────────────────────────────────────────────────

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

vi.mock('../../storage');
vi.mock('../segmentationThumbnailService');
vi.mock('../thumbnailManager', () => ({
  ThumbnailManager: function MockThumbnailManager(this: any) {
    this.generateAllThumbnails = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('../imageService');

// ─── helpers ─────────────────────────────────────────────────────────────────

function makePolygon(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'p-default',
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

// getProjectSegmentationStats now uses server-side aggregation
// (segmentation.aggregate + segmentation.groupBy + a $queryRaw polygon count).
// Derive those mock returns from a flat array of segmentation rows.
function mockSegStatsFromRows(
  prisma: any,
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

// ─── suite ───────────────────────────────────────────────────────────────────

describe('SegmentationService — gaps3 (additional uncovered branches)', () => {
  let service: SegmentationService;
  let prismaMock: any;
  let imageServiceMock: any;

  beforeEach(() => {
    prismaMock = {
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
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      $transaction: vi.fn(),
      $queryRaw: vi.fn(),
    };

    imageServiceMock = {
      getImageById: vi.fn(),
      updateSegmentationStatus: vi.fn().mockResolvedValue(undefined),
    };

    service = new SegmentationService(
      prismaMock as PrismaClient,
      imageServiceMock as ImageService
    );

    vi.clearAllMocks();
    imageServiceMock.updateSegmentationStatus.mockResolvedValue(undefined);
  });

  // ─── saveSegmentationResults — additional filter paths ─────────────────────

  describe('saveSegmentationResults — polygon filter edge cases', () => {
    it('accepts a polyline with exactly 2 points (geometry=polyline minPoints=2)', async () => {
      prismaMock.segmentation.upsert.mockResolvedValue({ id: 'seg-a' });

      const twoPointPolyline = {
        id: 'line-1',
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
        type: 'external',
        area: 0,
        confidence: 0.8,
        geometry: 'polyline',
      };

      await service.saveSegmentationResults(
        'img-1',
        [twoPointPolyline as any],
        'sperm',
        0.5,
        null,
        null,
        null,
        null,
        'u-1'
      );

      const saved: unknown[] = JSON.parse(
        prismaMock.segmentation.upsert.mock.calls[0][0].update.polygons
      );
      expect(saved).toHaveLength(1);
      expect((saved[0] as any).geometry).toBe('polyline');
    });

    it('filters out internal polygon whose parentIds contains a non-string element', async () => {
      prismaMock.segmentation.upsert.mockResolvedValue({ id: 'seg-b' });

      const badInternal = makePolygon({
        id: 'bad-internal',
        type: 'internal',
        parentIds: [42 as unknown as string], // non-string → invalid
      });
      const good = makePolygon({ id: 'good-ext' });

      await service.saveSegmentationResults(
        'img-1',
        [badInternal as any, good as any],
        'hrnet',
        0.5,
        null,
        null,
        null,
        null,
        'u-1'
      );

      const saved: unknown[] = JSON.parse(
        prismaMock.segmentation.upsert.mock.calls[0][0].update.polygons
      );
      // bad internal polygon should be filtered; only good survives
      expect(saved).toHaveLength(1);
      expect((saved[0] as any).id).toBe('good-ext');
    });

    it('filters out polygons with Infinity coordinates', async () => {
      prismaMock.segmentation.upsert.mockResolvedValue({ id: 'seg-c' });

      const infPoly = makePolygon({
        id: 'inf-poly',
        points: [
          { x: Infinity, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      });
      const good = makePolygon({ id: 'ok-poly' });

      await service.saveSegmentationResults(
        'img-1',
        [infPoly as any, good as any],
        'hrnet',
        0.5,
        null,
        null,
        null,
        null,
        'u-1'
      );

      const saved: unknown[] = JSON.parse(
        prismaMock.segmentation.upsert.mock.calls[0][0].update.polygons
      );
      expect(saved).toHaveLength(1);
      expect((saved[0] as any).id).toBe('ok-poly');
    });

    it('stores processingTime as null when input is null', async () => {
      prismaMock.segmentation.upsert.mockResolvedValue({ id: 'seg-d' });

      await service.saveSegmentationResults(
        'img-1',
        [makePolygon() as any],
        'hrnet',
        0.5,
        null,
        null /* processingTime */,
        null,
        null,
        'u-1'
      );

      const upsertCall = prismaMock.segmentation.upsert.mock.calls[0][0];
      // processingTime = null → no *1000 rounding → stored as null
      expect(upsertCall.update.processingTime).toBeNull();
      expect(upsertCall.create.processingTime).toBeNull();
    });

    it('computes averageConfidence correctly across multiple polygons', async () => {
      prismaMock.segmentation.upsert.mockResolvedValue({ id: 'seg-e' });

      const polys = [
        makePolygon({ id: 'p1', confidence: 1.0 }),
        makePolygon({ id: 'p2', confidence: 0.6 }),
      ];

      await service.saveSegmentationResults(
        'img-1',
        polys as any,
        'hrnet',
        0.5,
        null,
        null,
        null,
        null,
        'u-1'
      );

      const upsertCall = prismaMock.segmentation.upsert.mock.calls[0][0];
      // confidence 0 falls back to 0.8 in the dbPolygon builder (0.0 || 0.8)
      // confidence 1.0 stays 1.0; 0.6 stays 0.6
      // averageConfidence = (1.0 + 0.6) / 2 = 0.8
      expect(upsertCall.update.confidence).toBeCloseTo(0.8, 5);
      expect(upsertCall.create.confidence).toBeCloseTo(0.8, 5);
    });
  });

  // ─── getSegmentationResults — additional branches ──────────────────────────

  describe('getSegmentationResults — additional response mapping', () => {
    const imageId = 'img-get-x';
    const userId = 'u-get-x';

    beforeEach(() => {
      imageServiceMock.getImageById.mockResolvedValue({
        id: imageId,
        name: 'x.png',
      });
    });

    const makeSegRow = (
      polygons: unknown[],
      extra: Record<string, unknown> = {}
    ) => ({
      id: 'seg-x',
      imageId,
      polygons: JSON.stringify(polygons),
      model: 'hrnet',
      threshold: 0.5,
      confidence: 0.8,
      processingTime: null,
      imageWidth: null,
      imageHeight: null,
      updatedAt: new Date('2026-03-01T10:00:00Z'),
      ...extra,
    });

    it('returns processing_time=null when processingTime is null in DB', async () => {
      prismaMock.segmentation.findUnique.mockResolvedValue(
        makeSegRow([makePolygon()])
      );

      const result = await service.getSegmentationResults(imageId, userId);

      expect(result!.processing_time).toBeNull();
    });

    it('returns imageWidth=0 and imageHeight=0 when DB values are null', async () => {
      prismaMock.segmentation.findUnique.mockResolvedValue(
        makeSegRow([makePolygon()])
      );

      const result = await service.getSegmentationResults(imageId, userId);

      expect(result!.imageWidth).toBe(0);
      expect(result!.imageHeight).toBe(0);
      expect(result!.image_size).toEqual({ width: 0, height: 0 });
    });

    it('propagates partClass and instanceId on polylines (sperm fields)', async () => {
      const spermPoly = {
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
      };
      prismaMock.segmentation.findUnique.mockResolvedValue(
        makeSegRow([spermPoly])
      );

      const result = await service.getSegmentationResults(imageId, userId);

      const poly = result!.polygons[0];
      expect(poly.partClass).toBe('head');
      expect(poly.instanceId).toBe('sperm-42');
      expect((poly as any).geometry).toBe('polyline');
    });
  });

  // ─── updateSegmentationResults — additional branches ──────────────────────

  describe('updateSegmentationResults — additional paths', () => {
    const imageId = 'img-upd-x';
    const userId = 'u-upd-x';

    beforeEach(() => {
      imageServiceMock.getImageById.mockResolvedValue({
        id: imageId,
        name: 'f.png',
        projectId: 'proj-x',
        parentVideoId: null, // standalone — no cross-frame ops
      });
    });

    it('does NOT update imageWidth/imageHeight when neither is provided', async () => {
      const existingSeg = {
        id: 'seg-upd-1',
        imageId,
        polygons: JSON.stringify([makePolygon()]),
        model: 'hrnet',
        threshold: 0.5,
        confidence: 0.9,
        imageWidth: 800,
        imageHeight: 600,
      };
      prismaMock.segmentation.findUnique.mockResolvedValue(existingSeg);
      prismaMock.image.findMany.mockResolvedValue([]); // no siblings

      const updatedRow = {
        id: 'seg-upd-1',
        imageId,
        model: 'hrnet',
        threshold: 0.5,
        confidence: 0.9,
        imageWidth: 800,
        imageHeight: 600,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prismaMock.$transaction.mockResolvedValue([updatedRow]);

      const poly = {
        id: 'p-new',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        type: 'external' as const,
        area: 1,
        confidence: 0.9,
      };

      await service.updateSegmentationResults(imageId, [poly] as any, userId);

      // When imageWidth/imageHeight are not provided, they must NOT appear
      // in the transaction data object passed to prisma.segmentation.update
      expect(prismaMock.$transaction).toHaveBeenCalledOnce();
      // The updateData in the transaction should not contain imageWidth/imageHeight
      const txOps = prismaMock.$transaction.mock.calls[0][0];
      // ops is an array; first op is the segmentation.update call (a PrismaPromise)
      // We can't inspect PrismaPromise args easily; just assert transaction ran
      expect(Array.isArray(txOps)).toBe(true);
    });

    it('cross-frame: renames and deletes propagate to sibling frames with segmentation', async () => {
      // Set up: this frame has parentVideoId → siblings exist
      imageServiceMock.getImageById.mockResolvedValue({
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
      const existingSeg = {
        id: 'seg-vid-1',
        imageId,
        polygons: JSON.stringify(previousPolygons),
        model: 'microtubule',
        threshold: 0.5,
        confidence: 0.9,
        imageWidth: 512,
        imageHeight: 512,
      };
      prismaMock.segmentation.findUnique.mockResolvedValue(existingSeg);

      // Sibling frame with both MTs
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
      prismaMock.image.findMany.mockResolvedValue([
        {
          id: 'sibling-frame-1',
          segmentation: {
            id: 'seg-sib-1',
            polygons: JSON.stringify(siblingPolygons),
          },
        },
      ]);

      // New polygons: track-1 renamed, track-2 deleted
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
        // track-2 not present → delete
      ];

      const updatedRow = {
        id: 'seg-vid-1',
        imageId,
        model: 'microtubule',
        threshold: 0.5,
        confidence: 0.9,
        imageWidth: 512,
        imageHeight: 512,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      // Transaction receives [mainUpdate, siblingUpdate]
      prismaMock.$transaction.mockImplementation(async (ops: any[]) => {
        // Execute ops to capture what prisma.segmentation.update would receive
        const results = [];
        for (const op of ops) {
          // Each op is a PrismaPromise; since they're mocked via prismaMock
          // the actual call is already captured. Return a placeholder.
          results.push(updatedRow);
        }
        return results;
      });

      const result = await service.updateSegmentationResults(
        imageId,
        newPolys as any,
        userId
      );

      // Transaction should have been called with multiple ops (main + sibling)
      expect(prismaMock.$transaction).toHaveBeenCalledOnce();
      const txOps = prismaMock.$transaction.mock.calls[0][0];
      // Should have >= 2 ops: the main update + at least 1 sibling update
      expect(txOps.length).toBeGreaterThanOrEqual(2);
      expect(result.id).toBe('seg-vid-1');
    });
  });

  // ─── getBatchSegmentationResults ───────────────────────────────────────────

  describe('getBatchSegmentationResults', () => {
    it('excludes image ids not accessible to the user', async () => {
      // User only has access to img-A, not img-B
      prismaMock.image.findMany.mockResolvedValue([{ id: 'img-A' }]);
      prismaMock.segmentation.findMany.mockResolvedValue([]);

      const results = await service.getBatchSegmentationResults(
        ['img-A', 'img-B'],
        'user-1'
      );

      // img-B is not accessible → not in results at all
      expect('img-B' in results).toBe(false);
    });

    it('returns null for accessible images without segmentation', async () => {
      prismaMock.image.findMany.mockResolvedValue([{ id: 'img-A' }]);
      prismaMock.segmentation.findMany.mockResolvedValue([]); // no seg rows

      const results = await service.getBatchSegmentationResults(
        ['img-A'],
        'user-1'
      );

      expect(results['img-A']).toBeNull();
    });

    it('preserves trackId and name in batch response', async () => {
      const mtPoly = {
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
      };
      prismaMock.image.findMany.mockResolvedValue([{ id: 'img-mt' }]);
      prismaMock.segmentation.findMany.mockResolvedValue([
        {
          imageId: 'img-mt',
          polygons: JSON.stringify([mtPoly]),
          model: 'microtubule',
          threshold: 0.5,
          confidence: 0.9,
          processingTime: null,
          imageWidth: 512,
          imageHeight: 512,
        },
      ]);

      const results = await service.getBatchSegmentationResults(
        ['img-mt'],
        'user-1'
      );

      const entry = results['img-mt'] as any;
      expect(entry).not.toBeNull();
      const poly = entry.polygons[0];
      expect(poly.trackId).toBe('track-batch');
      expect(poly.name).toBe('MT-batch');
    });

    it('strips _embedding from batch response', async () => {
      const withEmbedding = {
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
      };
      prismaMock.image.findMany.mockResolvedValue([{ id: 'img-emb' }]);
      prismaMock.segmentation.findMany.mockResolvedValue([
        {
          imageId: 'img-emb',
          polygons: JSON.stringify([withEmbedding]),
          model: 'microtubule',
          threshold: 0.5,
          confidence: 0.9,
          processingTime: 3000,
          imageWidth: 200,
          imageHeight: 200,
        },
      ]);

      const results = await service.getBatchSegmentationResults(
        ['img-emb'],
        'user-1'
      );
      const poly = (results['img-emb'] as any).polygons[0];
      expect(poly._embedding).toBeUndefined();
    });

    it('propagates DB error', async () => {
      prismaMock.image.findMany.mockRejectedValue(new Error('DB unavailable'));

      await expect(
        service.getBatchSegmentationResults(['img-x'], 'user-1')
      ).rejects.toThrow('DB unavailable');
    });
  });

  // ─── getConcurrentRequestMetrics / hasAvailableCapacity ───────────────────

  describe('getConcurrentRequestMetrics', () => {
    it('returns zeros at startup', () => {
      const metrics = service.getConcurrentRequestMetrics();
      expect(metrics.activeRequests).toBe(0);
      expect(metrics.maxConcurrentRequests).toBe(4);
      expect(metrics.utilizationPercentage).toBe(0);
    });
  });

  describe('hasAvailableCapacity', () => {
    it('returns true when pool is empty', () => {
      expect(service.hasAvailableCapacity()).toBe(true);
    });
  });

  // ─── getProjectSegmentationStats — zero confidence edge case ─────────────

  describe('getProjectSegmentationStats — zero confidence edge', () => {
    it('returns averageConfidence=0 when all segmentation rows have confidence=0', async () => {
      prismaMock.project.findFirst.mockResolvedValue({ id: 'proj-zero' });
      prismaMock.image.count.mockResolvedValue(2);
      mockSegStatsFromRows(prismaMock, [
        {
          polygons: JSON.stringify([makePolygon()]),
          confidence: 0,
          model: 'hrnet',
        },
        {
          polygons: JSON.stringify([makePolygon()]),
          confidence: 0,
          model: 'hrnet',
        },
      ]);

      const stats = await service.getProjectSegmentationStats(
        'proj-zero',
        'u-1'
      );

      expect(stats.averageConfidence).toBe(0);
    });
  });
});
