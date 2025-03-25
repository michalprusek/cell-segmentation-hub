
import { useCallback } from 'react';

/**
 * Hook pro transformaci souřadnic
 */
export const useCoordinateTransform = (
  zoom: number,
  offset: { x: number; y: number }
) => {
  /**
   * Převod souřadnic myši na souřadnice v prostoru obrázku
   * Bere v úvahu zoom a offset pro přesnou detekci
   */
  const getCanvasCoordinates = useCallback((
    mouseX: number, 
    mouseY: number, 
    containerRect: DOMRect
  ) => {
    // Pozice myši relativně k plátnu
    const canvasX = mouseX - containerRect.left;
    const canvasY = mouseY - containerRect.top;
    
    // Převod na souřadnice v prostoru obrázku s ohledem na zoom a offset
    // Musíme odečíst offset a vydělit zoomem, abychom získali souřadnice v původním prostoru obrázku
    const x = (canvasX / zoom) - offset.x;
    const y = (canvasY / zoom) - offset.y;
    
    return { canvasX, canvasY, x, y };
  }, [zoom, offset]);

  return { getCanvasCoordinates };
};
