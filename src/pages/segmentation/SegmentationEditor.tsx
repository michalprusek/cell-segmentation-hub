import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
  startTransition,
} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useLanguage, useModel } from '@/contexts/exports';
import { useProjectData } from '@/hooks/useProjectData';
import { sortImagesBySettings } from '@/hooks/useImageFilter';
import { useEnhancedSegmentationEditor } from './hooks/useEnhancedSegmentationEditor';
import { useSegmentationReload } from './hooks/useSegmentationReload';
import { useSegmentationQueue } from '@/hooks/useSegmentationQueue';
import { useCoordinatedAbortController } from '@/hooks/shared/useAbortController';
import useDebounce from '@/hooks/useDebounce';
import { polygonKey } from '@/lib/segmentation';
import apiClient, { SegmentationPolygon } from '@/lib/api';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { handleCancelledError } from '@/lib/errorUtils';
import { transformSegmentationPolygons } from './utils/transformSegmentationPolygons';
import { usePolygonHandlers } from './hooks/usePolygonHandlers';
import { useSegmentationLoader } from './hooks/useSegmentationLoader';
import { useResegment } from './hooks/useResegment';
import { usePolygonRenderProps } from './hooks/usePolygonRenderProps';
import SegmentationErrorBoundary from './components/SegmentationErrorBoundary';

// Presentational render tree — pure component, all values threaded via props.
import SegmentationEditorLayout from './components/SegmentationEditorLayout';

import { useVideoFrames } from './hooks/useVideoFrames';
import {
  setCachedSegmentationPolygons,
  segmentationPolygonsQueryKey,
} from './hooks/segmentationPolygonCache';

