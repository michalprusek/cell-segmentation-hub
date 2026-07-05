import React, { useContext } from 'react';
import { cn } from '@/lib/utils';
import { ImageDisplayContext } from '../../contexts/ImageDisplayContext';

interface CanvasImageProps {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  loading?: boolean;
  onLoad?: (width: number, height: number) => void;
}

/**
 * Optional consumer of ImageDisplayContext. For standalone (non-video)
 * images the editor never wraps in the provider, so we read the raw
 * context value (null when unwrapped) and fall back to the identity
 * filter. The full ``useImageDisplay`` hook throws when unwrapped, so
 * we go straight to ``useContext`` here.
 */
function useDisplayFilter(): { filter: string } {
  const ctx = useContext(ImageDisplayContext);
  const brightness = ctx?.brightness ?? 100;
  const contrast = ctx?.contrast ?? 100;
  return {
    filter: `brightness(${brightness / 100}) contrast(${contrast / 100})`,
  };
}

/**
 * Komponenta pro zobrazení podkladového obrázku na plátně.
 *
 * When wrapped in an ImageDisplayProvider (video-mode editor) the
 * canvas image picks up brightness + contrast as a CSS filter. Min/max
 * window/level is handled only in the multi-channel canvas path (which
 * has pixel-level access); this standalone <img> path applies just the
 * brightness/contrast CSS filter.
 */
const CanvasImage = ({
  src,
  alt = 'Image to segment',
  width,
  height,
  loading = true,
  onLoad,
}: CanvasImageProps) => {
  const { filter } = useDisplayFilter();

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
        filter,
      }}
      onLoad={handleLoad}
      draggable={false}
      data-testid="canvas-image"
    />
  );
};

export default CanvasImage;
