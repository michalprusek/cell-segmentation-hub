
import { useCallback } from 'react';
import { Point } from '@/lib/segmentation';

/**
 * Hook pro detekci bodů polygonu
 */
export const useVertexDetection = (zoom: number) => {
  /**
   * Detekuje, zda je bod kurzoru v blízkosti bodu polygonu
   */
  const isNearVertex = useCallback((
    x: number, 
    y: number, 
    point: Point, 
    detectionRadius: number = 10
  ): boolean => {
    const dx = point.x - x;
    const dy = point.y - y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Přizpůsobení poloměru detekce podle zoomu
    const adjustedRadius = detectionRadius / zoom;
    
    return distance <= adjustedRadius;
  }, [zoom]);

  return { isNearVertex };
};
