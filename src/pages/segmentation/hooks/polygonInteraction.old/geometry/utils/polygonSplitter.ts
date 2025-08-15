
import { Point } from '@/lib/segmentation';
import { Intersection } from './intersectionUtils';
import { v4 as uuidv4 } from 'uuid';

export interface SliceOperation {
  polygonId: string;
  startPoint: Point;
  endPoint: Point;
}

export interface PolygonSplitResult {
  poly1Points: Point[];
  poly2Points: Point[];
}

/**
 * Implementation of polygon splitting algorithms
 */
export const polygonSplitUtils = {
  /**
   * Split the polygon into two separate paths based on intersections
   */
  splitPolygonPaths: (
    polygonPoints: Point[],
    intersections: Intersection[]
  ): PolygonSplitResult => {
    // Sort intersections by their order in the polygon
    intersections.sort((a, b) => {
      if (a.segmentIndex !== b.segmentIndex) {
        return a.segmentIndex - b.segmentIndex;
      }
      return a.t - b.t;
    });
    
    const [int1, int2] = intersections;
    
    // Create two new polygons
    const poly1Points: Point[] = [];
    const poly2Points: Point[] = [];
    
    // First part: from first intersection to second, clockwise
    let i = int1.segmentIndex;
    poly1Points.push(int1.point);
    
    while (i !== int2.segmentIndex) {
      i = (i + 1) % polygonPoints.length;
      poly1Points.push(polygonPoints[i]);
    }
    
    poly1Points.push(int2.point);
    
    // Second part: from second intersection to first, clockwise
    i = int2.segmentIndex;
    poly2Points.push(int2.point);
    
    while (i !== int1.segmentIndex) {
      i = (i + 1) % polygonPoints.length;
      poly2Points.push(polygonPoints[i]);
    }
    
    poly2Points.push(int1.point);
    
    return { poly1Points, poly2Points };
  },

  /**
   * Calculate a combined score for polygon selection based on area and perimeter
   */
  calculatePolygonScore: (
    points: Point[],
    calculatePolygonArea: (points: Point[]) => number,
    calculatePathLength: (points: Point[]) => number
  ): number => {
    const area = calculatePolygonArea(points);
    const length = calculatePathLength(points);
    
    // Weighted score (larger area and perimeter is generally more important)
    return (area * 0.7) + (length * 0.3);
  }
};
