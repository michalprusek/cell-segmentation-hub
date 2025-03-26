
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
  const { getImageCoordinates } = useCoordinateTransform(zoom, offset);

  /**
   * Detekuje, zda je bod kurzoru v blízkosti bodu polygonu
   * Pracuje přímo se souřadnicemi plátna bez nutnosti dalších přepočtů
   */
  const isNearVertex = useCallback((
    canvasX: number, 
    canvasY: number, 
    point: Point, 
    detectionRadius: number = 10
  ): boolean => {
    // Převedeme bod polygonu na canvas koordináty (nikoli naopak)
    const pointOnCanvas = {
      x: (point.x + offset.x) * zoom,
      y: (point.y + offset.y) * zoom
    };
    
    // Výpočet vzdálenosti mezi bodem kurzoru a bodem polygonu v prostoru plátna
    const dx = pointOnCanvas.x - canvasX;
    const dy = pointOnCanvas.y - canvasY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Dynamicky upravíme radius detekce podle zoomu
    const adjustedRadius = detectionRadius * (zoom < 1 ? 1.5 : 1);
    
    // Debugging pomocí konzole
    console.log(`isNearVertex: Mouse at canvas (${canvasX.toFixed(2)}, ${canvasY.toFixed(2)}), 
                Point on canvas: (${pointOnCanvas.x.toFixed(2)}, ${pointOnCanvas.y.toFixed(2)}), 
                Original point: (${point.x.toFixed(2)}, ${point.y.toFixed(2)}), 
                Distance: ${distance.toFixed(2)}, 
                Threshold: ${adjustedRadius.toFixed(2)},
                Zoom: ${zoom}, Offset: (${offset.x.toFixed(2)}, ${offset.y.toFixed(2)})`);
    
    return distance <= adjustedRadius;
  }, [zoom, offset]);

  return { isNearVertex };
};
