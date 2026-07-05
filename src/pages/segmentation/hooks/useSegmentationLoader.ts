import { useState, useEffect, useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import apiClient, { type SegmentationPolygon } from '@/lib/api';
import { logger } from '@/lib/logger';
import { handleCancelledError } from '@/lib/errorUtils';
import { toast } from 'sonner';
import {
  getCachedSegmentationPolygons,
  setCachedSegmentationPolygons,
} from './segmentationPolygonCache';

/**
 * Minimal structural slice of selectedImage that the loader reads.
 * Declared locally so this hook stays light-import (no heavy component graph).
 */
interface SelectedImageSlice {
  segmentationStatus?: string;
  width?: number;
  height?: number;
}

interface UseSegmentationLoaderParams {
  projectId: string | undefined;
  imageId: string | undefined;
  selectedImage: SelectedImageSlice | undefined;
  /** Returns an AbortSignal for the given operation name. */
  getSignal: (name: string) => AbortSignal;
  queryClient: QueryClient;
  /** Translation function for error toasts. */
  t: (key: string) => string;
  /** Ref tracking the currently-active imageId (written by orchestrator). */
  currentImageIdRef: React.MutableRefObject<string | undefined>;
}

interface UseSegmentationLoaderResult {
  segmentationPolygons: SegmentationPolygon[] | null;
  setSegmentationPolygons: React.Dispatch<
    React.SetStateAction<SegmentationPolygon[] | null>
  >;
  imageDimensions: { width: number; height: number } | null;
  setImageDimensions: React.Dispatch<
    React.SetStateAction<{ width: number; height: number } | null>
  >;
  loadedFrameKey: string | null;
  handleImageLoad: (width: number, height: number, channelsKey: string) => void;
}

/**
 * Owns the segmentation data-load cluster:
 *   - segmentationPolygons + imageDimensions + loadedFrameKey state
 *   - primary loadSegmentation useEffect (cache-first → API fetch)
 *   - handleImageLoad callback (marks frame as ready + updates dims)
 *
 * HAZARDS (per design doc):
 *   - previousImageIdRef and its two writer effects stay in the orchestrator.
 *   - reloadNonce + handleReloadedPolygons stay in the orchestrator (liaison).
 *   - onSave closure stays inline in the orchestrator.
 *   - The imageId-change abort/cleanup effect (dual-writes previousImageIdRef)
 *     stays in the orchestrator.
 */
export function useSegmentationLoader({
  projectId,
  imageId,
  selectedImage,
  getSignal,
  queryClient,
  t,
  currentImageIdRef,
}: UseSegmentationLoaderParams): UseSegmentationLoaderResult {
  // State for segmentation polygons from API
  const [segmentationPolygons, setSegmentationPolygons] = useState<
    SegmentationPolygon[] | null
  >(null);
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  // `loadedFrameKey` is `${imageId}::${channelsKey}` — both axes
  // need to match before the Skeleton overlay can step aside.
  // Tracking just `imageId` would let a channel toggle keep a stale
  // composite painted while the new channel still decodes.
  // The debounce that latches "show overlay" lives inside
  // `FrameLoadingGate`, which is rendered under ImageDisplayProvider
  // (it needs `visibleChannels` to construct the target key).
  const [loadedFrameKey, setLoadedFrameKey] = useState<string | null>(null);

  // Load segmentation data with proper cancellation handling
  useEffect(() => {
    let isMounted = true;

    // Update current image ref immediately
    currentImageIdRef.current = imageId;

    const loadSegmentation = async () => {
      if (!projectId || !imageId) return;

      // Get abort signal for main loading operation
      const signal = getSignal('main-loading');

      // Immediately clear polygons when switching images to prevent showing old data
      setSegmentationPolygons(null);
      setImageDimensions(null); // Also clear image dimensions
      logger.debug(
        '🧹 Cleared polygons and dimensions for new image:',
        imageId
      );

      // Check if the image has completed segmentation before trying to fetch results
      const hasSegmentation =
        selectedImage?.segmentationStatus === 'completed' ||
        selectedImage?.segmentationStatus === 'segmented';

      if (!hasSegmentation) {
        logger.debug(
          'Image does not have completed segmentation, skipping fetch:',
          {
            imageId,
            status: selectedImage?.segmentationStatus,
          }
        );

        // Set image dimensions from project data if available
        if (selectedImage?.width && selectedImage?.height) {
          logger.debug(
            '📐 Setting image dimensions from project data (no segmentation):',
            {
              width: selectedImage.width,
              height: selectedImage.height,
            }
          );
          if (isMounted && imageId === currentImageIdRef.current) {
            setImageDimensions({
              width: selectedImage.width,
              height: selectedImage.height,
            });
          }
        }
        return;
      }

      // Cache hit: serve a previously-fetched / prefetched result
      // without going to the network. The shared React Query cache
      // is populated by the editor's own success path below and by
      // the `useFrameWindowPrefetch` sliding window, so scrub-back
      // and pre-warmed frames paint instantly.
      const cached = getCachedSegmentationPolygons(queryClient, imageId);
      if (cached !== undefined) {
        if (!isMounted || imageId !== currentImageIdRef.current) return;
        if (cached.imageWidth && cached.imageHeight) {
          setImageDimensions({
            width: cached.imageWidth,
            height: cached.imageHeight,
          });
        } else if (selectedImage?.width && selectedImage?.height) {
          setImageDimensions({
            width: selectedImage.width,
            height: selectedImage.height,
          });
        }
        setSegmentationPolygons(cached.polygons);
        return;
      }

      try {
        const segmentationData = await apiClient.getSegmentationResults(
          imageId,
          {
            signal,
          }
        );

        // Verify we're still on the same image and component is mounted
        if (
          !isMounted ||
          imageId !== currentImageIdRef.current ||
          signal.aborted
        ) {
          logger.debug(
            '🛑 Segmentation load cancelled - image changed or component unmounted'
          );
          return;
        }

        // Populate the shared cache with the *normalised* result so
        // a future scrub-back or window-prefetch read can serve from
        // RAM. Empty / 404 frames are cached as `polygons: null` to
        // avoid retry storms on a fast scrub across non-segmented
        // frames.
        if (segmentationData && !segmentationData.polygons) {
          // Backend returned a non-null payload without a polygons
          // field — distinguishes a misshaped 200 from a legitimate
          // "no segmentation yet" so a misconfigured response doesn't
          // silently masquerade as empty for 60 s of staleTime.
          logger.warn(
            'Segmentation response present but missing polygons field — caching as empty',
            { imageId }
          );
        }
        setCachedSegmentationPolygons(queryClient, imageId, {
          polygons: segmentationData?.polygons ?? null,
          imageWidth: segmentationData?.imageWidth,
          imageHeight: segmentationData?.imageHeight,
        });

        // Handle empty or null segmentation gracefully
        if (!segmentationData || !segmentationData.polygons) {
          logger.debug('No segmentation data found for image:', imageId);
          if (isMounted && imageId === currentImageIdRef.current) {
            setSegmentationPolygons(null);
          }

          // Still try to set image dimensions from project data if available
          if (selectedImage?.width && selectedImage?.height) {
            logger.debug(
              '📐 Setting image dimensions from project data (no segmentation):',
              {
                width: selectedImage.width,
                height: selectedImage.height,
              }
            );
            if (isMounted && imageId === currentImageIdRef.current) {
              setImageDimensions({
                width: selectedImage.width,
                height: selectedImage.height,
              });
            }
          }
          return;
        }

        const polygons = segmentationData.polygons;

        // Extract image dimensions from segmentation data if available
        if (segmentationData.imageWidth && segmentationData.imageHeight) {
          logger.debug('📐 Setting image dimensions from segmentation data:', {
            width: segmentationData.imageWidth,
            height: segmentationData.imageHeight,
          });
          if (isMounted && imageId === currentImageIdRef.current) {
            setImageDimensions({
              width: segmentationData.imageWidth,
              height: segmentationData.imageHeight,
            });
          }
        } else if (selectedImage?.width && selectedImage?.height) {
          // Fallback to image dimensions from project data (database)
          logger.debug(
            '📐 Setting image dimensions from project data (fallback):',
            {
              width: selectedImage.width,
              height: selectedImage.height,
            }
          );
          if (isMounted && imageId === currentImageIdRef.current) {
            setImageDimensions({
              width: selectedImage.width,
              height: selectedImage.height,
            });
          }
        }

        logger.debug('📥 Loaded segmentation polygons from API:', {
          imageId,
          polygonCount: polygons.length,
          imageDimensions:
            segmentationData.imageWidth && segmentationData.imageHeight
              ? `${segmentationData.imageWidth}x${segmentationData.imageHeight}`
              : 'not available',
          firstPolygon: polygons[0]
            ? {
                id: polygons[0].id,
                type: polygons[0].type,
                pointsCount: polygons[0].points?.length || 0,
                samplePoints: polygons[0].points?.slice(0, 3),
              }
            : null,
        });

        // Final check before setting state
        if (isMounted && imageId === currentImageIdRef.current) {
          setSegmentationPolygons(polygons);
        }
      } catch (error: unknown) {
        // Handle cancellation gracefully - don't show errors for cancelled requests
        if (handleCancelledError(error, 'segmentation loading')) {
          return;
        }

        // Only handle real errors if we're still on the same image
        if (isMounted && imageId === currentImageIdRef.current) {
          logger.error('Failed to load segmentation:', error);
          // Set to null instead of showing error for missing segmentation
          if (
            error &&
            typeof error === 'object' &&
            'response' in error &&
            (error as { response?: { status?: number } }).response?.status ===
              404
          ) {
            logger.debug('No segmentation found for image (404):', imageId);
            setSegmentationPolygons(null);
          } else {
            toast.error(t('toast.operationFailed'));
            setSegmentationPolygons(null);
          }
        }
      }
    };

    loadSegmentation();

    return () => {
      isMounted = false;
      // Don't abort here - let the coordinated controller handle it
    };
    // currentImageIdRef is a stable React ref object — intentionally omitted
    // from the deps array. Adding it would cause the effect to re-run on every
    // render since refs are mutable objects (the linter compares the ref object
    // itself, not .current). The effect reads .current inside the async body,
    // which always gets the latest value without requiring a dep listing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectId,
    imageId,
    t,
    selectedImage?.width,
    selectedImage?.height,
    selectedImage?.segmentationStatus,
    getSignal,
    queryClient,
  ]);

  // Handle image load to get dimensions (only if not already set from segmentation data)
  // Stable identity: MultiChannelCanvas's decode effect depends on `onLoad`,
  // so a new function every render would re-fetch + re-decode all channels on
  // any unrelated editor re-render. Only `imageId` affects its behaviour.
  const handleImageLoad = useCallback(
    (width: number, height: number, channelsKey: string) => {
      // Mark this `(imageId, channels)` pair as visible so the Skeleton
      // overlay can step aside. The channelsKey comes from the canvas
      // that just finished compositing — see `MultiChannelCanvas.onLoad`.
      if (imageId) setLoadedFrameKey(`${imageId}::${channelsKey}`);
      setImageDimensions(current => {
        // Only update if dimensions are not already set from segmentation data
        if (!current) {
          logger.debug('📐 Setting image dimensions from image load:', {
            width,
            height,
          });
          return { width, height };
        }

        // Log if dimensions differ between image and segmentation data
        if (current.width !== width || current.height !== height) {
          logger.warn('⚠️ Image dimensions mismatch:', {
            fromSegmentation: current,
            fromImage: { width, height },
            imageId,
          });
          // Keep segmentation data dimensions (they're more reliable)
          return current;
        }

        return current;
      });
    },
    [imageId]
  );

  return {
    segmentationPolygons,
    setSegmentationPolygons,
    imageDimensions,
    setImageDimensions,
    loadedFrameKey,
    handleImageLoad,
  };
}
