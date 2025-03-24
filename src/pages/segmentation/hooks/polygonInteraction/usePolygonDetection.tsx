
import { useCallback } from 'react';
import { Point } from '@/lib/segmentation';

/**
 * Hook pro detekci bodů v polygonu
 */
export const usePolygonDetection = () => {
  /**
   * Detekuje, zda je bod uvnitř polygonu
   * Používá algoritmus Ray Casting
   */
  const isPointInPolygon = useCallback((x: number, y: number, points: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      
      const intersect = ((yi > y) !== (yj > y))
          && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }, []);

  return { isPointInPolygon };
};
