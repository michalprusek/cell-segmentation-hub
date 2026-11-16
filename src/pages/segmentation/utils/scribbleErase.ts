/**
 * Hit-testing for the delete tool's scribble ("draw over shapes, release to
 * delete them").
 *
 * Modelled on Excalidraw's eraser (`packages/excalidraw/eraser/index.ts` @
 * b42b1a19), which solves exactly this problem:
 *
 *  - Each pointer move tests only the NEWEST scribble segment, against shapes
 *    not hit yet, with a bounding-box rejection first. The cost per frame is
 *    O(shapes), not O(scribble length x shapes) — it matters on a microtubule
 *    frame with ~2000 polylines.
 *  - It tests SEGMENTS, not points. The editor coalesces mouse moves to one
 *    per animation frame, so two consecutive points of a fast stroke can lie
 *    hundreds of pixels apart on either side of a 3 px polyline; a point test
 *    (and any DOM hit-test, which is a point test) would skip it.
 *  - A filled shape is hit from inside OR by its outline; a line by
 *    segment-to-segment distance within a tolerance that is constant on
 *    SCREEN, i.e. divided by the zoom.
 *
 * Where this deviates from Excalidraw, deliberately: holes. A shape here may
 * own `internal` polygons (holes). A point inside a hole is not inside the
 * shape that owns it — scribbling inside a hole deletes the hole, not the
 * spheroid around it. The parent is still hit by its own filled area, by its
 * outer outline, and by a stroke that CROSSES a hole's outline (one side of
 * such a crossing is the parent's filled area — which is also what catches a
 * fast jump from one hole straight into another).
 */
import type { Point, Polygon } from '@/lib/segmentation';
import {
  distanceToSegment,
  isPointInPolygon,
  lineIntersection,
} from '@/lib/polygonGeometry';

/** Hit tolerance, SCREEN px. Divide by the zoom to get image units.
 *  Excalidraw's line tolerance for a 3 px stroke at zoom 1 is
 *  `max(strokeWidth, 2 * strokeWidth / zoom)` = 6. Deliberately tighter than
 *  the 12 px half-width of the polyline hover/click band
 *  (`POLYLINE_HIT_BAND_MULTIPLIER`): a stroke through a dense field of
 *  microtubules must not take the neighbours with it. */
export const SCRIBBLE_HIT_TOLERANCE_PX = 6;

/** Opacity of a shape the scribble has touched and will delete on release —
 *  Excalidraw's `ELEMENT_READY_TO_ERASE_OPACITY` (20 %). */
export const SCRIBBLE_PENDING_OPACITY = 0.2;

/** Width of the drawn scribble trail, SCREEN px. With the 3 px polyline
 *  stroke, a trail this wide visibly touches a line exactly when the hit test
 *  says it does: (9 + 3) / 2 = 6 = SCRIBBLE_HIT_TOLERANCE_PX. */
export const SCRIBBLE_TRAIL_WIDTH_PX = 9;

export interface ScribbleBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ScribbleCandidate {
  id: string;
  points: Point[];
  /** Closed polygon (has an interior) vs open polyline. */
  closed: boolean;
  bbox: ScribbleBBox;
  /** Outlines of the `internal` polygons this shape owns. */
  holes: Point[][];
}

const bboxOf = (points: Point[]): ScribbleBBox => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
};

const bboxWithin = (inner: ScribbleBBox, outer: ScribbleBBox): boolean =>
  inner.minX >= outer.minX &&
  inner.minY >= outer.minY &&
  inner.maxX <= outer.maxX &&
  inner.maxY <= outer.maxY;

const bboxArea = (b: ScribbleBBox): number =>
  (b.maxX - b.minX) * (b.maxY - b.minY);

const isHole = (p: Polygon): boolean =>
  p.geometry !== 'polyline' && (p.type === 'internal' || !!p.parent_id);

/**
 * Build the per-scribble candidate list ONCE, when the stroke starts: bounding
 * boxes and hole ownership do not change while the button is held.
 *
 * Hole ownership is `parent_id` when the hole has one (the neurite models and
 * `holes_to_internal` write it). Without it, the hole goes to the SMALLEST
 * non-hole closed shape that contains it — the immediate parent when shapes
 * are nested.
 */
export function prepareScribbleCandidates(
  polygons: Polygon[]
): ScribbleCandidate[] {
  const candidates: ScribbleCandidate[] = [];
  const byId = new Map<string, ScribbleCandidate>();
  const holes: Array<{ polygon: Polygon; bbox: ScribbleBBox }> = [];

  for (const polygon of polygons) {
    if (!polygon.points || polygon.points.length === 0) continue;
    const c: ScribbleCandidate = {
      id: polygon.id,
      points: polygon.points,
      closed: polygon.geometry !== 'polyline',
      bbox: bboxOf(polygon.points),
      holes: [],
    };
    candidates.push(c);
    byId.set(c.id, c);
    if (isHole(polygon) && polygon.points.length >= 3) {
      holes.push({ polygon, bbox: c.bbox });
    }
  }

  if (holes.length === 0) return candidates;

  const holeIds = new Set(holes.map(h => h.polygon.id));
  const owners = candidates.filter(
    c => c.closed && c.points.length >= 3 && !holeIds.has(c.id)
  );

  for (const { polygon, bbox } of holes) {
    let owner: ScribbleCandidate | undefined;
    if (polygon.parent_id) {
      owner = byId.get(polygon.parent_id);
    } else {
      for (const c of owners) {
        if (
          bboxWithin(bbox, c.bbox) &&
          isPointInPolygon(polygon.points[0], c.points) &&
          (!owner || bboxArea(c.bbox) < bboxArea(owner.bbox))
        ) {
          owner = c;
        }
      }
    }
    if (owner && owner.id !== polygon.id) owner.holes.push(polygon.points);
  }

  return candidates;
}

