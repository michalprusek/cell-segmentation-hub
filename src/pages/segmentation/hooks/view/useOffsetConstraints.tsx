import { useCallback } from 'react';

/**
 * Hook pro omezení posunu obrázku, aby nevyjel z canvasu
 */
export const useOffsetConstraints = (
  canvasContainerRef: React.RefObject<HTMLDivElement>,
  imageRef: React.MutableRefObject<HTMLImageElement | null>
) => {
  // Zajištění, aby obrázek nevyjel kompletně z canvasu
  const constrainOffset = useCallback(
    (newOffset: { x: number; y: number }, newZoom: number) => {
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
      const minVisibleX = Math.min(
        minX,
        -(img.width * (1 - minVisiblePortion))
      );
      const maxVisibleX = Math.max(
        maxX,
        (containerWidth / newZoom) * (1 - minVisiblePortion)
      );
      const minVisibleY = Math.min(
        minY,
        -(img.height * (1 - minVisiblePortion))
      );
      const maxVisibleY = Math.max(
        maxY,
        (containerHeight / newZoom) * (1 - minVisiblePortion)
      );

      return {
        x: Math.min(Math.max(newOffset.x, minVisibleX), maxVisibleX),
        y: Math.min(Math.max(newOffset.y, minVisibleY), maxVisibleY),
      };
    },
    [canvasContainerRef, imageRef]
  );

  return { constrainOffset };
};
