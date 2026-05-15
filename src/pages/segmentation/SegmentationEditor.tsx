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
import { EditMode } from './types';
import { shouldPreventCanvasDeselection } from './config/modeConfig';
import { Polygon, polygonKey, type PolygonKey } from '@/lib/segmentation';
import apiClient, { SegmentationPolygon } from '@/lib/api';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { handleCancelledError } from '@/lib/errorUtils';
import {
  generateSafePolygonKey,
  validatePolygonId,
  ensureValidPolygonId,
  logPolygonIdIssue,
} from '@/lib/polygonIdUtils';
import { ensureBrowserCompatibleUrl } from '@/lib/tiffUtils';

// New layout components
import VerticalToolbar from './components/VerticalToolbar';
import TopToolbar from './components/TopToolbar';
import PolygonListPanel from './components/PolygonListPanel';
import SpermInstancePanel from './components/SpermInstancePanel';
import MicrotubuleInstancePanel from './components/MicrotubuleInstancePanel';
import { isMicrotubuleInstance } from './utils/instanceColors';
import ChannelsSection from './components/sidebar/ChannelsSection';
import DisplaySection from './components/sidebar/DisplaySection';
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp';
import SegmentationErrorBoundary from './components/SegmentationErrorBoundary';

// Canvas components
import CanvasContainer from './components/canvas/CanvasContainer';
import CanvasContent from './components/canvas/CanvasContent';
import VideoFrameImage from './components/canvas/VideoFrameImage';
import FrameWindowPrefetcher from './components/canvas/FrameWindowPrefetcher';
import FrameLoadingGate from './components/canvas/FrameLoadingGate';
import { polygonVisibilityManager } from '@/lib/rendering/PolygonVisibilityManager';
import { SegmentChannelDialog } from '@/components/project/SegmentChannelDialog';
import CanvasPolygon from './components/canvas/CanvasPolygon';
import CanvasSvgFilters from './components/canvas/CanvasSvgFilters';
import ModeInstructions from './components/canvas/ModeInstructions';
import CanvasTemporaryGeometryLayer from './components/canvas/CanvasTemporaryGeometryLayer';
import { FpsMeter } from '@/lib/rendering/FpsMeter';

// Layout components
import EditorHeader from './components/EditorHeader';
import StatusBar from './components/StatusBar';
import EditorLayout from './components/layout/EditorLayout';

// Video-mode overlay (frame slider + channel switcher + window/level
// slider + kymograph modal). No-op for standalone images.
import { VideoModeOverlay } from './components/VideoModeOverlay';
import { ImageDisplayProvider } from './contexts/ImageDisplayContext';
import { useVideoFrames } from './hooks/useVideoFrames';
import {
  getCachedSegmentationPolygons,
  setCachedSegmentationPolygons,
} from './hooks/segmentationPolygonCache';

