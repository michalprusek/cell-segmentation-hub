/**
 * Sliding-window prefetch around the current frame in video-mode editor.
 *
 * Walks a window of frames spanning `windowBack` slots before the
 * current index and `windowAhead` slots after it. For each frame in the
 * window the hook (a) warms a per-channel image element via
 * `frameImageCache` so the `<img>` swap is RAM-only on scrub or
 * playback tick, and (b) seeds React Query with the polygon JSON via
 * `queryClient.prefetchQuery` keyed by the canonical query key. Both
 * paths are idempotent — re-running with the same window short-circuits
 * to cached entries, and a window shift evicts only the off-window
 * tails by virtue of `FrameImageCache`'s LRU + React Query's
 * stale-while-revalidate.
 *
 * Replaces two ad-hoc prefetch sites that previously diverged:
 *   - `SegmentationEditor.tsx`'s `prefetchWithPriority` (±1 image,
 *     non-video, polygon JSON only, 500 ms-delayed adjacent).
 *   - `VideoFrameImage.tsx`'s 10-frame lookahead (playback only, single
 *     channel only, image only).
 *
 * Window choice is intentionally asymmetric (5 back / 10 ahead) — a
 * paused user is more likely to step forward than backward and
 * playback is forward-only. See `FRAME_PREFETCH_WINDOW`.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { frameImageCache } from '@/lib/rendering/FrameImageCache';
import {
  buildFrameImageUrl,
  getCachedSegmentationPolygons,
  segmentationPolygonsQueryKey,
  fetchSegmentationPolygonsForCache,
  SEGMENTATION_POLYGON_QUERY_OPTIONS,
} from './segmentationPolygonCache';

export const FRAME_PREFETCH_WINDOW = {
  back: 5,
  ahead: 10,
} as const;

export interface FrameMinimal {
  id: string;
  /** Segmentation status drives whether we waste a prefetch slot on a
   *  frame that the backend will refuse to return polygons for. */
  segmentationStatus?: string;
}

export interface UseFrameWindowPrefetchOptions {
  /** Ordered list of frames (the container's `frames` array). */
  frames: readonly FrameMinimal[];
  /** Index of the frame currently visible in the editor. */
  currentIndex: number;
  /** Channels to prefetch per frame. Empty array means single-channel
   *  fallback URL only. The hook calls
   *  `frameImageCache.prefetch(url)` for each. */
  channels: readonly string[];
  /** Only run when we're in video mode — for standalone images the
   *  prefetch concept doesn't apply. */
  enabled: boolean;
  /** Override window. Default is 5 back / 10 ahead. */
  windowBack?: number;
  windowAhead?: number;
}

export interface UseFrameWindowPrefetchResult {
  /** All image URLs the hook is currently warming. Useful for the
   *  buffer indicator + play-gate to compute ready-count. */
  windowImageUrls: string[];
  /** How many of the warmed URLs have finished loading. */
  readyCount: number;
  /** True when every URL in the window has loaded. */
  isWindowReady: boolean;
}

