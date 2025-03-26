
import React from 'react';
import { cn } from '@/lib/utils';

interface CanvasImageProps {
  src: string;
  alt?: string;
  loading?: boolean;
}

/**
 * Komponenta pro zobrazení podkladového obrázku na plátně
 */
const CanvasImage = ({ src, alt = "Image to segment", loading = true }: CanvasImageProps) => {
  return (
    <img 
      src={src} 
      alt={alt}
      className={cn(
        "absolute top-0 left-0 pointer-events-none max-w-none object-contain transition-opacity",
        loading ? "opacity-100" : "opacity-50"
      )}
      style={{ 
        imageRendering: "crisp-edges",
        WebkitFontSmoothing: "none", // Adding proper webkit property instead
        MozImageRendering: "crisp-edges"
      }}
      draggable={false}
      data-testid="canvas-image"
    />
  );
};

export default CanvasImage;
