
import { useCallback } from 'react';

/**
 * Hook pro obsluhu zoom-in a zoom-out akcí
 */
export const useZoomHandlers = (
  zoom: number,
  offset: { x: number; y: number },
  canvasContainerRef: React.RefObject<HTMLDivElement>,
  imageRef: React.MutableRefObject<HTMLImageElement | null>,
  setZoom: (value: React.SetStateAction<number>) => void,
  setOffset: (offset: { x: number; y: number }) => void,
  constrainOffset: (newOffset: { x: number; y: number }, newZoom: number) => { x: number; y: number },
  MIN_ZOOM: number,
  MAX_ZOOM: number
) => {
  const handleZoomIn = useCallback(() => {
    if (!canvasContainerRef.current || !imageRef.current) return;
    
    const container = canvasContainerRef.current;
    const rect = container.getBoundingClientRect();
    
    // Zoomujeme na střed canvasu
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    // Pozice středu v souřadnicích obrázku
    const centerXInImage = centerX / zoom - offset.x;
    const centerYInImage = centerY / zoom - offset.y;
    
    setZoom(prev => {
      const newZoom = Math.min(prev * 1.2, MAX_ZOOM);
      
      // Výpočet nového offsetu, aby zůstal střed na stejné pozici
      const newOffsetX = centerXInImage - (centerX / newZoom);
      const newOffsetY = centerYInImage - (centerY / newZoom);
      
      // Omezení offsetu
      setOffset(constrainOffset({ x: newOffsetX, y: newOffsetY }, newZoom));
      
      return newZoom;
    });
  }, [canvasContainerRef, imageRef, zoom, offset, setZoom, setOffset, constrainOffset, MAX_ZOOM]);
  
  const handleZoomOut = useCallback(() => {
    if (!canvasContainerRef.current || !imageRef.current) return;
    
    const container = canvasContainerRef.current;
    const rect = container.getBoundingClientRect();
    
    // Zoomujeme na střed canvasu
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    // Pozice středu v souřadnicích obrázku
    const centerXInImage = centerX / zoom - offset.x;
    const centerYInImage = centerY / zoom - offset.y;
    
    setZoom(prev => {
      const newZoom = Math.max(prev / 1.2, MIN_ZOOM);
      
      // Výpočet nového offsetu, aby zůstal střed na stejné pozici
      const newOffsetX = centerXInImage - (centerX / newZoom);
      const newOffsetY = centerYInImage - (centerY / newZoom);
      
      // Omezení offsetu
      setOffset(constrainOffset({ x: newOffsetX, y: newOffsetY }, newZoom));
      
      return newZoom;
    });
  }, [canvasContainerRef, imageRef, zoom, offset, setZoom, setOffset, constrainOffset, MIN_ZOOM]);

  return { handleZoomIn, handleZoomOut };
};
