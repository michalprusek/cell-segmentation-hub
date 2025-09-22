import { logger } from '@/lib/logger';
import type { Point, Polygon } from './segmentation';
import {
  lineIntersection,
  lineRayIntersection,
  createPolygon,
  calculatePolygonArea,
} from './polygonGeometry';

/**
 * Polygon slicing functionality inspired by SpheroSeg
 */

function computeAndPushIntersection(
  intersections: Array<{ point: Point; edgeIndex: number; t: number }>,
  intersectionPoint: Point,
  points: Point[],
  edgeIndex: number
): void {
  const j = (edgeIndex + 1) % points.length;
  // Calculate parameter t along the edge for sorting intersections
  const edgeLength = Math.sqrt(
    Math.pow(points[j].x - points[edgeIndex].x, 2) +
      Math.pow(points[j].y - points[edgeIndex].y, 2)
  );
  const intersectionDist = Math.sqrt(
    Math.pow(intersectionPoint.x - points[edgeIndex].x, 2) +
      Math.pow(intersectionPoint.y - points[edgeIndex].y, 2)
  );
  const t = edgeLength > 0 ? intersectionDist / edgeLength : 0;

  intersections.push({ point: intersectionPoint, edgeIndex, t });
}

/**
 * Slices a polygon along a line defined by two points
 * @param polygon The polygon to slice
 * @param sliceStart The start point of the slice line
 * @param sliceEnd The end point of the slice line
 * @returns An array of two new polygons if slicing was successful, or null if slicing failed
 */
