
import { useCallback } from 'react';

/**
 * Hook pro přesouvání celého plátna
 */
export const useCanvasDrag = (
  zoom: number,
  offset: { x: number; y: number },
  setOffset: (offset: { x: number; y: number }) => void,
  dragState: React.MutableRefObject<{
    isDragging: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  }>
) => {
  /**
   * Zpracování pohybu při tažení plátna
   */
  const handleCanvasDrag = useCallback((
    e: React.MouseEvent,
    containerElement: HTMLElement
  ): boolean => {
    if (!dragState.current.isDragging) return false;
    
    const dx = e.clientX - dragState.current.lastX;
    const dy = e.clientY - dragState.current.lastY;
    
    // Aktualizace last pozice pro plynulý pohyb
    dragState.current.lastX = e.clientX;
    dragState.current.lastY = e.clientY;
    
    setOffset({
      x: offset.x + dx / zoom,
      y: offset.y + dy / zoom
    });
    
    containerElement.style.cursor = 'grabbing';
    return true;
  }, [zoom, offset, setOffset, dragState]);

  /**
   * Začátek tažení plátna
   */
  const startCanvasDrag = useCallback((
    e: React.MouseEvent
  ) => {
    dragState.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY
    };
  }, [dragState]);

  return {
    handleCanvasDrag,
    startCanvasDrag
  };
};
