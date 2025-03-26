
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

  return {
    distance,
    findClosestPointOnSegment,
    findShortestPath
  };
};