export function slicePolygon(
  polygon: Polygon,
  sliceStart: Point,
  sliceEnd: Point
): [Polygon, Polygon] | null {
  if (!polygon.points || polygon.points.length < 3) {
    return null;
  }

  const intersections: Array<{ point: Point; edgeIndex: number; t: number }> =
    [];
  const points = polygon.points;

  // Find all intersections between the slice line and polygon edges
  // First try with line segment intersection
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const intersection = lineIntersection(
      sliceStart,
      sliceEnd,
      points[i],
      points[j]
    );

    if (intersection) {
      computeAndPushIntersection(intersections, intersection, points, i);
    }
  }

  // If we don't have exactly 2 intersections with the segment, try infinite line
  if (intersections.length !== 2) {
    const segmentIntersectionCount = intersections.length;
    intersections.length = 0; // Clear array

    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const intersection = lineRayIntersection(
        sliceStart,
        sliceEnd,
        points[i],
        points[j]
      );

      if (intersection) {
        computeAndPushIntersection(intersections, intersection, points, i);
      }
    }
  }

  // Handle vertex intersections by deduplicating when we have more than 2 intersections
  // Only deduplicate if we actually have duplicate points (when slice passes through vertices)
  if (intersections.length > 2) {
    const uniqueIntersections: Array<{
      point: Point;
      edgeIndex: number;
      t: number;
    }> = [];
    const EPSILON = 1e-10;

    for (const intersection of intersections) {
      const existingIndex = uniqueIntersections.findIndex(
        existing =>
          Math.abs(existing.point.x - intersection.point.x) < EPSILON &&
          Math.abs(existing.point.y - intersection.point.y) < EPSILON
      );

      if (existingIndex === -1) {
        // New unique intersection
        uniqueIntersections.push(intersection);
      } else {
        // Duplicate found at same spatial location - this means we hit a vertex
        // For vertex intersections, prefer the edge with t closer to 0 (start of edge)
        // This ensures more stable polygon construction
        const existing = uniqueIntersections[existingIndex];
        if (intersection.t < existing.t) {
          uniqueIntersections[existingIndex] = intersection;
        }
      }
    }

    // Only replace intersections if deduplication actually reduced the count
    // This prevents breaking cases where we legitimately have multiple distinct intersections
    if (
      uniqueIntersections.length < intersections.length &&
      uniqueIntersections.length >= 2
    ) {
      intersections.length = 0;
      intersections.push(...uniqueIntersections);
    }
  }

  // Need exactly 2 intersections for a valid slice
  if (intersections.length !== 2) {
    return null;
  }

  // Sort intersections by edge index and t parameter
  intersections.sort((a, b) => {
    if (a.edgeIndex !== b.edgeIndex) return a.edgeIndex - b.edgeIndex;
    return a.t - b.t;
  });

  // Build the two new polygons
  const polygon1Points: Point[] = [];
  const polygon2Points: Point[] = [];

  // Sort intersections by their position along the slice line to ensure consistent ordering
  const sliceLineLength = Math.sqrt(
    Math.pow(sliceEnd.x - sliceStart.x, 2) +
      Math.pow(sliceEnd.y - sliceStart.y, 2)
  );

  // Check for degenerate slice line (too short length)
  if (sliceLineLength < 1) {
    const validation = validateSliceLine(polygon, sliceStart, sliceEnd);
    return null;
  }

  // Calculate position along slice line for each intersection
  const intersectionsWithPosition = intersections.map(intersection => {
    const distFromStart = Math.sqrt(
      Math.pow(intersection.point.x - sliceStart.x, 2) +
        Math.pow(intersection.point.y - sliceStart.y, 2)
    );
    return {
      ...intersection,
      positionOnSlice: distFromStart / sliceLineLength,
    };
  });

  // Sort by position along the slice line
  intersectionsWithPosition.sort(
    (a, b) => a.positionOnSlice - b.positionOnSlice
  );

  const firstIntersection = intersectionsWithPosition[0];
  const secondIntersection = intersectionsWithPosition[1];

  // Build polygons by traversing vertices in order
  // First polygon: from first intersection, through vertices, to second intersection
  polygon1Points.push(firstIntersection.point);

  let currentIndex = (firstIntersection.edgeIndex + 1) % points.length;
  let safetyCounter = 0;
  const maxIterations = points.length;

  // Add all vertices between first and second intersection (going clockwise)
  while (
    currentIndex !== (secondIntersection.edgeIndex + 1) % points.length &&
    safetyCounter < maxIterations
  ) {
    const vertex = points[currentIndex];
    // Only add vertex if it's not identical to our intersection points
    const VERTEX_EPSILON = 1e-10;
    const isIdenticalToFirst =
      Math.abs(vertex.x - firstIntersection.point.x) < VERTEX_EPSILON &&
      Math.abs(vertex.y - firstIntersection.point.y) < VERTEX_EPSILON;
    const isIdenticalToSecond =
      Math.abs(vertex.x - secondIntersection.point.x) < VERTEX_EPSILON &&
      Math.abs(vertex.y - secondIntersection.point.y) < VERTEX_EPSILON;

    if (!isIdenticalToFirst && !isIdenticalToSecond) {
      polygon1Points.push(vertex);
    }
    currentIndex = (currentIndex + 1) % points.length;
    safetyCounter++;
  }

  if (safetyCounter >= maxIterations) {
    logger.warn(
      'Infinite loop prevention triggered in polygon slicing (first traversal)'
    );
    return null;
  }

  polygon1Points.push(secondIntersection.point);

  // Second polygon: from second intersection, through remaining vertices, to first intersection
  polygon2Points.push(secondIntersection.point);

  currentIndex = (secondIntersection.edgeIndex + 1) % points.length;
  safetyCounter = 0;

  // Add all vertices between second and first intersection (going clockwise)
  while (
    currentIndex !== (firstIntersection.edgeIndex + 1) % points.length &&
    safetyCounter < maxIterations
  ) {
    const vertex = points[currentIndex];
    // Only add vertex if it's not identical to our intersection points
    const VERTEX_EPSILON = 1e-10;
    const isIdenticalToFirst =
      Math.abs(vertex.x - firstIntersection.point.x) < VERTEX_EPSILON &&
      Math.abs(vertex.y - firstIntersection.point.y) < VERTEX_EPSILON;
    const isIdenticalToSecond =
      Math.abs(vertex.x - secondIntersection.point.x) < VERTEX_EPSILON &&
      Math.abs(vertex.y - secondIntersection.point.y) < VERTEX_EPSILON;

    if (!isIdenticalToFirst && !isIdenticalToSecond) {
      polygon2Points.push(vertex);
    }
    currentIndex = (currentIndex + 1) % points.length;
    safetyCounter++;
  }

  if (safetyCounter >= maxIterations) {
    logger.warn(
      'Infinite loop prevention triggered in polygon slicing (second traversal)'
    );
    return null;
  }

  polygon2Points.push(firstIntersection.point);

  // Clean up any duplicate consecutive points that can occur when slicing through vertices
  // Special handling for degenerate cases with too few unique points
  const cleanPoints = (points: Point[]): Point[] => {
    if (points.length <= 3) return points;

    const cleaned: Point[] = [points[0]];
    const EPSILON = 1e-10;

    for (let i = 1; i < points.length; i++) {
      const current = points[i];
      const previous = cleaned[cleaned.length - 1];

      // Skip if current point is too close to the previous point
      if (
        Math.abs(current.x - previous.x) > EPSILON ||
        Math.abs(current.y - previous.y) > EPSILON
      ) {
        cleaned.push(current);
      }
    }

    // Check if last point is too close to first point
    if (cleaned.length > 3) {
      const first = cleaned[0];
      const last = cleaned[cleaned.length - 1];
      if (
        Math.abs(first.x - last.x) < EPSILON &&
        Math.abs(first.y - last.y) < EPSILON
      ) {
        cleaned.pop(); // Remove duplicate last point
      }
    }

    // For degenerate slices that result in line segments, create a minimal triangle
    // by slightly offsetting one of the points to create a valid polygon
    if (cleaned.length === 2) {
      const p1 = cleaned[0];
      const p2 = cleaned[1];

      // Create a third point that's slightly offset perpendicular to the line
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);

      if (length > 0) {
        // Create perpendicular offset (very small)
        const offsetDistance = Math.max(1e-6, length * 1e-6);
        const perpX = (-dy / length) * offsetDistance;
        const perpY = (dx / length) * offsetDistance;

        // Add offset point at midpoint of the line
        const midX = (p1.x + p2.x) / 2 + perpX;
        const midY = (p1.y + p2.y) / 2 + perpY;

        cleaned.splice(1, 0, { x: midX, y: midY });
      }
    }

    return cleaned;
  };

  const cleanPolygon1Points = cleanPoints(polygon1Points);
  const cleanPolygon2Points = cleanPoints(polygon2Points);

  // Ensure both polygons have at least 3 points
  if (cleanPolygon1Points.length < 3 || cleanPolygon2Points.length < 3) {
    return null;
  }

  // Create new polygon objects
  const newPolygon1 = createPolygon(cleanPolygon1Points, polygon.color);
  const newPolygon2 = createPolygon(cleanPolygon2Points, polygon.color);

  // Copy additional properties if they exist
  if (polygon.confidence !== undefined) {
    newPolygon1.confidence = polygon.confidence;
    newPolygon2.confidence = polygon.confidence;
  }

  return [newPolygon1, newPolygon2];
}

