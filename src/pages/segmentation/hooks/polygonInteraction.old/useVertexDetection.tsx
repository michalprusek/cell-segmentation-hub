
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
    
    // Kontrola validity dat před výpočtem
    if (!imageCoords || typeof imageCoords.x !== 'number' || typeof imageCoords.y !== 'number' ||
        !point || typeof point.x !== 'number' || typeof point.y !== 'number') {
      return false;
    }
    
    // Výpočet vzdálenosti mezi bodem kurzoru a bodem polygonu v prostoru obrázku
    const dx = point.x - imageCoords.x;
    const dy = point.y - imageCoords.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Dynamicky upravíme radius detekce podle zoomu - OBRÁCENĚ
    let adjustedRadius;
    if (zoom > 4) {
      // Při extrémním přiblížení zvětšíme radius výrazněji
      adjustedRadius = (detectionRadius * 2) / zoom;
    } else if (zoom > 3) {
      // Při velkém přiblížení zvětšíme radius
      adjustedRadius = (detectionRadius * 1.5) / zoom;
    } else if (zoom < 0.5) {
      // Při velkém oddálení snížíme radius výrazněji
      adjustedRadius = (detectionRadius * 0.6) / zoom;
    } else if (zoom < 0.7) {
      // Při mírném oddálení snížíme radius
      adjustedRadius = (detectionRadius * 0.8) / zoom;
    } else {
      // Standardní radius v normálním zoomu
      adjustedRadius = detectionRadius / zoom;
    }
    
    // Debugging pomocí konzole - s kontrolou undefined hodnot
    const mouseXSafe = typeof mouseX === 'number' ? mouseX.toFixed(2) : 'undefined';
    const mouseYSafe = typeof mouseY === 'number' ? mouseY.toFixed(2) : 'undefined';
    const imageCoordsXSafe = (imageCoords && typeof imageCoords.x === 'number') ? imageCoords.x.toFixed(2) : 'undefined';
    const imageCoordsYSafe = (imageCoords && typeof imageCoords.y === 'number') ? imageCoords.y.toFixed(2) : 'undefined';
    const pointXSafe = (point && typeof point.x === 'number') ? point.x.toFixed(2) : 'undefined';
    const pointYSafe = (point && typeof point.y === 'number') ? point.y.toFixed(2) : 'undefined';
    const distanceSafe = typeof distance === 'number' ? distance.toFixed(2) : 'undefined';
    const radiusSafe = typeof adjustedRadius === 'number' ? adjustedRadius.toFixed(2) : 'undefined';
    
    console.log(`isNearVertex: Mouse at (${mouseXSafe}, ${mouseYSafe}), 
                Image coords: (${imageCoordsXSafe}, ${imageCoordsYSafe}), 
                Vertex at: (${pointXSafe}, ${pointYSafe}), 
                Distance: ${distanceSafe}, 
                Threshold: ${radiusSafe}`);
    
    return distance <= adjustedRadius;
  }, [zoom, getImageCoordinates]);

  return { isNearVertex };
};
