import type { Point, Polygon } from '@/lib/segmentation';
import { polylineSemanticsForProjectType } from '@/lib/polylineSemantics';

/** A polyline endpoint: `head` = points[0], `tail` = points[last]. */
export type Endpoint = 'head' | 'tail';

/** The point at the given endpoint of a polyline. */
export const endpointPoint = (polygon: Polygon, endpoint: Endpoint): Point =>
  endpoint === 'head'
    ? polygon.points[0]
    : polygon.points[polygon.points.length - 1];

/** Which endpoint of `polygon` is nearer to `point` (ties resolve to head). */
export const nearestEndpoint = (polygon: Polygon, point: Point): Endpoint => {
  const head = polygon.points[0];
  const tail = polygon.points[polygon.points.length - 1];
  const dHead = (point.x - head.x) ** 2 + (point.y - head.y) ** 2;
  const dTail = (point.x - tail.x) ** 2 + (point.y - tail.y) ** 2;
  return dHead <= dTail ? 'head' : 'tail';
};

const isJoinablePolyline = (p: Polygon): boolean =>
  p.geometry === 'polyline' && p.points.length >= 2;

/**
 * Can polyline `b` be merged into `a`? They must be distinct joinable
 * polylines that share the class relevant to the project type:
 *  - sperm → same `partClass`
 *  - microtubule → same `mtType` (both `undefined` = both untyped = joinable)
 *  - generic → no class field applies, always allowed
 */
export const canJoinPolylines = (
  a: Polygon,
  b: Polygon,
  projectType: string | undefined
): boolean => {
  if (a.id === b.id) return false;
  if (!isJoinablePolyline(a) || !isJoinablePolyline(b)) return false;
  const { kind } = polylineSemanticsForProjectType(projectType);
  if (kind === 'sperm') return a.partClass === b.partClass;
  if (kind === 'microtubule') return a.mtType === b.mtType;
  return true;
};

export interface JoinTarget {
  polygonId: string;
  endpoint: Endpoint;
  distanceSq: number;
}

/**
 * Nearest joinable foreign endpoint to `point`, within `maxDistance`
 * (image-space units). Scans both endpoints of every candidate that passes
 * `canJoinPolylines(source, candidate, projectType)`. `null` if none in range.
 */
export const findJoinTarget = (
  polygons: Polygon[],
  source: Polygon,
  point: Point,
  maxDistance: number,
  projectType: string | undefined
): JoinTarget | null => {
  const maxSq = maxDistance * maxDistance;
  let best: JoinTarget | null = null;
  for (const candidate of polygons) {
    if (!canJoinPolylines(source, candidate, projectType)) continue;
    for (const endpoint of ['head', 'tail'] as const) {
      const ep = endpointPoint(candidate, endpoint);
      const dSq = (point.x - ep.x) ** 2 + (point.y - ep.y) ** 2;
      if (dSq <= maxSq && (best === null || dSq < best.distanceSq)) {
        best = { polygonId: candidate.id, endpoint, distanceSq: dSq };
      }
    }
  }
  return best;
};

/**
 * Merge B into A at the chosen endpoints. A survives (caller keeps A's
 * fields and drops B). Returns A's new `points`:
 *   orient(A so `aEnd` is last) ++ bridge ++ orient(B so `bEnd` is first)
 */
export const joinPolylinePoints = (
  a: Polygon,
  aEnd: Endpoint,
  b: Polygon,
  bEnd: Endpoint,
  bridge: Point[]
): Point[] => {
  const aOriented = aEnd === 'tail' ? a.points : [...a.points].reverse();
  const bOriented = bEnd === 'head' ? b.points : [...b.points].reverse();
  return [...aOriented, ...bridge, ...bOriented];
};
