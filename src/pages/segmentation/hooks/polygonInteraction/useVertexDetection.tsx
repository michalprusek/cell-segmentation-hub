
import { useCallback } from 'react';
import { Point } from '@/lib/segmentation';

/**
 * Hook pro detekci bodů polygonu
 */
export const useVertexDetection = (zoom: number) => {
  /**
   * Detekuje, zda je bod kurzoru v blízkosti bodu polygonu
   * Použití většího poloměru pro detekci (15px)
   */
  const isNearVertex = useCallback((
    x: number, 
    y: number, 
    point: Point, 
    detectionRadius: number = 15
  ): boolean => {
    const dx = point.x - x;
    const dy = point.y - y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Přizpůsobení poloměru detekce podle zoomu
    // Inverzní závislost - čím větší zoom, tím menší detekční poloměr potřebujeme
    const adjustedRadius = detectionRadius / zoom;
    
    return distance <= adjustedRadius;
  }, [zoom]);

  return { isNearVertex };
};
