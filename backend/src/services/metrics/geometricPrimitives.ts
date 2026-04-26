/**
 * Pure geometric primitive functions extracted from `MetricsCalculator`.
 *
 * Each function is stateless and side-effect-free — no class instance, no
 * logger calls, no file IO. Domain-specific metric orchestration stays in
 * `metricsCalculator.ts`; only the building blocks live here.
 *
 * Polygon vertices are represented as `Point[]` (open or closed — a closed
 * polygon's first and last point may coincide; algorithms below handle
 * either form via wraparound `(i + 1) % n` indexing).
 */

export interface Point {
  x: number;
  y: number;
}

export interface PolygonShape {
  points: Point[];
}

/**
 * Shoelace formula. Returns absolute area; sign of orientation discarded.
 */
export function calculatePolygonArea(points: Point[]): number {
  if (!points || points.length < 3) {
    return 0;
  }

  let area = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const currentPoint = points[i];
    const nextPoint = points[j];

    if (
      !currentPoint ||
      !nextPoint ||
      typeof currentPoint.x !== 'number' ||
      typeof currentPoint.y !== 'number' ||
      typeof nextPoint.x !== 'number' ||
      typeof nextPoint.y !== 'number'
    ) {
      continue;
    }

    area += currentPoint.x * nextPoint.y;
    area -= nextPoint.x * currentPoint.y;
  }

  return Math.abs(area / 2);
}

/**
 * Sum of edge lengths around the polygon (closed perimeter).
 */
export function calculatePerimeter(points: Point[]): number {
  if (!points || points.length < 2) {
    return 0;
  }

  let perimeter = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const currentPoint = points[i];
    const nextPoint = points[j];

    if (
      !currentPoint ||
      !nextPoint ||
      typeof currentPoint.x !== 'number' ||
      typeof currentPoint.y !== 'number' ||
      typeof nextPoint.x !== 'number' ||
      typeof nextPoint.y !== 'number'
    ) {
      continue;
    }

    const dx = nextPoint.x - currentPoint.x;
    const dy = nextPoint.y - currentPoint.y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }

  return perimeter;
}

/**
 * Axis-aligned bounding box. Returns zero dimensions for empty input.
 */
export function calculateBoundingBox(points: Point[]): {
  width: number;
  height: number;
} {
  if (!points || points.length === 0) {
    return { width: 0, height: 0 };
  }

  const xs = points.filter(p => p && typeof p.x === 'number').map(p => p.x);
  const ys = points.filter(p => p && typeof p.y === 'number').map(p => p.y);

  if (xs.length === 0 || ys.length === 0) {
    return { width: 0, height: 0 };
  }

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Cross product `(a - o) × (b - o)`. Used by convex hull and centroid.
 * Positive = counter-clockwise turn, zero = collinear, negative = clockwise.
 */
export function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Euclidean distance between two points.
 */
export function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Convex hull using Andrew's monotone chain algorithm.
 * Returns hull vertices in counter-clockwise order. Input < 3 points
 * is returned unchanged.
 */
export function calculateConvexHull(points: Point[]): Point[] {
  if (points.length < 3) {
    return points;
  }

  // Sort points by x-coordinate, then by y-coordinate
  const sortedPoints = [...points].sort((a, b) => {
    if (a.x === b.x) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });

  // Build lower hull
  const lower: Point[] = [];
  for (const point of sortedPoints) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  // Build upper hull
  const upper: Point[] = [];
  for (let i = sortedPoints.length - 1; i >= 0; i--) {
    const point = sortedPoints[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  // Remove last point of each half because it's repeated
  lower.pop();
  upper.pop();

  return lower.concat(upper);
}

/**
 * Distance from a point to a line segment (clamped to endpoints — not the
 * infinite line).
 */
export function pointToLineDistance(
  point: Point,
  lineStart: Point,
  lineEnd: Point
): number {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;

  if (lenSq === 0) {
    return distance(point, lineStart);
  }

  const param = dot / lenSq;

  let xx: number, yy: number;

  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }

  const dx = point.x - xx;
  const dy = point.y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Find Feret diameters via brute-force pairwise distance on the convex hull.
 * Returns max, min, and orthogonal Feret diameters.
 *
 * NOTE on `orthogonal`: this doubles the max one-sided perpendicular
 * distance from the Feret axis. A true orthogonal caliper width would
 * measure between two parallel supporting lines (not double the one-sided
 * distance) — this is an approximation acknowledged by the original
 * implementation.
 */
export function rotatingCalipers(hull: Point[]): {
  max: number;
  min: number;
  orthogonal: number;
} {
  if (hull.length < 3) {
    return { max: 0, min: 0, orthogonal: 0 };
  }

  let maxDist = 0;
  let minDist = Infinity;
  let orthogonalDist = 0;
  let maxPair: [Point, Point] | null = null;

  // Find maximum Feret diameter (max distance between any two hull points)
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      const dist = distance(hull[i], hull[j]);
      if (dist > maxDist) {
        maxDist = dist;
        maxPair = [hull[i], hull[j]];
      }
    }
  }

  // Find minimum Feret diameter (min caliper width)
  // For each edge of the hull, find the furthest point from that edge
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    let maxDistFromEdge = 0;

    for (let k = 0; k < hull.length; k++) {
      if (k === i || k === j) {
        continue;
      }
      const dist = pointToLineDistance(hull[k], hull[i], hull[j]);
      maxDistFromEdge = Math.max(maxDistFromEdge, dist);
    }

    if (maxDistFromEdge > 0 && maxDistFromEdge < minDist) {
      minDist = maxDistFromEdge;
    }
  }

  // Find orthogonal Feret diameter (perpendicular to max Feret line)
  if (maxPair) {
    const [p1, p2] = maxPair;
    let maxOrthDist = 0;

    for (const point of hull) {
      const dist = pointToLineDistance(point, p1, p2);
      maxOrthDist = Math.max(maxOrthDist, dist);
    }

    orthogonalDist = maxOrthDist * 2;
  }

  if (minDist === Infinity) {
    minDist = maxDist;
  }

  return {
    max: maxDist,
    min: minDist,
    orthogonal: orthogonalDist,
  };
}

