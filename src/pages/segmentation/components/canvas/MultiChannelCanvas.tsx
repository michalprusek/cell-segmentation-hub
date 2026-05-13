/**
 * Multi-channel composite canvas for video-mode editing.
 *
 * Replaces the single-channel `<img>` pipeline with a `<canvas>` element
 * that composites N visible channels onto a shared image plane. For each
 * visible channel:
 *
 *   1. Fetch the per-channel PNG via /api/images/<frameId>/frame-data
 *      (single-byte grayscale).
 *   2. Apply the user's min/max window-level LUT remap — the same
 *      ImageJ-style brightness floor/ceiling the sliders in DisplaySection
 *      have always promised but never delivered (the old `<img>` pipeline
 *      had no pixel-level access).
 *   3. Tint the grayscale by the channel's display colour: each pixel
 *      becomes `gray × colour / 255` per RGB component.
 *   4. Additive composite onto the destination canvas (canvas
 *      `globalCompositeOperation = 'lighter'`) — overlapping channel
 *      signal sums, mimicking how a fluorescence microscope sees
 *      multi-channel emission.
 *
 * Brightness / contrast are applied via CSS `filter` on the canvas
 * element, so they compose after all per-channel processing (matches the
 * old behaviour for the two CSS sliders).
 *
 * When the editor has no channel concept (standalone images,
 * non-video-mode) the caller renders the legacy `<img>` instead — this
 * component only spins up when the visible-channel list is non-empty.
 */

import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useImageDisplay } from '../../contexts/ImageDisplayContext';
import { logger } from '@/lib/logger';

interface MultiChannelCanvasProps {
  /** Frame Image row id — used to build `/api/images/<id>/frame-data`. */
  frameId: string;
  /** Channels (and order) currently composited. Order matters because
   *  the destination canvas is additively blended in that order; for
   *  pure-additive 'lighter' compositing the order does not affect the
   *  pixel result, but it does set the visual layering of any failed
   *  loads. Driven by ImageDisplayContext.visibleChannels. */
  visibleChannels: string[];
  /** Per-channel RGB tint colours. Falls back to white for missing
   *  entries (grayscale). */
  channelColors: Record<string, string>;
  /** Initial dimensions (used for the <canvas> width/height attrs while
   *  the first frame is loading; later overwritten from the first
   *  successful image load). */
  width?: number;
  height?: number;
  loading?: boolean;
  /** Notified once the first channel image has loaded with its natural
   *  dimensions — the rest of the editor wires zoom + polygons against
   *  the image-space coordinate system. */
  onLoad?: (width: number, height: number) => void;
}

/** Parse `#RRGGBB` (or `#rgb`) into a 3-element [r, g, b] tuple. White
 *  is the identity for grayscale display — invalid inputs degrade to it
 *  rather than throwing so a typo in localStorage doesn't crash the
 *  canvas. */
function hexToRgb(hex: string): [number, number, number] {
  if (!hex || hex[0] !== '#') return [255, 255, 255];
  if (hex.length === 4) {
    return [
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
      parseInt(hex[3] + hex[3], 16),
    ];
  }
  if (hex.length === 7) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }
  return [255, 255, 255];
}

/** Lookup table for min/max remap. Computed once per render of the
 *  hook's `windowMin`/`windowMax` rather than per-pixel arithmetic. */
function buildLut(windowMin: number, windowMax: number): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const safeMin = Math.min(windowMin, windowMax);
  const safeMax = Math.max(windowMin, windowMax);
  const range = Math.max(1, safeMax - safeMin);
  for (let i = 0; i < 256; i++) {
    if (i < safeMin) lut[i] = 0;
    else if (i > safeMax) lut[i] = 255;
    else lut[i] = Math.round(((i - safeMin) * 255) / range);
  }
  return lut;
}