const SegmentationEditor = () => {
  const { projectId, imageId } = useParams<{
    projectId: string;
    imageId: string;
  }>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { selectedModel, confidenceThreshold, detectHoles } = useModel();
  const navigate = useNavigate();
  // Shared cache between the editor's primary load and the
  // sliding-window prefetch hook. Both write/read under the
  // canonical segmentation-results query key so a scrub-back or a
  // pre-warmed frame paints without a network round-trip.
  const queryClient = useQueryClient();

  // Track if this is the initial load (coming from Project Detail) vs internal navigation
  const isInitialLoadRef = useRef(true);
  const previousImageIdRef = useRef<string | undefined>(undefined);
  const currentImageIdRef = useRef<string | undefined>(imageId);

  // Coordinated AbortController for all segmentation operations
  const { getSignal, abortAllOperations, abortAll } =
    useCoordinatedAbortController(
      ['main-loading', 'prefetch', 'websocket-reload'],
      'SegmentationEditor'
    );

  // Project data - optimize by NOT fetching all images upfront
  // This significantly improves performance with large projects (e.g., 640 images)
  // Instead, we fetch only metadata and load segmentation data on-demand
  const {
    projectTitle,
    projectType,
    images,
    loading: projectLoading,
    refreshImageSegmentation,
    // useProjectData always fetches metadata only (lod: 'low') and loads
    // segmentation geometry on demand — there is no fetch-all path to disable,
    // so no options arg is passed. Adjacent-frame prefetch is handled separately.
  } = useProjectData(projectId, user?.id);

  // WebSocket connection for segmentation status updates
  const {
    lastUpdate,
    queueStats,
    isConnected: isWebSocketConnected,
  } = useSegmentationQueue(projectId);

  // Debounce WebSocket updates to prevent rapid state changes
  // Use longer debounce during bulk operations to reduce re-renders
  const debouncedLastUpdate = useDebounce(
    lastUpdate,
    queueStats && (queueStats.queued > 10 || queueStats.processing > 5)
      ? 1000
      : 300
  );

  // Create compatibility objects for existing code
  // Apply the same sorting as in ProjectDetail page
  const projectImages = useMemo(() => {
    if (!images) return [];
    return sortImagesBySettings(images);
  }, [images]);

  const selectedImage = useMemo(
    () => projectImages.find(img => img.id === imageId),
    [projectImages, imageId]
  );

  const project = useMemo(
    () => ({ name: projectTitle || 'Unknown Project' }),
    [projectTitle]
  );

  const [canvasDimensions, setCanvasDimensions] = useState({
    width: 800,
    height: 600,
  });

  // Segmentation data-load cluster: polygons + dimensions + loadedFrameKey state
  // + the primary loadSegmentation effect (cache-first → API) + handleImageLoad.
  const {
    segmentationPolygons,
    setSegmentationPolygons,
    imageDimensions,
    setImageDimensions,
    loadedFrameKey,
    handleImageLoad,
  } = useSegmentationLoader({
    projectId,
    imageId,
    selectedImage,
    getSignal,
    queryClient,
    t,
    currentImageIdRef,
  });

  // Bumped every time fresh segmentation data is reloaded (resegment / WS
  // completion). The editor's polygon-sync effect keys on this so a reload
  // that yields the SAME polygon count but new geometry still replaces the
  // canvas — a plain length check misses same-count resegments.
  const [reloadNonce, setReloadNonce] = useState(0);
  const handleReloadedPolygons = useCallback(
    (polys: SegmentationPolygon[] | null) => {
      setSegmentationPolygons(polys);
      setReloadNonce(n => n + 1);
    },
    [setSegmentationPolygons]
  );

  // Use custom hook for segmentation reload logic
  const { isReloading, reloadSegmentation, cleanupReloadOperations } =
    useSegmentationReload({
      projectId,
      imageId,
      onPolygonsLoaded: handleReloadedPolygons,
      onDimensionsUpdated: setImageDimensions,
      maxRetries: 2,
    });

  // Smart prefetching for adjacent images with cancellation support
  // This ensures smooth navigation without loading all 640 images upfront
  useEffect(() => {
    if (!projectImages.length || !imageId || !refreshImageSegmentation) return;

    // Cancel any existing prefetch operations when imageId changes
    const signal = getSignal('prefetch');

    const currentIndex = projectImages.findIndex(img => img.id === imageId);
    if (currentIndex === -1) return;

    // Define prefetch window (current + adjacent images)
    const prefetchIndices = [
      currentIndex - 1, // Previous image
      currentIndex, // Current image (priority)
      currentIndex + 1, // Next image
    ].filter(idx => idx >= 0 && idx < projectImages.length);

    // Prefetch with priority: current first, then adjacent
    const prefetchWithPriority = async () => {
      try {
        // Check if we're still on the same image
        if (signal.aborted || imageId !== currentImageIdRef.current) {
          logger.debug('🛑 Prefetch cancelled - image changed');
          return;
        }

        // First ensure current image is loaded
        const currentImage = projectImages[currentIndex];
        if (currentImage && !currentImage.segmentationResult) {
          await refreshImageSegmentation(currentImage.id);
        }

        // Then prefetch adjacent images in background
        setTimeout(() => {
          if (signal.aborted || imageId !== currentImageIdRef.current) {
            return; // Don't prefetch if cancelled or image changed
          }

          prefetchIndices.forEach(idx => {
            if (idx !== currentIndex) {
              const img = projectImages[idx];
              if (
                img &&
                !img.segmentationResult &&
                (img.segmentationStatus === 'completed' ||
                  img.segmentationStatus === 'segmented')
              ) {
                // Prefetch in background without blocking
                refreshImageSegmentation(img.id).catch(error => {
                  // Silent fail for prefetch, but handle cancellation properly
                  if (!handleCancelledError(error, 'prefetch')) {
                    logger.debug('Prefetch failed (non-critical):', error);
                  }
                });
              }
            }
          });
        }, 500); // Small delay to prioritize current image
      } catch (error) {
        // Handle cancellation gracefully
        if (!handleCancelledError(error, 'prefetch')) {
          logger.error('Prefetch error:', error);
        }
      }
    };

    prefetchWithPriority();
  }, [imageId, projectImages, refreshImageSegmentation, getSignal]);

  // Calculate canvas dimensions dynamically based on container and image
  const updateCanvasDimensions = useCallback(
    (containerWidth: number, containerHeight: number) => {
      if (imageDimensions) {
        const imageAspectRatio = imageDimensions.width / imageDimensions.height;
        const containerAspectRatio = containerWidth / containerHeight;

        let newWidth, newHeight;
        if (imageAspectRatio > containerAspectRatio) {
          // Image is wider than container
          newWidth = containerWidth;
          newHeight = containerWidth / imageAspectRatio;
        } else {
          // Image is taller than container
          newHeight = containerHeight;
          newWidth = containerHeight * imageAspectRatio;
        }

        // Apply devicePixelRatio for crisp rendering
        const dpr = window.devicePixelRatio || 1;
        setCanvasDimensions({
          width: Math.round(newWidth * dpr) / dpr,
          height: Math.round(newHeight * dpr) / dpr,
        });
      }
    },
    [imageDimensions]
  );

  // Update canvas dimensions when image dimensions change
  useEffect(() => {
    if (imageDimensions) {
      // Use a default container size for now, could be measured from ref
      const defaultContainerWidth = 800;
      const defaultContainerHeight = 600;
      updateCanvasDimensions(defaultContainerWidth, defaultContainerHeight);
    }
  }, [imageDimensions, updateCanvasDimensions]);

  const canvasWidth = canvasDimensions.width;
  const canvasHeight = canvasDimensions.height;

  // Get initial polygons from segmentation data
  const initialPolygons = useMemo(
    () => transformSegmentationPolygons(segmentationPolygons, imageDimensions),
    [segmentationPolygons, imageDimensions]
  );

  // Determine if we should trigger auto-center (only on initial load from Project Detail)
  const shouldAutoCenter = useRef(false);
  useEffect(() => {
    if (imageId !== previousImageIdRef.current) {
      // Image has changed
      if (isInitialLoadRef.current) {
        // This is the initial load - trigger auto-center
        shouldAutoCenter.current = true;
        isInitialLoadRef.current = false;
      } else {
        // This is navigation within the editor - don't auto-center
        shouldAutoCenter.current = false;
      }
      previousImageIdRef.current = imageId;
    }
  }, [imageId]);

  // Sperm polyline state for SpermInstancePanel
  const [activePartClass, setActivePartClass] = useState<
    'head' | 'midpiece' | 'tail'
  >('head');
  const [activeInstanceId, setActiveInstanceId] = useState<string>('sperm_1');
  const activePartClassRef = useRef<'head' | 'midpiece' | 'tail'>(
    activePartClass
  );
  const activeInstanceIdRef = useRef<string>(activeInstanceId);
  activePartClassRef.current = activePartClass;
  activeInstanceIdRef.current = activeInstanceId;

  // Initialize enhanced editor
  const editor = useEnhancedSegmentationEditor({
    initialPolygons,
    reloadNonce,
    imageWidth: imageDimensions?.width || 1024,
    imageHeight: imageDimensions?.height || 768,
    canvasWidth,
    canvasHeight,
    imageId, // Pass imageId to track image changes
    isFromGallery: shouldAutoCenter.current, // Use our auto-center flag
    activePartClassRef,
    activeInstanceIdRef,
    // Drives MT-only polyline behaviours inside the hook + the
    // slicing hook it owns (Enter-extends, polyline-slice). Sperm
    // and other types fall back to the legacy paths.
    projectType,
    onSave: async (polygons, targetImageId, targetDimensions, signal) => {
      const saveToImageId = targetImageId || imageId;
      if (!projectId || !saveToImageId) return;

      // Determine the correct dimensions to use
      let saveWidth: number | undefined;
      let saveHeight: number | undefined;

      if (targetDimensions) {
        // Use explicitly provided dimensions (for auto-save)
        saveWidth = targetDimensions.width;
        saveHeight = targetDimensions.height;
        logger.debug(
          '📐 Using provided dimensions for save:',
          targetDimensions,
          'for image:',
          saveToImageId
        );
      } else if (targetImageId && targetImageId !== imageId) {
        // Look up dimensions from projectImages if saving to a different image
        const targetImage = projectImages.find(img => img.id === targetImageId);
        saveWidth = targetImage?.width;
        saveHeight = targetImage?.height;
        logger.debug(
          '📐 Looked up dimensions from projectImages:',
          { width: saveWidth, height: saveHeight },
          'for image:',
          saveToImageId
        );
      } else {
        // Use current image dimensions for manual save
        saveWidth = imageDimensions?.width;
        saveHeight = imageDimensions?.height;
        logger.debug(
          '📐 Using current dimensions for manual save:',
          imageDimensions,
          'for image:',
          saveToImageId
        );
      }

      // Fallback: if we still don't have dimensions, try to get them from projectImages
      if (!saveWidth || !saveHeight) {
        const fallbackImage = projectImages.find(
          img => img.id === saveToImageId
        );
        if (fallbackImage?.width && fallbackImage?.height) {
          saveWidth = fallbackImage.width;
          saveHeight = fallbackImage.height;
          logger.warn(
            '⚠️ Using fallback dimensions from projectImages:',
            { width: saveWidth, height: saveHeight },
            'for image:',
            saveToImageId
          );
        }
      }

      try {
        // Transform Polygon[] to SegmentationPolygon[] for API. Spread preserves
        // every wire-level field (trackId for MT, future additions); only
        // parent_id → parentIds[] needs explicit conversion. `_embedding` is a
        // server-only blob (KB per polyline) — strip defensively even though
        // backend already removes it before serving.
        const polygonData: SegmentationPolygon[] = polygons.map(polygon => {
          const { parent_id, _embedding: _drop, ...rest } = polygon;
          return {
            ...rest,
            type: polygon.type || 'external',
            class: polygon.class || 'spheroid',
            parentIds: parent_id ? [parent_id] : [],
          };
        });

        const updatedResult = await apiClient.updateSegmentationResults(
          saveToImageId,
          polygonData,
          saveWidth,
          saveHeight,
          signal ? { signal } : undefined
        );
        // Keep the shared React Query cache in sync with the just-saved
        // server state. The editor's load path serves cache-first
        // (cache hit short-circuits the network), so without this a
        // delete-then-reopen within gcTime would resurrect the removed
        // polygons from the stale cache entry seeded on initial load.
        setCachedSegmentationPolygons(queryClient, saveToImageId, {
          polygons: updatedResult.polygons ?? [],
          imageWidth: saveWidth,
          imageHeight: saveHeight,
        });
        // Only update UI state if we're saving the current image (not autosave for different image)
        if (saveToImageId === imageId) {
          setSegmentationPolygons(updatedResult.polygons || []);
          toast.success(t('toast.dataSaved'));
        } else {
          // This is an autosave for a different image, don't show success toast or update UI
          logger.debug('✅ Autosaved polygons for image:', saveToImageId);
        }
      } catch (error) {
        // Handle cancellation gracefully
        if (handleCancelledError(error, 'segmentation save')) {
          return;
        }

        logger.error('Failed to save segmentation:', error);
        toast.error(t('toast.operationFailed'));
      }
    },
    // IMPORTANT: onPolygonsChange is intentionally NOT provided
    // to prevent any automatic saving when polygons change.
    // Saving only happens on:
    // 1. Manual save (Ctrl+S or Save button)
    // 2. Switching images (autosaveBeforeReset)
    // 3. Leaving the editor (unmount autosave)
  });

  // Listen for segmentation completion and auto-reload polygons (debounced) with cancellation
  const handleSegmentationStatusUpdate = useCallback(() => {
    // Only proceed if we have a WebSocket update for the current image
    if (!debouncedLastUpdate || debouncedLastUpdate.imageId !== imageId) {
      return;
    }

    // Auto-reload polygons when segmentation is completed
    if (
      !isReloading &&
      (debouncedLastUpdate.status === 'segmented' ||
        debouncedLastUpdate.status === 'completed')
    ) {
      logger.debug(
        '🎯 Segmentation completed via WebSocket, auto-reloading polygons:',
        {
          imageId: debouncedLastUpdate.imageId,
          status: debouncedLastUpdate.status,
          polygonCount: debouncedLastUpdate.polygonCount,
        }
      );

      // Get abort signal for WebSocket reload operations
      const signal = getSignal('websocket-reload');

      // Add retry mechanism to handle race condition between WebSocket status and API availability
      const tryReloadWithRetry = async (attempt = 1, maxAttempts = 3) => {
        if (
          isReloading ||
          signal.aborted ||
          imageId !== currentImageIdRef.current
        ) {
          logger.debug('🛑 WebSocket reload cancelled');
          return;
        }

        try {
          await reloadSegmentation();
        } catch (error) {
          // Handle cancellation gracefully
          if (handleCancelledError(error, 'websocket reload')) {
            return;
          }

          logger.warn(
            `Segmentation reload attempt ${attempt} failed, will retry in ${attempt * 1000}ms`,
            { imageId: debouncedLastUpdate.imageId, error }
          );

          if (
            attempt < maxAttempts &&
            !signal.aborted &&
            imageId === currentImageIdRef.current
          ) {
            setTimeout(() => {
              if (!signal.aborted && imageId === currentImageIdRef.current) {
                tryReloadWithRetry(attempt + 1, maxAttempts);
              }
            }, attempt * 1000); // Exponential backoff: 1s, 2s, 3s
          } else {
            logger.error(
              `Failed to reload segmentation after ${maxAttempts} attempts`,
              { imageId: debouncedLastUpdate.imageId }
            );
            // Surface a recovery action to the user. Note: reloadSegmentation()
            // already fires this toast via useSegmentationReload when its own
            // internal retries exhaust. This catch fires only for unexpected
            // throws that bypass that path (e.g. network abort outside the
            // hook's guard), so there is no double-toast risk.
            toast.error(
              t('toast.segmentation.reloadFailed') ||
                'Failed to load segmentation results. Please refresh the page.'
            );
          }
        }
      };

      // Start with initial delay to ensure API is ready
      setTimeout(() => {
        if (!signal.aborted && imageId === currentImageIdRef.current) {
          tryReloadWithRetry();
        }
      }, 500);

      return;
    }

    // Also handle failed segmentation
    if (
      debouncedLastUpdate.status === 'failed' ||
      debouncedLastUpdate.status === 'no_segmentation'
    ) {
      logger.debug('❌ Segmentation failed/empty, clearing polygons:', {
        imageId: debouncedLastUpdate.imageId,
        status: debouncedLastUpdate.status,
      });
      // Only update if we're still on the same image
      if (imageId === currentImageIdRef.current) {
        setSegmentationPolygons(null);
      }
    }
  }, [
    debouncedLastUpdate,
    imageId,
    isReloading,
    reloadSegmentation,
    setSegmentationPolygons,
    getSignal,
    t,
  ]);

  useEffect(() => {
    handleSegmentationStatusUpdate();
  }, [handleSegmentationStatusUpdate]);

  // Cleanup and coordinate cancellation when imageId changes
  useEffect(() => {
    // When imageId changes, cancel all ongoing operations for the previous image
    const previousImageId = previousImageIdRef.current;
    if (previousImageId && previousImageId !== imageId) {
      logger.debug(
        `🛑 Image changed from ${previousImageId} to ${imageId} - cancelling all operations`
      );
      abortAllOperations();
    }

    // Update the ref
    previousImageIdRef.current = imageId;
    currentImageIdRef.current = imageId;

    return () => {
      cleanupReloadOperations();
    };
  }, [imageId, cleanupReloadOperations, abortAllOperations]);

  // Cleanup all operations when component unmounts
  useEffect(() => {
    return () => {
      abortAll();
    };
  }, [abortAll]);

  // Navigation functions
  const navigateToImage = (direction: 'prev' | 'next') => {
    if (!projectImages?.length) return;

    const current = projectImages.find(img => img.id === imageId);
    if (!current) return;

    // Video frame children navigate by `frameIndex` ascending, not by
    // gallery sort order. The gallery defaults to `updatedAt DESC` which
    // would otherwise invert the meaning of next/back for users — frame 3
    // sits at array index 0 (newest), frame 1 at index N-1 (oldest), so
    // clicking "next" from frame 2 (array index 1) would jump to frame 1.
    if (current.parentVideoId) {
      const siblings = projectImages
        .filter(img => img.parentVideoId === current.parentVideoId)
        .sort((a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0));
      const idx = siblings.findIndex(img => img.id === imageId);
      if (idx < 0) return;
      const target =
        direction === 'next'
          ? siblings[(idx + 1) % siblings.length]
          : siblings[(idx - 1 + siblings.length) % siblings.length];
      if (target) {
        startTransition(() => {
          navigate(`/segmentation/${projectId}/${target.id}`);
        });
      }
      return;
    }

    // Standalone image: fall back to gallery sort order.
    const currentIndex = projectImages.findIndex(img => img.id === imageId);
    if (currentIndex === -1) return;

    const nextIndex =
      direction === 'next'
        ? currentIndex < projectImages.length - 1
          ? currentIndex + 1
          : 0
        : currentIndex > 0
          ? currentIndex - 1
          : projectImages.length - 1;

    const nextImage = projectImages[nextIndex];
    if (nextImage) {
      // Use startTransition to ensure navigation works with React 18 concurrent features
      // This fixes navigation freezing issues after segmentation
      startTransition(() => {
        navigate(`/segmentation/${projectId}/${nextImage.id}`);
      });
    }
  };

  // Polygon CRUD handlers + owned state (hiddenPolygonIds, hoveredPolygonId,
  // persistedSelectionTrackId) + the MT cross-frame selection remap effect.
  // Called BEFORE usePolygonRenderProps because that hook takes hiddenPolygonIds
  // as a parameter.
  const {
    hiddenPolygonIds,
    hoveredPolygonId,
    setHoveredPolygonId,
    handleTogglePolygonVisibility,
    handleDeletePolygonFromPanel,
    handleSelectPolygon,
    handleDeletePolygonFromContextMenu,
    handleSlicePolygonFromContextMenu,
    handleEditPolygonFromContextMenu,
    handleDeleteVertexFromContextMenu,
    handleRenamePolygon,
    handleChangeInstanceId,
    handleChangePartClass,
    handleUpdatePolygonField,
  } = usePolygonHandlers({ editor, imageId });

  // Pure render-derivation pipeline (polyline/instance discrimination, legacy
  // edit-mode booleans, hidden/degenerate polygon filter — no viewport culling).
  // Extracted to usePolygonRenderProps for isolated unit testing.
  const {
    hasPolylines,
    polylineKind,
    availableInstanceIds,
    legacyModes,
    visiblePolygons,
    frameHiddenIds,
  } = usePolygonRenderProps({
    editor,
    hiddenPolygonIds,
    activeInstanceId,
  });

  // Development-only debug logger: logs polygon rendering state.
  // Moved here (after usePolygonHandlers) so hiddenPolygonIds is in scope.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const filteredPolygons = editor.polygons.filter(
      polygon => !hiddenPolygonIds.has(polygonKey(polygon))
    );
    logger.debug('🎨 Polygon rendering state:', {
      totalPolygons: editor.polygons.length,
      visiblePolygons: filteredPolygons.length,
      hiddenCount: hiddenPolygonIds.size,
      imageDimensions,
      transform: editor.transform,
      svgViewBox: `0 0 ${imageDimensions?.width || canvasWidth} ${imageDimensions?.height || canvasHeight}`,
      firstPolygon: filteredPolygons[0]
        ? {
            id: filteredPolygons[0].id,
            pointsCount: filteredPolygons[0].points?.length || 0,
            samplePoints: filteredPolygons[0].points?.slice(0, 5),
            bounds:
              filteredPolygons[0].points?.length > 0
                ? {
                    minX: Math.min(...filteredPolygons[0].points.map(p => p.x)),
                    maxX: Math.max(...filteredPolygons[0].points.map(p => p.x)),
                    minY: Math.min(...filteredPolygons[0].points.map(p => p.y)),
                    maxY: Math.max(...filteredPolygons[0].points.map(p => p.y)),
                  }
                : null,
          }
        : null,
    });
  }, [
    editor.polygons,
    hiddenPolygonIds,
    imageDimensions,
    canvasHeight,
    canvasWidth,
    editor.transform,
  ]);

  // Re-run ML segmentation on the currently-open frame using the
  // user-selected model + threshold. Overwrites the existing
  // `Segmentation` row on the backend (upsert). After the batch
  // endpoint returns, we reload polygons via the existing
  // `reloadSegmentation` hook so the canvas reflects the new result.
  // The resegment hook chain MUST be declared after `const video = useVideoFrames(...)`
  // because `handleResegmentCurrentFrame` captures `video.container`. Per
  // CLAUDE.md production bug #11 + memory `feedback_react_hook_tdz_after_data_source`:
  // useCallback/useMemo placed BEFORE the `const` they capture in deps
  // throws "Cannot access 'X' before initialization" at runtime. Moved
  // ~100 lines down to live next to `const video = useVideoFrames(...)`.

  // Compute navigation context that EditorHeader uses for the
  // currentImageIndex / totalImages display + the Back/Next disabled
  // gating. For video frame children we treat the sibling frames as the
  // navigation domain (sorted by frameIndex ascending) so that the
  // "X / Y" counter reads "Frame 2 / 3" instead of "Frame 1 of 301" and
  // the Back button on the first frame (frameIndex 0) is correctly
  // disabled regardless of gallery sort order.
  const navContext = useMemo(() => {
    if (!projectImages?.length) {
      return { index: -1, total: 0 };
    }
    const current = projectImages.find(img => img.id === imageId);
    if (current?.parentVideoId) {
      const siblings = projectImages
        .filter(img => img.parentVideoId === current.parentVideoId)
        .sort((a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0));
      return {
        index: siblings.findIndex(img => img.id === imageId),
        total: siblings.length,
      };
    }
    return {
      index: projectImages.findIndex(img => img.id === imageId),
      total: projectImages.length,
    };
  }, [projectImages, imageId]);

  const currentImageIndex = navContext.index;

  // Video mode: derive videoContainerId from the selected row. Frames
  // (which are what the user opens in practice) carry the container id
  // in parentVideoId; the rare case of opening a container directly
  // uses imageId. useMemo so the value is stable across renders.
  // CRITICAL: this must run BEFORE any early returns below so the
  // useVideoFrames hook is called unconditionally on every render.
  const videoContainerId = useMemo(() => {
    if (!selectedImage) return null;
    const meta = selectedImage as {
      isVideoContainer?: boolean;
      parentVideoId?: string | null;
    };
    return meta.isVideoContainer
      ? (imageId ?? null)
      : (meta.parentVideoId ?? null);
  }, [selectedImage, imageId]);

  // Lift video-frames state to editor scope so the header (Play
  // button + scrubber) and the still-mounted VideoModeOverlay
  // (kymograph modal + key bindings) read from the same source.
  // useVideoFrames(null) short-circuits internally via `enabled: !!id`.
  const video = useVideoFrames(videoContainerId);
  const isVideoMode =
    !!videoContainerId && (video.container?.frameCount ?? 0) > 1;

  // ───────────────── Resegment chain ─────────────────
  // Lives HERE (after `const video = useVideoFrames`) to avoid the TDZ that
  // would result from passing video.container?.channels before `video` is
  // defined. CLAUDE.md production bug #11.
  const {
    isResegmenting,
    showResegmentChannelDialog,
    setShowResegmentChannelDialog,
    runResegment,
    handleResegmentCurrentFrame,
  } = useResegment({
    projectId,
    imageId,
    projectType,
    selectedModel,
    confidenceThreshold,
    detectHoles,
    videoChannels: video.container?.channels ?? null,
    queryClient,
    t,
    onReloaded: handleReloadedPolygons,
    setImageDimensions,
    currentImageIdRef,
  });
  // ─────────────── End resegment chain ───────────────

  // ───────────────── Cross-frame track operations ─────────────────
  // Placed AFTER `const video = useVideoFrames(...)` so they can read
  // video.container without a TDZ (CLAUDE.md production bug #11).

  // `editor` is a fresh object literal every render of
  // useEnhancedSegmentationEditor. Mirror it into a ref so the track-op handlers
  // below stay identity-stable (they read the latest polygons via the ref) —
  // they're compared in the CanvasPolygon React.memo comparator, so closing over
  // `editor` directly would break the comparator and re-render every polyline on
  // each cursor/hover/zoom tick (CLAUDE.md failure pattern #5).
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // Invalidate the cached segmentation of the video's frames so a scrub after a
  // track op refetches the mutated data. The sliding-window prefetch caches
  // sibling frames for 60 s, which would otherwise paint stale geometry.
  const invalidateVideoFrameSegmentationCaches = useCallback(() => {
    const frames = video.container?.frames;
    if (!frames) return;
    for (const frame of frames) {
      queryClient.invalidateQueries({
        queryKey: segmentationPolygonsQueryKey(frame.id),
      });
    }
  }, [video.container, queryClient]);

  // Right-click "Propagate to following frames": stamp this microtubule's
  // current shape into every later frame of the video.
  const handlePropagateTrack = useCallback(
    async (polygonId: string) => {
      const videoId = video.container?.id;
      const source = editorRef.current
        .getPolygons()
        .find(p => p.id === polygonId);
      const fromFrameIndex = video.container?.frames.find(
        f => f.id === imageId
      )?.frameIndex;
      const points = (source?.points ?? []).map(p => ({ x: p.x, y: p.y }));
      // Guard failures are unexpected (missing video/source) or a degenerate
      // polyline; always give feedback rather than a silent no-op.
      if (
        !videoId ||
        !source ||
        typeof fromFrameIndex !== 'number' ||
        points.length < 2
      ) {
        logger.warn('Cannot propagate microtubule track', {
          hasVideo: !!videoId,
          hasSource: !!source,
          fromFrameIndex,
          points: points.length,
        });
        toast.error(t('segmentation.trackOps.propagateFailed'));
        return;
      }

      try {
        const result = await apiClient.propagateTrackForward(
          videoId,
          fromFrameIndex,
          {
            trackId: source.trackId,
            name: source.name,
            geometry: 'polyline',
            points,
          }
        );
        // When the backend generated a trackId (source had none), patch it onto
        // the source polyline so its colour + a later save stay consistent with
        // the propagated copies.
        if (result.trackId && result.trackId !== source.trackId) {
          handleUpdatePolygonField(polygonId, { trackId: result.trackId });
        }
        invalidateVideoFrameSegmentationCaches();
        toast.success(
          t('segmentation.trackOps.propagateSuccess', {
            count: result.framesUpdated,
          })
        );
      } catch (error) {
        logger.error('Failed to propagate microtubule track', error);
        toast.error(t('segmentation.trackOps.propagateFailed'));
      }
    },
    [
      video.container,
      imageId,
      handleUpdatePolygonField,
      invalidateVideoFrameSegmentationCaches,
      t,
    ]
  );

  // Right-click delete: whole track for a tracked microtubule, else the single
  // polyline (untracked MT or non-MT project).
  const handleDeletePolygonOrTrack = useCallback(
    async (polygonId: string) => {
      const videoId = video.container?.id;
      const target = editorRef.current
        .getPolygons()
        .find(p => p.id === polygonId);
      const trackId = target?.trackId;
      if (projectType === 'microtubules' && videoId && trackId) {
        try {
          const result = await apiClient.deleteTrack(videoId, trackId);
          // Remove it from the current frame + hidden-set locally for instant
          // feedback; the backend already purged every sibling frame.
          handleDeletePolygonFromContextMenu(polygonId);
          invalidateVideoFrameSegmentationCaches();
          toast.success(
            t('segmentation.trackOps.deleteTrackSuccess', {
              count: result.framesAffected,
            })
          );
        } catch (error) {
          logger.error('Failed to delete microtubule track', error);
          toast.error(t('segmentation.trackOps.deleteTrackFailed'));
        }
        return;
      }
      handleDeletePolygonFromContextMenu(polygonId);
    },
    [
      video.container,
      projectType,
      handleDeletePolygonFromContextMenu,
      invalidateVideoFrameSegmentationCaches,
      t,
    ]
  );
  // ─────────────── End cross-frame track operations ───────────────

  // The overlay debounce moved into `FrameLoadingGate` — it needs
  // `visibleChannels` from ImageDisplayContext which is only mounted
  // inside the provider subtree below.

  // Seed video.frameIndex from the URL imageId on first container load.
  // useVideoFrames defaults to frame 0 internally; without this sync,
  // opening /segmentation/<pid>/<frame97Id> would show frame 0 in the
  // canvas and "1 / 300" in the header. We seed once, when the
  // container metadata arrives and the URL points at a known frame.
  useEffect(() => {
    if (!isVideoMode || !video.container || !imageId) return;
    const idx = video.container.frames.findIndex(f => f.id === imageId);
    if (idx >= 0 && idx !== video.frameIndex) {
      video.setFrameIndex(idx);
    }
    // Intentionally NOT depending on video.frameIndex — that would
    // fight Play / scrubber on every tick. Only re-run when the URL
    // changes or the container is first loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideoMode, video.container, imageId]);

  // Reverse sync: mirror video.frameIndex back into the URL imageId.
  // The header slider and Play loop mutate frameIndex locally, but the
  // segmentation loader (loadSegmentation useEffect) only re-fires when
  // URL imageId changes — back/next buttons work because they navigate()
  // directly, slider/play didn't. `replace: true` keeps drag scrubbing
  // and play-loop ticks from polluting browser history.
  //
  // Playback ticks at 10 FPS need IMMEDIATE sync so each tick triggers
  // its fetch. Manual scrubs (slider drag, arrow-key mash) are
  // DEBOUNCED — a 40 key/s mash would otherwise fan out 40 redundant
  // navigate() + fetch cycles per second; the slider thumb already
  // moves locally without waiting for this sync, so we can wait
  // until the user pauses before committing the URL.
  // Tracks the previous render's `isPlaying` so we can detect the
  // playback→pause transition and FLUSH any pending mismatch right
  // away. Without this, a user pausing mid-tick would leave the URL
  // 100-200 ms behind the slider thumb until the debounce fires.
  const wasPlayingRef = useRef(video.isPlaying);
  useEffect(() => {
    const justPaused = wasPlayingRef.current && !video.isPlaying;
    wasPlayingRef.current = video.isPlaying;

    if (!isVideoMode || !video.container) return;
    const targetId = video.container.frames[video.frameIndex]?.id;
    if (!targetId || targetId === imageId) return;

    const commit = () => {
      startTransition(() => {
        navigate(`/segmentation/${projectId}/${targetId}`, { replace: true });
      });
    };

    if (video.isPlaying || justPaused) {
      commit();
      return;
    }

    // Debounce window: 120 ms is short enough that a paused user
    // pressing → once feels instant (UI thumb already moved), long
    // enough that a held-key burst at >8/s collapses to one commit.
    const timer = window.setTimeout(commit, 120);
    return () => window.clearTimeout(timer);
  }, [
    isVideoMode,
    video.container,
    video.frameIndex,
    video.isPlaying,
    imageId,
    projectId,
    navigate,
  ]);

  // Show loading state only during initial load
  // Once we have basic image metadata, show the UI even if segmentation is still loading
  if (projectLoading && !projectImages.length) {
    return (
      <div className="flex items-center justify-center h-screen">
        {t('common.loading')}
      </div>
    );
  }

  if (!selectedImage) {
    return (
      <div className="flex items-center justify-center h-screen">
        {t('common.no_preview')}
      </div>
    );
  }

  const visiblePolygonsCount = editor.polygons.length - frameHiddenIds.size;
  const hiddenPolygonsCount = frameHiddenIds.size;

  return (
    <SegmentationErrorBoundary>
      {/* The entire render tree lives in SegmentationEditorLayout — a
          pure presentational component. Every value/handler/composite
          object it consumes is threaded through explicit props below so
          all state, effects, and logic stay in this orchestrator. */}
      <SegmentationEditorLayout
        editor={editor}
        video={video}
        user={user}
        projectId={projectId}
        imageId={imageId}
        projectType={projectType}
        project={project}
        selectedImage={selectedImage}
        currentImageIndex={currentImageIndex}
        navContext={navContext}
        navigateToImage={navigateToImage}
        lastUpdate={lastUpdate}
        queueStats={queueStats}
        isWebSocketConnected={isWebSocketConnected}
        isVideoMode={isVideoMode}
        videoContainerId={videoContainerId}
        imageDimensions={imageDimensions}
        canvasWidth={canvasWidth}
        canvasHeight={canvasHeight}
        loadedFrameKey={loadedFrameKey}
        handleImageLoad={handleImageLoad}
        projectLoading={projectLoading}
        isReloading={isReloading}
        hasPolylines={hasPolylines}
        polylineKind={polylineKind}
        availableInstanceIds={availableInstanceIds}
        legacyModes={legacyModes}
        visiblePolygons={visiblePolygons}
        frameHiddenIds={frameHiddenIds}
        setHoveredPolygonId={setHoveredPolygonId}
        hoveredPolygonId={hoveredPolygonId}
        handleTogglePolygonVisibility={handleTogglePolygonVisibility}
        handleDeletePolygonFromPanel={handleDeletePolygonFromPanel}
        handleSelectPolygon={handleSelectPolygon}
        handleDeletePolygonOrTrack={handleDeletePolygonOrTrack}
        handlePropagateTrack={handlePropagateTrack}
        handleSlicePolygonFromContextMenu={handleSlicePolygonFromContextMenu}
        handleEditPolygonFromContextMenu={handleEditPolygonFromContextMenu}
        handleDeleteVertexFromContextMenu={handleDeleteVertexFromContextMenu}
        handleRenamePolygon={handleRenamePolygon}
        handleChangeInstanceId={handleChangeInstanceId}
        handleChangePartClass={handleChangePartClass}
        activePartClass={activePartClass}
        setActivePartClass={setActivePartClass}
        activeInstanceId={activeInstanceId}
        setActiveInstanceId={setActiveInstanceId}
        visiblePolygonsCount={visiblePolygonsCount}
        hiddenPolygonsCount={hiddenPolygonsCount}
        isResegmenting={isResegmenting}
        showResegmentChannelDialog={showResegmentChannelDialog}
        setShowResegmentChannelDialog={setShowResegmentChannelDialog}
        runResegment={runResegment}
        handleResegmentCurrentFrame={handleResegmentCurrentFrame}
        t={t}
      />
    </SegmentationErrorBoundary>
  );
};

export default SegmentationEditor;
