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

// Simulate metrics calculation (would be calculated using OpenCV in reality)
export const calculateMetrics = (
  polygon: { points: Array<{ x: number; y: number }> },
  holes: Array<{ points: Array<{ x: number; y: number }> }> = []
): PolygonMetrics => {
  // Calculate actual area (subtract hole areas)
  const mainArea = calculatePolygonArea(polygon.points);
  const holesArea = holes.reduce(
    (sum, hole) => sum + calculatePolygonArea(hole.points),
    0
  );
  const area = mainArea - holesArea;

  // Calculate perimeter
  const perimeter = calculatePerimeter(polygon.points);

  // Calculate circularity: 4π × area / perimeter²
  const circularity = (4 * Math.PI * area) / (perimeter * perimeter);

  // Other metrics based on area and perimeter
  return {
    Area: area,
    Perimeter: perimeter,
    EquivalentDiameter: Math.sqrt((4 * area) / Math.PI),
    Circularity: circularity,
    FeretDiameterMax: Math.random() * 100 + 20,
    FeretDiameterMaxOrthogonalDistance: Math.random() * 50 + 10,
    FeretDiameterMin: Math.random() * 40 + 10,
    FeretAspectRatio: Math.random() * 3 + 1,
    LengthMajorDiameterThroughCentroid: Math.random() * 80 + 20,
    LengthMinorDiameterThroughCentroid: Math.random() * 40 + 10,
    Compactness: Math.random() * 0.5 + 0.5,
    Convexity: Math.random() * 0.3 + 0.7,
    Solidity: Math.random() * 0.2 + 0.8,
    Sphericity: Math.random() * 0.4 + 0.6,
  };
};

// Format number for display
export const formatNumber = (value: number): string => {
  return value.toFixed(4);
};
