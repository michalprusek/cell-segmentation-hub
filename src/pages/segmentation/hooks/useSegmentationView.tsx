
import { useState, useEffect, useCallback, useRef } from 'react';
import { useImageCentering } from './view/useImageCentering';
import { useOffsetConstraints } from './view/useOffsetConstraints';
import { useZoomHandlers } from './view/useZoomHandlers';
import { useWheelZoom } from './view/useWheelZoom';

/**
 * Hook pro správu zobrazení a navigace v segmentačním editoru
 */
export const useSegmentationView = (canvasContainerRef: React.RefObject<HTMLDivElement>, imageSrc: string) => {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement | null>(null);
  
  // Omezení zoomu na 40-600%
  const MIN_ZOOM = 0.4; // 40%
  const MAX_ZOOM = 6.0; // 600%
  
  // Hooks pro jednotlivé funkcionality
  const { constrainOffset } = useOffsetConstraints(canvasContainerRef, imageRef);
  
  const { centerImage } = useImageCentering(
    canvasContainerRef, 
    imageSrc, 
    imageRef, 
    setZoom, 
    setOffset, 
    MIN_ZOOM, 
    MAX_ZOOM
  );
  
  const { handleZoomIn, handleZoomOut } = useZoomHandlers(
    zoom, 
    offset, 
    canvasContainerRef, 
    imageRef, 
    setZoom, 
    setOffset, 
    constrainOffset, 
    MIN_ZOOM, 
    MAX_ZOOM
  );
  
  // Efekt pro inicializaci při načtení
  useEffect(() => {
    if (canvasContainerRef.current && imageSrc) {
      centerImage();
    }
  }, [centerImage, imageSrc]);
  
  // Wheel zoom hook
  useWheelZoom(
    zoom, 
    offset, 
    canvasContainerRef, 
    setZoom, 
    setOffset, 
    constrainOffset, 
    MIN_ZOOM, 
    MAX_ZOOM
  );
  
  // Přepsaní metody setOffset, aby zajistila, že obrázek nevyjede z plátna
  const safeSetOffset = useCallback((newOffset: { x: number; y: number }) => {
    setOffset(constrainOffset(newOffset, zoom));
  }, [zoom, constrainOffset]);
  
  const handleResetView = useCallback(() => {
    centerImage();
  }, [centerImage]);
  
  return {
    zoom,
    offset,
    setOffset: safeSetOffset,
    handleZoomIn,
    handleZoomOut,
    handleResetView,
    centerImage
  };
};
