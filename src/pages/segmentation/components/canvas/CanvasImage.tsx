import React from 'react';
import { cn } from '@/lib/utils';

interface CanvasImageProps {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  loading?: boolean;
  onLoad?: (width: number, height: number) => void;
}

/**
 * Komponenta pro zobrazení podkladového obrázku na plátně
 */
const CanvasImage = ({
  src,
  alt = 'Image to segment',
  width,
  height,
  loading = true,
  onLoad,
}: CanvasImageProps) => {
  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    if (onLoad) {
      onLoad(img.naturalWidth, img.naturalHeight);
    }
  };

  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={cn(
        'absolute top-0 left-0 pointer-events-none max-w-none object-contain transition-opacity select-none',
        loading ? 'opacity-100' : 'opacity-50'
      )}
      style={{
        imageRendering: 'crisp-edges',
        WebkitFontSmoothing: 'none', // Improving text rendering in WebKit browsers
        width: width ? `${width}px` : 'auto',
        height: height ? `${height}px` : 'auto',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none',
      }}
      onLoad={handleLoad}
      draggable={false}
      data-testid="canvas-image"
    />
  );
};

export default CanvasImage;
