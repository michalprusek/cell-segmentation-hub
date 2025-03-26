
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
    mouseX: number, 
    mouseY: number, 
    point: Point, 
    detectionRadius: number = 10
  ): boolean => {
    // V případě že přijímáme screen coordinates, převedeme je na image coordinates
    const imageCoords = getImageCoordinates(mouseX, mouseY);
    
    // Výpočet vzdálenosti mezi bodem kurzoru a bodem polygonu v prostoru obrázku
    const dx = point.x - imageCoords.x;
    const dy = point.y - imageCoords.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Dynamicky upravíme radius detekce podle zoomu
    let adjustedRadius;
    if (zoom > 4) {
      // Při extrémním přiblížení snížíme radius výrazněji
      adjustedRadius = (detectionRadius * 0.6) / zoom;
    } else if (zoom > 3) {
      // Při velkém přiblížení snížíme radius
      adjustedRadius = (detectionRadius * 0.8) / zoom;
    } else if (zoom < 0.5) {
      // Při velkém oddálení zvětšíme radius výrazněji
      adjustedRadius = (detectionRadius * 2) / zoom;
    } else if (zoom < 0.7) {
      // Při mírném oddálení zvětšíme radius
      adjustedRadius = (detectionRadius * 1.5) / zoom;
    } else {
      // Standardní radius v normálním zoomu
      adjustedRadius = detectionRadius / zoom;
    }
    
    // Debugging pomocí konzole
    console.log(`isNearVertex: Mouse at (${mouseX.toFixed(2)}, ${mouseY.toFixed(2)}), 
                Image coords: (${imageCoords.x.toFixed(2)}, ${imageCoords.y.toFixed(2)}), 
                Vertex at: (${point.x.toFixed(2)}, ${point.y.toFixed(2)}), 
                Distance: ${distance.toFixed(2)}, 
                Threshold: ${adjustedRadius.toFixed(2)}`);
    
    return distance <= adjustedRadius;
  }, [zoom, getImageCoordinates]);

  return { isNearVertex };
};
