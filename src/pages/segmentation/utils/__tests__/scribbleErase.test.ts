/**
 * Hit-testing of the delete tool's scribble against the shapes on the canvas.
 *
 * Modelled on Excalidraw's eraser (`packages/excalidraw/eraser/index.ts` @
 * b42b1a19): each pointer move tests the NEWEST scribble segment, a filled
 * shape is hit from inside or by its outline, a line by segment distance.
 *
 * Coordinates are image units; the tolerance passed in is already
 * `SCRIBBLE_HIT_TOLERANCE_PX / zoom`, which is how the editor calls it.
 */
import { describe, it, expect } from 'vitest';
import type { Point, Polygon } from '@/lib/segmentation';
import {
  SCRIBBLE_HIT_TOLERANCE_PX,
  collectScribbleHits,
  prepareScribbleCandidates,
  scribbleSegmentHits,
  segmentDistance,
} from '../scribbleErase';

const p = (x: number, y: number): Point => ({ x, y });

const polyline = (id: string, points: Point[]): Polygon =>
  ({ id, points, type: 'external', geometry: 'polyline' }) as Polygon;

const square = (
  id: string,
  min: number,
  max: number,
  extra: Partial<Polygon> = {}
): Polygon =>
  ({
    id,
    points: [p(min, min), p(max, min), p(max, max), p(min, max)],
    type: 'external',
    geometry: 'polygon',
    ...extra,
  }) as Polygon;

const TOL = 6;

/** The candidate built for `id` out of `polygons`. */
const candidate = (polygons: Polygon[], id: string) => {
  const c = prepareScribbleCandidates(polygons).find(x => x.id === id);
  if (!c) throw new Error(`no candidate ${id}`);
  return c;
};