export function useFrameWindowPrefetch({
  frames,
  currentIndex,
  channels,
  enabled,
  windowBack = FRAME_PREFETCH_WINDOW.back,
  windowAhead = FRAME_PREFETCH_WINDOW.ahead,
}: UseFrameWindowPrefetchOptions): UseFrameWindowPrefetchResult {
  const queryClient = useQueryClient();

  // Stable fingerprint of channels — joining is cheap and gives the
  // effect a primitive dependency so a fresh `channels` array from the
  // parent doesn't re-fire the work.
  const channelsKey = channels.join('|');

  const windowFrames = useMemo(() => {
    if (!enabled || frames.length === 0) return [];
    const start = Math.max(0, currentIndex - windowBack);
    const end = Math.min(frames.length - 1, currentIndex + windowAhead);
    const slice: FrameMinimal[] = [];
    for (let i = start; i <= end; i++) slice.push(frames[i]);
    return slice;
    // `frames` is referentially stable inside one container fetch so
    // listing it here is safe; the explicit guard above handles the
    // not-yet-loaded case.
  }, [enabled, frames, currentIndex, windowBack, windowAhead]);

  // Compute the per-channel URL set for the window. Used both to
  // drive prefetch and to report `readyCount` back to consumers.
  // `channelsKey` (primitive) is the fingerprint that drives the
  // memo: parent renders that hand us a fresh `channels` array with
  // identical content won't recompute the URLs.
  const windowImageUrls = useMemo(() => {
    if (!windowFrames.length) return [];
    const channelList = channels.length > 0 ? channels : [null];
    const urls: string[] = [];
    for (const frame of windowFrames) {
      for (const channel of channelList) {
        urls.push(buildFrameImageUrl(frame.id, channel));
      }
    }
    return urls;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowFrames, channelsKey]);

  // Track the set of URLs we've already kicked off so a window
  // shift fires `prefetch()` only for the NEW URLs at the leading
  // edge, not the 30+ already-warmed URLs at the trailing edge.
  // During playback the slider advances by 1 frame at a time, so
  // each tick should add just `channels.length` new URLs to this
  // set — orders of magnitude below the nginx api-zone rate limit
  // (30 r/s burst 80). Without this guard the prefetch fanout
  // generated 50+ 503 responses per second during playback.
  const prefetchedRef = useRef<Set<string>>(new Set());
  const prefetchedPolygonsRef = useRef<Set<string>>(new Set());

  // Effect: kick off image + polygon prefetch for each window frame.
  // Idempotent at the URL level — only NEW URLs trigger network calls.
  useEffect(() => {
    if (!enabled || windowFrames.length === 0) return;

    const startedImageUrls: string[] = [];

    // Image prefetch — fire and forget for URLs we haven't seen.
    // The ref-tracked set is more aggressive than FrameImageCache.has
    // because evicted entries (rare, only past the 200-LRU cap)
    // shouldn't trigger redundant re-fetches mid-playback — the
    // browser HTTP cache (30 min) will serve them on real mount.
    const channelList = channels.length > 0 ? channels : [null];
    for (const frame of windowFrames) {
      for (const channel of channelList) {
        const url = buildFrameImageUrl(frame.id, channel);
        if (prefetchedRef.current.has(url)) continue;
        prefetchedRef.current.add(url);
        startedImageUrls.push(url);
        frameImageCache.prefetch(url).catch(() => {
          /* silent — surfaced by the actual mount */
        });
      }
    }

    // Polygon prefetch — only call prefetchQuery for frames we
    // haven't seen AND that aren't already in the React Query
    // cache. Otherwise React Query will short-circuit cheaply, but
    // the call still costs a microtask + an observer touch which at
    // 10 FPS × 16 frames adds up.
    for (const frame of windowFrames) {
      const status = frame.segmentationStatus;
      if (status && status !== 'segmented' && status !== 'completed') continue;
      if (prefetchedPolygonsRef.current.has(frame.id)) continue;
      if (getCachedSegmentationPolygons(queryClient, frame.id) !== undefined) {
        prefetchedPolygonsRef.current.add(frame.id);
        continue;
      }
      prefetchedPolygonsRef.current.add(frame.id);
      queryClient
        .prefetchQuery({
          queryKey: segmentationPolygonsQueryKey(frame.id),
          queryFn: ({ signal }) =>
            fetchSegmentationPolygonsForCache(frame.id, signal),
          ...SEGMENTATION_POLYGON_QUERY_OPTIONS,
        })
        .catch(() => {
          /* prefetch is best-effort; main fetch path retries on real visit */
        });
    }

    // Snapshot the ref so the cleanup closure uses the same set that
    // the effect body wrote to (silences exhaustive-deps stale-ref
    // warning; the ref is intentionally reset elsewhere on channel
    // changes, not here).
    const prefetchedSet = prefetchedRef.current;
    return () => {
      // Cancel only image entries that started in *this* effect run
      // and have not finished loading yet. Already-loaded entries
      // are LRU candidates managed by the cache itself.
      for (const url of startedImageUrls) {
        if (!frameImageCache.isReady(url)) {
          frameImageCache.abort(url);
          // Allow a future window-shift to retry this URL — the
          // abort means we never saw the response.
          prefetchedSet.delete(url);
        }
      }
      // React Query handles its own cancellation when the queryClient
      // detects the cache entry's signal observer count drops.
    };
    // `channels` is fingerprinted by `channelsKey`; including only
    // the primitive prevents re-fires on parent-provided fresh
    // arrays with identical content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, windowFrames, channelsKey, queryClient]);

  // Reset the ref-tracked sets when the channel set or enable flag
  // changes — a different channel needs its own URLs prefetched
  // fresh, and disabling/re-enabling video mode should not leak
  // stale "already prefetched" markers into the new session.
  useEffect(() => {
    prefetchedRef.current.clear();
    prefetchedPolygonsRef.current.clear();
  }, [channelsKey, enabled]);

  const readyCount = frameImageCache.readyCount(windowImageUrls);
  const isWindowReady =
    windowImageUrls.length > 0 && readyCount === windowImageUrls.length;

  return { windowImageUrls, readyCount, isWindowReady };
}