/**
 * Validate if a slice line is valid for a given polygon
 * If the line segment doesn't intersect properly, try extending it to an infinite line
 */
export function validateSliceLine(
  polygon: Polygon,
  sliceStart: Point,
  sliceEnd: Point
): {
  isValid: boolean;
  reason?: string;
  intersectionCount?: number;
  extendedToInfiniteLine?: boolean;
} {
  if (!polygon.points || polygon.points.length < 3) {
    return { isValid: false, reason: 'Polygon must have at least 3 points' };
  }

  // Check if slice line has valid length
  const dx = sliceEnd.x - sliceStart.x;
  const dy = sliceEnd.y - sliceStart.y;
  const lineLength = Math.sqrt(dx * dx + dy * dy);

  if (lineLength < 1) {
    return { 
      isValid: false, 
      reason: 'Slice line is too short - draw points further apart (minimum 1 pixel distance)' 
    };
  }

  // First, try with the line segment (original behavior)
  let intersectionCount = 0;
  const points = polygon.points;
  const intersectionPoints: Point[] = [];

  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const intersection = lineIntersection(
      sliceStart,
      sliceEnd,
      points[i],
      points[j]
    );

    if (intersection) {
      intersectionCount++;
      intersectionPoints.push(intersection);
    }
  }

  // If we have exactly 2 intersections with the segment, we're good
  if (intersectionCount === 2) {
    // Valid slice line - found 2 intersections with line segment
    return { isValid: true, intersectionCount };
  }

  // Log the segment attempt for debugging
  // Line segment intersections logged for debugging

  // If we have 0 or 1 intersections with the segment, try extending to infinite line
  // This handles cases where one or both slice points are inside the polygon
  let rayIntersectionCount = 0;
  const rayIntersectionPoints: Point[] = [];

  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const intersection = lineRayIntersection(
      sliceStart,
      sliceEnd,
      points[i],
      points[j]
    );

    if (intersection) {
      rayIntersectionCount++;
      rayIntersectionPoints.push(intersection);
    }
  }

  // Infinite line intersections logged for debugging

  // If the infinite line has exactly 2 intersections, the slice can work
  if (rayIntersectionCount === 2) {
    // Valid slice line - found 2 intersections with infinite line
    return {
      isValid: true,
      intersectionCount: rayIntersectionCount,
      extendedToInfiniteLine: true,
    };
  }

  // Provide detailed feedback about why the slice failed
  let detailedReason = '';
  
  if (intersectionCount === 0 && rayIntersectionCount === 0) {
    detailedReason = 'Slice line does not intersect the polygon. Try drawing the line across the polygon edges.';
  } else if (intersectionCount === 1 && rayIntersectionCount === 1) {
    detailedReason = 'Slice line only touches the polygon at one point. Draw the line completely across the polygon.';
  } else if (intersectionCount > 2 || rayIntersectionCount > 2) {
    detailedReason = `Slice line intersects too many polygon edges (${Math.max(intersectionCount, rayIntersectionCount)} intersections). Try a simpler cut across the polygon.`;
  } else {
    detailedReason = `Unexpected intersection pattern. Line segment: ${intersectionCount} intersections, infinite line: ${rayIntersectionCount} intersections.`;
  }

  console.warn('[Slice Validation] ❌ Invalid slice:', detailedReason);

  // Neither segment nor infinite line work
  return {
    isValid: false,
    reason: detailedReason,
    intersectionCount: Math.max(intersectionCount, rayIntersectionCount),
  };
}

