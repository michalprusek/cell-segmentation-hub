/**
 * Full-canvas loading overlay shown while the current video frame is
 * not yet warm in cache. Skeleton-first behaviour: the editor hides
 * the old frame + polygons whenever the new frame is still in flight,
 * so the canvas never flickers between two unrelated frames.
 *
 * The overlay disappears the moment both (a) the image is loaded in
 * `frameImageCache` and (b) the polygon query has settled. Cache hits
 * from `useFrameWindowPrefetch` skip the overlay entirely — a scrub
 * inside the prefetch window paints instantly.
 */

import { Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface EditorFrameLoadingOverlayProps {
  visible: boolean;
  width?: number;
  height?: number;
  label?: string;
}

export default function EditorFrameLoadingOverlay({
  visible,
  width,
  height,
  label,
}: EditorFrameLoadingOverlayProps) {
  if (!visible) return null;
  return (
    <div
      className={cn(
        'absolute inset-0 z-30 pointer-events-none flex items-center justify-center',
        // The overlay sits ABOVE the image and SVG polygon layers so a
        // partially-rendered frame doesn't bleed through.
        'bg-background/40'
      )}
      style={{
        width: width ? `${width}px` : undefined,
        height: height ? `${height}px` : undefined,
      }}
      data-testid="editor-frame-loading-overlay"
      aria-busy="true"
      aria-live="polite"
    >
      <Skeleton className="absolute inset-0 rounded-none opacity-60" />
      <div className="relative flex flex-col items-center gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        {label ? (
          <span className="text-sm text-muted-foreground">{label}</span>
        ) : null}
      </div>
    </div>
  );
}
