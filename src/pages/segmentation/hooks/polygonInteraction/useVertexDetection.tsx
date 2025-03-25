
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
  const { getScreenCoordinates, getImageCoordinates } = useCoordinateTransform(zoom, offset);

  /**
   * Detekuje, zda je bod kurzoru v blízkosti bodu polygonu
   * Přepočítává souřadnice s ohledem na zoom a offset
   */
  const isNearVertex = useCallback((
    screenX: number, 
    screenY: number, 
    point: Point, 
    detectionRadius: number = 10
  ): boolean => {
    // Převedení pozice kurzoru na souřadnice obrázku
    const { x: imageX, y: imageY } = getImageCoordinates(screenX, screenY);
    
    // Výpočet vzdálenosti mezi bodem kurzoru a bodem polygonu v prostoru obrázku
    const dx = point.x - imageX;
    const dy = point.y - imageY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Použijeme fixní poloměr detekce v pixelech, nezávislý na zoomu
    const threshold = detectionRadius / zoom;
    
    // Debugging pomocí konzole
    console.log(`isNearVertex: Screen cursor (${screenX.toFixed(2)}, ${screenY.toFixed(2)}), 
                Image cursor: (${imageX.toFixed(2)}, ${imageY.toFixed(2)}), 
                Vertex at: (${point.x.toFixed(2)}, ${point.y.toFixed(2)}), 
                Distance: ${distance.toFixed(2)}, 
                Threshold: ${threshold.toFixed(2)}`);
    
    return distance <= threshold;
  }, [zoom, getImageCoordinates]);

  return { isNearVertex };
};
