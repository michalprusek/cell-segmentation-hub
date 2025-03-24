
import { useState, useEffect, useCallback } from 'react';

/**
 * Hook pro správu zobrazení a navigace v segmentačním editoru
 */
export const useSegmentationView = (canvasContainerRef: React.RefObject<HTMLDivElement>, imageSrc: string) => {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  
  // Vycentrování obrázku v plátně s přizpůsobením velikosti
  const centerImage = useCallback(() => {
    if (!canvasContainerRef.current) return;
    
    const container = canvasContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    
    const img = new Image();
    img.src = imageSrc;
    
    img.onload = () => {
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;
      
      // Výpočet poměru stran
      const imgRatio = img.width / img.height;
      const containerRatio = containerWidth / containerHeight;
      
      // Výpočet nové velikosti s ohledem na zachování poměru stran
      let newZoom = 1;
      
      // Vždy fit to container, aby se celý obrázek vešel do plátna
      if (imgRatio > containerRatio) {
        // Obrázek je širší než container - omezení podle šířky
        newZoom = (containerWidth * 0.9) / img.width;
      } else {
        // Obrázek je vyšší než container - omezení podle výšky
        newZoom = (containerHeight * 0.9) / img.height;
      }
      
      // Omezení zoomu pro velmi malé nebo velmi velké obrázky
      newZoom = Math.max(0.1, Math.min(2, newZoom));
      
      // Výpočet offsetu pro vycentrování
      const offsetX = ((containerWidth / newZoom) - img.width) / 2;
      const offsetY = ((containerHeight / newZoom) - img.height) / 2;
      
      setZoom(newZoom);
      setOffset({ x: offsetX, y: offsetY });
    };
  }, [canvasContainerRef, imageSrc]);
  
  // Inicializace při načtení
  useEffect(() => {
    if (canvasContainerRef.current && imageSrc) {
      centerImage();
    }
  }, [centerImage, imageSrc]);
  
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    
    if (!canvasContainerRef.current) return;
    
    const container = canvasContainerRef.current;
    const rect = container.getBoundingClientRect();
    
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const mouseXInImage = (mouseX / zoom) - offset.x;
    const mouseYInImage = (mouseY / zoom) - offset.y;
    
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(10, zoom * delta));
    
    const newOffsetX = -mouseXInImage + (mouseX / newZoom);
    const newOffsetY = -mouseYInImage + (mouseY / newZoom);
    
    setZoom(newZoom);
    setOffset({ x: newOffsetX, y: newOffsetY });
  }, [zoom, offset, canvasContainerRef]);
  
  useEffect(() => {
    const currentContainer = canvasContainerRef.current;
    if (!currentContainer) return;
    
    currentContainer.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      currentContainer.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel, canvasContainerRef]);
  
  const handleZoomIn = () => {
    setZoom(prev => {
      const newZoom = Math.min(prev * 1.2, 10);
      return newZoom;
    });
  };
  
  const handleZoomOut = () => {
    setZoom(prev => {
      const newZoom = Math.max(prev / 1.2, 0.1);
      return newZoom;
    });
  };
  
  const handleResetView = () => {
    centerImage();
  };
  
  return {
    zoom,
    offset,
    setOffset,
    handleZoomIn,
    handleZoomOut,
    handleResetView,
    centerImage
  };
};
