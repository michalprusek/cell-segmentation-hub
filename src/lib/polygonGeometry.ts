import type { Point, Polygon } from './segmentation';

/**
 * Advanced geometry utilities for polygon operations
 * Inspired by SpheroSeg implementation
 */

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * Calculate the distance from a point to a line segment
 */
export const distanceToSegment = (
  point: Point,
  segmentStart: Point,
  segmentEnd: Point
): number => {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;

  if (dx === 0 && dy === 0) {
    // Segment is a point, return distance to that point
    const pdx = point.x - segmentStart.x;
    const pdy = point.y - segmentStart.y;
    return Math.sqrt(pdx * pdx + pdy * pdy);
  }

  // Calculate the parameter t where the closest point on the segment is
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) /
        (dx * dx + dy * dy)
    )
  );

  // Calculate the closest point on the segment
  const closestX = segmentStart.x + t * dx;
  const closestY = segmentStart.y + t * dy;

  // Return distance from point to closest point on segment
  const distX = point.x - closestX;
  const distY = point.y - closestY;
  return Math.sqrt(distX * distX + distY * distY);
};

/**
 * Calculate the area of a polygon using the Shoelace formula
 */
export const calculatePolygonArea = (points: Point[]): number => {
  let area = 0;
  const n = points.length;

  if (n < 3) return 0;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }

  return Math.abs(area) / 2;
};

/**
 * Calculate the perimeter of a polygon
 */
export const calculatePolygonPerimeter = (points: Point[]): number => {
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const nextIndex = (i + 1) % points.length;
    const dx = points[nextIndex].x - points[i].x;
    const dy = points[nextIndex].y - points[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  return perimeter;
};

/**
 * Determine if a polygon is defined in clockwise or counter-clockwise order
 */
export const isPolygonClockwise = (points: Point[]): boolean => {
  let sum = 0;
  const n = points.length;

  if (n < 3) return true;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += (points[j].x - points[i].x) * (points[j].y + points[i].y);
  }

  return sum > 0;
};

/**
 * Check if a point is inside a polygon using the ray casting algorithm
 *
 * @param point - The point to test
 * @param polygon - Array of points defining the polygon vertices
 * @returns True if the point is inside the polygon, false otherwise
 *
 * @example
 * const polygon = [
 *   { x: 0, y: 0 },
 *   { x: 10, y: 0 },
 *   { x: 10, y: 10 },
 *   { x: 0, y: 10 }
 * ];
 * const inside = isPointInPolygon({ x: 5, y: 5 }, polygon); // true
 *
 * Algorithm (Ray Casting):
 * 1. Cast a horizontal ray from the point to infinity (right)
 * 2. Count how many polygon edges the ray crosses
 * 3. If odd number of crossings, point is inside; if even, outside
 * 4. Handle edge cases: point on vertex, horizontal edges, etc.
 */
