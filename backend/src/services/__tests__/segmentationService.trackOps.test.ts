/**
 * segmentationService.trackOps.test.ts
 *
 * Cross-frame track-ops coverage, consolidated from the former *.trackOps,
 * *.trackOpsService and *.crossFrame files (plus the duplicated pure-helper
 * blocks that used to live in *.gaps4):
 *
 *  Pure helpers (no I/O):
 *   - extractTrackedPolys      — build trackId → meta map, skip untracked/empty
 *   - diffTrackOps             — rename/delete diff between prev & next frames
 *   - parsePolygonsJsonForDiff — defensive JSON parse for the diff path
 *   - removePolygonsWithTrackId / upsertTrackPolyline — list mutations
 *
 *  Orchestration (mocked Prisma):
 *   - propagateTrackGeometryForward
 *   - deleteTrackAcrossVideo
 *   - setTrackTypeAcrossVideo
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  SegmentationService,
  VideoAccessError,
  extractTrackedPolys,
  diffTrackOps,
  parsePolygonsJsonForDiff,
  removePolygonsWithTrackId,
  upsertTrackPolyline,
  type PropagatedPolyline,
} from '../segmentationService';
import { ImageService } from '../imageService';
import { logger } from '../../utils/logger';

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
vi.mock('../segmentationThumbnailService');
// Plain constructor inside the factory (not a vi.fn) so restoreMocks:true can't
// wipe the body between tests.
vi.mock('../thumbnailManager', () => ({
  ThumbnailManager: function MockThumbnailManager(this: any) {
    this.generateAllThumbnails = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('../imageService');

// ─── shared fixtures ──────────────────────────────────────────────────────────

const polyline = (
  trackId: string | undefined,
  extra: Record<string, unknown> = {}
) => ({
  id: `poly_${Math.random().toString(36).slice(2, 8)}`,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
  ],
  type: 'external',
  geometry: 'polyline',
  ...(trackId !== undefined ? { trackId } : {}),
  ...extra,
});

// ─── pure helpers: extractTrackedPolys / diffTrackOps / parsePolygonsJsonForDiff

describe('cross-frame propagation diff helpers', () => {
  describe('extractTrackedPolys', () => {
    it('skips polygons without trackId and keeps tracked ones', () => {
      const result = extractTrackedPolys([
        polyline(undefined, { name: 'X' }),
        polyline('t1', { name: 'A' }),
      ]);
      expect(result.size).toBe(1);
      expect(result.get('t1')).toMatchObject({ trackId: 't1', name: 'A' });
    });

    it('skips polygons with empty-string trackId (collision risk)', () => {
      const result = extractTrackedPolys([polyline('', { name: 'X' })]);
      expect(result.size).toBe(0);
    });
  });

  describe('diffTrackOps', () => {
    it('emits a rename op when name changes for the same trackId', () => {
      const prev = [polyline('t1', { name: 'MT-A' })];
      const next = [polyline('t1', { name: 'MT-A-renamed' })];
      const { renames, deletes } = diffTrackOps(prev, next);
      expect(deletes.size).toBe(0);
      expect(renames.get('t1')).toMatchObject({
        type: 'rename',
        name: 'MT-A-renamed',
      });
    });

    it('emits a rename op when partClass changes', () => {
      const prev = [polyline('t1', { partClass: 'head' })];
      const next = [polyline('t1', { partClass: 'tail' })];
      const { renames } = diffTrackOps(prev, next);
      expect(renames.get('t1')).toMatchObject({ partClass: 'tail' });
    });

    it('emits a delete when a trackId disappears from new polygons', () => {
      const prev = [
        polyline('t1', { name: 'A' }),
        polyline('t2', { name: 'B' }),
      ];
      const next = [polyline('t1', { name: 'A' })]; // t2 deleted
      const { renames, deletes } = diffTrackOps(prev, next);
      expect(renames.size).toBe(0);
      expect(deletes.has('t2')).toBe(true);
    });

    it('does NOT emit any op when only points change (per-frame geometry)', () => {
      const prev = [
        { ...polyline('t1', { name: 'A' }), points: [{ x: 1, y: 1 }] },
      ];
      const next = [
        { ...polyline('t1', { name: 'A' }), points: [{ x: 99, y: 99 }] },
      ];
      const { renames, deletes } = diffTrackOps(prev, next);
      expect(renames.size).toBe(0);
      expect(deletes.size).toBe(0);
    });

    it('does NOT propagate fresh trackIds (new on this frame only)', () => {
      const prev: unknown[] = [];
      const next = [polyline('t_new', { name: 'fresh' })];
      const { renames, deletes } = diffTrackOps(prev, next);
      expect(renames.size).toBe(0);
      expect(deletes.size).toBe(0);
    });

    it('handles polygons without trackId without crashing', () => {
      const prev = [polyline(undefined), polyline('t1', { name: 'A' })];
      const next = [polyline(undefined), polyline('t1', { name: 'B' })];
      const { renames } = diffTrackOps(prev, next);
      expect(renames.size).toBe(1);
      expect(renames.get('t1')!.name).toBe('B');
    });
  });

  describe('parsePolygonsJsonForDiff', () => {
    const ctx = { currentImageId: 'img1', parentVideoId: 'vid1' };

    it('parses a well-formed JSON array', () => {
      const json = JSON.stringify([polyline('t1', { name: 'A' })]);
      const result = parsePolygonsJsonForDiff(json, ctx);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
    });

    it('returns [] and logs error when JSON is malformed', () => {
      expect(parsePolygonsJsonForDiff('not json {[', ctx)).toEqual([]);
      expect(vi.mocked(logger.error)).toHaveBeenCalled();
    });

    it('returns [] and logs warn when JSON parses to a non-array', () => {
      expect(parsePolygonsJsonForDiff('{"oops": true}', ctx)).toEqual([]);
      expect(vi.mocked(logger.warn)).toHaveBeenCalled();
    });
  });
});

// ─── pure helpers: removePolygonsWithTrackId / upsertTrackPolyline ─────────────

describe('removePolygonsWithTrackId', () => {
  const poly = (trackId: string | undefined, extra: Record<string, unknown> = {}) =>
    polyline(trackId, extra);

  it('removes every polygon carrying the trackId and counts them', () => {
    const polys = [poly('t1'), poly('t2'), poly('t1'), poly(undefined)];
    const { polygons, removed } = removePolygonsWithTrackId(polys, 't1');
    expect(removed).toBe(2);
    expect(polygons).toHaveLength(2);
    expect(
      polygons.every(p => (p as { trackId?: string }).trackId !== 't1')
    ).toBe(true);
  });

  it('leaves the list untouched when the trackId is absent', () => {
    const polys = [poly('t2'), poly(undefined)];
    const { polygons, removed } = removePolygonsWithTrackId(polys, 't1');
    expect(removed).toBe(0);
    expect(polygons).toHaveLength(2);
  });

  it('never matches an empty-string trackId against a real one', () => {
    const polys = [poly('t1'), poly('')];
    const { removed } = removePolygonsWithTrackId(polys, 't1');
    expect(removed).toBe(1);
  });
});

describe('upsertTrackPolyline', () => {
  const poly = (trackId: string | undefined, extra: Record<string, unknown> = {}) =>
    polyline(trackId, extra);

  const source: PropagatedPolyline = {
    trackId: 't1',
    instanceId: 'mt_abc',
    name: 'MT-A',
    geometry: 'polyline',
    points: [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ],
  };

  it('overwrites an existing polyline with the same trackId (no duplicate)', () => {
    const existing = [poly('t1', { name: 'stale' }), poly('t2')];
    let n = 0;
    const out = upsertTrackPolyline(existing, 't1', source, () => `new_${n++}`);
    const t1s = out.filter(p => (p as { trackId?: string }).trackId === 't1');
    expect(t1s).toHaveLength(1); // overwritten, not duplicated
    expect(out).toHaveLength(2); // t1 (replaced) + t2 (untouched)
    const added = t1s[0] as Record<string, unknown>;
    expect(added.id).toBe('new_0'); // fresh id, not the stale one
    expect(added.points).toEqual(source.points);
    expect(added.name).toBe('MT-A');
    expect(added.geometry).toBe('polyline');
    expect(added.type).toBe('external');
    // instanceId carried so the export viz/metrics can label the copy.
    expect(added.instanceId).toBe('mt_abc');
  });

  it('adds the polyline when the frame does not have that track yet', () => {
    const existing = [poly('t2')];
    const out = upsertTrackPolyline(existing, 't1', source, () => 'fresh');
    expect(out).toHaveLength(2);
    expect(out.some(p => (p as { trackId?: string }).trackId === 't1')).toBe(
      true
    );
  });

  it('deep-copies points so later edits do not alias the source', () => {
    const out = upsertTrackPolyline([], 't1', source, () => 'id');
    const added = out[0] as { points: Array<{ x: number; y: number }> };
    added.points[0].x = 999;
    expect(source.points[0].x).toBe(1); // source untouched
  });

  it('omits the name field when the source has none', () => {
    const noName: PropagatedPolyline = {
      trackId: 't9',
      geometry: 'polyline',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    const out = upsertTrackPolyline([], 't9', noName, () => 'id');
    expect('name' in (out[0] as object)).toBe(false);
  });
});

// ─── orchestration: propagate / delete / setType (mocked Prisma) ──────────────

const seg = (id: string, polygons: unknown[]) => ({
  id: `seg-${id}`,
  polygons: JSON.stringify(polygons),
});
const line = (trackId?: string) => ({
  id: `p-${Math.random().toString(36).slice(2, 7)}`,
  type: 'external',
  geometry: 'polyline',
  points: [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ],
  ...(trackId ? { trackId } : {}),
});

/** Parse the polygons JSON written by a given segmentation.update mock call. */
const writtenPolys = (call: any): any[] => JSON.parse(call[0].data.polygons);

