
import { useCallback } from 'react';
import { Point } from '@/lib/segmentation';

/**
 * Hook containing geometry utility functions for polygon editing
 */
export const useGeometryUtils = () => {
  /**
   * Calculate Euclidean distance between two points
   */
  const distance = useCallback((p1: Point, p2: Point): number => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }, []);

  /**
   * Find the closest point on a line segment to a given point
   */
  const findClosestPointOnSegment = useCallback((
    p: Point, 
    v: Point, 
    w: Point
  ): { point: Point, distance: number, t: number } => {
    // Line segment defined by points v and w
    // Return closest point on segment to point p
    
    const l2 = Math.pow(w.x - v.x, 2) + Math.pow(w.y - v.y, 2);
    if (l2 === 0) {
      // v and w are the same point
      return { point: v, distance: distance(p, v), t: 0 };
    }
    
    // Consider line extending the segment, with v at t=0 and w at t=1
    // Closest point on infinite line is:
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    
    // Clamp to segment
    t = Math.max(0, Math.min(1, t));
    
    // Find projected point
    const projectedPoint = {
      x: v.x + t * (w.x - v.x),
      y: v.y + t * (w.y - v.y)
    };
    
    // Calculate distance
    const dist = distance(p, projectedPoint);
    
    return { point: projectedPoint, distance: dist, t };
  }, [distance]);

  /**
   * Determines which path between two points in a polygon forms a shorter perimeter
   */
  const findShortestPath = useCallback((
    points: Point[],
    startIndex: number,
    endIndex: number
  ) => {
    const totalPoints = points.length;
    
    // Function to calculate segment length
    const segmentLength = (idx1: number, idx2: number) => {
      const p1 = points[idx1];
      const p2 = points[idx2];
      return distance(p1, p2);
    };
    
    // Calculate length of path going clockwise
    let clockwiseLength = 0;
    let clockwiseIndices = [];
    
    // Handle clockwise
    let curr = startIndex;
    while (curr !== endIndex) {
      const next = (curr + 1) % totalPoints;
      clockwiseLength += segmentLength(curr, next);
      clockwiseIndices.push(curr);
      curr = next;
    }
    
    // Calculate length of path going counter-clockwise
    let counterClockwiseLength = 0;
    let counterClockwiseIndices = [];
    
    // Handle counter-clockwise
    curr = startIndex;
    while (curr !== endIndex) {
      const prev = (curr - 1 + totalPoints) % totalPoints;
      counterClockwiseLength += segmentLength(curr, prev);
      counterClockwiseIndices.push(curr);
      curr = prev;
    }
    
    // Determine which path is shorter
    if (clockwiseLength <= counterClockwiseLength) {
      // Clockwise path is shorter
      return {
        path: clockwiseIndices,
        replaceIndices: {
          start: startIndex,
          end: endIndex
        }
      };
    } else {
      // Counter-clockwise path is shorter
      return {
        path: counterClockwiseIndices.reverse(),
        replaceIndices: {
          start: startIndex,
          end: endIndex
        }
      };
    }
  }, [distance]);

  /**
   * Calculate total length of the polygon path
   */
  const calculatePathLength = useCallback((points: Point[]): number => {
    let totalLength = 0;
    
    for (let i = 0; i < points.length; i++) {
      const nextIndex = (i + 1) % points.length;
      totalLength += distance(points[i], points[nextIndex]);
    }
    
    return totalLength;
  }, [distance]);

  /**
   * Check if polygon is self-intersecting
   */
  const isPolygonSelfIntersecting = useCallback((points: Point[]): boolean => {
    if (points.length < 3) return false;
    
    // Check all possible pairs of non-adjacent segments
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      
      for (let j = i + 2; j < points.length; j++) {
        if ((i === 0) && (j === points.length - 1)) continue; // Skip check for first and last segments
        
        const c = points[j];
        const d = points[(j + 1) % points.length];
        
        // Check if segments AB and CD intersect
        if (doSegmentsIntersect(a, b, c, d)) {
          return true;
        }
      }
    }
    
    return false;
  }, []);

  /**
   * Helper function to check if two segments intersect
   */
  const doSegmentsIntersect = useCallback((a: Point, b: Point, c: Point, d: Point): boolean => {
    // Calculate direction values
    const d1x = b.x - a.x;
    const d1y = b.y - a.y;
    const d2x = d.x - c.x;
    const d2y = d.y - c.y;
    
    // Calculate determinant
    const determinant = d1x * d2y - d1y * d2x;
    
    // If determinant is zero, lines are parallel
    if (Math.abs(determinant) < 0.0001) return false;
    
    const s = (1/determinant) * ((a.x - c.x) * d2y - (a.y - c.y) * d2x);
    const t = (1/determinant) * (-(a.x - c.x) * d1y + (a.y - c.y) * d1x);
    
    return (s >= 0 && s <= 1 && t >= 0 && t <= 1);
  }, []);

  /**
   * Check if a line segment is intersecting itself
   */
  const isLineIntersectingItself = useCallback((line: [Point, Point]): boolean => {
    // A simple line segment can't intersect itself
    return false;
  }, []);

  return {
    distance,
    findClosestPointOnSegment,
    findShortestPath,
    calculatePathLength,
    isPolygonSelfIntersecting,
    isLineIntersectingItself
  };
};
