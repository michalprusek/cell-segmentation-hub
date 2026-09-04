import type { Point, Polygon } from '@/lib/segmentation';
import {
  polylineSemanticsForProjectType,
  type PolylineKind,
} from '@/lib/polylineSemantics';

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
 * The class label that gates joining, normalised so `null`, `undefined`, an
 * empty string and a non-string all read as the same UNLABELLED state.
 *
 * `null` matters: `mtTypeTargets.applyMtType` and the backend's
 * `segmentationService` both normalise `null → undefined` (they DELETE the
 * key), but a raw `null` arriving from any other path must not make a
 * polyline un-joinable with a genuinely `undefined` one — to the user the
 * two are the same "not labelled yet".
 */
const joinClassOf = (p: Polygon, kind: PolylineKind): string | undefined => {
  const raw =
    kind === 'sperm' ? p.partClass : kind === 'microtubule' ? p.mtType : null;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
};

/**
 * Do the two polylines' class labels permit a join?
 *
 * An UNLABELLED polyline joins anything — the merged polyline inherits the
 * labelled side's class (`inheritJoinClass`). Requiring both sides to already
 * carry the same label was reported 2026-09-04 as the reason endpoint-join
 * "did not work": the user had labelled one microtubule and not the other,
 * and the click silently degraded into a plain add-point.
 *
 * Two DIFFERENT labels still block the join — that gate is intentional (a
 * merge would have to discard one of them) — but the caller is expected to
 * SAY so rather than swallow the click.
 */
export const joinClassesCompatible = (
  a: Polygon,
  b: Polygon,
  projectType: string | undefined
): boolean => {
  const { kind } = polylineSemanticsForProjectType(projectType);
  if (kind === 'generic') return true; // no class field applies
  const ca = joinClassOf(a, kind);
  const cb = joinClassOf(b, kind);
  if (ca === undefined || cb === undefined) return true;
  return ca === cb;
};

/**
 * Class fields the surviving polyline A must take FROM B, as a patch to
 * spread onto A. Non-empty only when A is unlabelled and B is labelled —
 * without it, joining an unlabelled A onto a labelled B would silently erase
 * the label the user had already assigned.
 *
 * ONLY the class travels. The identity fields — `instanceId` (sperm),
 * `trackId` and `name` (microtubule) — stay A's, which is what a join has
 * always done: two same-class polylines with different `instanceId`s already
 * merged into A's instance and dropped B's. Copying identity across would
 * silently reassign the merged polyline to another sperm instance / MT track,
 * a much bigger claim than "these two are one filament".
 */
export const inheritJoinClass = (
  a: Polygon,
  b: Polygon,
  projectType: string | undefined
): Partial<Polygon> => {
  const { kind } = polylineSemanticsForProjectType(projectType);
  if (kind === 'generic') return {};
  if (joinClassOf(a, kind) !== undefined) return {}; // A already labelled
  if (joinClassOf(b, kind) === undefined) return {}; // B unlabelled too
  return kind === 'sperm' ? { partClass: b.partClass } : { mtType: b.mtType };
};

export interface JoinTarget {
  polygonId: string;
  endpoint: Endpoint;
  distanceSq: number;
}

export interface JoinScan {
  /** The endpoint to join to: the one NEAREST the point, if its label is
   *  compatible. `null` otherwise. */
  target: JoinTarget | null;
  /**
   * Set when the nearest in-range endpoint is a perfectly good polyline but
   * carries a DIFFERENT label, so the join is refused. Mutually exclusive
   * with `target` — it exists purely so the caller can explain the refusal
   * instead of silently doing something else.
   */
  blockedByClass: JoinTarget | null;
}

/**
 * The foreign polyline endpoint nearest `point` within `maxDistance`
 * (image-space units), classified by whether its label permits a join.
 *
 * **The nearest endpoint decides, compatible or not.** Picking the nearest
 * COMPATIBLE one instead would silently merge into a different polyline than
 * the one under the cursor: with a mismatched endpoint 1 px away and a
 * compatible one 4 px away (the hit radius is `VERTEX_HIT_RADIUS / zoom`, so
 * ≥8 image px at zoom 1), the user clicks precisely on the first and gets the
 * second. Refusing and saying why is the only honest answer.
 */
export const scanJoinTargets = (
  polygons: Polygon[],
  source: Polygon,
  point: Point,
  maxDistance: number,
  projectType: string | undefined
): JoinScan => {
  if (!isJoinablePolyline(source)) {
    return { target: null, blockedByClass: null };
  }
  const maxSq = maxDistance * maxDistance;
  let nearest: JoinTarget | null = null;
  let nearestCompatible = false;
  for (const candidate of polygons) {
    if (candidate.id === source.id) continue;
    if (!isJoinablePolyline(candidate)) continue;
    const compatible = joinClassesCompatible(source, candidate, projectType);
    for (const endpoint of ['head', 'tail'] as const) {
      const ep = endpointPoint(candidate, endpoint);
      const dSq = (point.x - ep.x) ** 2 + (point.y - ep.y) ** 2;
      if (dSq > maxSq) continue;
      // Strict `<` keeps the first candidate on a tie, so the result is
      // deterministic in polygon order rather than depending on iteration.
      if (nearest === null || dSq < nearest.distanceSq) {
        nearest = { polygonId: candidate.id, endpoint, distanceSq: dSq };
        nearestCompatible = compatible;
      }
    }
  }
  if (nearest === null) return { target: null, blockedByClass: null };
  return nearestCompatible
    ? { target: nearest, blockedByClass: null }
    : { target: null, blockedByClass: nearest };
};

/**
 * Nearest joinable foreign endpoint to `point`, within `maxDistance`
 * (image-space units). `null` if none in range. Thin wrapper over
 * `scanJoinTargets` for callers (the hover highlight) that don't need to
 * know WHY a nearby endpoint was rejected.
 */
export const findJoinTarget = (
  polygons: Polygon[],
  source: Polygon,
  point: Point,
  maxDistance: number,
  projectType: string | undefined
): JoinTarget | null =>
  scanJoinTargets(polygons, source, point, maxDistance, projectType).target;

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
