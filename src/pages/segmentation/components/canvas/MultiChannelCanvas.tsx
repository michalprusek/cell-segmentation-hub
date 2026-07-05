/**
 * Multi-channel composite canvas for video-mode editing.
 *
 * Replaces the single-channel `<img>` pipeline with a `<canvas>` element
 * that composites N visible channels onto a shared image plane. For each
 * visible channel:
 *
 *   1. Fetch the per-channel PNG via /api/images/<frameId>/frame-data.
 *   2. Decode it to its NATIVE sample depth via `decodeGrayPng` — 16-bit
 *      microscopy frames keep all 16 bits (the browser's native
 *      createImageBitmap path would silently crush them to 8-bit). Non-
 *      grayscale PNGs fall back to an 8-bit createImageBitmap decode.
 *   3. Apply the user's min/max window-level LUT remap on the true sample
 *      values — ImageJ-style. The window range auto-scales to each channel
 *      set's real min/max (reported to ImageDisplayContext) so a 16-bit
 *      frame opens with a sensible contrast and the sliders span the data.
 *   4. Tint the grayscale by the channel's display colour and additively
 *      composite (canvas `globalCompositeOperation = 'lighter'`), mimicking
 *      multi-channel fluorescence emission.
 *
 * Decoding is split from windowing: we fetch+decode once per frame/channel
 * set (cached in a ref) and re-run the cheap windowing+composite pass on any
 * Min/Max, colour, or opacity change (never a refetch), so dragging is
 * real-time even on 16-bit frames.
 *
 * Brightness / contrast are applied via CSS `filter` on the canvas element,
 * composing after all per-channel processing.
 *
 * When the editor has no channel concept (standalone images) the caller
 * renders the legacy `<img>` instead — this component only spins up when
 * the visible-channel list is non-empty.
 */

import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { decodeGrayPng } from '@/lib/png16';
import { useImageDisplay } from '../../contexts/ImageDisplayContext';
import { useLanguage } from '@/contexts/exports';
import { logger } from '@/lib/logger';

interface MultiChannelCanvasProps {
  /** Frame Image row id — used to build `/api/images/<id>/frame-data`. */
  frameId: string;
  /** Video container id. Scopes the auto-scale range key together with the
   *  channel set, so navigating to a DIFFERENT video that happens to share
   *  channel names still re-fits the window to the new data. */
  containerId?: string;
  /** Channels currently composited. Order is irrelevant to the composite
   *  (additive `'lighter'`); the list is just
   *  ImageDisplayContext.visibleChannels. */
  visibleChannels: string[];
  /** Per-channel RGB tint colours. Falls back to white (grayscale) for
   *  missing entries. */
  channelColors: Record<string, string>;
  /** Initial dimensions (used for the <canvas> width/height attrs while the
   *  first frame loads; later overwritten from the decoded image). */
  width?: number;
  height?: number;
  loading?: boolean;
  /** Notified once the first channel image has loaded with its natural
   *  dimensions + the channelsKey that produced this load. */
  onLoad?: (width: number, height: number, channelsKey: string) => void;
}

/** One decoded channel's grayscale samples at native depth. */
interface ChannelSamples {
  channel: string;
  width: number;
  height: number;
  bitDepth: number;
  /** length = width*height, one grayscale sample per pixel. */
  data: Uint16Array | Uint8Array;
}

/** Parse `#RRGGBB` (or `#rgb`) into [r, g, b]. White is the grayscale
 *  identity — invalid inputs degrade to it rather than throwing. */
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

/** Window/level LUT over the sample domain [0, rangeMax] → 8-bit display.
 *  Sized to the current channel set's brightest value, so a 16-bit frame
 *  gets up to a 65536-entry table (64 KB, rebuilt on each windowing pass —
 *  Min/Max/colour/opacity change). Values ≤ windowMin map to black,
 *  ≥ windowMax to white. */
function buildLut(
  windowMin: number,
  windowMax: number,
  rangeMax: number
): Uint8ClampedArray {
  const size = Math.min(65535, Math.max(1, Math.round(rangeMax))) + 1;
  const lut = new Uint8ClampedArray(size);
  const lo = Math.min(windowMin, windowMax);
  const hi = Math.max(windowMin, windowMax);
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < size; i++) {
    if (i <= lo) lut[i] = 0;
    else if (i >= hi) lut[i] = 255;
    else lut[i] = Math.round(((i - lo) * 255) / range);
  }
  return lut;
}

