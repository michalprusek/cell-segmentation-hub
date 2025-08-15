import type { Point, Polygon } from './segmentation';

/**
 * Advanced geometry utilities for polygon operations
 * Inspired by SpheroSeg implementation
 */

/**
 * Calculate the distance from a point to a line segment
 */
export const distanceToSegment = (point: Point, segmentStart: Point, segmentEnd: Point): number => {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;
  
  if (dx === 0 && dy === 0) {
    // Segment is a point, return distance to that point
    const pdx = point.x - segmentStart.x;
    const pdy = point.y - segmentStart.y;
    return Math.sqrt(pdx * pdx + pdy * pdy);
  }
  
  // Calculate the parameter t where the closest point on the segment is
  const t = Math.max(0, Math.min(1, 
    ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) / (dx * dx + dy * dy)
  ));
  
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
 * Check if a point is inside a polygon using ray casting algorithm
 */
export const isPointInPolygon = (point: Point, polygonPoints: Point[]): boolean => {
  const x = point.x;
  const y = point.y;
  let inside = false;

  for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
    const xi = polygonPoints[i].x;
    const yi = polygonPoints[i].y;
    const xj = polygonPoints[j].x;
    const yj = polygonPoints[j].y;

    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
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
    color: color || '#ff0000'
  };
};

/**
 * Calculate line intersection between two line segments
 */
export const lineIntersection = (
  p1: Point, p2: Point, // First line segment
  p3: Point, p4: Point  // Second line segment
): Point | null => {
  const x1 = p1.x, y1 = p1.y;
  const x2 = p2.x, y2 = p2.y;
  const x3 = p3.x, y3 = p3.y;
  const x4 = p4.x, y4 = p4.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  
  // Lines are parallel
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  // Check if intersection is within both line segments
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1)
    };
  }

  return null;
};

/**
 * Check which side of a line a point is on
 * Returns positive if point is on the left, negative if on the right, 0 if on the line
 */
export const pointSideOfLine = (point: Point, lineStart: Point, lineEnd: Point): number => {
  return (lineEnd.x - lineStart.x) * (point.y - lineStart.y) - 
         (lineEnd.y - lineStart.y) * (point.x - lineStart.x);
};

/**
 * Find the closest vertex in a polygon to a given point
 */
export const findClosestVertex = (point: Point, polygonPoints: Point[], maxDistance?: number): {
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

  if (closestIndex === -1 || (maxDistance !== undefined && minDistance > maxDistance)) {
    return null;
  }

  return {
    index: closestIndex,
    distance: minDistance
  };
};

/**
 * Find the closest segment in a polygon to a given point
 */
export const findClosestSegment = (point: Point, polygonPoints: Point[], maxDistance?: number): {
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
      const t = Math.max(0, Math.min(1, 
        ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / (dx * dx + dy * dy)
      ));
      
      projectedPoint = {
        x: p1.x + t * dx,
        y: p1.y + t * dy
      };
    }
  }

  if (closestStartIndex === -1 || (maxDistance !== undefined && minDistance > maxDistance)) {
    return null;
  }

  return {
    startIndex: closestStartIndex,
    endIndex: (closestStartIndex + 1) % polygonPoints.length,
    distance: minDistance,
    projectedPoint
  };
};

/**
 * Calculate bounding box of a polygon
 */
export const calculateBoundingBox = (points: Point[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
} => {
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
    height: maxY - minY
  };
};