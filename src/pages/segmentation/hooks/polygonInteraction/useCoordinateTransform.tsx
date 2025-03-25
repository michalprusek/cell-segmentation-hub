
import { useCallback } from 'react';

/**
 * Hook pro transformaci souřadnic mezi různými souřadnými systémy
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
    // Zde byl problém - nesprávný výpočet s offsetem
    const x = (canvasX / zoom) - (offset.x * zoom);
    const y = (canvasY / zoom) - (offset.y * zoom);
    
    return { canvasX, canvasY, x, y };
  }, [zoom, offset]);

  /**
   * Převod souřadnic obrázku na souřadnice plátna
   * Pro správné vykreslování elementů
   */
  const getScreenCoordinates = useCallback((
    imageX: number,
    imageY: number
  ) => {
    const screenX = (imageX + offset.x) * zoom;
    const screenY = (imageY + offset.y) * zoom;
    
    return { screenX, screenY };
  }, [zoom, offset]);

  return { 
    getCanvasCoordinates,
    getScreenCoordinates
  };
};
