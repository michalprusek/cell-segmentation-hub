
import { useCallback } from 'react';
import { Point } from '@/lib/segmentation';
import { useCoordinateTransform } from './useCoordinateTransform';

/**
 * Hook pro detekci bodů polygonu
 */
export const useVertexDetection = (
  zoom: number,
  offset: { x: number; y: number }
) => {
  const { getScreenCoordinates } = useCoordinateTransform(zoom, offset);

  /**
   * Detekuje, zda je bod kurzoru v blízkosti bodu polygonu
   * Přepočítává souřadnice s ohledem na zoom a offset
   */
  const isNearVertex = useCallback((
    imageX: number, 
    imageY: number, 
    point: Point, 
    detectionRadius: number = 10
  ): boolean => {
    // Výpočet vzdálenosti mezi bodem kurzoru a bodem polygonu v prostoru obrázku
    const dx = point.x - imageX;
    const dy = point.y - imageY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Použijeme konstantní poloměr v obrazovém prostoru
    const adjustedRadius = detectionRadius / zoom;
    
    // Debugging pomocí konzole
    console.log(`isNearVertex: Cursor at image: (${imageX.toFixed(2)}, ${imageY.toFixed(2)}), Point at: (${point.x.toFixed(2)}, ${point.y.toFixed(2)}), Distance: ${distance.toFixed(2)}, Threshold: ${adjustedRadius.toFixed(2)}`);
    
    return distance <= adjustedRadius;
  }, [zoom]);

  return { isNearVertex };
};
