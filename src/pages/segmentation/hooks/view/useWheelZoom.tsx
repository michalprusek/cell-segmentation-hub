
import { useCallback, useEffect } from 'react';

/**
 * Hook pro obsluhu zoom pomocí kolečka myši
 */
export const useWheelZoom = (
  zoom: number,
  offset: { x: number; y: number },
  canvasContainerRef: React.RefObject<HTMLDivElement>,
  setZoom: (zoom: number) => void,
  setOffset: (offset: { x: number; y: number }) => void,
  constrainOffset: (newOffset: { x: number; y: number }, newZoom: number) => { x: number; y: number },
  MIN_ZOOM: number,
  MAX_ZOOM: number
) => {
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    
    if (!canvasContainerRef.current) return;
    
    const container = canvasContainerRef.current;
    const rect = container.getBoundingClientRect();
    
    // Pozice myši v rámci containeru
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Pozice myši v souřadnicích obrázku
    const mouseXInImage = mouseX / zoom - offset.x;
    const mouseYInImage = mouseY / zoom - offset.y;
    
    // Výpočet nového zoomu
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * delta));
    
    // Výpočet nového offsetu, aby zůstal bod pod kurzorem na stejné pozici
    const newOffsetX = mouseXInImage - (mouseX / newZoom);
    const newOffsetY = mouseYInImage - (mouseY / newZoom);
    
    // Omezení offsetu, aby obrázek příliš nevyjel z plátna
    const newOffset = constrainOffset({ x: newOffsetX, y: newOffsetY }, newZoom);
    
    setZoom(newZoom);
    setOffset(newOffset);
  }, [zoom, offset, canvasContainerRef, constrainOffset, setZoom, setOffset, MIN_ZOOM, MAX_ZOOM]);
  
  useEffect(() => {
    const currentContainer = canvasContainerRef.current;
    if (!currentContainer) return;
    
    currentContainer.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      currentContainer.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel, canvasContainerRef]);

  return { handleWheel };
};