/** Twice the signed area of p, q, r: > 0 left turn, < 0 right, 0 collinear. */
const orient = (p: Point, q: Point, r: Point): number =>
  (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);

/**
 * Does the stroke a→b pass THROUGH the edge c→d, from one side to the other?
 *
 * Stricter than `lineIntersection`, which also counts contact at an endpoint:
 * here a and b must lie strictly on opposite sides of the edge's line, so a
 * stroke that starts or ends ON a hole's outline has not crossed it. The edge
 * is half-open against the stroke's line — the ray-casting convention — so a
 * stroke through a VERTEX crosses exactly one of the two edges meeting there.
 * Excluding both would miss it: a diagonal through the corners of two
 * pixel-aligned square holes is exactly that.
 */
function crossesEdge(a: Point, b: Point, c: Point, d: Point): boolean {
  const sa = orient(c, d, a);
  const sb = orient(c, d, b);
  if (!((sa > 0 && sb < 0) || (sa < 0 && sb > 0))) return false;
  return orient(a, b, c) > 0 !== orient(a, b, d) > 0;
}

/** Is p inside the hole outline or ON it? On counts: ray casting alone puts a
 *  point on a hole's right or top edge OUTSIDE the hole, and so inside the
 *  shape around it. */
const inOrOnHole = (p: Point, hole: Point[]): boolean => {
  if (isPointInPolygon(p, hole)) return true;
  const m = hole.length;
  for (let i = 0; i < m; i++) {
    if (distanceToSegment(p, hole[i], hole[(i + 1) % m]) < 1e-9) return true;
  }
  return false;
};

/** Shortest distance between segments ab and cd (0 when they cross). */
export function segmentDistance(
  a: Point,
  b: Point,
  c: Point,
  d: Point
): number {
  if (lineIntersection(a, b, c, d)) return 0;
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b)
  );
}

/**
 * Does the scribble segment a→b touch this shape?
 *
 * `b` is the newest point. Only `b` is tested for "inside": `a` was the `b`
 * of the previous call, and the first call of a stroke is the zero-length
 * segment start→start.
 *
 * `tol` is in image units (`SCRIBBLE_HIT_TOLERANCE_PX / zoom`).
 */
export function scribbleSegmentHits(
  c: ScribbleCandidate,
  a: Point,
  b: Point,
  tol: number
): boolean {
  // Cheap rejection first: the segment's box, grown by the tolerance, against
  // the shape's box. Growing only one side is enough — the shape's own
  // outline lies inside its box.
  if (
    Math.max(a.x, b.x) + tol < c.bbox.minX ||
    Math.min(a.x, b.x) - tol > c.bbox.maxX ||
    Math.max(a.y, b.y) + tol < c.bbox.minY ||
    Math.min(a.y, b.y) - tol > c.bbox.maxY
  ) {
    return false;
  }

  const pts = c.points;
  const n = pts.length;
  if (n === 1) return segmentDistance(a, b, pts[0], pts[0]) <= tol;

  const hasInterior = c.closed && n >= 3;
  if (
    hasInterior &&
    isPointInPolygon(b, pts) &&
    !c.holes.some(h => inOrOnHole(b, h))
  ) {
    return true;
  }

  const edgeCount = hasInterior ? n : n - 1;
  for (let i = 0; i < edgeCount; i++) {
    if (segmentDistance(a, b, pts[i], pts[(i + 1) % n]) <= tol) return true;
  }

  // Crossing a hole's outline means one side of the crossing is this shape's
  // filled area. Strict crossing, not tolerance and not mere contact:
  // touching a hole's outline is aiming at the hole.
  for (const hole of c.holes) {
    const m = hole.length;
    for (let i = 0; i < m; i++) {
      if (crossesEdge(a, b, hole[i], hole[(i + 1) % m])) return true;
    }
  }

  return false;
}

/** Ids of the candidates the segment a→b newly touches, in candidate order. */
export function collectScribbleHits(
  candidates: ScribbleCandidate[],
  a: Point,
  b: Point,
  tol: number,
  already: ReadonlySet<string>
): string[] {
  const hits: string[] = [];
  for (const c of candidates) {
    if (already.has(c.id)) continue;
    if (scribbleSegmentHits(c, a, b, tol)) hits.push(c.id);
  }
  return hits;
}