export const isPointInPolygon = (
  point: Point,
  polygonPoints: Point[]
): boolean => {
  const x = point.x;
  const y = point.y;
  let inside = false;

  for (
    let i = 0, j = polygonPoints.length - 1;
    i < polygonPoints.length;
    j = i++
  ) {
    const xi = polygonPoints[i].x;
    const yi = polygonPoints[i].y;
    const xj = polygonPoints[j].x;
    const yj = polygonPoints[j].y;

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
};

/**
 * Create a new polygon with a unique ID
 */
export const createPolygon = (points: Point[], color?: string): Polygon => {
  return {
    id: `polygon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    points: [...points], // Create a copy
    confidence: 1.0,
    color: color || '#ff0000',
  };
};

/**
 * Calculate line intersection between two line segments
 */
export const lineIntersection = (
  p1: Point,
  p2: Point, // First line segment
  p3: Point,
  p4: Point // Second line segment
): Point | null => {
  const x1 = p1.x,
    y1 = p1.y;
  const x2 = p2.x,
    y2 = p2.y;
  const x3 = p3.x,
    y3 = p3.y;
  const x4 = p4.x,
    y4 = p4.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

  // Lines are parallel
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  // Check if intersection is within both line segments
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
    };
  }

  return null;
};

/**
 * Calculate intersection between an infinite line (defined by two points) and a line segment
 * Unlike lineIntersection, this treats the first line as infinite (extending beyond p1 and p2)
 * while the second line remains a segment between p3 and p4
 */
export const lineRayIntersection = (
  p1: Point,
  p2: Point, // Points defining the infinite line
  p3: Point,
  p4: Point // Line segment endpoints
): Point | null => {
  const x1 = p1.x,
    y1 = p1.y;
  const x2 = p2.x,
    y2 = p2.y;
  const x3 = p3.x,
    y3 = p3.y;
  const x4 = p4.x,
    y4 = p4.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

  // Lines are parallel
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  // Only check if intersection is within the segment (p3-p4)
  // The line p1-p2 is treated as infinite (no constraint on t)
  if (u >= 0 && u <= 1) {
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
    };
  }

  return null;
};

/**
 * Check which side of a line a point is on
 * Returns positive if point is on the left, negative if on the right, 0 if on the line
 */
export const pointSideOfLine = (
  point: Point,
  lineStart: Point,
  lineEnd: Point
): number => {
  return (
    (lineEnd.x - lineStart.x) * (point.y - lineStart.y) -
    (lineEnd.y - lineStart.y) * (point.x - lineStart.x)
  );
};

/**
 * Find the closest vertex in a polygon to a given point
 *
 * @param point - The reference point
 * @param polygonPoints - Array of polygon vertices to search
 * @param maxDistance - Optional maximum distance threshold
 * @returns Object with vertex index and distance, or null if none found within threshold
 *
 * @example
 * const polygon = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
 * const closest = findClosestVertex({ x: 1, y: 1 }, polygon, 5);
 * // Returns { index: 0, distance: 1.414... }
 *
 * Use cases:
 * - Vertex selection on mouse click (with maxDistance as click tolerance)
 * - Snapping to vertices during editing
 * - Finding attachment points for new edges
 */
export const findClosestVertex = (
  point: Point,
  polygonPoints: Point[],
  maxDistance?: number
): {
  index: number;
  distance: number;
} | null => {
  let closestIndex = -1;
  let minDistance = Infinity;

  for (let i = 0; i < polygonPoints.length; i++) {
    const vertex = polygonPoints[i];
    const dx = vertex.x - point.x;
    const dy = vertex.y - point.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = i;
    }
  }

  if (
    closestIndex === -1 ||
    (maxDistance !== undefined && minDistance > maxDistance)
  ) {
    return null;
  }

  return {
    index: closestIndex,
    distance: minDistance,
  };
};

/**
 * Find the closest edge segment in a polygon to a given point
 *
 * @param point - The reference point
 * @param polygonPoints - Array of polygon vertices
 * @param maxDistance - Optional maximum distance threshold
 * @returns Object with segment index, distance, and closest point on segment
 *
 * @example
 * const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
 * const closest = findClosestSegment({ x: 5, y: -2 }, square);
 * // Returns { index: 0, distance: 2, closestPoint: { x: 5, y: 0 } }
 *
 * Algorithm:
 * 1. Iterate through all polygon edges
 * 2. Calculate perpendicular distance to each edge
 * 3. Track the minimum distance and corresponding edge
 * 4. Return the closest point on the winning edge
 *
 * Use cases:
 * - Adding vertices to edges on click
 * - Edge selection and highlighting
 * - Measuring clearances and proximity
 */
export const findClosestSegment = (
  point: Point,
  polygonPoints: Point[],
  maxDistance?: number
): {
  startIndex: number;
  endIndex: number;
  distance: number;
  projectedPoint: Point;
} | null => {
  let closestStartIndex = -1;
  let minDistance = Infinity;
  let projectedPoint: Point = { x: 0, y: 0 };

  for (let i = 0; i < polygonPoints.length; i++) {
    const p1 = polygonPoints[i];
    const p2 = polygonPoints[(i + 1) % polygonPoints.length];

    // Calculate distance to this segment
    const distance = distanceToSegment(point, p1, p2);

    if (distance < minDistance) {
      minDistance = distance;
      closestStartIndex = i;

      // Calculate projected point on segment
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / (dx * dx + dy * dy)
        )
      );

      projectedPoint = {
        x: p1.x + t * dx,
        y: p1.y + t * dy,
      };
    }
  }

  if (
    closestStartIndex === -1 ||
    (maxDistance !== undefined && minDistance > maxDistance)
  ) {
    return null;
  }

  return {
    startIndex: closestStartIndex,
    endIndex: (closestStartIndex + 1) % polygonPoints.length,
    distance: minDistance,
    projectedPoint,
  };
};

/**
 * Calculate bounding box of a polygon
 */
/**
 * Calculate the axis-aligned bounding box (AABB) of a polygon
 *
 * @param points - Array of polygon vertices
 * @returns Bounding box with min/max coordinates and dimensions
 *
 * @example
 * const triangle = [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 10 }];
 * const bbox = calculateBoundingBox(triangle);
 * // Returns { minX: 0, maxX: 10, minY: 0, maxY: 10, width: 10, height: 10 }
 *
 * Use cases:
 * - Collision detection (broad phase)
 * - Viewport culling
 * - Centering and scaling operations
 * - Spatial indexing and partitioning
 */
export const calculateBoundingBox = (points: Point[]): BoundingBox => {
  if (points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;

  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

/**
 * Calculate the centroid (center point) of a polygon
 */
export const getPolygonCentroid = (points: Point[]): Point => {
  if (!points || points.length === 0) return { x: 0, y: 0 };

  const sum = points.reduce(
    (acc, point) => ({
      x: acc.x + point.x,
      y: acc.y + point.y,
    }),
    { x: 0, y: 0 }
  );

  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  };
};

/**
 * Check if one polygon is inside another polygon (approximate)
 *
 * @param innerPoints - Vertices of the potentially inner polygon
 * @param outerPoints - Vertices of the potentially outer polygon
 * @returns True if inner polygon is inside outer polygon
 *
 * @example
 * const inner = [{ x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 3, y: 7 }];
 * const outer = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
 * const isInside = isPolygonInsidePolygon(inner, outer); // true
 *
 * Algorithm:
 * Uses centroid-based approximation:
 * 1. Calculate centroid of inner polygon
 * 2. Check if centroid is inside outer polygon
 *
 * Limitations:
 * - Not accurate for concave polygons or partial overlaps
 * - For exact containment, check all vertices + edge intersections
 *
 * Use cases:
 * - Hierarchy detection in nested cells
 * - Parent-child relationships in segmentation
 * - Quick approximate containment checks
 */
export const isPolygonInsidePolygon = (
  innerPoints: Point[],
  outerPoints: Point[]
): boolean => {
  if (
    !innerPoints ||
    !outerPoints ||
    innerPoints.length === 0 ||
    outerPoints.length === 0
  ) {
    return false;
  }

  // Calculate centroid of inner polygon
  const centroid = getPolygonCentroid(innerPoints);

  // Check if centroid is inside outer polygon
  return isPointInPolygon(centroid, outerPoints);
};
