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
 * Step 3+4 run on the GPU when the browser has WebGL2: `createCompositor`
 * moves the window/level remap, the tint and the additive blend into a
 * fragment shader, so a frame costs a texture upload and a slider tick costs a
 * uniform update. The CPU implementation below stays as the fallback — it is
 * what runs when WebGL2 is unavailable and what takes over after a lost GL
 * context (see the render-path effect). Both produce the same image; only the
 * per-pixel loop's location differs.
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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { decodeGrayPngPooled } from '@/lib/png16Client';
import {
  decodedFrameCache,
  frameCacheKey,
  getOrDecode,
} from '@/lib/decodedFrameCache';
import { buildLut } from '@/lib/windowLevel';
import {
  createCompositor,
  type Compositor,
  type CompositorChannel,
  type CompositorWindow,
} from '@/lib/webglCompositor';
import { useImageDisplay } from '../../contexts/ImageDisplayContext';
import { useLanguage } from '@/contexts/exports';
import { logger } from '@/lib/logger';

/** Stable empty default so the optional coverage prop keeps a constant
 *  reference across renders (a fresh `{}` would churn the memo below). */
const EMPTY_COVERAGE: Record<string, string[]> = {};

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
  /** Per-channel frame coverage for PNG-backed partial channels (channel name
   *  → covered frame ids). A channel absent here covers every frame. Channels
   *  that don't cover `frameId` are NOT fetched (no 404 noise) — but they
   *  remain in the channelsKey so the loading-gate key stays stable. */
  channelCoverage?: Record<string, string[]>;
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
  /** Min/max sample across this channel. Carried from the decoder rather than
   *  recomputed: decodeGrayPng already found both inside the loop it had to
   *  run anyway, and rescanning here cost a second full pass over every sample
   *  of every channel — ~6.2 M iterations per frame at 1474x1412 x3, on the
   *  main thread, for a number that was already known. */
  min: number;
  max: number;
}

/**
 * Which implementation is driving the composite.
 *
 * `'webgl'` is the OPTIMISTIC initial value, not a confirmed capability: a
 * canvas element yields only ONE context type for its whole lifetime, so the
 * WebGL2 request has to happen before anything else draws — there is no way to
 * try it and fall back on the same element. When the request fails (no WebGL2)
 * or the context is later lost, we flip to `'2d'`; that value is part of the
 * `<canvas>`'s React `key`, so the flip mounts a FRESH element which has never
 * been asked for a WebGL2 context and can therefore still give us a 2D one.
 */