/**
 * Ray-casting test for point-in-polygon.
 */
export function isPointInPolygon(point: Point, polygon: PolygonShape): boolean {
  if (!polygon?.points || polygon.points.length < 3) {
    return false;
  }

  const { x, y } = point;
  const points = polygon.points;
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i]?.x || 0;
    const yi = points[i]?.y || 0;
    const xj = points[j]?.x || 0;
    const yj = points[j]?.y || 0;

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Centroid via shoelace-weighted formula. Falls back to vertex average
 * when the polygon is degenerate (zero or near-zero signed area).
 */
export function calculateCentroid(points: Point[]): Point {
  if (!points || points.length === 0) {
    return { x: 0, y: 0 };
  }

  let cx = 0;
  let cy = 0;
  let area = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const currentPoint = points[i];
    const nextPoint = points[j];

    if (
      !currentPoint ||
      !nextPoint ||
      typeof currentPoint.x !== 'number' ||
      typeof currentPoint.y !== 'number' ||
      typeof nextPoint.x !== 'number' ||
      typeof nextPoint.y !== 'number'
    ) {
      continue;
    }

    const crossVal =
      currentPoint.x * nextPoint.y - nextPoint.x * currentPoint.y;
    area += crossVal;
    cx += (currentPoint.x + nextPoint.x) * crossVal;
    cy += (currentPoint.y + nextPoint.y) * crossVal;
  }

  area *= 0.5;
  if (Math.abs(area) < Number.EPSILON) {
    // Fallback to simple average for degenerate cases
    const avgX =
      points.reduce((sum, p) => sum + (p?.x || 0), 0) / points.length;
    const avgY =
      points.reduce((sum, p) => sum + (p?.y || 0), 0) / points.length;
    return { x: avgX, y: avgY };
  }

  cx /= 6 * area;
  cy /= 6 * area;

  return { x: cx, y: cy };
}

/**
 * Check if inner polygon's centroid lies inside the outer polygon.
 * NB: this is a centroid test, not a strict containment test —
 * concave outer polygons can still pass even when inner has vertices
 * outside the outer hull.
 */
export function isPolygonInside(
  inner: PolygonShape,
  outer: PolygonShape
): boolean {
  if (
    !inner?.points ||
    !outer?.points ||
    inner.points.length === 0 ||
    outer.points.length === 0
  ) {
    return false;
  }

  const centroid = calculateCentroid(inner.points);
  return isPointInPolygon(centroid, outer);
}