const EMPTY_HOVERED_VERTEX = { polygonId: null, vertexIndex: null } as const;

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
  } = useProjectData(projectId, user?.id, {
    fetchAll: false, // CRITICAL: Don't fetch all segmentation data upfront
    // We'll handle prefetching adjacent images separately
  });

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

  // State for segmentation polygons from API
  const [segmentationPolygons, setSegmentationPolygons] = useState<
    SegmentationPolygon[] | null
  >(null);
  const [isResegmenting, setIsResegmenting] = useState(false);
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  // Stores STABLE keys (trackId where present, else polygon.id) so a
  // microtubule hidden on one frame stays hidden when the user scrubs.
  // Branded `Set<PolygonKey>` makes accidental key-by-other-string a
  // compile error.
  const [hiddenPolygonIds, setHiddenPolygonIds] = useState<Set<PolygonKey>>(
    new Set()
  );
  // Cross-frame selection persistence: when the user picks an MT
  // polyline, remember its trackId so frame scrubs can re-select the
  // same MT instance on the new frame. null = no persistent selection.
  const [persistedSelectionTrackId, setPersistedSelectionTrackId] = useState<
    string | null
  >(null);
  const [hoveredPolygonId, setHoveredPolygonId] = useState<string | null>(null);
  const [canvasDimensions, setCanvasDimensions] = useState({
    width: 800,
    height: 600,
  });
  // `loadedFrameKey` is `${imageId}::${channelsKey}` — both axes
  // need to match before the Skeleton overlay can step aside.
  // Tracking just `imageId` would let a channel toggle keep a stale
  // composite painted while the new channel still decodes.
  // The debounce that latches "show overlay" lives inside
  // `FrameLoadingGate`, which is rendered under ImageDisplayProvider
  // (it needs `visibleChannels` to construct the target key).
  const [loadedFrameKey, setLoadedFrameKey] = useState<string | null>(null);

  // Use custom hook for segmentation reload logic
  const { isReloading, reloadSegmentation, cleanupReloadOperations } =
    useSegmentationReload({
      projectId,
      imageId,
      onPolygonsLoaded: setSegmentationPolygons,
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
  const initialPolygons = useMemo(() => {
    // Return empty array if no segmentation data exists or if it's not an array
    if (
      !segmentationPolygons ||
      !Array.isArray(segmentationPolygons) ||
      segmentationPolygons.length === 0
    ) {
      return [];
    }

    // For large datasets, process in chunks to prevent blocking
    const startTime = performance.now();

    // Transform SegmentationPolygon[] to Polygon[] and filter out invalid polygons.
    // Spreads `segPoly` so any wire-level field (trackId, future additions) reaches
    // the editor without manual maintenance; only parentIds[] needs explicit
    // conversion to parent_id (singular).
    const polygons: Polygon[] = segmentationPolygons
      .filter(segPoly => {
        const minPoints = segPoly.geometry === 'polyline' ? 2 : 3;
        return segPoly.points && segPoly.points.length >= minPoints;
      })
      .map((segPoly): Polygon | null => {
        const validPoints = segPoly.points
          .map(point => {
            if (Array.isArray(point)) {
              return { x: point[0], y: point[1] };
            }
            if (typeof point === 'object' && point !== null) {
              if (typeof point.x === 'number' && typeof point.y === 'number') {
                return point;
              }
              logger.warn(
                'Skipping invalid point with non-numeric coordinates',
                point
              );
              return null;
            }
            logger.warn('Skipping invalid point format', point);
            return null;
          })
          .filter((point): point is { x: number; y: number } => point !== null);

        const minValidPoints = segPoly.geometry === 'polyline' ? 2 : 3;
        if (validPoints.length < minValidPoints) {
          logger.warn('Dropping polygon due to insufficient valid points', {
            polygonId: segPoly.id,
          });
          return null;
        }

        let polygonId = segPoly.id;
        if (!validatePolygonId(segPoly.id)) {
          logPolygonIdIssue(
            segPoly,
            'Invalid or missing polygon ID from ML service'
          );
          polygonId = ensureValidPolygonId(segPoly.id, 'ml_polygon');
          logger.warn(
            `Generated fallback ID: ${polygonId} for polygon with invalid ID: ${segPoly.id}`
          );
        }

        const { parentIds, ...rest } = segPoly;
        return {
          ...rest,
          id: polygonId,
          points: validPoints,
          parent_id: parentIds?.[0],
        };
      })
      .filter((polygon): polygon is Polygon => polygon !== null);

    const invalidCount = segmentationPolygons.length - polygons.length;
    const processingTime = performance.now() - startTime;

    if (invalidCount > 0) {
      logger.warn(
        `⚠️ Filtered out ${invalidCount} invalid polygons (missing or insufficient points)`
      );
    }

    // Monitor processing time to detect performance issues
    if (processingTime > 100) {
      logger.warn(
        `⚠️ Polygon processing took ${processingTime.toFixed(2)}ms for ${segmentationPolygons.length} polygons`
      );
    }

    if (process.env.NODE_ENV === 'development') {
      logger.debug('🔄 Transformed segmentation polygons for editor:', {
        hasSegmentationData: true,
        inputCount: segmentationPolygons.length,
        validCount: polygons.length,
        filteredOut: invalidCount,
        processingTime: `${processingTime.toFixed(2)}ms`,
        imageDimensions,
        firstPolygon: polygons[0]
          ? {
              id: polygons[0].id,
              type: polygons[0].type,
              parent_id: polygons[0].parent_id,
              pointsCount: polygons[0].points?.length || 0,
              firstPoints: polygons[0].points?.slice(0, 3),
            }
          : null,
        internalPolygonCount: polygons.filter(
          p => p.type === 'internal' || p.parent_id
        ).length,
        externalPolygonCount: polygons.filter(
          p => p.type === 'external' && !p.parent_id
        ).length,
      });
    }

    return polygons;
  }, [segmentationPolygons, imageDimensions]);

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
      } catch (error: any) {
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

  // Handle image load to get dimensions (only if not already set from segmentation data)
  const handleImageLoad = (
    width: number,
    height: number,
    channelsKey: string
  ) => {
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
  };

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

  // Legacy compatibility handlers
  const handleTogglePolygonVisibility = (polygonId: string) => {
    // Map current-frame polygon.id → stable key (trackId or id) so the
    // hide state survives frame changes for MTs.
    const target = editor.polygons.find(p => p.id === polygonId);
    if (!target) return;
    const key = polygonKey(target);
    setHiddenPolygonIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const handleDeletePolygonFromPanel = (polygonId: string) => {
    const target = editor.polygons.find(p => p.id === polygonId);
    editor.handleDeletePolygon(polygonId);
    if (target) {
      const key = polygonKey(target);
      setHiddenPolygonIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(key);
        return newSet;
      });
    }
  };

  // Capture trackId at click so frame scrubbing re-attaches selection
  // to the same MT instance on the new frame.
  const handleSelectPolygon = useCallback(
    (polygonId: string | null) => {
      if (polygonId === null) {
        setPersistedSelectionTrackId(null);
      } else {
        const p = editor.polygons.find(x => x.id === polygonId);
        setPersistedSelectionTrackId(p?.trackId ?? null);
      }
      editor.handlePolygonSelection(polygonId);
    },
    [editor]
  );

  // Cross-frame selection remap. When polygons load for a new frame
  // (initialPolygons replaces editor.polygons), find the polygon that
  // shares the persisted trackId and re-select it. If no sibling exists
  // on this frame (track wasn't matched here), selection is left null
  // by the editor's own image-change reset and we don't fight it — but
  // we log so a missing match is debuggable when a user reports
  // "selection lost".
  useEffect(() => {
    if (!persistedSelectionTrackId) return;
    const match = editor.polygons.find(
      p => p.trackId === persistedSelectionTrackId
    );
    if (match) {
      if (editor.selectedPolygonId !== match.id) {
        editor.setSelectedPolygonId(match.id);
      }
    } else if (editor.polygons.length > 0) {
      // Polygons loaded but no match — track is not present on this
      // frame. Surface via debug log so support can correlate user
      // reports; UI deliberately stays quiet (toast on every scrub past
      // a gap would be obnoxious).
      logger.debug('Selected MT track not present on current frame', {
        trackId: persistedSelectionTrackId,
        frameImageId: imageId,
      });
    }
    // Intentionally narrow deps: passing the whole `editor` object
    // would re-fire on every render of useEnhancedSegmentationEditor
    // (cursor moves, hovers). The destructured fields capture
    // exactly the state this effect needs to react to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editor.polygons,
    persistedSelectionTrackId,
    editor.selectedPolygonId,
    editor.setSelectedPolygonId,
    imageId,
  ]);

  // Context menu handlers for polygon right-click
  const handleDeletePolygonFromContextMenu = useCallback(
    (polygonId: string) => {
      const target = editor.polygons.find(p => p.id === polygonId);
      editor.handleDeletePolygon(polygonId);
      if (target) {
        const key = polygonKey(target);
        setHiddenPolygonIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(key);
          return newSet;
        });
      }
    },
    [editor]
  );

  const handleSlicePolygonFromContextMenu = useCallback(
    (polygonId: string) => {
      // Select the polygon and switch to slice mode (skip to step 2)
      editor.setSelectedPolygonId(polygonId);
      editor.setEditMode(EditMode.Slice);
    },
    [editor]
  );

  const handleEditPolygonFromContextMenu = useCallback(
    (polygonId: string) => {
      // Select the polygon and switch to edit vertices mode
      editor.setSelectedPolygonId(polygonId);
      editor.setEditMode(EditMode.EditVertices);
    },
    [editor]
  );

  // Context menu handlers for vertex right-click
  const handleDeleteVertexFromContextMenu = useCallback(
    (polygonId: string, vertexIndex: number) => {
      editor.handleDeleteVertex(polygonId, vertexIndex);
    },
    [editor]
  );

  // Check if any polylines exist to conditionally show SpermInstancePanel
  const hasPolylines = useMemo(
    () => editor.polygons.some(p => p.geometry === 'polyline'),
    [editor.polygons]
  );

  // Discriminate sperm vs microtubule projects so the sidebar shows the
  // right panel. Authoritative signal: `polygon.class` ('sperm' or
  // 'microtubule') is stamped by the ML model when it produces the
  // polygon. Each project uses one model, so the first polyline whose
  // class we recognise is sufficient — no majority-counting needed.
  // Legacy/manually-drawn polylines without `class` fall back to
  // `partClass` (sperm head/midpiece/tail) or `mt_` instanceId prefix.
  const polylineKind = useMemo<'sperm' | 'microtubule' | null>(() => {
    for (const p of editor.polygons) {
      if (p.geometry !== 'polyline') continue;
      if (p.class === 'microtubule') return 'microtubule';
      if (p.class === 'sperm') return 'sperm';
      if (p.partClass) return 'sperm';
      if (isMicrotubuleInstance(p.instanceId)) return 'microtubule';
    }
    return null;
  }, [editor.polygons]);

  // Compute available sperm instance IDs for context menu (from existing polylines + active).
  // Two-stage memo: first derive a stable string key, then split into array only when key changes.
  // This prevents new array references on unrelated polygon edits (e.g. vertex drags).
  const availableInstanceKey = useMemo(() => {
    const ids = new Set<string>();
    for (const p of editor.polygons) {
      if (p.geometry === 'polyline' && p.instanceId) ids.add(p.instanceId);
    }
    ids.add(activeInstanceId);
    return Array.from(ids).sort().join(',');
  }, [editor.polygons, activeInstanceId]);

  const availableInstanceIds = useMemo(
    () => availableInstanceKey.split(',').filter(Boolean),
    [availableInstanceKey]
  );

  // Generic handler for updating a single field on a polygon by ID
  const handleUpdatePolygonField = useCallback(
    (polygonId: string, updates: Partial<Polygon>) => {
      const currentPolygons = editor.getPolygons();
      const updatedPolygons = currentPolygons.map(p =>
        p.id === polygonId ? { ...p, ...updates } : p
      );
      editor.updatePolygons(updatedPolygons);
    },
    // editor object reference is stable; tracking individual methods avoids
    // re-creating this callback when unrelated editor state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor.getPolygons, editor.updatePolygons]
  );

  const handleRenamePolygon = useCallback(
    (polygonId: string, name: string) =>
      handleUpdatePolygonField(polygonId, { name }),
    [handleUpdatePolygonField]
  );

  const handleChangeInstanceId = useCallback(
    (polygonId: string, instanceId: string) =>
      handleUpdatePolygonField(polygonId, { instanceId }),
    [handleUpdatePolygonField]
  );

  const handleChangePartClass = useCallback(
    (polygonId: string, partClass: 'head' | 'midpiece' | 'tail') =>
      handleUpdatePolygonField(polygonId, { partClass }),
    [handleUpdatePolygonField]
  );

  // Re-run ML segmentation on the currently-open frame using the
  // user-selected model + threshold. Overwrites the existing
  // `Segmentation` row on the backend (upsert). After the batch
  // endpoint returns, we reload polygons via the existing
  // `reloadSegmentation` hook so the canvas reflects the new result.
  // The backend enforces a per-project-type model whitelist (e.g. MT
  // projects only accept `'microtubule'`). The user-chosen `selectedModel`
  // is meaningful only for the generic spheroid project — for typed
  // projects we override so the request never gets rejected with
  // "Model X is not compatible with project type Y". The
  // `spheroid_invasive` branch matches backend `MODEL_TYPE_COMPATIBILITY`
  // which pins invasive projects to `unet_attention_aspp` (running
  // HRNet on invasive data produces wrong-pipeline output silently).
  const effectiveResegmentModel = useMemo(() => {
    if (projectType === 'microtubules') return 'microtubule';
    if (projectType === 'sperm') return 'sperm';
    if (projectType === 'wound') return 'wound';
    if (projectType === 'spheroid_invasive') return 'unet_attention_aspp';
    return selectedModel;
  }, [projectType, selectedModel]);

  // Channel picker state for resegment on multi-channel video frames.
  // True between Resegment-click and the user's channel choice; the
  // request fires inside `runResegment` with the picked channel.
  const [showResegmentChannelDialog, setShowResegmentChannelDialog] =
    useState(false);

  // Pure request — separated so both the direct (single-channel) path
  // and the dialog's onConfirm callback share one source of truth for
  // the network call + per-result handling.
  const runResegment = useCallback(
    async (channel?: string) => {
      if (!imageId || isResegmenting) return;
      setIsResegmenting(true);
      try {
        const result = await apiClient.requestBatchSegmentation(
          [imageId],
          effectiveResegmentModel,
          confidenceThreshold,
          detectHoles,
          channel
        );
        // The batch endpoint returns HTTP 200 even when every image
        // failed; surface the per-image outcome — see review pass-2.
        if (result.successful === 0) {
          const firstError = result.results?.[0]?.error;
          logger.error('Resegment returned 0 successes', { firstError });
          toast.error(
            firstError
              ? `${t('segmentation.toolbar.resegmentFailed')}: ${firstError}`
              : t('segmentation.toolbar.resegmentFailed')
          );
          return;
        }
        // Defense-in-depth: a 1-image call always has either successful=1
        // or successful=0, but if the helper is reused with >1 imageIds
        // a partial failure must not be hidden by the success toast.
        if (result.failed > 0) {
          const firstError = result.results?.find(r => !r.success)?.error;
          logger.warn('Resegment partial failure', { result });
          toast.warning(
            firstError
              ? `${t('segmentation.toolbar.resegmentSuccess')} (${result.failed} failed: ${firstError})`
              : `${t('segmentation.toolbar.resegmentSuccess')} (${result.failed} failed)`
          );
        } else {
          toast.success(t('segmentation.toolbar.resegmentSuccess'));
        }
        await reloadSegmentation();
      } catch (err) {
        if (handleCancelledError(err, 'resegment current frame')) return;
        logger.error('Resegment failed', err);
        toast.error(t('segmentation.toolbar.resegmentFailed'));
      } finally {
        setIsResegmenting(false);
      }
    },
    [
      imageId,
      isResegmenting,
      effectiveResegmentModel,
      confidenceThreshold,
      detectHoles,
      reloadSegmentation,
      t,
    ]
  );

  // Top-toolbar Resegment entry point. For multi-channel video frames
  // we MUST let the user pick which channel to send (per CLAUDE.md
  // editor spec); the backend's default segmentation source isn't
  // always what the user is looking at on screen. For single-channel
  // / non-video cases we commit immediately.
  const handleResegmentCurrentFrame = useCallback(() => {
    if (!imageId || isResegmenting) return;
    const channels = video.container?.channels ?? [];
    if (channels.length > 1) {
      setShowResegmentChannelDialog(true);
      return;
    }
    void runResegment();
  }, [imageId, isResegmenting, video.container, runResegment]);

  // Convert new EditMode to legacy booleans for compatibility
  const legacyModes = useMemo(
    () => ({
      editMode: editor.editMode === EditMode.EditVertices,
      slicingMode: editor.editMode === EditMode.Slice,
      pointAddingMode: editor.editMode === EditMode.AddPoints,
      deleteMode: editor.editMode === EditMode.DeletePolygon,
    }),
    [editor.editMode]
  );

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

  // Stage 1: filter hidden / degenerate polygons.
  const renderablePolygons = useMemo(
    () =>
      editor.polygons.filter(polygon => {
        if (hiddenPolygonIds.has(polygonKey(polygon)) || !polygon.points)
          return false;
        const minPoints = polygon.geometry === 'polyline' ? 2 : 3;
        return polygon.points.length >= minPoints;
      }),
    [editor.polygons, hiddenPolygonIds]
  );

  // Stage 2: frustum-cull off-viewport polygons via the visibility manager.
  // The manager's internal threshold guards small counts (< 10 polygons
  // → no culling), so MT/single-polyline cases pay zero overhead. Sperm
  // projects with 50+ polylines at high zoom typically halve the SVG
  // node count under this filter. We pass through `selectedPolygonId`
  // so the manager never culls the focused polygon even if it scrolls
  // off-screen briefly during a drag.
  const visiblePolygons = useMemo(() => {
    if (renderablePolygons.length < 10) return renderablePolygons;
    const containerWidth = imageDimensions?.width || canvasWidth;
    const containerHeight = imageDimensions?.height || canvasHeight;
    return polygonVisibilityManager.getVisiblePolygons(renderablePolygons, {
      zoom: editor.transform.zoom,
      offset: {
        x: editor.transform.translateX,
        y: editor.transform.translateY,
      },
      containerWidth,
      containerHeight,
      selectedPolygonId: editor.selectedPolygonId,
      forceRenderSelected: true,
    }).visiblePolygons;
  }, [
    renderablePolygons,
    editor.transform.zoom,
    editor.transform.translateX,
    editor.transform.translateY,
    editor.selectedPolygonId,
    imageDimensions,
    canvasWidth,
    canvasHeight,
  ]);

  // Panels still consume polygon.id, so project the stable-key set
  // down per frame.
  const frameHiddenIds = useMemo(
    () =>
      new Set(
        editor.polygons
          .filter(p => hiddenPolygonIds.has(polygonKey(p)))
          .map(p => p.id)
      ),
    [editor.polygons, hiddenPolygonIds]
  );

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
      {/* ImageDisplayProvider lives at the editor level so the header
          (frame # / scrubber), the sidebar (Channels + Display
          sections, future PR), and the canvas (brightness/contrast
          CSS filter) can all read/write the same display state. */}
      <ImageDisplayProvider userId={user?.id}>
        {/* Headless sliding-window prefetcher: warms the FrameImageCache
            for the per-channel PNGs around `video.frameIndex` and seeds
            the React Query cache with polygon JSON for the same window.
            Lives inside the provider so it can consume `visibleChannels`
            + `channel` from useImageDisplay. Disabled outside video
            mode — standalone images don't have an upcoming-frame
            concept. */}
        {isVideoMode && video.container && (
          <FrameWindowPrefetcher
            frames={video.container.frames}
            currentIndex={video.frameIndex}
            enabled={isVideoMode}
          />
        )}
        <EditorLayout>
          {/* Header */}
          <EditorHeader
            projectId={projectId || ''}
            projectTitle={project?.name || t('projects.noProjects')}
            imageName={
              selectedImage.name ? selectedImage.name.normalize('NFC') : ''
            }
            currentImageIndex={currentImageIndex !== -1 ? currentImageIndex : 0}
            totalImages={navContext.total}
            onNavigate={navigateToImage}
            hasUnsavedChanges={editor.hasUnsavedChanges}
            onSave={editor.handleSave}
            imageId={imageId}
            segmentationStatus={selectedImage?.segmentationStatus}
            lastUpdate={lastUpdate}
            queueStats={queueStats}
            isWebSocketConnected={isWebSocketConnected}
            videoFrameCount={
              isVideoMode ? video.container?.frameCount : undefined
            }
            videoFrameIndex={isVideoMode ? video.frameIndex : undefined}
            onVideoFrameChange={isVideoMode ? video.setFrameIndex : undefined}
            videoIsPlaying={isVideoMode ? video.isPlaying : undefined}
            onVideoToggle={isVideoMode ? video.toggle : undefined}
          />

          {videoContainerId && (
            <VideoModeOverlay
              videoContainerId={videoContainerId}
              projectType={projectType}
            />
          )}

          {/* Main Content Area */}
          <div className="flex flex-1 overflow-hidden">
            {/* Left: Vertical Toolbar */}
            <VerticalToolbar
              editMode={editor.editMode}
              selectedPolygonId={editor.selectedPolygonId}
              setEditMode={editor.setEditMode}
              disabled={projectLoading}
              onZoomIn={editor.handleZoomIn}
              onZoomOut={editor.handleZoomOut}
              onResetView={editor.handleResetView}
              hasExistingPolygons={editor.getPolygons().length > 0}
            />

            {/* Center: Canvas and Top Toolbar */}
            <div className="flex-1 flex flex-col">
              {/* Top Toolbar — Resegment lives here (next to Undo/Redo)
                  per PR #195. The button is disabled with a spinner
                  while the batch runs; once the batch returns,
                  `handleResegmentCurrentFrame` calls `reloadSegmentation`
                  so the new polyline drops into the canvas without a
                  full reload. */}
              <TopToolbar
                canUndo={editor.canUndo}
                canRedo={editor.canRedo}
                hasUnsavedChanges={editor.hasUnsavedChanges}
                handleUndo={editor.handleUndo}
                handleRedo={editor.handleRedo}
                handleSave={editor.handleSave}
                onResegment={handleResegmentCurrentFrame}
                isResegmenting={isResegmenting}
                disabled={projectLoading}
                isSaving={editor.isSaving}
              />

              {/* Canvas Area */}
              <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                <div className="flex-1 lg:flex-1 p-2 min-h-0 h-[calc(100vh-300px)] lg:h-auto overflow-hidden">
                  <CanvasContainer
                    ref={editor.canvasRef}
                    editMode={editor.editMode}
                    onMouseDown={editor.handleMouseDown}
                    onMouseMove={editor.handleMouseMove}
                    onMouseUp={editor.handleMouseUp}
                    onDoubleClick={editor.handleCreatePolylineDoubleClick}
                    loading={projectLoading}
                    // Legacy compatibility props
                    slicingMode={legacyModes.slicingMode}
                    pointAddingMode={legacyModes.pointAddingMode}
                    deleteMode={legacyModes.deleteMode}
                  >
                    <CanvasContent transform={editor.transform}>
                      {/* Base Image — video mode binds src to the play
                          head (useVideoFrames.currentFrame.id) and the
                          active channel (useImageDisplay.channel), so
                          scrubbing / Play / channel-switch actually
                          swap the canvas image. The sliding-window
                          prefetch (FrameWindowPrefetcher above) keeps
                          the cache warm symmetrically around the
                          current index for both scrub and playback.
                          Standalone images keep the static URL. */}
                      {selectedImage && (
                        <VideoFrameImage
                          isVideoMode={isVideoMode}
                          currentFrameId={video.currentFrame?.id ?? null}
                          fallbackSrc={ensureBrowserCompatibleUrl(
                            selectedImage.id,
                            selectedImage.url,
                            selectedImage.name
                          )}
                          width={imageDimensions?.width || canvasWidth}
                          height={imageDimensions?.height || canvasHeight}
                          alt={t('common.image')}
                          onLoad={handleImageLoad}
                        />
                      )}

                      {/* SVG Overlay for polygon rendering - uses same dimensions as image */}
                      <svg
                        width={imageDimensions?.width || canvasWidth}
                        height={imageDimensions?.height || canvasHeight}
                        viewBox={`0 0 ${imageDimensions?.width || canvasWidth} ${imageDimensions?.height || canvasHeight}`}
                        className="absolute top-0 left-0"
                        style={{
                          width: imageDimensions?.width || canvasWidth,
                          height: imageDimensions?.height || canvasHeight,
                          maxWidth: 'none',
                          pointerEvents: 'auto',
                          zIndex: 10,
                        }}
                        onClick={e => {
                          // Unselect polygon when clicking on empty canvas area
                          // BUT skip deselection when in modes that require point placement (centralized SSOT config)
                          if (
                            e.target === e.currentTarget &&
                            !shouldPreventCanvasDeselection(editor.editMode)
                          ) {
                            handleSelectPolygon(null);
                          }
                        }}
                        data-transform={JSON.stringify(editor.transform)}
                        data-image-dims={JSON.stringify(imageDimensions)}
                        data-polygon-count={editor.polygons.length}
                      >
                        {/* SVG Filters for glow effects */}
                        <CanvasSvgFilters />

                        {/* Render all polygons */}
                        {visiblePolygons.map(polygon => (
                          <CanvasPolygon
                            key={generateSafePolygonKey(
                              polygon,
                              editor.isUndoRedoInProgress
                            )}
                            polygon={polygon}
                            isSelected={polygon.id === editor.selectedPolygonId}
                            hoveredVertex={
                              editor.hoveredVertex || EMPTY_HOVERED_VERTEX
                            }
                            vertexDragState={editor.vertexDragState}
                            zoom={editor.transform.zoom}
                            isUndoRedoInProgress={editor.isUndoRedoInProgress}
                            isHovered={polygon.id === hoveredPolygonId}
                            editMode={editor.editMode}
                            onSelectPolygon={editor.handlePolygonClick}
                            onDeletePolygon={handleDeletePolygonFromContextMenu}
                            onSlicePolygon={handleSlicePolygonFromContextMenu}
                            onEditPolygon={handleEditPolygonFromContextMenu}
                            // Sperm-specific context-menu actions
                            // (head/midpiece/tail re-classify + "Assign to
                            // instance N") are only meaningful in a sperm
                            // project. Without this gate, MT users see the
                            // same sperm menu and accidentally re-label or
                            // merge MTs under a sperm-style instanceId.
                            onChangePartClass={
                              polylineKind === 'sperm'
                                ? handleChangePartClass
                                : undefined
                            }
                            onChangeInstanceId={
                              polylineKind === 'sperm'
                                ? handleChangeInstanceId
                                : undefined
                            }
                            availableInstanceIds={
                              polylineKind === 'sperm'
                                ? availableInstanceIds
                                : undefined
                            }
                            onDeleteVertex={handleDeleteVertexFromContextMenu}
                            onHover={setHoveredPolygonId}
                            // Drives sperm-vs-microtubule context-menu
                            // gating inside PolygonContextMenu — sperm
                            // items appear only on sperm projects, the
                            // kymograph item only on microtubule projects.
                            projectType={projectType}
                          />
                        ))}

                        {/* Vertices are now rendered inside CanvasPolygon component */}

                        {/* Temporary geometry (preview lines, temp points, etc.) */}
                        <CanvasTemporaryGeometryLayer
                          transform={editor.transform}
                          editMode={editor.editMode}
                          tempPoints={editor.tempPoints}
                          cursorPosition={editor.cursorPosition}
                          interactionState={editor.interactionState}
                          selectedPolygonId={editor.selectedPolygonId}
                          polygons={editor.polygons}
                        />
                      </svg>

                      {/* Skeleton-first loading overlay: hides the canvas
                          while the new frame's image hasn't decoded yet.
                          Sits *inside* CanvasContent so the pan/zoom
                          transform aligns the overlay with the image
                          area, not the surrounding viewport chrome. */}
                      <FrameLoadingGate
                        imageId={imageId ?? null}
                        loadedFrameKey={loadedFrameKey}
                        isVideoMode={isVideoMode}
                        width={imageDimensions?.width || canvasWidth}
                        height={imageDimensions?.height || canvasHeight}
                        label={t('segmentationEditor.loadingFrame')}
                      />
                    </CanvasContent>

                    {/* Mode Instructions Overlay */}
                    <ModeInstructions
                      editMode={editor.editMode}
                      interactionState={editor.interactionState}
                      selectedPolygonId={editor.selectedPolygonId}
                      tempPoints={editor.tempPoints}
                      isShiftPressed={editor.keyboardState.isShiftPressed()}
                    />
                  </CanvasContainer>
                </div>

                {/* Right: Channels + Display (video only) + Polygon List + Sperm Instance Panel */}
                <div className="flex flex-col w-full lg:w-72 h-64 lg:h-full overflow-y-auto">
                  {isVideoMode && video.container && (
                    <>
                      <ChannelsSection
                        channels={video.container.channels}
                        containerId={videoContainerId}
                      />
                      <DisplaySection />
                    </>
                  )}
                  <PolygonListPanel
                    loading={projectLoading}
                    polygons={editor.polygons}
                    selectedPolygonId={editor.selectedPolygonId}
                    onSelectPolygon={handleSelectPolygon}
                    hiddenPolygonIds={frameHiddenIds}
                    onTogglePolygonVisibility={handleTogglePolygonVisibility}
                    onRenamePolygon={handleRenamePolygon}
                    onDeletePolygon={handleDeletePolygonFromPanel}
                  />
                  {hasPolylines && polylineKind === 'sperm' && (
                    <SpermInstancePanel
                      polygons={editor.polygons}
                      selectedPolygonId={editor.selectedPolygonId}
                      onSelectPolygon={handleSelectPolygon}
                      activePartClass={activePartClass}
                      onPartClassChange={setActivePartClass}
                      activeInstanceId={activeInstanceId}
                      onInstanceIdChange={setActiveInstanceId}
                    />
                  )}
                  {hasPolylines && polylineKind === 'microtubule' && (
                    <MicrotubuleInstancePanel
                      polygons={editor.polygons}
                      selectedPolygonId={editor.selectedPolygonId}
                      onSelectPolygon={handleSelectPolygon}
                      hiddenPolygonIds={frameHiddenIds}
                      onToggleVisibility={handleTogglePolygonVisibility}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom: Status Bar with Keyboard Shortcuts inline */}
          <div className="relative flex items-stretch bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
            {/* Keyboard Shortcuts Button — sits in the footer's flex flow
                so it can't visually overlap the polygon counters next to
                it (the previous absolute-positioning hid the leftmost
                "polygons" label behind the button). */}
            <div className="flex items-center pl-2 pr-1 flex-shrink-0">
              <KeyboardShortcutsHelp />
            </div>

            {/* Loading indicator overlay — spans the full footer */}
            {isReloading && (
              <div className="absolute inset-0 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm z-20 flex items-center justify-center">
                <div className="flex items-center gap-2 bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow-lg dark:bg-gray-900">
                  <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {t('segmentationEditor.reloadingSegmentation')}
                  </span>
                </div>
              </div>
            )}

            {/* Status Bar — fills the remaining footer width */}
            <StatusBar
              polygons={editor.polygons}
              editMode={editor.editMode}
              selectedPolygonId={editor.selectedPolygonId}
              visiblePolygonsCount={visiblePolygonsCount}
              hiddenPolygonsCount={hiddenPolygonsCount}
            />
          </div>
        </EditorLayout>
        {/* Opt-in dev overlay: append ?perf=1 to the URL or set
            localStorage.segPerfOverlay='1'. Renders null in production
            by default — no bundle cost beyond the module itself. */}
        <FpsMeter />

        {/* Channel picker for resegment on multi-channel video frames.
            Opens when the user clicks Resegment on a video whose
            container exposes more than one channel. The picker forwards
            the chosen channel to `runResegment` which threads it through
            apiClient → /segmentation/batch → segmentationService. */}
        <SegmentChannelDialog
          open={showResegmentChannelDialog}
          channels={video.container?.channels?.map(c => c.name) ?? []}
          defaultChannel={
            // Prefer the channel currently picked as the segmentation
            // source (so the user's first click typically just confirms);
            // fall back to the first channel in the container.
            video.container?.channels?.find(c => c.isSegmentationSource)
              ?.name ??
            video.container?.channels?.[0]?.name ??
            ''
          }
          onConfirm={channel => {
            setShowResegmentChannelDialog(false);
            void runResegment(channel);
          }}
          onCancel={() => setShowResegmentChannelDialog(false)}
        />
      </ImageDisplayProvider>
    </SegmentationErrorBoundary>
  );
};

export default SegmentationEditor;