export default function MultiChannelCanvas({
  frameId,
  visibleChannels,
  channelColors,
  width,
  height,
  loading = true,
  onLoad,
}: MultiChannelCanvasProps) {
  const { windowMin, windowMax, brightness, contrast } = useImageDisplay();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Stable key to bust the effect when any visible-channel order or
  // colour changes. Serialising both keeps the dep array primitive and
  // avoids identity-based re-renders.
  const channelsKey = visibleChannels.join('|');
  const colorsKey = visibleChannels.map(c => channelColors[c] ?? '').join('|');

  useEffect(() => {
    if (!visibleChannels.length || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) return;

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      const lut = buildLut(windowMin, windowMax);
      // Load all channel PNGs in parallel. Failures are swallowed
      // individually so one missing channel can't blank the canvas;
      // the destination canvas just composites whatever succeeded.
      const images = await Promise.all(
        visibleChannels.map(async channel => {
          try {
            const url = `/api/images/${frameId}/frame-data?channel=${encodeURIComponent(channel)}`;
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) return null;
            const blob = await res.blob();
            const bitmap = await createImageBitmap(blob);
            return { channel, bitmap };
          } catch (err) {
            if (controller.signal.aborted) return null;
            logger.warn(
              `Failed to load channel '${channel}' for frame ${frameId}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
            return null;
          }
        })
      );

      if (cancelled) return;
      const loaded = images.filter(
        (i): i is { channel: string; bitmap: ImageBitmap } => i != null
      );
      if (loaded.length === 0) return;

      // First successful image dictates canvas dimensions — all
      // channels of a video share the same shape, so picking the
      // first is safe and avoids a second pass.
      const { bitmap: firstBmp } = loaded[0];
      const w = firstBmp.width;
      const h = firstBmp.height;
      canvas.width = w;
      canvas.height = h;
      onLoad?.(w, h);

      // Per-channel tint pipeline. We could colour-mix natively via
      // canvas blend modes (multiply→lighter), but the manual pixel
      // path gives us LUT remap "for free" in the same pass.
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      // Reuse one offscreen canvas across channels — avoids 8N
      // memory thrash on a 5-channel ND2.
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const offCtx = off.getContext('2d', { willReadFrequently: true });
      if (!offCtx) return;

      for (const { channel, bitmap } of loaded) {
        if (cancelled) return;
        const [cR, cG, cB] = hexToRgb(channelColors[channel] ?? '#FFFFFF');
        offCtx.clearRect(0, 0, w, h);
        offCtx.drawImage(bitmap, 0, 0);
        const img = offCtx.getImageData(0, 0, w, h);
        const data = img.data;
        for (let p = 0; p < data.length; p += 4) {
          // Source PNG is grayscale → R, G, B are all the same value.
          // LUT-remap first, then tint by channel colour.
          const v = lut[data[p]];
          data[p] = (v * cR) >> 8; // (v * cR) / 256 via shift
          data[p + 1] = (v * cG) >> 8;
          data[p + 2] = (v * cB) >> 8;
          // alpha stays at PNG-source alpha (usually 255)
        }
        offCtx.putImageData(img, 0, 0);
        ctx.drawImage(off, 0, 0);
        bitmap.close?.();
      }
    })().catch(err => {
      if (!controller.signal.aborted) {
        logger.error('MultiChannelCanvas composite failed', err);
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    frameId,
    channelsKey,
    colorsKey,
    windowMin,
    windowMax,
    onLoad,
    // visibleChannels + channelColors purposefully excluded — `channelsKey`
    // + `colorsKey` are their content fingerprints, primitive-safe for the
    // dep array. Listing the arrays directly would re-fire on every
    // parent render because they're freshly-spread objects.
    visibleChannels,
    channelColors,
  ]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={cn(
        'absolute top-0 left-0 pointer-events-none max-w-none object-contain transition-opacity select-none',
        loading ? 'opacity-100' : 'opacity-50'
      )}
      style={{
        imageRendering: 'crisp-edges',
        width: width ? `${width}px` : 'auto',
        height: height ? `${height}px` : 'auto',
        userSelect: 'none',
        filter: `brightness(${brightness / 100}) contrast(${contrast / 100})`,
      }}
      data-testid="multi-channel-canvas"
    />
  );
}
