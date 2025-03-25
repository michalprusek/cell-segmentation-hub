
import { useCallback } from 'react';

/**
 * Hook pro vycentrování obrázku v plátně
 */
export const useImageCentering = (
  canvasContainerRef: React.RefObject<HTMLDivElement>, 
  imageSrc: string,
  imageRef: React.MutableRefObject<HTMLImageElement | null>,
  setZoom: (zoom: number) => void,
  setOffset: (offset: { x: number; y: number }) => void,
  MIN_ZOOM: number,
  MAX_ZOOM: number
) => {
  // Vycentrování obrázku v plátně s přizpůsobením velikosti
  const centerImage = useCallback(() => {
    if (!canvasContainerRef.current || !imageSrc) return;
    
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
        newZoom = (containerWidth * 0.8) / img.width;
      } else {
        // Obrázek je vyšší než container - omezení podle výšky
        newZoom = (containerHeight * 0.8) / img.height;
      }
      
      // Omezení zoomu pro velmi malé nebo velmi velké obrázky
      newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
      
      // Přesné vycentrování - nastavíme offset na 0,0
      // Tím umístíme obrázek přesně na střed canvasu
      setZoom(newZoom);
      setOffset({ x: 0, y: 0 });
    };
  }, [canvasContainerRef, imageSrc, imageRef, setZoom, setOffset, MIN_ZOOM, MAX_ZOOM]);

  return { centerImage };
};
