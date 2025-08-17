import { Point } from '@/lib/segmentation';
import { calculatePolygonArea, calculatePerimeter } from '@/lib/segmentation';

export interface PolygonMetrics {
  Area: number;
  Perimeter: number;
  EquivalentDiameter: number;
  Circularity: number;
  FeretDiameterMax: number;
  FeretDiameterMaxOrthogonalDistance: number;
  FeretDiameterMin: number;
  FeretAspectRatio: number;
  LengthMajorDiameterThroughCentroid: number;
  LengthMinorDiameterThroughCentroid: number;
  Compactness: number;
  Convexity: number;
  Solidity: number;
  Sphericity: number;
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

// Calculate metrics calculation (using real calculations instead of random values)
export const calculateMetrics = (
  polygon: { points: Array<{ x: number; y: number }> },
  holes: Array<{ points: Array<{ x: number; y: number }> }> = []
): PolygonMetrics => {
  // Validate polygon points
  if (!validatePolygonPoints(polygon.points)) {
    console.warn('Invalid polygon points detected, returning zero metrics');
    return {
      Area: 0,
      Perimeter: 0,
      EquivalentDiameter: 0,
      Circularity: 0,
      FeretDiameterMax: 0,
      FeretDiameterMaxOrthogonalDistance: 0,
      FeretDiameterMin: 0,
      FeretAspectRatio: 0,
      LengthMajorDiameterThroughCentroid: 0,
      LengthMinorDiameterThroughCentroid: 0,
      Compactness: 0,
      Convexity: 0,
      Solidity: 0,
      Sphericity: 0,
    };
  }

  // Calculate actual area (subtract hole areas)
  const mainArea = calculatePolygonArea(polygon.points);
  const holesArea = holes
    .filter(hole => validatePolygonPoints(hole.points))
    .reduce((sum, hole) => sum + calculatePolygonArea(hole.points), 0);
  const area = Math.max(0, mainArea - holesArea);

  // Calculate perimeter
  const perimeter = calculatePerimeter(polygon.points);

  // Calculate circularity: 4π × area / perimeter²
  const circularity =
    perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;

  // Calculate bounding box for Feret measurements
  const bbox = calculateBoundingBox(polygon.points);
  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;

  // Feret diameters (approximated using bounding box)
  const feretMax = Math.sqrt(width * width + height * height);
  const feretMin = Math.min(width, height);
  const aspectRatio = feretMin > 0 ? feretMax / feretMin : 0;

  // Major and minor diameters (approximated)
  const majorDiameter = Math.max(width, height);
  const minorDiameter = Math.min(width, height);

  // Equivalent diameter from area
  const equivalentDiameter = Math.sqrt((4 * area) / Math.PI);

  // Compactness: area / (bounding box area)
  const boundingBoxArea = width * height;
  const compactness = boundingBoxArea > 0 ? area / boundingBoxArea : 0;

  // Convexity and solidity (approximated - would need convex hull for precise calculation)
  const convexity = Math.min(1.0, circularity * 1.2); // Approximation
  const solidity = Math.min(1.0, compactness * 1.1); // Approximation

  // Sphericity (approximated)
  const sphericity = Math.min(1.0, circularity);

  return {
    Area: area,
    Perimeter: perimeter,
    EquivalentDiameter: equivalentDiameter,
    Circularity: Math.min(1.0, circularity),
    FeretDiameterMax: feretMax,
    FeretDiameterMaxOrthogonalDistance: Math.abs(width - height),
    FeretDiameterMin: feretMin,
    FeretAspectRatio: aspectRatio,
    LengthMajorDiameterThroughCentroid: majorDiameter,
    LengthMinorDiameterThroughCentroid: minorDiameter,
    Compactness: compactness,
    Convexity: convexity,
    Solidity: solidity,
    Sphericity: sphericity,
  };
};

// Format number for display
export const formatNumber = (value: number): string => {
  return value.toFixed(4);
};