describe('SegmentationService track ops (orchestration)', () => {
  let service: SegmentationService;
  let prismaMock: any;
  let imageServiceMock: any;

  beforeEach(() => {
    prismaMock = {
      segmentation: { update: vi.fn(x => x), create: vi.fn(x => x) },
      image: { findMany: vi.fn(), update: vi.fn(x => x) },
      $transaction: vi.fn().mockResolvedValue([]),
    };
    imageServiceMock = { getImageById: vi.fn() };
    service = new SegmentationService(
      prismaMock as PrismaClient,
      imageServiceMock as ImageService
    );
    // getImageById returns a truthy container by default (owned).
    imageServiceMock.getImageById.mockResolvedValue({
      id: 'vid',
      isVideoContainer: true,
    });
  });

  describe('propagateTrackGeometryForward', () => {
    const srcPolyline = {
      geometry: 'polyline' as const,
      points: [
        { x: 5, y: 5 },
        { x: 6, y: 7 },
        { x: 8, y: 9 },
      ],
    };

    it('generates one mt_<hex> trackId and writes it identically into every following frame', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f1', segmentation: seg('1', [line('other')]) },
        { id: 'f2', segmentation: seg('2', []) },
      ]);

      const res = await service.propagateTrackGeometryForward(
        'vid',
        0,
        { ...srcPolyline, trackId: undefined },
        'user'
      );

      expect(res.trackId).toMatch(/^mt_[0-9a-f]{8}$/);
      expect(res.framesUpdated).toBe(2);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

      // Every written frame carries the SAME generated trackId on the new line.
      const calls = prismaMock.segmentation.update.mock.calls;
      expect(calls).toHaveLength(2);
      for (const call of calls) {
        const added = writtenPolys(call).filter(p => p.trackId === res.trackId);
        expect(added).toHaveLength(1);
        expect(added[0].points).toEqual(srcPolyline.points);
      }
      // Frame f1's unrelated 'other' track is preserved (not clobbered).
      expect(writtenPolys(calls[0]).some(p => p.trackId === 'other')).toBe(true);
    });

    it('reuses the source trackId when it already has one', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f1', segmentation: seg('1', [line('t7')]) },
      ]);
      const res = await service.propagateTrackGeometryForward(
        'vid',
        0,
        { ...srcPolyline, trackId: 't7' },
        'user'
      );
      expect(res.trackId).toBe('t7');
      // Overwrite: the frame ends with exactly one 't7' line (no duplicate).
      expect(
        writtenPolys(prismaMock.segmentation.update.mock.calls[0]).filter(
          p => p.trackId === 't7'
        )
      ).toHaveLength(1);
    });

    it('skips a corrupt-JSON frame instead of clobbering it', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'good', segmentation: seg('good', [line('a'), line('b')]) },
        { id: 'bad', segmentation: { id: 'seg-bad', polygons: '{not json' } },
      ]);
      const res = await service.propagateTrackGeometryForward(
        'vid',
        0,
        { ...srcPolyline, trackId: 'x' },
        'user'
      );
      // Only the good frame is written; the corrupt frame is left untouched.
      expect(res.framesUpdated).toBe(1);
      expect(prismaMock.segmentation.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.segmentation.update.mock.calls[0][0].where.id).toBe(
        'seg-good'
      );
    });

    it('creates a segmentation row (+ marks segmented) for a frame that has none', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f1', width: 512, height: 512, segmentation: null },
      ]);
      const res = await service.propagateTrackGeometryForward(
        'vid',
        0,
        { ...srcPolyline, trackId: 't' },
        'user'
      );
      // The microtubule now appears in the previously-empty frame.
      expect(res.framesUpdated).toBe(1);
      expect(prismaMock.segmentation.update).not.toHaveBeenCalled();
      // A new segmentation row was created carrying just the propagated line...
      expect(prismaMock.segmentation.create).toHaveBeenCalledTimes(1);
      const created = prismaMock.segmentation.create.mock.calls[0][0].data;
      const polys = JSON.parse(created.polygons);
      expect(polys).toHaveLength(1);
      expect(polys[0].trackId).toBe('t');
      expect(created.imageWidth).toBe(512);
      // ...and the frame was marked segmented, all in one transaction.
      expect(
        prismaMock.image.update.mock.calls[0][0].data.segmentationStatus
      ).toBe('segmented');
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('does not open a transaction when there are no following frames', async () => {
      prismaMock.image.findMany.mockResolvedValue([]);
      const res = await service.propagateTrackGeometryForward(
        'vid',
        99,
        { ...srcPolyline, trackId: 't' },
        'user'
      );
      expect(res.framesUpdated).toBe(0);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('throws VideoAccessError when the video is not owned', async () => {
      imageServiceMock.getImageById.mockResolvedValue(null);
      await expect(
        service.propagateTrackGeometryForward('vid', 0, srcPolyline, 'user')
      ).rejects.toBeInstanceOf(VideoAccessError);
    });

    it('throws on a degenerate (<2 point) polyline', async () => {
      await expect(
        service.propagateTrackGeometryForward(
          'vid',
          0,
          { geometry: 'polyline', points: [{ x: 1, y: 1 }] },
          'user'
        )
      ).rejects.toThrow(/at least 2/);
    });
  });

  describe('deleteTrackAcrossVideo', () => {
    it('removes the track from exactly the frames that carry it', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f1', segmentation: seg('1', [line('t1'), line('t2')]) },
        { id: 'f2', segmentation: seg('2', [line('t2')]) }, // no t1 → untouched
        { id: 'f3', segmentation: seg('3', [line('t1')]) },
        { id: 'f4', segmentation: null },
      ]);
      const res = await service.deleteTrackAcrossVideo('vid', 't1', 'user');
      expect(res.framesAffected).toBe(2); // f1 + f3
      expect(prismaMock.segmentation.update).toHaveBeenCalledTimes(2);
      // t1 is gone from every written frame; t2 survives.
      for (const call of prismaMock.segmentation.update.mock.calls) {
        const polys = writtenPolys(call);
        expect(polys.some(p => p.trackId === 't1')).toBe(false);
      }
    });

    it('throws VideoAccessError when the video is not owned', async () => {
      imageServiceMock.getImageById.mockResolvedValue(null);
      await expect(
        service.deleteTrackAcrossVideo('vid', 't1', 'user')
      ).rejects.toBeInstanceOf(VideoAccessError);
    });
  });

  describe('setTrackTypeAcrossVideo', () => {
    it('sets mtType on exactly the frames carrying a selected track', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f1', segmentation: seg('1', [line('t1'), line('t2')]) },
        { id: 'f2', segmentation: seg('2', [line('t2')]) }, // no t1 → untouched
        { id: 'f3', segmentation: seg('3', [line('t1')]) },
        { id: 'f4', segmentation: null },
      ]);
      const res = await service.setTrackTypeAcrossVideo(
        'vid',
        ['t1'],
        'mt_type_x',
        'user'
      );
      expect(res.framesAffected).toBe(2); // f1 + f3
      expect(prismaMock.segmentation.update).toHaveBeenCalledTimes(2);
      for (const call of prismaMock.segmentation.update.mock.calls) {
        const polys = writtenPolys(call);
        expect(
          polys
            .filter(p => p.trackId === 't1')
            .every(p => p.mtType === 'mt_type_x')
        ).toBe(true);
        // A different track on the same frame keeps no mtType.
        expect(
          polys.filter(p => p.trackId === 't2').every(p => !p.mtType)
        ).toBe(true);
      }
    });

    it('returns 0 and does not scan for an empty trackIds list', async () => {
      const res = await service.setTrackTypeAcrossVideo(
        'vid',
        [],
        'mt_type_x',
        'user'
      );
      expect(res.framesAffected).toBe(0);
      expect(prismaMock.image.findMany).not.toHaveBeenCalled();
    });

    it('clears mtType when passed null', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        {
          id: 'f1',
          segmentation: seg('1', [{ ...line('t1'), mtType: 'mt_type_x' }]),
        },
      ]);
      const res = await service.setTrackTypeAcrossVideo(
        'vid',
        ['t1'],
        null,
        'user'
      );
      expect(res.framesAffected).toBe(1);
      const polys = writtenPolys(prismaMock.segmentation.update.mock.calls[0]);
      expect(polys[0].mtType).toBeUndefined();
    });

    it('throws VideoAccessError when the video is not owned', async () => {
      imageServiceMock.getImageById.mockResolvedValue(null);
      await expect(
        service.setTrackTypeAcrossVideo('vid', ['t1'], 'mt_type_x', 'user')
      ).rejects.toBeInstanceOf(VideoAccessError);
    });
  });
});
