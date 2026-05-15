/**
 * Single source of truth for the segmentation-polygon React Query
 * cache used by the segmentation editor.
 *
 * Both the editor's primary load path (`SegmentationEditor.tsx`'s
 * effect that hydrates the canvas on imageId change) and the
 * sliding-window prefetch hook (`useFrameWindowPrefetch`) share the
 * same query key + queryFn + cache config so a scrub-back is served
 * from RAM and a prefetched frame surfaces instantly when the user
 * lands on it.
 *
 * The exported `buildFrameImageUrl` helper also lives here so the
 * prefetch hook and the canvas image components agree on URL shape
 * (channel encoding + fallback to `/display`).
 */

import type { QueryClient, QueryKey } from '@tanstack/react-query';
import apiClient, { SegmentationPolygon } from '@/lib/api';

export interface CachedSegmentationData {
  polygons: SegmentationPolygon[] | null;
  imageWidth?: number;
  imageHeight?: number;
}

/** Canonical React Query key. Keep co-located with the queryFn so a
 *  rename can't drift between call sites. */
export function segmentationPolygonsQueryKey(imageId: string): QueryKey {
  return ['segmentation-results', imageId];
}

/** Fetcher used by both the prefetch hook and the editor's primary
 *  load. Normalises empty / 404 responses to `{ polygons: null }` so
 *  consumers don't have to thread "no data yet" through a different
 *  channel. */
export async function fetchSegmentationPolygonsForCache(
  imageId: string,
  signal?: AbortSignal
): Promise<CachedSegmentationData> {
  try {
    const data = await apiClient.getSegmentationResults(imageId, { signal });
    if (!data || !data.polygons) {
      return { polygons: null };
    }
    return {
      polygons: data.polygons,
      imageWidth: data.imageWidth,
      imageHeight: data.imageHeight,
    };
  } catch (err) {
    // 404 → frame has no segmentation yet. Surface as "no data"
    // rather than letting React Query mark the entry as errored
    // (which would trigger a retry storm during a fast scrub).
    if (err && typeof err === 'object' && 'status' in err) {
      const status = (err as { status?: number }).status;
      if (status === 404) return { polygons: null };
    }
    throw err;
  }
}

/** Per-query options applied to both prefetch and main fetch. The
 *  60 s staleTime + 5 min gcTime is tuned so a user can scrub away
 *  and back without a refetch but a stale-after-resegmentation case
 *  still resolves within a minute. ETag-based invalidation from the
 *  backend is the longer-lived correctness story; this is just the
 *  client-side default. */
export const SEGMENTATION_POLYGON_QUERY_OPTIONS = {
  staleTime: 60_000,
  gcTime: 5 * 60_000,
  // Only one retry — the network-error case is usually transient
  // and the prefetch path swallows failures anyway.
  retry: 1,
} as const;

/** Synchronous cache read used by the editor's primary load path so
 *  a scrub-back or a freshly-prefetched frame paints without a
 *  network round-trip. Returns `undefined` when there's no entry —
 *  callers fall back to the existing apiClient call and then write
 *  the result back via `setCachedSegmentationPolygons`. */
export function getCachedSegmentationPolygons(
  queryClient: QueryClient,
  imageId: string
): CachedSegmentationData | undefined {
  return queryClient.getQueryData<CachedSegmentationData>(
    segmentationPolygonsQueryKey(imageId)
  );
}

/** Companion to `getCachedSegmentationPolygons`. Called by the
 *  editor's primary load path after a successful fetch so subsequent
 *  cache hits (scrub-back, late prefetch arrival) can short-circuit
 *  the network call. */
export function setCachedSegmentationPolygons(
  queryClient: QueryClient,
  imageId: string,
  data: CachedSegmentationData
): void {
  queryClient.setQueryData(segmentationPolygonsQueryKey(imageId), data);
}

/** Build the per-channel display URL for one video frame. Mirrors
 *  the helper in `VideoFrameImage.tsx` — duplicated there for
 *  locality; this re-export is the canonical version the prefetch
 *  hook uses so both sides agree on URL shape (including channel
 *  encoding). */
export function buildFrameImageUrl(
  frameId: string,
  channel: string | null
): string {
  if (channel) {
    return `/api/images/${frameId}/frame-data?channel=${encodeURIComponent(channel)}`;
  }
  return `/api/images/${frameId}/display`;
}
