
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
  // Opravená funkce pro zoom in, která udržuje střed displeje ve středu
  const handleZoomIn = useCallback(() => {
    if (!canvasContainerRef.current) return;
    
    const container = canvasContainerRef.current;
    const rect = container.getBoundingClientRect();
    
    // Střed displeje
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    // Pozice středu displeje v prostoru obrázku před změnou zoomu
    const imagePointBeforeX = centerX / zoom - offset.x;
    const imagePointBeforeY = centerY / zoom - offset.y;
    
    // Nový zoom (zvětšení)
    const newZoom = Math.min(zoom * 1.2, MAX_ZOOM);
    
    // Nový offset tak, aby stejný bod obrázku byl ve středu displeje
    const newOffsetX = -imagePointBeforeX + (centerX / newZoom);
    const newOffsetY = -imagePointBeforeY + (centerY / newZoom);
    
    // Nastavení nových hodnot
    setZoom(newZoom);
    setOffset(constrainOffset({ x: newOffsetX, y: newOffsetY }, newZoom));
    
  }, [canvasContainerRef, zoom, offset, setZoom, setOffset, constrainOffset, MAX_ZOOM]);
  
  // Opravená funkce pro zoom out, která udržuje střed displeje ve středu
  const handleZoomOut = useCallback(() => {
    if (!canvasContainerRef.current) return;
    
    const container = canvasContainerRef.current;
    const rect = container.getBoundingClientRect();
    
    // Střed displeje
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    // Pozice středu displeje v prostoru obrázku před změnou zoomu
    const imagePointBeforeX = centerX / zoom - offset.x;
    const imagePointBeforeY = centerY / zoom - offset.y;
    
    // Nový zoom (zmenšení)
    const newZoom = Math.max(zoom / 1.2, MIN_ZOOM);
    
    // Nový offset tak, aby stejný bod obrázku byl ve středu displeje
    const newOffsetX = -imagePointBeforeX + (centerX / newZoom);
    const newOffsetY = -imagePointBeforeY + (centerY / newZoom);
    
    // Nastavení nových hodnot
    setZoom(newZoom);
    setOffset(constrainOffset({ x: newOffsetX, y: newOffsetY }, newZoom));
    
  }, [canvasContainerRef, zoom, offset, setZoom, setOffset, constrainOffset, MIN_ZOOM]);

  return { handleZoomIn, handleZoomOut };
};
