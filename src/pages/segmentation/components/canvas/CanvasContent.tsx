import React, { useEffect, useState } from 'react';
import { TransformState } from '../../types';
import { snapToDevicePixel } from '../../utils/devicePixelSnap';

interface CanvasContentProps {
  transform: TransformState;
  children: React.ReactNode;
}

const readDpr = () =>
  typeof window !== 'undefined' && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;

/**
 * The device pixel ratio, as state. It changes without any prop changing —
 * browser zoom (Ctrl +/-), or the window moving to a monitor of another
 * density — and the snap below has to follow it.
 */
function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(readDpr);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    // A `resolution` media query fires for exactly one ratio, so it is
    // re-armed for the new value each time it fires.
    let mql: MediaQueryList | null = null;
    const onChange = () => {
      setDpr(readDpr());
      arm();
    };
    const arm = () => {
      mql?.removeEventListener?.('change', onChange);
      mql = window.matchMedia(`(resolution: ${readDpr()}dppx)`);
      mql?.addEventListener?.('change', onChange);
    };
    arm();
    return () => mql?.removeEventListener?.('change', onChange);
  }, []);

  return dpr;
}

/**
 * Container for the canvas content: one plain 2D `translate() scale()`.
 *
 * What is NOT here, and why — each was measured on production (Chrome 152,
 * RTX A5000, zoom 10, DPR 1 / 1.5 / 2):
 *
 *  - `perspective`. Nothing below has a 3D transform, so it drew nothing; but
 *    together with a CSS `filter` on the bitmap it made every image-pixel
 *    boundary bleed one screen pixel (adjacent pixels differing 0.185 of the
 *    time against 0.097 for pure nearest neighbour). It was the sole trigger.
 *  - `backfaceVisibility` and `translate3d`. Innocent of the bleed and of no
 *    measurable benefit: zoom cost 437 ms with the hints and 458 ms without
 *    over 72 frames of 2000 polylines, both a steady 60 fps.
 *  - `will-change: transform`, including "only while zooming". It makes the
 *    gesture ~10x cheaper (41 ms against 437 ms) by pinning the layer's
 *    raster to the scale it had when promoted — which is exactly the blur
 *    this component exists to avoid: applied before zooming 2 -> 10 the
 *    stroke edge measured 5.05 px instead of 0.6 px. Without it Chrome
 *    re-rasters on every scale change, so each presented frame is sharp.
 *    Do not add it back without a density threshold and a measurement.
 *
 * The translate that reaches the DOM is snapped to whole device pixels; see
 * `snapToDevicePixel` for the numbers, and for why the container's own
 * position is deliberately NOT part of it. The `transform` prop is never
 * modified.
 */
const CanvasContent = ({ transform, children }: CanvasContentProps) => {
  const dpr = useDevicePixelRatio();
  const x = snapToDevicePixel(transform.translateX, dpr);
  const y = snapToDevicePixel(transform.translateY, dpr);

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        style={{
          transform: `translate(${x}px, ${y}px) scale(${transform.zoom})`,
          transformOrigin: '0 0',
          position: 'relative',
        }}
        data-testid="canvas-transform-container"
      >
        {children}
      </div>
    </div>
  );
};

export default CanvasContent;
