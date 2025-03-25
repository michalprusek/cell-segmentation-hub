
import { useCallback } from 'react';
import { Point } from '@/lib/segmentation';

/**
 * Hook pro detekci bodů polygonu
 */
export const useVertexDetection = (zoom: number) => {
  /**
   * Detekuje, zda je bod kurzoru v blízkosti bodu polygonu
   * Přepočítává souřadnice s ohledem na zoom a offset
   */
  const isNearVertex = useCallback((
    imageX: number, 
    imageY: number, 
    point: Point, 
    detectionRadius: number = 15
  ): boolean => {
    // Výpočet vzdálenosti mezi bodem kurzoru a bodem polygonu v prostoru obrázku
    const dx = point.x - imageX;
    const dy = point.y - imageY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Přizpůsobení poloměru detekce podle zoomu
    // Při menším zoomu potřebujeme relativně větší detekční poloměr
    const adjustedRadius = Math.max(5, detectionRadius / (zoom || 1));
    
    return distance <= adjustedRadius;
  }, [zoom]);

  return { isNearVertex };
};
