
import { useState, useEffect, useCallback, useRef } from 'react';

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
  
  // Vycentrování obrázku v plátně s přizpůsobením velikosti
  const centerImage = useCallback(() => {
    if (!canvasContainerRef.current) return;
    
    const container = canvasContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    
    const img = new Image();
    img.src = imageSrc;
    imageRef.current = img;
    
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
      newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
      
      // Výpočet offsetu pro vycentrování
      const offsetX = ((containerWidth / newZoom) - img.width) / 2;
      const offsetY = ((containerHeight / newZoom) - img.height) / 2;
      
      setZoom(newZoom);
      setOffset({ x: offsetX, y: offsetY });
    };
  }, [canvasContainerRef, imageSrc]);
  
  // Zajištění, aby obrázek nevyjel kompletně z canvasu
  const constrainOffset = useCallback((newOffset: { x: number; y: number }, newZoom: number) => {
    if (!canvasContainerRef.current || !imageRef.current) return newOffset;
    
    const container = canvasContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    const img = imageRef.current;
    
    // Zajistíme, aby alespoň 25% obrázku bylo vždy viditelné
    const minVisiblePortion = 0.25;
    
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    
    const scaledImgWidth = img.width * newZoom;
    const scaledImgHeight = img.height * newZoom;
    
    const minX = containerWidth / newZoom - img.width;
    const maxX = 0;
    const minY = containerHeight / newZoom - img.height;
    const maxY = 0;
    
    // Přidáme další omezení, aby obrázek nikdy zcela neopustil viewport
    const minVisibleX = Math.min(minX, -(img.width * (1 - minVisiblePortion)));
    const maxVisibleX = Math.max(maxX, (containerWidth / newZoom) * (1 - minVisiblePortion));
    const minVisibleY = Math.min(minY, -(img.height * (1 - minVisiblePortion)));
    const maxVisibleY = Math.max(maxY, (containerHeight / newZoom) * (1 - minVisiblePortion));
    
    return {
      x: Math.min(Math.max(newOffset.x, minVisibleX), maxVisibleX),
      y: Math.min(Math.max(newOffset.y, minVisibleY), maxVisibleY)
    };
  }, [canvasContainerRef]);
  
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
    const newOffsetX = offset.x + (mouseXInImage - (mouseX / newZoom));
    const newOffsetY = offset.y + (mouseYInImage - (mouseY / newZoom));
    
    // Omezení offsetu, aby obrázek příliš nevyjel z plátna
    const newOffset = constrainOffset({ x: newOffsetX, y: newOffsetY }, newZoom);
    
    setZoom(newZoom);
    setOffset(newOffset);
  }, [zoom, offset, canvasContainerRef, constrainOffset]);
  
  useEffect(() => {
    const currentContainer = canvasContainerRef.current;
    if (!currentContainer) return;
    
    currentContainer.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      currentContainer.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel, canvasContainerRef]);
  
  const handleZoomIn = () => {
    if (!canvasContainerRef.current) return;
    
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
      const newOffsetX = offset.x + (centerXInImage - (centerX / newZoom));
      const newOffsetY = offset.y + (centerYInImage - (centerY / newZoom));
      
      // Omezení offsetu
      setOffset(constrainOffset({ x: newOffsetX, y: newOffsetY }, newZoom));
      
      return newZoom;
    });
  };
  
  const handleZoomOut = () => {
    if (!canvasContainerRef.current) return;
    
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
      const newOffsetX = offset.x + (centerXInImage - (centerX / newZoom));
      const newOffsetY = offset.y + (centerYInImage - (centerY / newZoom));
      
      // Omezení offsetu
      setOffset(constrainOffset({ x: newOffsetX, y: newOffsetY }, newZoom));
      
      return newZoom;
    });
  };
  
  // Přepsaní metody setOffset, aby zajistila, že obrázek nevyjede z plátna
  const safeSetOffset = useCallback((newOffset: { x: number; y: number }) => {
    setOffset(constrainOffset(newOffset, zoom));
  }, [zoom, constrainOffset]);
  
  const handleResetView = () => {
    centerImage();
  };
  
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
