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
      // Calculate parameter t along the edge for sorting intersections
      const edgeLength = Math.sqrt(
        Math.pow(points[j].x - points[i].x, 2) +
          Math.pow(points[j].y - points[i].y, 2)
      );
      const intersectionDist = Math.sqrt(
        Math.pow(intersection.x - points[i].x, 2) +
          Math.pow(intersection.y - points[i].y, 2)
      );
      const t = edgeLength > 0 ? intersectionDist / edgeLength : 0;

      intersections.push({ point: intersection, edgeIndex: i, t });
    }
  }

  // If we don't have exactly 2 intersections with the segment, try infinite line
  if (intersections.length !== 2) {
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
        // Calculate parameter t along the edge for sorting intersections
        const edgeLength = Math.sqrt(
          Math.pow(points[j].x - points[i].x, 2) +
            Math.pow(points[j].y - points[i].y, 2)
        );
        const intersectionDist = Math.sqrt(
          Math.pow(intersection.x - points[i].x, 2) +
            Math.pow(intersection.y - points[i].y, 2)
        );
        const t = edgeLength > 0 ? intersectionDist / edgeLength : 0;

        intersections.push({ point: intersection, edgeIndex: i, t });
      }
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

  // First polygon: from first intersection to second intersection (clockwise)
  polygon1Points.push(firstIntersection.point);

  let currentIndex = (firstIntersection.edgeIndex + 1) % points.length;
  let safetyCounter = 0;
  const maxIterations = points.length;

  // Add all vertices between first and second intersection
  while (
    currentIndex !== (secondIntersection.edgeIndex + 1) % points.length &&
    safetyCounter < maxIterations
  ) {
    polygon1Points.push(points[currentIndex]);
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

  // Second polygon: from second intersection to first intersection (clockwise)
  polygon2Points.push(secondIntersection.point);

  currentIndex = (secondIntersection.edgeIndex + 1) % points.length;
  safetyCounter = 0;

  // Add all vertices between second and first intersection
  while (
    currentIndex !== (firstIntersection.edgeIndex + 1) % points.length &&
    safetyCounter < maxIterations
  ) {
    polygon2Points.push(points[currentIndex]);
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

  // Ensure both polygons have at least 3 points
  if (polygon1Points.length < 3 || polygon2Points.length < 3) {
    return null;
  }

  // Create new polygon objects
  const newPolygon1 = createPolygon(polygon1Points, polygon.color);
  const newPolygon2 = createPolygon(polygon2Points, polygon.color);

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
    return { isValid: false, reason: 'Slice line is too short' };
  }

  // First, try with the line segment (original behavior)
  let intersectionCount = 0;
  const points = polygon.points;

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
    }
  }

  // If we have exactly 2 intersections with the segment, we're good
  if (intersectionCount === 2) {
    return { isValid: true, intersectionCount };
  }

  // If we have 0 or 1 intersections with the segment, try extending to infinite line
  // This handles cases where one or both slice points are inside the polygon
  let rayIntersectionCount = 0;

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
    }
  }

  // If the infinite line has exactly 2 intersections, the slice can work
  if (rayIntersectionCount === 2) {
    return {
      isValid: true,
      intersectionCount: rayIntersectionCount,
      extendedToInfiniteLine: true,
    };
  }

  // Neither segment nor infinite line work
  return {
    isValid: false,
    reason: `Expected 2 intersections, found ${intersectionCount} with segment, ${rayIntersectionCount} with infinite line`,
    intersectionCount,
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