type RenderPath = 'webgl' | '2d';

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
  let min = 255;
  let max = 0;
  // Range comes free here — the loop is already touching every sample.
  for (let p = 0, i = 0; p < id.data.length; p += 4, i++) {
    const v = id.data[p];
    data[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { channel: '', width: w, height: h, bitDepth: 8, data, min, max };
}

export default function MultiChannelCanvas({
  frameId,
  containerId,
  visibleChannels,
  channelColors,
  channelCoverage = EMPTY_COVERAGE,
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
  // Live WebGL2 compositor, or null while on the CPU path. Held in a ref (not
  // state) so the composite effect can read it without the extra render a
  // state write would cost.
  const compositorRef = useRef<Compositor | null>(null);
  // Scratch canvas for the CPU composite, allocated once and resized in place.
  // It used to be `document.createElement('canvas')` INSIDE the effect, i.e. a
  // fresh width*height bitmap on every slider tick.
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  // Scratch pixel buffer for the CPU composite, kept alongside the canvas it is
  // drawn into. createImageData allocates AND spec-mandates a zero fill —
  // 8.3 MB at 1474x1412 — every call, and every byte of it is overwritten
  // below before it is used, so paying for that per pass was pure waste.
  const outImgRef = useRef<ImageData | null>(null);
  const [renderPath, setRenderPath] = useState<RenderPath>('webgl');
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

  // Channels we actually FETCH for this frame: drop any PNG-backed partial
  // channel that doesn't cover `frameId` (a channel absent from the coverage
  // map covers every frame). Skipping the fetch — rather than letting it 404 —
  // keeps the console clean while a sparse channel is composited only where it
  // exists. `channelsKey` (the full set) still drives the loading-gate key, so
  // dropping an uncovered channel here never leaves the frame overlay stuck.
  const coverageKey = Object.entries(channelCoverage)
    .map(([k, v]) => `${k}:${v.length}`)
    .join('|');
  const fetchChannels = useMemo(
    () =>
      visibleChannels.filter(c => {
        const cov = channelCoverage[c];
        return !cov || cov.includes(frameId);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channelsKey, frameId, coverageKey]
  );
  const fetchChannelsKey = fetchChannels.join('|');

  // --- Render-path selection: ask the CURRENT canvas element for WebGL2 once.
  // Declared BEFORE the decode and composite effects so that on every commit
  // the compositor is created (or torn down) before the composite pass looks
  // for it. Re-runs only when `renderPath` changes, which — because that value
  // is the canvas's key — always means a brand-new element to bind to. ---
  useEffect(() => {
    if (renderPath !== 'webgl') return; // already on the CPU fallback
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Guards the fallback against firing twice (a late onContextLost after we
    // already gave up, or after this effect was cleaned up).
    let released = false;
    const fallBackTo2d = () => {
      if (released) return;
      released = true;
      compositorRef.current = null;
      setRenderPath('2d');
    };

    let created: Compositor | null = null;
    try {
      created = createCompositor(canvas, fallBackTo2d);
    } catch (err) {
      logger.warn(
        'MultiChannelCanvas: WebGL2 compositor construction threw — using the 2D path',
        err
      );
      created = null;
    }
    if (!created) {
      // No WebGL2 (or it blew up). Remount as a fresh element and composite on
      // the CPU; this element may already be in WebGL context mode.
      fallBackTo2d();
      return;
    }

    const compositor = created;
    compositorRef.current = compositor;
    return () => {
      released = true;
      compositorRef.current = null;
      compositor.dispose();
    };
  }, [renderPath]);

  // --- Decode pass: fetch + decode all visible channels once per
  // frame/channel set. Deliberately does NOT depend on window/colour state
  // so slider drags re-window from the cache instead of refetching. ---
  useEffect(() => {
    if (!visibleChannels.length || !canvasRef.current) return;
    // Every visible channel is a partial one that doesn't cover this frame —
    // nothing to fetch. Blank the composite and still emit onLoad with the
    // full channelsKey so the frame loading-gate clears (it keys on the full
    // set). Rare: the segmentation-source channel is full-coverage + visible
    // by default, so it normally stays in fetchChannels.
    if (!fetchChannels.length) {
      decodedRef.current = [];
      setDecodeVersion(v => v + 1);
      try {
        onLoad?.(width ?? 0, height ?? 0, channelsKey);
      } catch (err) {
        logger.error('MultiChannelCanvas: onLoad callback threw', err);
      }
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      const results = await Promise.all(
        fetchChannels.map(async channel => {
          const cacheKey = frameCacheKey(frameId, channel);
          const cached = decodedFrameCache.get(cacheKey);
          if (cached) {
            // Already decoded — stepping back a frame, replaying a clip, or a
            // channel toggle that re-runs this effect. The prefetcher warms the
            // HTTP cache, but the decode is the expensive half and this is the
            // only thing that keeps it.
            return {
              channel,
              width: cached.width,
              height: cached.height,
              bitDepth: cached.bitDepth,
              data: cached.data,
              min: cached.min,
              max: cached.max,
            } as ChannelSamples;
          }
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
            // Off the main thread, and in parallel across channels. Decoding
            // one 1474x1412 16-bit channel is ~15 ms of native inflate plus
            // ~10 ms of JavaScript un-filtering; doing that inline for two
            // channels is what froze playback.
            // getOrDecode, not decodeGrayPngPooled directly: decode-ahead may
            // already be decoding this exact frame, and joining its work beats
            // starting a second 4 MB decode that occupies a worker the NEXT
            // frame is about to need. It stores the result in the cache too.
            const decoded = await getOrDecode(cacheKey, () =>
              decodeGrayPngPooled(blob)
            );
            if (decoded) {
              return {
                channel,
                width: decoded.width,
                height: decoded.height,
                bitDepth: decoded.bitDepth,
                data: decoded.data,
                min: decoded.min,
                max: decoded.max,
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
        const failedKey = `${frameId}:${fetchChannelsKey}`;
        if (lastFailedKeyRef.current !== failedKey) {
          lastFailedKeyRef.current = failedKey;
          logger.error(
            `MultiChannelCanvas: all ${fetchChannels.length} channel(s) failed to load for frame ${frameId} [${fetchChannelsKey}]`
          );
          toast.error(
            t('toast.multiChannel.allChannelsFailed') ||
              'Failed to load image channels'
          );
        }
        return;
      }
      lastFailedKeyRef.current = null;

      // Partial failure: some (not all) FETCHED channels loaded. Compared
      // against fetchChannels (the covered set we actually requested), NOT the
      // full visible set — an uncovered partial channel was intentionally
      // skipped, so it must not count as a failure here.
      if (loaded.length < fetchChannels.length) {
        const partialKey = `${frameId}:${fetchChannelsKey}:${loaded.length}`;
        if (lastPartialFailKeyRef.current !== partialKey) {
          lastPartialFailKeyRef.current = partialKey;
          logger.warn(
            `MultiChannelCanvas: ${fetchChannels.length - loaded.length}/${fetchChannels.length} channel(s) failed to load for frame ${frameId} [${fetchChannelsKey}]`
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
      // style auto-scale + slider bounds in ImageDisplayContext. Reduces over
      // N per-channel scalars the decoders already produced, NOT over the
      // samples themselves.
      let cmin = Infinity;
      let cmax = -Infinity;
      for (const cs of loaded) {
        if (cs.min < cmin) cmin = cs.min;
        if (cs.max > cmax) cmax = cs.max;
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
    fetchChannels,
    fetchChannelsKey,
    reportDataRange,
    onLoad,
    t,
    visibleChannels,
    width,
    height,
  ]);

  // --- Windowing + composite pass: cheap, re-runs on any Min/Max, colour or
  // opacity change (never a refetch) using the cached decoded samples.
  // Brightness/Contrast are a CSS filter and don't touch this pass. ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const loaded = decodedRef.current;
    if (!canvas || loaded.length === 0) return;
    const { w, h } = dimsRef.current;
    if (w === 0 || h === 0) return;

    // --- GPU path. Must return before ANY 2D use of this canvas: on a real
    // browser `getContext('2d')` on a WebGL-mode canvas returns null, and
    // writing canvas.width would clear the drawing buffer setSize() owns. ---
    if (renderPath === 'webgl') {
      const compositor = compositorRef.current;
      // The render-path effect has not produced one yet, or has just torn it
      // down. Skip this pass rather than touching the canvas 2D-wise; the
      // pending setRenderPath('2d') re-runs us against a fresh element.
      if (!compositor) return;
      if (!compositor.isAlive()) {
        // Context lost without onContextLost reaching us (or before it did).
        // Remount as a 2D canvas; this effect re-runs and paints on the CPU,
        // so the user never sees a blank frame.
        compositorRef.current = null;
        setRenderPath('2d');
        return;
      }
      const channels: CompositorChannel[] = loaded.map(cs => ({
        channel: cs.channel,
        data: cs.data,
        width: cs.width,
        height: cs.height,
        color: hexToRgb(channelColors[cs.channel] ?? '#FFFFFF'),
        opacity: (channelOpacities[cs.channel] ?? 100) / 100,
      }));
      // Raw sample units — the same three numbers buildLut() takes below.
      const compositorWindow: CompositorWindow = {
        min: windowMin,
        max: windowMax,
        rangeMax: windowRangeMax,
      };
      compositor.setSize(w, h);
      compositor.draw(channels, compositorWindow);
      return;
    }

    // --- CPU fallback: the original per-pixel composite, unchanged. ---
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
      logger.warn(
        'MultiChannelCanvas: 2D context unavailable — cannot composite'
      );
      return;
    }
    // Setting canvas.width/height resets the bitmap; only do it when the size
    // actually changes so a slider tick doesn't pay a full-canvas reset every
    // frame (clearRect below handles the per-pass clear).
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const lut = buildLut(windowMin, windowMax, windowRangeMax);
    const maxIdx = lut.length - 1;

    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    // Reuse the scratch canvas across passes — a fresh one per pass meant a
    // full width*height allocation on every slider tick. Every pixel of it is
    // overwritten below (alpha included) before it is drawn, so there is no
    // stale content to clear.
    let off = offscreenRef.current;
    if (!off) {
      off = document.createElement('canvas');
      offscreenRef.current = off;
    }
    if (off.width !== w) off.width = w;
    if (off.height !== h) off.height = h;
    const offCtx = off.getContext('2d', { willReadFrequently: true });
    if (!offCtx) {
      logger.warn('MultiChannelCanvas: offscreen 2D context unavailable');
      return;
    }
    let outImg = outImgRef.current;
    if (!outImg || outImg.width !== w || outImg.height !== h) {
      outImg = offCtx.createImageData(w, h);
      outImgRef.current = outImg;
    }
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
    // A path flip remounts the <canvas> (new key ⇒ new element), so the last
    // composite is gone and has to be replayed on the new one.
    renderPath,
  ]);

  return (
    <canvas
      // Part of the identity, not just a value: flipping to '2d' must give us
      // a NEW element, because this one is stuck in WebGL context mode.
      key={renderPath}
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
