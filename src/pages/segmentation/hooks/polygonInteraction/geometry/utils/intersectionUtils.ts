
import { Point } from '@/lib/segmentation';

export interface Intersection {
  point: Point;
  segmentIndex: number;
  t: number; // parametrická hodnota podél segmentu (0-1)
}

/**
 * Utility functions for calculating intersections between lines and polygons
 */
export const intersectionUtils = {
  /**
   * Calculate intersections between a line and polygon segments
   */
  calculateIntersections: (
    polygonPoints: Point[],
    line: [Point, Point]
  ): Intersection[] => {
    const intersections: Intersection[] = [];
    const [p1, p2] = line;

    // Check each polygon segment for intersections with the slice line
    for (let i = 0; i < polygonPoints.length; i++) {
      const j = (i + 1) % polygonPoints.length; // Zajistí uzavření polygonu
      const p3 = polygonPoints[i];
      const p4 = polygonPoints[j];

      // Calculate intersection using parametric equations:
      // P = p1 + t * (p2 - p1)
      // Q = p3 + s * (p4 - p3)
      // Find t and s where P = Q and 0 <= t,s <= 1
      
      const denominator = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
      
      // Skip parallel lines (denominator = 0)
      if (Math.abs(denominator) < 0.0001) continue;
      
      const t = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denominator;
      const s = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denominator;
      
      // Intersection exists only if t and s are in [0, 1]
      if (t >= 0 && t <= 1 && s >= 0 && s <= 1) {
        const point = {
          x: p1.x + t * (p2.x - p1.x),
          y: p1.y + t * (p2.y - p1.y)
        };
        
        // Special case: intersection is at a polygon vertex
        const isVertex = (
          (Math.abs(point.x - p3.x) < 0.0001 && Math.abs(point.y - p3.y) < 0.0001) ||
          (Math.abs(point.x - p4.x) < 0.0001 && Math.abs(point.y - p4.y) < 0.0001)
        );
        
        // Ignore intersections that are exactly at vertices
        if (!isVertex) {
          intersections.push({
            point,
            segmentIndex: i,
            t: s // parametric value along polygon segment
          });
        }
      }
    }
    
    return intersections;
  },

  /**
   * Calculate polygon area for use in polygon splitting operations
   */
  calculatePolygonArea: (points: Point[]): number => {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
  }
};
