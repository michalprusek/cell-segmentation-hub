
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
    
    // Výpočet nového zoomu s jemnějšími kroky
    // Použijeme delta faktor s menším krokem pro plynulejší zoom
    const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * zoomFactor));
    
    // Zaokrouhlíme na 2 desetinná místa pro stabilnější hodnoty
    const roundedZoom = Math.round(newZoom * 100) / 100;
    
    // Pokud se zoom skutečně změnil
    if (roundedZoom !== zoom) {
      // Výpočet nového offsetu, aby bod pod kurzorem zůstal na stejném místě
      const newOffsetX = -mouseXInImage + (mouseX / roundedZoom);
      const newOffsetY = -mouseYInImage + (mouseY / roundedZoom);
      
      // Aplikace omezení na offset
      const constrainedOffset = constrainOffset({ x: newOffsetX, y: newOffsetY }, roundedZoom);
      
      setZoom(roundedZoom);
      setOffset(constrainedOffset);
    }
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
