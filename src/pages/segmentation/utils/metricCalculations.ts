import { Point } from '@/lib/segmentation';
import { calculatePolygonArea, calculatePerimeter } from '@/lib/segmentation';
import { logger } from '@/lib/logger';

// Type for a 2D vector
interface Vector2D {
  x: number;
  y: number;
}

/**
 * Calculate convex hull using Graham scan algorithm
 */
function calculateConvexHull(points: Point[]): Point[] {
  if (points.length < 3) return points;

  // Sort points by x-coordinate, then by y-coordinate
  const sortedPoints = [...points].sort((a, b) => {
    if (a.x === b.x) return a.y - b.y;
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
 * Calculate cross product for convex hull algorithm
 */
function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Calculate distance between two points
 */
function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate the distance from a point to a line defined by two points
 */
function pointToLineDistance(
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

  if (lenSq === 0) return distance(point, lineStart);

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
 * Rotating calipers algorithm to find Feret diameters
 * Returns max, min, and orthogonal Feret diameters
 */
function rotatingCalipers(hull: Point[]): {
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

    // Find the furthest point from this edge
    for (let k = 0; k < hull.length; k++) {
      if (k === i || k === j) continue;
      const dist = pointToLineDistance(hull[k], hull[i], hull[j]);
      maxDistFromEdge = Math.max(maxDistFromEdge, dist);
    }

    // The caliper width for this orientation is the distance to the furthest point
    if (maxDistFromEdge > 0 && maxDistFromEdge < minDist) {
      minDist = maxDistFromEdge;
    }
  }

  // Find orthogonal Feret diameter
  // This is the width perpendicular to the maximum Feret diameter
  if (maxPair) {
    const [p1, p2] = maxPair;
    let maxOrthDist = 0;

    // Find the maximum perpendicular distance from the max Feret line
    for (const point of hull) {
      const dist = pointToLineDistance(point, p1, p2);
      maxOrthDist = Math.max(maxOrthDist, dist);
    }

    orthogonalDist = maxOrthDist * 2; // Width is twice the max distance from centerline
  }

  // Handle edge cases
  if (minDist === Infinity) {
    // Fallback for degenerate cases
    minDist = maxDist;
  }

  return {
    max: maxDist,
    min: minDist,
    orthogonal: orthogonalDist,
  };
}

export interface PolygonMetrics {
  Area: number;
  Perimeter: number;
  EquivalentDiameter: number;
  Circularity: number;
  FeretDiameterMax: number;
  FeretDiameterOrthogonal: number; // Perpendicular to max Feret
  FeretDiameterMin: number;
  FeretAspectRatio: number;
  BoundingBoxWidth: number; // Axis-aligned bounding box width
  BoundingBoxHeight: number; // Axis-aligned bounding box height
  Extent: number; // Renamed from Compactness - area/bbox_area
  Convexity: number;
  Solidity: number;
  // Sphericity removed - it's a 3D metric
}

// Validate polygon points
const validatePolygonPoints = (
  points: Array<{ x: number; y: number }>
): boolean => {
  if (!points || points.length < 3) return false;

  return points.every(
    point =>
      point !== null &&
      point !== undefined &&
      typeof point.x === 'number' &&
      typeof point.y === 'number' &&
      !isNaN(point.x) &&
      !isNaN(point.y) &&
      isFinite(point.x) &&
      isFinite(point.y)
  );
};

// Calculate bounding box for polygon
const calculateBoundingBox = (points: Array<{ x: number; y: number }>) => {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
};

// Calculate metrics with proper scientific formulas
export const calculateMetrics = (
  polygon: { points: Array<{ x: number; y: number }> },
  holes: Array<{ points: Array<{ x: number; y: number }> }> = []
): PolygonMetrics => {
  // Validate polygon points
  if (!validatePolygonPoints(polygon.points)) {
    logger.warn('Invalid polygon points detected, returning zero metrics');
    return {
      Area: 0,
      Perimeter: 0,
      EquivalentDiameter: 0,
      Circularity: 0,
      FeretDiameterMax: 0,
      FeretDiameterOrthogonal: 0,
      FeretDiameterMin: 0,
      FeretAspectRatio: 0,
      BoundingBoxWidth: 0,
      BoundingBoxHeight: 0,
      Extent: 0,
      Convexity: 0,
      Solidity: 0,
    };
  }

  // Calculate actual area (subtract hole areas)
  // Uses Shoelace formula, handles polygon closure automatically
  const mainArea = calculatePolygonArea(polygon.points);
  const holesArea = holes
    .filter(hole => validatePolygonPoints(hole.points))
    .reduce((sum, hole) => sum + calculatePolygonArea(hole.points), 0);
  const area = Math.max(0, mainArea - holesArea);

  // Calculate perimeter (outer + all holes, following ImageJ convention)
  // This ensures perimeter includes both outer boundary and hole boundaries
  let perimeter = calculatePerimeter(polygon.points);

  // Add perimeters of all holes to total perimeter
  for (const hole of holes) {
    if (validatePolygonPoints(hole.points)) {
      perimeter += calculatePerimeter(hole.points);
    }
  }

  // Calculate circularity: 4π × area / perimeter²
  // Naturally ≤ 1, clamped to handle discretization artifacts
  const circularity =
    perimeter > 0
      ? Math.min(1.0, (4 * Math.PI * area) / (perimeter * perimeter))
      : 0;

  // Calculate bounding box for extent calculation
  const bbox = calculateBoundingBox(polygon.points);
  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;
  const boundingBoxArea = width * height;

  // Extent (formerly misnamed as Compactness): area / bounding box area
  // Measures how much of the bounding box is filled by the shape [0,1]
  const extent = boundingBoxArea > 0 ? area / boundingBoxArea : 0;

  // Calculate convex hull for convexity, solidity, and Feret diameters
  const convexHull = calculateConvexHull(polygon.points);
  const convexArea = calculatePolygonArea(convexHull);
  const convexPerimeter = calculatePerimeter(convexHull);

  // Convexity = perimeter of convex hull / perimeter of polygon
  // Values in (0,1], equals 1 for convex shapes
  const convexity = perimeter > 0 ? convexPerimeter / perimeter : 0;

  // Solidity = area of polygon / area of convex hull
  // Measures how "solid" or filled the shape is
  const solidity = convexArea > 0 ? area / convexArea : 0;

  // Calculate proper Feret diameters using rotating calipers on convex hull
  const feretDiameters = rotatingCalipers(convexHull);

  // Aspect ratio from proper Feret diameters
  const aspectRatio =
    feretDiameters.min > 0 ? feretDiameters.max / feretDiameters.min : 0;

  // Equivalent diameter: diameter of circle with same area
  const equivalentDiameter = Math.sqrt((4 * area) / Math.PI);

  return {
    Area: area,
    Perimeter: perimeter,
    EquivalentDiameter: equivalentDiameter,
    Circularity: circularity,
    FeretDiameterMax: feretDiameters.max,
    FeretDiameterOrthogonal: feretDiameters.orthogonal,
    FeretDiameterMin: feretDiameters.min,
    FeretAspectRatio: aspectRatio,
    BoundingBoxWidth: width,
    BoundingBoxHeight: height,
    Extent: extent,
    Convexity: convexity,
    Solidity: solidity,
  };
};

// Format number for display
export const formatNumber = (value: number): string => {
  return value.toFixed(4);
};
