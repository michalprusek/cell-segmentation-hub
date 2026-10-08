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
 *   - trackPolylineMatches     — "this frame already holds it" for propagate
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
  trackPolylineMatches,
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

  it('keeps the type label the frame already had for that track', () => {
    // The label is resolved from EACH frame's own polygon (panel, canvas
    // colour, metrics export) and the request does not carry it, so a rewrite
    // that dropped it un-typed the microtubule on every later frame.
    const existing = [
      poly('t1', { mtType: 'label-dynamic' }),
      poly('t2', { mtType: 'label-other' }),
    ];
    const out = upsertTrackPolyline(existing, 't1', source, () => 'id');
    const t1 = out.find(p => (p as { trackId?: string }).trackId === 't1');
    expect((t1 as { mtType?: string }).mtType).toBe('label-dynamic');
  });

  it('writes no type label when the frame had none for that track', () => {
    const out = upsertTrackPolyline(
      [poly('t2', { mtType: 'label-other' })],
      't1',
      source,
      () => 'id'
    );
    const t1 = out.find(p => (p as { trackId?: string }).trackId === 't1');
    expect('mtType' in (t1 as object)).toBe(false);
  });
});

describe('trackPolylineMatches', () => {
  // The fixture BENDS and no two points share a coordinate with their
  // neighbour: a compare of the length alone, of the first point alone, or of
  // x without y cannot tell the variants below apart from the original.
  const bent: PropagatedPolyline = {
    trackId: 't1',
    instanceId: 'mt_abc',
    name: 'MT-A',
    geometry: 'polyline',
    points: [
      { x: 10, y: 40 },
      { x: 25.5, y: 31.25 },
      { x: 48, y: 36 },
      { x: 60.75, y: 12 },
    ],
  };
  /** What `upsertTrackPolyline` leaves on a frame for `bent`. */
  const held = (over: Record<string, unknown> = {}) => ({
    ...(upsertTrackPolyline([], 't1', bent, () => 'kept-id')[0] as object),
    ...over,
  });
  const movePoint = (index: number, to: { x: number; y: number }) =>
    bent.points.map((pt, i) => (i === index ? to : pt));

  it('is true for a frame holding exactly what the upsert would write', () => {
    expect(trackPolylineMatches([held()], 't1', bent)).toBe(true);
  });

  it('ignores the frame\u2019s other tracks and fields the upsert does not send', () => {
    const others = [
      { id: 'o', trackId: 't2', geometry: 'polyline', points: [] },
      held({ id: 'another-id', mtType: 'label-1', confidence: 0.4 }),
    ];
    expect(trackPolylineMatches(others, 't1', bent)).toBe(true);
  });

  it.each([
    ['the last point', 3, { x: 60.75, y: 13 }],
    ['a middle point', 1, { x: 25.5, y: 31.5 }],
    ['only the x of a middle point', 2, { x: 48.5, y: 36 }],
    ['the first point', 0, { x: 11, y: 40 }],
  ])('is false when %s moved', (_what, index, to) => {
    const moved = { ...bent, points: movePoint(index, to) };
    expect(trackPolylineMatches([held()], 't1', moved)).toBe(false);
  });

  it('is false when the polyline gained or lost a point', () => {
    const longer = { ...bent, points: [...bent.points, { x: 70, y: 5 }] };
    const shorter = { ...bent, points: bent.points.slice(0, 3) };
    expect(trackPolylineMatches([held()], 't1', longer)).toBe(false);
    expect(trackPolylineMatches([held()], 't1', shorter)).toBe(false);
  });

  it('is false when the name differs, in either direction', () => {
    expect(
      trackPolylineMatches([held()], 't1', { ...bent, name: 'MT-renamed' })
    ).toBe(false);
    expect(trackPolylineMatches([held()], 't1', { ...bent, name: null })).toBe(
      false
    );
    expect(trackPolylineMatches([held({ name: undefined })], 't1', bent)).toBe(
      false
    );
  });

  it('is false when the instanceId differs', () => {
    expect(
      trackPolylineMatches([held()], 't1', { ...bent, instanceId: 'mt_zzz' })
    ).toBe(false);
    expect(
      trackPolylineMatches([held({ instanceId: undefined })], 't1', bent)
    ).toBe(false);
  });

  it('treats a missing name and an empty one as the same "none"', () => {
    const unnamed = { ...bent, name: '' };
    expect(
      trackPolylineMatches([held({ name: undefined })], 't1', unnamed)
    ).toBe(true);
  });

  it('is false when the stored shape is a closed polygon', () => {
    expect(
      trackPolylineMatches([held({ geometry: 'polygon' })], 't1', bent)
    ).toBe(false);
    // Absent geometry means 'polygon' on a stored row.
    expect(
      trackPolylineMatches([held({ geometry: undefined })], 't1', bent)
    ).toBe(false);
  });

  it('is false when the frame holds the track TWICE, even if both are identical', () => {
    // The upsert collapses duplicates to one, so this frame would change.
    expect(trackPolylineMatches([held(), held()], 't1', bent)).toBe(false);
  });

  it('is false when the frame does not hold the track', () => {
    expect(trackPolylineMatches([], 't1', bent)).toBe(false);
    expect(trackPolylineMatches([held({ trackId: 't2' })], 't1', bent)).toBe(
      false
    );
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
      segmentation: {
        update: vi.fn(x => x),
        create: vi.fn(x => x),
        findUnique: vi.fn(),
      },
      // `findUnique` is the static-share channel lookup in
      // `updateSegmentationResults`; undefined container => not shared, which is
      // what every fixture in this file is.
      image: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(x => x),
      },
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
      expect(res).toMatchObject({
        framesUpdated: 2,
        framesChanged: 2,
        framesUnchanged: 0,
        framesSkipped: 0,
      });
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
      // Only the good frame is written; the corrupt frame is left untouched —
      // and REPORTED, so the editor cannot read it as "nothing to change".
      expect(res).toMatchObject({
        framesUpdated: 1,
        framesChanged: 1,
        framesUnchanged: 0,
        framesSkipped: 1,
      });
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
      // The microtubule now appears in the previously-empty frame. A created
      // row is a change.
      expect(res).toMatchObject({ framesUpdated: 1, framesChanged: 1 });
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
      expect(res).toMatchObject({
        framesUpdated: 0,
        framesChanged: 0,
        framesUnchanged: 0,
        framesSkipped: 0,
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    // --- frames that already hold the polyline (2026-10-08) ----------------
    //
    // Every frame used to be rewritten whatever it held, so a second press of
    // "propagate" reported the full frame count again. `bent` has four points
    // that share no coordinate with a neighbour, so a compare of the length,
    // of the first point, or of x without y cannot pass these by accident.
    const bent = {
      trackId: 't7',
      instanceId: 'mt_abc',
      name: 'MT7',
      geometry: 'polyline' as const,
      points: [
        { x: 10, y: 40 },
        { x: 25.5, y: 31.25 },
        { x: 48, y: 36 },
        { x: 60.75, y: 12 },
      ],
    };
    /** The polygon a previous propagate of `bent` left on a frame. */
    const heldBent = (over: Record<string, unknown> = {}) => ({
      id: 'kept-id',
      trackId: 't7',
      type: 'external',
      geometry: 'polyline',
      points: bent.points.map(pt => ({ ...pt })),
      area: 0,
      confidence: 1,
      name: 'MT7',
      instanceId: 'mt_abc',
      ...over,
    });

    it('writes NOTHING when every following frame already holds the polyline', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f1', segmentation: seg('1', [line('other'), heldBent()]) },
        { id: 'f2', segmentation: seg('2', [heldBent({ mtType: 'label-1' })]) },
      ]);

      const res = await service.propagateTrackGeometryForward(
        'vid',
        0,
        bent,
        'user'
      );

      expect(res).toEqual({
        trackId: 't7',
        framesUpdated: 2, // the microtubule IS on both frames
        framesChanged: 0,
        framesUnchanged: 2,
        framesSkipped: 0,
      });
      // No row touched: no rewrite (which would mint a new polygon id and bump
      // updatedAt), no create, and no transaction opened for an empty batch.
      expect(prismaMock.segmentation.update).not.toHaveBeenCalled();
      expect(prismaMock.segmentation.create).not.toHaveBeenCalled();
      expect(prismaMock.image.update).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rewrites only the frames that differ, and counts each kind', async () => {
      const moved = heldBent({
        points: bent.points.map((pt, i) => (i === 3 ? { x: 60.75, y: 13 } : pt)),
      });
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'same', segmentation: seg('same', [heldBent()]) },
        { id: 'moved', segmentation: seg('moved', [moved]) },
        { id: 'absent', segmentation: seg('absent', [line('other')]) },
        { id: 'norow', width: 64, height: 64, segmentation: null },
        { id: 'bad', segmentation: { id: 'seg-bad', polygons: '{not json' } },
      ]);

      const res = await service.propagateTrackGeometryForward(
        'vid',
        0,
        bent,
        'user'
      );

      expect(res).toEqual({
        trackId: 't7',
        framesUpdated: 4, // same + moved + absent + norow
        framesChanged: 3, // moved + absent rewritten, norow created
        framesUnchanged: 1,
        framesSkipped: 1,
      });
      expect(
        prismaMock.segmentation.update.mock.calls.map(
          (c: any) => c[0].where.id
        )
      ).toEqual(['seg-moved', 'seg-absent']);
      expect(prismaMock.segmentation.create).toHaveBeenCalledTimes(1);
      // The rewritten frame ends with the NEW last point.
      expect(
        writtenPolys(prismaMock.segmentation.update.mock.calls[0]).find(
          p => p.trackId === 't7'
        ).points
      ).toEqual(bent.points);
      // One transaction carrying exactly the changed frames' operations:
      // 2 updates + 1 create + its status flip.
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.$transaction.mock.calls[0][0]).toHaveLength(4);
    });

    it.each([
      ['name', { name: 'MT7-old' }],
      ['instanceId', { instanceId: 'mt_old' }],
    ])(
      'still writes a frame whose geometry matches but whose %s differs',
      async (_field, over) => {
        prismaMock.image.findMany.mockResolvedValue([
          { id: 'f1', segmentation: seg('1', [heldBent(over)]) },
        ]);
        const res = await service.propagateTrackGeometryForward(
          'vid',
          0,
          bent,
          'user'
        );
        expect(res).toMatchObject({ framesChanged: 1, framesUnchanged: 0 });
        const written = writtenPolys(
          prismaMock.segmentation.update.mock.calls[0]
        ).find(p => p.trackId === 't7');
        expect(written).toMatchObject({ name: 'MT7', instanceId: 'mt_abc' });
      }
    );

    it('collapses a frame holding the track twice, and counts it as changed', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        {
          id: 'f1',
          segmentation: seg('1', [heldBent(), heldBent({ id: 'dup' })]),
        },
      ]);
      const res = await service.propagateTrackGeometryForward(
        'vid',
        0,
        bent,
        'user'
      );
      expect(res).toMatchObject({ framesChanged: 1, framesUnchanged: 0 });
      expect(
        writtenPolys(prismaMock.segmentation.update.mock.calls[0]).filter(
          p => p.trackId === 't7'
        )
      ).toHaveLength(1);
    });

    it('logs how many frames were left alone', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f1', segmentation: seg('1', [heldBent()]) },
      ]);
      await service.propagateTrackGeometryForward('vid', 0, bent, 'user');
      expect(logger.info).toHaveBeenCalledWith(
        'Propagated microtubule track forward',
        'SegmentationService',
        expect.objectContaining({
          framesRewritten: 0,
          framesCreated: 0,
          framesUnchanged: 1,
          corruptFramesSkipped: 0,
        })
      );
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

  describe('propagateTracksGeometryForward (batch)', () => {
    // Bent, and different per track, so one polyline cannot stand in for
    // another and a swapped x/y would show.
    const bent = (trackId: string | undefined, dx: number) => ({
      geometry: 'polyline' as const,
      trackId,
      instanceId: `inst-${dx}`,
      points: [
        { x: 5 + dx, y: 5 },
        { x: 6 + dx, y: 7.5 },
        { x: 9 + dx, y: 8 },
      ],
    });
    /** What a frame holds, without the per-polygon ids uuid mints. */
    const shape = (polys: any[]) =>
      polys.map(({ id: _id, ...rest }) => rest);

    it('writes each frame ONCE however many microtubules are sent', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f1', segmentation: seg('1', [line('other')]) },
        { id: 'f2', segmentation: seg('2', [line('a')]) },
        { id: 'f3', segmentation: seg('3', []) },
      ]);

      const res = await service.propagateTracksGeometryForward(
        'vid',
        0,
        [bent('a', 0), bent('b', 10), bent('c', 20)],
        'user'
      );

      expect(prismaMock.image.findMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.segmentation.update).toHaveBeenCalledTimes(3);
      expect(res.map(r => r.trackId)).toEqual(['a', 'b', 'c']);
      for (const call of prismaMock.segmentation.update.mock.calls) {
        const polys = writtenPolys(call);
        for (const [trackId, dx] of [
          ['a', 0],
          ['b', 10],
          ['c', 20],
        ] as const) {
          const held = polys.filter(p => p.trackId === trackId);
          expect(held).toHaveLength(1);
          expect(held[0].points).toEqual(bent(trackId, dx).points);
        }
      }
      // The unrelated track on f1 survives all three upserts.
      expect(
        writtenPolys(prismaMock.segmentation.update.mock.calls[0]).some(
          p => p.trackId === 'other'
        )
      ).toBe(true);
    });

    it('stores exactly what one call per microtubule stored', async () => {
      const initial: Record<string, unknown[]> = {
        f1: [line('other'), { ...line('a'), mtType: 'label-1' }],
        f2: [line('b'), line('b')],
        f3: [],
      };
      const polylines = [bent('a', 0), bent('b', 10), bent('c', 20)];

      // The loop the editor used to run: every call re-reads what the
      // previous one wrote. Run here through the single-track method, itself
      // now a batch of one — so this proves a batch of N equals N batches of
      // one, and the single-track suite above pins what a batch of one does.
      const state: Record<string, string> = Object.fromEntries(
        Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)])
      );
      prismaMock.image.findMany.mockImplementation(async () =>
        Object.keys(state).map(k => ({
          id: k,
          segmentation: { id: k, polygons: state[k] },
        }))
      );
      prismaMock.segmentation.update.mockImplementation((arg: any) => {
        state[arg.where.id] = arg.data.polygons;
        return arg;
      });
      const looped = [];
      for (const polyline of polylines) {
        looped.push(
          await service.propagateTrackGeometryForward('vid', 0, polyline, 'user')
        );
      }
      const afterLoop = Object.fromEntries(
        Object.entries(state).map(([k, v]) => [k, shape(JSON.parse(v))])
      );

      for (const [k, v] of Object.entries(initial)) {
        state[k] = JSON.stringify(v);
      }
      const batched = await service.propagateTracksGeometryForward(
        'vid',
        0,
        polylines,
        'user'
      );
      const afterBatch = Object.fromEntries(
        Object.entries(state).map(([k, v]) => [k, shape(JSON.parse(v))])
      );

      expect(afterBatch).toEqual(afterLoop);
      expect(batched).toEqual(looped);
      // The type label a track carried on a later frame is still there.
      expect(
        afterBatch.f1?.find((p: any) => p.trackId === 'a')?.mtType
      ).toBe('label-1');
    });

    it('counts per microtubule, and leaves a frame that holds them all unwritten', async () => {
      const a = bent('a', 0);
      const b = bent('b', 10);
      const stored = (p: typeof a) => ({ id: 'x', type: 'external', ...p });
      prismaMock.image.findMany.mockResolvedValue([
        // Holds both already: no write.
        { id: 'f1', segmentation: seg('1', [stored(a), stored(b)]) },
        // Holds only `a`: written once, for `b`.
        { id: 'f2', segmentation: seg('2', [stored(a)]) },
        { id: 'bad', segmentation: { id: 'seg-bad', polygons: '{not json' } },
      ]);

      const res = await service.propagateTracksGeometryForward(
        'vid',
        0,
        [a, b],
        'user'
      );

      expect(res).toEqual([
        {
          trackId: 'a',
          framesUpdated: 2,
          framesChanged: 0,
          framesUnchanged: 2,
          framesSkipped: 1,
        },
        {
          trackId: 'b',
          framesUpdated: 2,
          framesChanged: 1,
          framesUnchanged: 1,
          framesSkipped: 1,
        },
      ]);
      expect(prismaMock.segmentation.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.segmentation.update.mock.calls[0][0].where.id).toBe(
        'seg-2'
      );
    });

    it('creates ONE row carrying every microtubule for a frame that has none', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f1', width: 512, height: 512, segmentation: null },
      ]);

      const res = await service.propagateTracksGeometryForward(
        'vid',
        0,
        [bent(undefined, 0), bent(undefined, 10)],
        'user'
      );

      expect(prismaMock.segmentation.create).toHaveBeenCalledTimes(1);
      const created = JSON.parse(
        prismaMock.segmentation.create.mock.calls[0][0].data.polygons
      );
      expect(created).toHaveLength(2);
      // Each untracked source gets its OWN minted id.
      expect(res[0]?.trackId).toMatch(/^mt_[0-9a-f]{8}$/);
      expect(res[1]?.trackId).toMatch(/^mt_[0-9a-f]{8}$/);
      expect(res[0]?.trackId).not.toBe(res[1]?.trackId);
      expect(created.map((p: any) => p.trackId)).toEqual(
        res.map(r => r.trackId)
      );
      expect(res.map(r => r.framesChanged)).toEqual([1, 1]);
    });

    it('counts a repeated track on a frame with no row as it did when each was its own request', async () => {
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f1', width: 512, height: 512, segmentation: null },
      ]);
      const res = await service.propagateTracksGeometryForward(
        'vid',
        0,
        [bent('a', 0), bent('a', 0)],
        'user'
      );
      // The second is the same track and shape the first just put there.
      expect(res.map(r => [r.framesChanged, r.framesUnchanged])).toEqual([
        [1, 0],
        [0, 1],
      ]);
      expect(
        JSON.parse(prismaMock.segmentation.create.mock.calls[0][0].data.polygons)
      ).toHaveLength(1);
    });

    it('refuses a non-finite coordinate before reading any frame', async () => {
      // With no following frame `upsertTrackPolyline` never runs, so without
      // the up-front check this answered 200 with zero counts.
      prismaMock.image.findMany.mockResolvedValue([]);
      await expect(
        service.propagateTracksGeometryForward(
          'vid',
          0,
          [
            bent('a', 0),
            {
              geometry: 'polyline',
              points: [
                { x: 1, y: 1 },
                { x: Number.NaN, y: 2 },
              ],
            },
          ],
          'user'
        )
      ).rejects.toThrow('at least 2 finite points');
      expect(prismaMock.image.findMany).not.toHaveBeenCalled();
    });

    it('refuses the whole batch for one degenerate polyline, before reading any frame', async () => {
      await expect(
        service.propagateTracksGeometryForward(
          'vid',
          0,
          [bent('a', 0), { geometry: 'polyline', points: [{ x: 1, y: 1 }] }],
          'user'
        )
      ).rejects.toThrow('at least 2 points');
      expect(prismaMock.image.findMany).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
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

  describe('deleteTrackFromFrame', () => {
    it('removes the track from THIS frame only and never scans siblings', async () => {
      prismaMock.segmentation.findUnique.mockResolvedValue(
        seg('f1', [line('t1'), line('t2'), line('t1')])
      );

      const res = await service.deleteTrackFromFrame('f1', 't1', 'user');

      expect(res.removed).toBe(2);
      expect(prismaMock.segmentation.update).toHaveBeenCalledTimes(1);
      const polys = writtenPolys(
        prismaMock.segmentation.update.mock.calls[0]
      );
      expect(polys).toHaveLength(1);
      expect(polys[0].trackId).toBe('t2');
      // The whole point of the frame scope: no other frame is even looked at.
      expect(prismaMock.image.findMany).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('writes nothing when the track is not on this frame', async () => {
      prismaMock.segmentation.findUnique.mockResolvedValue(
        seg('f1', [line('t2')])
      );
      const res = await service.deleteTrackFromFrame('f1', 't1', 'user');
      expect(res.removed).toBe(0);
      expect(prismaMock.segmentation.update).not.toHaveBeenCalled();
    });

    it('writes nothing when the frame has no segmentation row', async () => {
      prismaMock.segmentation.findUnique.mockResolvedValue(null);
      const res = await service.deleteTrackFromFrame('f1', 't1', 'user');
      expect(res.removed).toBe(0);
      expect(prismaMock.segmentation.update).not.toHaveBeenCalled();
    });

    it('refuses to write a frame whose stored polygons are unreadable', async () => {
      // Overwriting it with the survivors of an empty parse would silently
      // destroy every other microtubule on the frame.
      prismaMock.segmentation.findUnique.mockResolvedValue({
        id: 'seg-f1',
        polygons: 'not json {[',
      });
      await expect(
        service.deleteTrackFromFrame('f1', 't1', 'user')
      ).rejects.toThrow(/unreadable/i);
      expect(prismaMock.segmentation.update).not.toHaveBeenCalled();
    });

    it('throws VideoAccessError when the frame is not owned', async () => {
      imageServiceMock.getImageById.mockResolvedValue(null);
      await expect(
        service.deleteTrackFromFrame('f1', 't1', 'user')
      ).rejects.toBeInstanceOf(VideoAccessError);
      expect(prismaMock.segmentation.findUnique).not.toHaveBeenCalled();
    });
  });

  // The behaviour the feature exists for, exercised through BOTH methods that
  // produce it — the frame-scoped delete and the save that follows it. Testing
  // `deleteTrackFromFrame` alone would prove nothing: the destruction happens
  // in `updateSegmentationResults`, one layer up.
  describe('a frame-scoped delete survives the next save', () => {
    /**
     * Save frame f1 carrying only t2 (the editor dropped t1 locally), against a
     * video whose siblings f2/f3 both carry t1. `storedPolygonsJson` is what the
     * DB holds for f1 at that moment — the diff baseline, and the whole
     * difference between the two tests below.
     * Returns how many sibling frames the save rewrote.
     */
    const saveFrameWithoutT1 = async (
      storedPolygonsJson: string
    ): Promise<string[]> => {
      imageServiceMock.getImageById.mockResolvedValue({
        id: 'f1',
        parentVideoId: 'vid',
      });
      prismaMock.segmentation.findUnique.mockResolvedValue({
        id: 'seg-f1',
        polygons: storedPolygonsJson,
        imageWidth: 10,
        imageHeight: 10,
      });
      prismaMock.image.findMany.mockResolvedValue([
        { id: 'f2', segmentation: seg('2', [line('t1')]) },
        { id: 'f3', segmentation: seg('3', [line('t1')]) },
      ]);
      prismaMock.$transaction.mockImplementation(async (ops: any[]) => [
        {
          id: 'seg-f1',
          imageId: 'f1',
          model: 'manual',
          threshold: 0.5,
          confidence: 0.9,
          imageWidth: 10,
          imageHeight: 10,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        ...ops.slice(1),
      ]);

      prismaMock.segmentation.update.mockClear();
      await service.updateSegmentationResults(
        'f1',
        [{ ...line('t2'), points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] as any,
        'user'
      );
      // Every update op minus the one for the edited frame itself.
      return prismaMock.segmentation.update.mock.calls
        .map((call: any) => call[0].where.id as string)
        .filter((id: string) => id !== 'seg-f1');
    };

    it('WITHOUT the frame-scoped call, saving purges the track everywhere', async () => {
      // Baseline still carries t1 → `diffTrackOps` reads its absence from the
      // saved polygons as "the user deleted this track" and mirrors it.
      const siblings = await saveFrameWithoutT1(
        JSON.stringify([line('t1'), line('t2')])
      );
      expect(siblings.sort()).toEqual(['seg-2', 'seg-3']);
    });

    it('WITH the frame-scoped call first, the siblings keep the track', async () => {
      // 1. The user picks "this frame only".
      prismaMock.segmentation.findUnique.mockResolvedValue(
        seg('f1', [line('t1'), line('t2')])
      );
      const res = await service.deleteTrackFromFrame('f1', 't1', 'user');
      expect(res.removed).toBe(1);
      const storedAfterDelete =
        prismaMock.segmentation.update.mock.calls[0][0].data.polygons;

      // 2. The editor saves the frame later. The baseline it diffs against is
      //    the row step 1 just wrote, so no delete op is emitted at all.
      const siblings = await saveFrameWithoutT1(storedAfterDelete);
      expect(siblings).toEqual([]);
    });
  });
});
