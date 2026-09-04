import React, { useContext, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { ImageDisplayContext } from '../../contexts/ImageDisplayContext';
import { decodeGrayPng, type DecodedGray } from '@/lib/png16';
import { buildLut } from '@/lib/windowLevel';
import { logger } from '@/lib/logger';

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
 * Two paths, and which one runs is decided by the image itself:
 *
 *  - **8-bit, or anything not greyscale PNG** — a plain `<img>`, unchanged.
 *    Nothing to preserve and nothing to window, so there is no reason to pay
 *    for a decode.
 *  - **16-bit greyscale PNG** — decoded here and painted through a
 *    window/level LUT. A browser maps a 16-bit PNG into `<img>` linearly, so
 *    a microscopy image using the bottom of the range (measured on a real
 *    file: values 237..3853 of 65535) renders essentially black. That is not
 *    a cosmetic problem: before this, the backend also collapsed such an
 *    image to TWO grey levels on the way out, and the two losses compounded.
 *
 * The window defaults to the frame's own min..max, which is what makes a
 * dim 16-bit image visible without the user touching anything; the
 * ImageDisplayProvider's min/max override it when present, matching the
 * multi-channel canvas.
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
  const [deep, setDeep] = useState<DecodedGray | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Probe the source once per src. A miss (not a greyscale PNG, 8-bit, or a
  // fetch failure) leaves `deep` null and the <img> below renders exactly as
  // it always did — the fallback is the old behaviour, not a blank canvas.
  useEffect(() => {
    let cancelled = false;
    setDeep(null);
    if (!src) return;
    (async () => {
      try {
        const res = await fetch(src, { credentials: 'include' });
        if (!res.ok) return;
        const decoded = await decodeGrayPng(await res.blob());
        if (cancelled || !decoded || decoded.bitDepth <= 8) return;
        setDeep(decoded);
        onLoad?.(decoded.width, decoded.height);
      } catch (err) {
        // Never block the picture on this: the <img> path still runs.
        logger.debug?.('16-bit probe failed, using the <img> path', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, onLoad]);

  // Paint through the window/level LUT whenever the data or the window moves.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!deep || !canvas) return;
    const c2d = canvas.getContext('2d');
    if (!c2d) return;
    canvas.width = deep.width;
    canvas.height = deep.height;
    // Auto-contrast on the frame's own min..max. There is no min/max control
    // for a standalone image — ImageDisplayContext carries only brightness and
    // contrast, and those still apply as a CSS filter on this canvas — so the
    // window has to come from the data, which is also what makes a dim 16-bit
    // image visible without the user doing anything.
    const lut = buildLut(deep.min, deep.max, deep.max);
    const maxIdx = lut.length - 1;
    const out = c2d.createImageData(deep.width, deep.height);
    const px = out.data;
    for (let i = 0, o = 0; i < deep.data.length; i++, o += 4) {
      const s = deep.data[i];
      const v = lut[s > maxIdx ? maxIdx : s];
      px[o] = v;
      px[o + 1] = v;
      px[o + 2] = v;
      px[o + 3] = 255;
    }
    c2d.putImageData(out, 0, 0);
  }, [deep]);

  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    if (onLoad) {
      onLoad(img.naturalWidth, img.naturalHeight);
    }
  };

  const commonStyle: React.CSSProperties = {
    imageRendering: 'crisp-edges',
    width: width ? `${width}px` : 'auto',
    height: height ? `${height}px` : 'auto',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    filter,
  };

  if (deep) {
    return (
      <canvas
        ref={canvasRef}
        className={cn(
          'absolute top-0 left-0 pointer-events-none max-w-none object-contain transition-opacity select-none',
          loading ? 'opacity-100' : 'opacity-50'
        )}
        style={commonStyle}
        data-testid="canvas-image"
        data-bit-depth={deep.bitDepth}
      />
    );
  }

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
