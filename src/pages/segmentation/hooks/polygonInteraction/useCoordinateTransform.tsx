
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
    const imageX = (canvasX - offset.x * zoom) / zoom;
    const imageY = (canvasY - offset.y * zoom) / zoom;
    
    return { 
      canvasX, 
      canvasY, 
      x: imageX, 
      y: imageY 
    };
  }, [zoom, offset]);

  /**
   * Převod souřadnic plátna na souřadnice v prostoru obrázku
   * Používáno pro převod pozice myši na souřadnice bodu v obrázku
   */
  const getImageCoordinates = useCallback((
    canvasX: number,
    canvasY: number
  ) => {
    // Přesný výpočet pozice v prostoru obrázku
    const imageX = (canvasX - offset.x * zoom) / zoom;
    const imageY = (canvasY - offset.y * zoom) / zoom;
    
    return { x: imageX, y: imageY };
  }, [zoom, offset]);

  /**
   * Převod souřadnic obrázku na souřadnice plátna
   * Pro správné vykreslování elementů
   */
  const getScreenCoordinates = useCallback((
    imageX: number,
    imageY: number
  ) => {
    // Přesný výpočet pozice na obrazovce
    const screenX = imageX * zoom + offset.x * zoom;
    const screenY = imageY * zoom + offset.y * zoom;
    
    return { screenX, screenY };
  }, [zoom, offset]);

  return { 
    getCanvasCoordinates,
    getImageCoordinates,
    getScreenCoordinates
  };
};