/**
 * Find suggested slice points that would create a valid slice
 * This can be used for UI hints or automatic slice suggestions
 */
export function findSliceHints(polygon: Polygon, startPoint?: Point): Point[] {
  const hints: Point[] = [];

  if (!polygon.points || polygon.points.length < 4) {
    return hints; // Need at least 4 points to slice meaningfully
  }

  if (startPoint) {
    // Find points that would create valid slices from the start point
    const points = polygon.points;

    for (let i = 0; i < points.length; i++) {
      const candidate = points[i];

      // Skip if too close to start point
      const dx = candidate.x - startPoint.x;
      const dy = candidate.y - startPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 10) continue; // Minimum distance threshold

      const validation = validateSliceLine(polygon, startPoint, candidate);
      if (validation.isValid) {
        hints.push(candidate);
      }
    }
  }

  return hints;
}

/**
 * Calculate the optimal slice line that would create two polygons with similar areas
 */
export function findBalancedSlice(
  polygon: Polygon,
  precision: number = 10
): { start: Point; end: Point } | null {
  if (!polygon.points || polygon.points.length < 4) {
    return null;
  }

  let bestSlice: { start: Point; end: Point; areaDifference: number } | null =
    null;

  // Sample points along polygon perimeter
  const points = polygon.points;
  const samplePoints: Point[] = [];

  for (let i = 0; i < points.length; i++) {
    samplePoints.push(points[i]);

    // Add intermediate points along edges for better precision
    const nextIndex = (i + 1) % points.length;
    const edge = {
      start: points[i],
      end: points[nextIndex],
    };

    for (let t = 0.2; t < 1; t += 0.2) {
      samplePoints.push({
        x: edge.start.x + t * (edge.end.x - edge.start.x),
        y: edge.start.y + t * (edge.end.y - edge.start.y),
      });
    }
  }

  // Try all combinations of sample points
  for (let i = 0; i < samplePoints.length; i++) {
    for (let j = i + precision; j < samplePoints.length; j++) {
      const start = samplePoints[i];
      const end = samplePoints[j];

      const result = slicePolygon(polygon, start, end);
      if (result) {
        const [poly1, poly2] = result;
        const area1 = calculatePolygonArea(poly1.points);
        const area2 = calculatePolygonArea(poly2.points);
        const areaDifference = Math.abs(area1 - area2);

        if (!bestSlice || areaDifference < bestSlice.areaDifference) {
          bestSlice = { start, end, areaDifference };
        }
      }
    }
  }

  return bestSlice ? { start: bestSlice.start, end: bestSlice.end } : null;
}

// Note: calculatePolygonArea is now imported from polygonGeometry.ts to avoid code duplication