/** Fallback for non-grayscale PNGs: decode 8-bit via createImageBitmap. */
async function decode8Bit(blob: Blob): Promise<ChannelSamples | null> {
  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width;
  const h = bitmap.height;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d', { willReadFrequently: true });
  if (!octx) {
    logger.warn('MultiChannelCanvas: 2D context unavailable for 8-bit decode');
    bitmap.close?.();
    return null;
  }
  octx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const id = octx.getImageData(0, 0, w, h);
  const data = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < id.data.length; p += 4, i++) data[i] = id.data[p];
  return { channel: '', width: w, height: h, bitDepth: 8, data };
}

export default function MultiChannelCanvas({
  frameId,
  containerId,
  visibleChannels,
  channelColors,
  width,
  height,
  loading = true,
  onLoad,
}: MultiChannelCanvasProps) {
  const {
    windowMin,
    windowMax,
    windowRangeMax,
    brightness,
    contrast,
    channelOpacities,
    reportDataRange,
  } = useImageDisplay();
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Decoded samples for the current frame/channel set, reused across
  // window-slider re-renders so dragging never refetches.
  const decodedRef = useRef<ChannelSamples[]>([]);
  const dimsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  // Bumped after a successful decode to trigger the windowing/composite
  // effect (which reads decodedRef).
  const [decodeVersion, setDecodeVersion] = useState(0);
  const lastFailedKeyRef = useRef<string | null>(null);
  const lastPartialFailKeyRef = useRef<string | null>(null);

  const channelsKey = visibleChannels.join('|');
  const colorsKey = visibleChannels.map(c => channelColors[c] ?? '').join('|');
  const opacitiesKey = visibleChannels
    .map(c => channelOpacities[c] ?? 100)
    .join('|');

  // --- Decode pass: fetch + decode all visible channels once per
  // frame/channel set. Deliberately does NOT depend on window/colour state
  // so slider drags re-window from the cache instead of refetching. ---
  useEffect(() => {
    if (!visibleChannels.length || !canvasRef.current) return;
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      const results = await Promise.all(
        visibleChannels.map(async channel => {
          try {
            const url = `/api/images/${frameId}/frame-data?channel=${encodeURIComponent(channel)}`;
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) {
              logger.warn(
                `MultiChannelCanvas: channel '${channel}' frame ${frameId} HTTP ${res.status} ${res.statusText}`
              );
              return null;
            }
            const blob = await res.blob();
            const decoded = await decodeGrayPng(blob);
            if (decoded) {
              return {
                channel,
                width: decoded.width,
                height: decoded.height,
                bitDepth: decoded.bitDepth,
                data: decoded.data,
              } as ChannelSamples;
            }
            const fallback = await decode8Bit(blob);
            if (!fallback) {
              logger.warn(
                `MultiChannelCanvas: channel '${channel}' frame ${frameId} decoded to null (both 16-bit and 8-bit paths)`
              );
            }
            return fallback ? { ...fallback, channel } : null;
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
      const loaded = results.filter((r): r is ChannelSamples => r != null);
      if (loaded.length === 0) {
        const failedKey = `${frameId}:${channelsKey}`;
        if (lastFailedKeyRef.current !== failedKey) {
          lastFailedKeyRef.current = failedKey;
          logger.error(
            `MultiChannelCanvas: all ${visibleChannels.length} channel(s) failed to load for frame ${frameId} [${channelsKey}]`
          );
          toast.error(
            t('toast.multiChannel.allChannelsFailed') ||
              'Failed to load image channels'
          );
        }
        return;
      }
      lastFailedKeyRef.current = null;

      // Partial failure: some (not all) channels loaded. The composite still
      // renders, but a missing channel is visually indistinguishable from a
      // genuinely dark one, so surface it (deduped) rather than silently
      // dropping it.
      if (loaded.length < visibleChannels.length) {
        const partialKey = `${frameId}:${channelsKey}:${loaded.length}`;
        if (lastPartialFailKeyRef.current !== partialKey) {
          lastPartialFailKeyRef.current = partialKey;
          logger.warn(
            `MultiChannelCanvas: ${visibleChannels.length - loaded.length}/${visibleChannels.length} channel(s) failed to load for frame ${frameId} [${channelsKey}]`
          );
          toast.error(
            t('toast.multiChannel.someChannelsFailed') ||
              'Some image channels failed to load'
          );
        }
      } else {
        lastPartialFailKeyRef.current = null;
      }

      // Combined sample range across visible channels → drives the ImageJ-
      // style auto-scale + slider bounds in ImageDisplayContext.
      let cmin = Infinity;
      let cmax = -Infinity;
      for (const cs of loaded) {
        const src = cs.data;
        for (let i = 0; i < src.length; i++) {
          const v = src[i];
          if (v < cmin) cmin = v;
          if (v > cmax) cmax = v;
        }
      }

      decodedRef.current = loaded;
      dimsRef.current = { w: loaded[0].width, h: loaded[0].height };
      // Trigger the composite BEFORE invoking external callbacks, so a throw
      // from the parent-supplied reportDataRange/onLoad can't leave the canvas
      // blank. The range key is scoped to the container so navigating to a
      // different video with the same channel names still re-fits the window.
      setDecodeVersion(v => v + 1);
      try {
        reportDataRange(
          Number.isFinite(cmin) ? cmin : 0,
          Number.isFinite(cmax) ? cmax : 255,
          `${containerId ?? ''}::${channelsKey}`
        );
        onLoad?.(loaded[0].width, loaded[0].height, channelsKey);
      } catch (err) {
        logger.error(
          'MultiChannelCanvas: onLoad/reportDataRange callback threw',
          err
        );
      }
    })().catch(err => {
      if (!controller.signal.aborted) {
        logger.error('MultiChannelCanvas decode-effect failed', err);
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    frameId,
    containerId,
    channelsKey,
    reportDataRange,
    onLoad,
    t,
    visibleChannels,
  ]);

  // --- Windowing + composite pass: cheap, re-runs on any Min/Max, colour or
  // opacity change (never a refetch) using the cached decoded samples.
  // Brightness/Contrast are a CSS filter and don't touch this pass. ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const loaded = decodedRef.current;
    if (!canvas || loaded.length === 0) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
      logger.warn(
        'MultiChannelCanvas: 2D context unavailable — cannot composite'
      );
      return;
    }
    const { w, h } = dimsRef.current;
    if (w === 0 || h === 0) return;
    // Setting canvas.width/height resets the bitmap; only do it when the size
    // actually changes so a slider tick doesn't pay a full-canvas reset every
    // frame (clearRect below handles the per-pass clear).
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const lut = buildLut(windowMin, windowMax, windowRangeMax);
    const maxIdx = lut.length - 1;

    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const offCtx = off.getContext('2d', { willReadFrequently: true });
    if (!offCtx) {
      logger.warn('MultiChannelCanvas: offscreen 2D context unavailable');
      return;
    }
    const outImg = offCtx.createImageData(w, h);
    const out = outImg.data;

    for (const cs of loaded) {
      const [cR, cG, cB] = hexToRgb(channelColors[cs.channel] ?? '#FFFFFF');
      const opacity = (channelOpacities[cs.channel] ?? 100) / 100;
      const scale = opacity >= 1 ? 1 : opacity;
      const src = cs.data;
      for (let i = 0, p = 0; i < src.length; i++, p += 4) {
        const s = src[i];
        const v = lut[s > maxIdx ? maxIdx : s];
        out[p] = ((v * cR) >> 8) * scale;
        out[p + 1] = ((v * cG) >> 8) * scale;
        out[p + 2] = ((v * cB) >> 8) * scale;
        out[p + 3] = 255;
      }
      offCtx.putImageData(outImg, 0, 0);
      ctx.drawImage(off, 0, 0);
    }
  }, [
    decodeVersion,
    windowMin,
    windowMax,
    windowRangeMax,
    colorsKey,
    opacitiesKey,
    channelColors,
    channelOpacities,
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
