
import { useCallback } from 'react';
import { Point } from '@/lib/segmentation';

/**
 * Hook providing geometry utility functions for polygon editing
 */
export const useGeometryUtils = () => {
  /**
   * Calculate the distance between two points
   */
  const distance = useCallback((p1: Point, p2: Point): number => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }, []);

  /**
   * Check if a point is close to another point
   */
  const isNearPoint = useCallback((p1: Point, p2: Point, threshold: number = 10): boolean => {
    return distance(p1, p2) < threshold;
  }, [distance]);

  /**
   * Calculate the path length
   */
  const calculatePathLength = useCallback((points: Point[]): number => {
    let length = 0;
    for (let i = 0; i < points.length - 1; i++) {
      length += distance(points[i], points[i + 1]);
    }
    return length;
  }, [distance]);

  return {
    distance,
    isNearPoint,
    calculatePathLength
  };
};
