/**
 * Development-only FPS + rendering stats overlay for the segmentation editor.
 *
 * Opt-in via `?perf=1` query param or `localStorage.segPerfOverlay = '1'`.
 * Designed for validating performance work on the editor's render path
 * without shipping anything user-visible by default.
 *
 * Frustum culling is currently bypassed in the editor (see
 * `SegmentationEditor.tsx visiblePolygons`), so the visibility-manager
 * counters below will read their defaults (zero frames sampled, no
 * reduced-mode trigger). The overlay flags this explicitly with a
 * `culling: DISABLED` line so the zero values aren't misread as
 * indicators that culling is "working well".
 *
 * Uses an imperative rAF loop and a ref-only state update pattern so the
 * overlay itself doesn't cause additional renders of its parent tree.
 */
/* eslint-disable react-refresh/only-export-components -- exports helpers alongside overlay */

import { useEffect, useRef, useState } from 'react';
import { polygonVisibilityManager } from './PolygonVisibilityManager';
import { boundingBoxCache } from './BoundingBoxCache';

const FPS_WINDOW_MS = 1000;

export interface FpsMeterSample {
  fps: number;
  frameCount: number;
  visibility: ReturnType<typeof polygonVisibilityManager.getStats>;
  cache: ReturnType<typeof boundingBoxCache.getStats>;
}

/**
 * Pure FPS sampler — a fixed-size ring of frame timestamps, trimmed to
 * the trailing `windowMs`. Exposed as a helper so it can be unit-tested
 * without a browser rAF.
 */
export class FpsSampler {
  private readonly frames: number[] = [];

  constructor(private readonly windowMs = FPS_WINDOW_MS) {}

  record(nowMs: number): void {
    this.frames.push(nowMs);
    const cutoff = nowMs - this.windowMs;
    while (this.frames.length > 0 && this.frames[0] < cutoff) {
      this.frames.shift();
    }
  }

  get fps(): number {
    const n = this.frames.length;
    if (n < 2) return 0;
    const span = this.frames[n - 1] - this.frames[0];
    return span > 0 ? ((n - 1) * 1000) / span : 0;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  reset(): void {
    this.frames.length = 0;
  }
}

export function isFpsOverlayEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('perf') === '1') return true;
    return window.localStorage?.getItem('segPerfOverlay') === '1';
  } catch {
    return false;
  }
}

/**
 * Hook: returns a live FPS + stats sample while an rAF loop is running.
 * Only runs while the component is mounted AND the overlay is enabled,
 * so disabling it has no runtime cost.
 */
export function useFpsSampler(enabled: boolean): FpsMeterSample {
  const samplerRef = useRef<FpsSampler>();
  if (!samplerRef.current) samplerRef.current = new FpsSampler();

  const [sample, setSample] = useState<FpsMeterSample>(() => ({
    fps: 0,
    frameCount: 0,
    visibility: polygonVisibilityManager.getStats(),
    cache: boundingBoxCache.getStats(),
  }));

  useEffect(() => {
    if (!enabled) return;

    let raf = 0;
    let lastPublish = 0;

    const tick = (now: number) => {
      samplerRef.current!.record(now);
      // Publish at ~4 Hz — more than enough for human readability and
      // keeps React renders out of the critical path.
      if (now - lastPublish > 250) {
        lastPublish = now;
        setSample({
          fps: samplerRef.current!.fps,
          frameCount: samplerRef.current!.frameCount,
          visibility: polygonVisibilityManager.getStats(),
          cache: boundingBoxCache.getStats(),
        });
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  return sample;
}

/**
 * Overlay component. Mount near the top of the editor tree; it self-gates
 * on `isFpsOverlayEnabled()` and renders nothing in production by default.
 *
 * The gate is read ONCE per mount via a `useState` initializer so the
 * editor's hot re-render path doesn't pay for a fresh `URLSearchParams`
 * build and `localStorage.getItem` call on every render.
 */
export function FpsMeter(): JSX.Element | null {
  const [enabled] = useState(isFpsOverlayEnabled);
  const sample = useFpsSampler(enabled);
  if (!enabled) return null;

  const vis = sample.visibility;
  const cache = sample.cache;

  return (
    <div
      data-testid="fps-meter"
      style={{
        position: 'fixed',
        bottom: 8,
        right: 8,
        zIndex: 9999,
        padding: '6px 10px',
        borderRadius: 6,
        background: 'rgba(0, 0, 0, 0.75)',
        color: '#fff',
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 11,
        lineHeight: 1.35,
        pointerEvents: 'none',
        whiteSpace: 'pre',
      }}
    >
      {`FPS ${sample.fps.toFixed(1)}
frames ${sample.frameCount}
culling DISABLED
level ${vis.isUsingReducedRendering ? 'reduced' : 'normal'}
cull-thresh ${vis.cullingThreshold}
avgFrame ${vis.averageFrameTime.toFixed(2)}ms
cache ${cache.size} (${(cache.hitRate * 100).toFixed(0)}% hit)`}
    </div>
  );
}