describe('scribbleErase', () => {
  const line = polyline('mt', [p(0, 50), p(100, 50)]);

  it('hits a polyline crossed by the segment', () => {
    expect(
      scribbleSegmentHits(candidate([line], 'mt'), p(50, 0), p(50, 100), TOL)
    ).toBe(true);
  });

  it('hits a polyline jumped over between two events', () => {
    // Both ends ~450 px away: only a SEGMENT test can see the crossing. A
    // per-point test — what a DOM hit-test per mousemove amounts to — misses.
    expect(
      scribbleSegmentHits(candidate([line], 'mt'), p(50, -500), p(50, 500), TOL)
    ).toBe(true);
  });

  it('misses a polyline just beyond tolerance', () => {
    const c = candidate([line], 'mt');
    expect(scribbleSegmentHits(c, p(0, 57), p(100, 57), TOL)).toBe(false);
    expect(scribbleSegmentHits(c, p(0, 55), p(100, 55), TOL)).toBe(true);
  });

  it('a click inside a closed polygon hits it', () => {
    const sq = square('sq', 0, 100);
    expect(
      scribbleSegmentHits(candidate([sq], 'sq'), p(50, 50), p(50, 50), TOL)
    ).toBe(true);
  });

  it('a click in a hole hits the hole, not its parent', () => {
    const parent = square('parent', 0, 100);
    const hole = square('hole', 40, 60, {
      type: 'internal',
      parent_id: 'parent',
    });
    const polys = [parent, hole];
    expect(
      scribbleSegmentHits(candidate(polys, 'hole'), p(50, 50), p(50, 50), TOL)
    ).toBe(true);
    expect(
      scribbleSegmentHits(candidate(polys, 'parent'), p(50, 50), p(50, 50), TOL)
    ).toBe(false);
  });

  it('hole without parent_id is still resolved geometrically', () => {
    const parent = square('parent', 0, 100);
    const hole = square('hole', 40, 60, { type: 'internal' });
    expect(
      scribbleSegmentHits(
        candidate([parent, hole], 'parent'),
        p(50, 50),
        p(50, 50),
        TOL
      )
    ).toBe(false);
  });

  it("crossing the parent's outline still hits the parent", () => {
    const parent = square('parent', 0, 100);
    const hole = square('hole', 40, 60, {
      type: 'internal',
      parent_id: 'parent',
    });
    expect(
      scribbleSegmentHits(
        candidate([parent, hole], 'parent'),
        p(-20, 50),
        p(10, 50),
        TOL
      )
    ).toBe(true);
  });

  it('a fast jump from one hole to another still hits the parent', () => {
    // Both points of the segment are in holes and the parent's OUTER outline
    // is far away — only the crossing of the hole outlines reveals that the
    // stroke passed over the parent's filled band between them.
    const parent = square('parent', 0, 100);
    const h1 = square('h1', 10, 30, { type: 'internal', parent_id: 'parent' });
    const h2 = square('h2', 70, 90, { type: 'internal', parent_id: 'parent' });
    expect(
      scribbleSegmentHits(
        candidate([parent, h1, h2], 'parent'),
        p(20, 20),
        p(80, 80),
        TOL
      )
    ).toBe(true);
  });

  it("touching a hole's outline from inside the hole spares the parent", () => {
    const parent = square('parent', 0, 100);
    const hole = square('hole', 40, 60, {
      type: 'internal',
      parent_id: 'parent',
    });
    // 2 px inside the hole's left edge, moving along it.
    expect(
      scribbleSegmentHits(
        candidate([parent, hole], 'parent'),
        p(42, 45),
        p(42, 55),
        TOL
      )
    ).toBe(false);
  });

  // Touching a hole's outline is aiming at the hole, from either side and at
  // either end of the segment. Pixel-aligned contours make this common: at
  // zoom 1 with an integral pan, every pointer position IS an integer image
  // coordinate, exactly where the contour vertices and edges lie.
  it("a stroke that only touches a hole's outline spares the parent", () => {
    const parent = square('parent', 0, 100);
    const hole = square('hole', 40, 60, {
      type: 'internal',
      parent_id: 'parent',
    });
    const c = candidate([parent, hole], 'parent');
    // Ends ON the left edge (CodeRabbit's case: endpoint contact counted as
    // a crossing).
    expect(scribbleSegmentHits(c, p(50, 50), p(40, 50), TOL)).toBe(false);
    // Ends ON the right edge — ray casting puts that point OUTSIDE the hole,
    // so it must not count as "inside the parent" either.
    expect(scribbleSegmentHits(c, p(50, 50), p(60, 50), TOL)).toBe(false);
    // Starts on the outline and goes in.
    expect(scribbleSegmentHits(c, p(40, 50), p(50, 50), TOL)).toBe(false);
    // A click exactly on a corner of the hole.
    expect(scribbleSegmentHits(c, p(60, 60), p(60, 60), TOL)).toBe(false);
  });

  it('a segment ending outside a polygon but near its outline hits it', () => {
    // Outside, 4 px from the right edge: the tolerance applies to closed
    // shapes too, so "touching the stroke" counts like it does for a line.
    const sq = square('sq', 0, 100);
    expect(
      scribbleSegmentHits(candidate([sq], 'sq'), p(104, 50), p(104, 50), TOL)
    ).toBe(true);
    expect(
      scribbleSegmentHits(candidate([sq], 'sq'), p(110, 50), p(110, 50), TOL)
    ).toBe(false);
  });

  it('tolerance is screen-constant', () => {
    const c = candidate([line], 'mt');
    const tolAt = (zoom: number) => SCRIBBLE_HIT_TOLERANCE_PX / zoom;
    // 3 image px away: on screen that is 9 px at zoom 3 (miss), 1.5 px at
    // zoom 0.5 (hit).
    expect(scribbleSegmentHits(c, p(0, 53), p(100, 53), tolAt(3))).toBe(false);
    expect(scribbleSegmentHits(c, p(0, 53), p(100, 53), tolAt(0.5))).toBe(true);
    // 10 image px away hits only when zoomed far out.
    expect(scribbleSegmentHits(c, p(0, 60), p(100, 60), tolAt(0.5))).toBe(true);
    expect(scribbleSegmentHits(c, p(0, 60), p(100, 60), tolAt(1))).toBe(false);
  });

  it('collectScribbleHits skips already-hit ids', () => {
    const a = polyline('a', [p(0, 50), p(100, 50)]);
    const b = polyline('b', [p(0, 70), p(100, 70)]);
    const cands = prepareScribbleCandidates([a, b]);
    expect(
      collectScribbleHits(cands, p(50, 0), p(50, 100), TOL, new Set())
    ).toEqual(['a', 'b']);
    expect(
      collectScribbleHits(cands, p(50, 0), p(50, 100), TOL, new Set(['a']))
    ).toEqual(['b']);
  });

  it('segmentDistance is zero for crossing segments and exact otherwise', () => {
    expect(segmentDistance(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(0);
    expect(segmentDistance(p(0, 0), p(10, 0), p(0, 3), p(10, 3))).toBe(3);
  });
});
