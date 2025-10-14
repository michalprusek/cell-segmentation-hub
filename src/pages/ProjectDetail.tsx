import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth, useLanguage, useModel } from '@/contexts/exports';
import ProjectHeader from '@/components/project/ProjectHeader';
import ProjectToolbar from '@/components/project/ProjectToolbar';
import EmptyState from '@/components/project/EmptyState';
import ProjectImages from '@/components/project/ProjectImages';
import ProjectUploaderSection from '@/components/project/ProjectUploaderSection';
import { QueueStatsPanel } from '@/components/project/QueueStatsPanel';
import { ExportProgressPanel } from '@/components/project/ExportProgressPanel';
import { useSharedAdvancedExport } from '@/pages/export/hooks/useSharedAdvancedExport';
import { useProjectData } from '@/hooks/useProjectData';
import { useImageFilter } from '@/hooks/useImageFilter';
import { useProjectImageActions } from '@/hooks/useProjectImageActions';
import { useSegmentationQueue } from '@/hooks/useSegmentationQueue';
// Removed useThumbnailUpdates - unified thumbnail system doesn't need it
import { logger } from '@/lib/logger';
import { useStatusReconciliation } from '@/hooks/useStatusReconciliation';
import { usePagination } from '@/hooks/usePagination';
import { motion } from 'framer-motion';
import apiClient from '@/lib/api';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  // AlertDialogTrigger,"
} from '@/components/ui/alert-dialog';
// import { Checkbox } from '@/components/ui/checkbox';

const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { selectedModel, confidenceThreshold, detectHoles } = useModel();
  const [showUploader, setShowUploader] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [batchSubmitted, setBatchSubmitted] = useState<boolean>(false);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(
    new Set()
  );
  const [showDeleteDialog, setShowDeleteDialog] = useState<boolean>(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState<boolean>(false);
  // Navigation state variables removed - automatic navigation to segmentation editor disabled

  // Debouncing and deduplication for segmentation refresh
  const debounceTimeoutRef = useRef<{ [imageId: string]: NodeJS.Timeout }>({});
  const lastStatusRef = useRef<{ [imageId: string]: string }>({});

  // Fetch project data - simplified without visible range for now
  const {
    projectTitle,
    images,
    loading,
    updateImages,
    refreshImageSegmentation,
  } = useProjectData(id, user?.id, {
    fetchAll: false,
  });

  // Handle cancellation events from WebSocket - define early for useSegmentationQueue
  const handleSegmentationCancelled = useCallback(
    (data: { imageId?: string; batchId?: string; message?: string }) => {
      if (!data.imageId) return;

      logger.debug('Segmentation cancelled for image', 'ProjectDetail', {
        imageId: data.imageId,
        batchId: data.batchId,
      });

      // Update image state to no_segmentation
      updateImages(prevImages =>
        prevImages.map(img => {
          if (img.id === data.imageId) {
            return {
              ...img,
              segmentationStatus: 'no_segmentation',
              segmentationResult: undefined,
              segmentationData: undefined,
              segmentationThumbnailPath: undefined,
              segmentationThumbnailUrl: undefined,
              thumbnail_url: img.url, // Reset to original image URL
              updatedAt: new Date(),
            };
          }
          return img;
        })
      );
    },
    [updateImages]
  );

  const handleBulkSegmentationCancelled = useCallback(
    async (data: {
      cancelledCount?: number;
      affectedProjects?: string[];
      affectedBatches?: string[];
      message?: string;
    }) => {
      logger.info('Bulk segmentation cancelled', 'ProjectDetail', {
        count: data.cancelledCount,
        projects: data.affectedProjects,
      });

      // Check if current project is affected
      if (data.affectedProjects?.includes(id)) {
        // Refetch all images to get latest status
        if (id && user?.id) {
          try {
            // Fetch all images with pagination
            let allImages: any[] = [];
            let page = 1;
            let hasMore = true;
            const limit = 50;

            while (hasMore) {
              const imagesResponse = await apiClient.getProjectImages(id, {
                limit,
                page,
              });

              if (
                !imagesResponse.images ||
                !Array.isArray(imagesResponse.images)
              ) {
                break;
              }

              allImages = [...allImages, ...imagesResponse.images];
              hasMore = page * limit < imagesResponse.total;
              page++;

              if (page > 40) break; // Safety limit
            }

            const formattedImages = (allImages || []).map(img => {
              let segmentationStatus =
                img.segmentationStatus || img.segmentation_status;
              if (segmentationStatus === 'segmented') {
                segmentationStatus = 'completed';
              }

              // Find existing image to preserve thumbnails for images not affected by cancellation
              const existingImage = images.find(
                existing => existing.id === img.id
              );

              // Only clear thumbnails if the image was actually cancelled (status is no_segmentation)
              const wasCancelled = segmentationStatus === 'no_segmentation';

              return {
                id: img.id,
                name: img.name || `Image ${img.id}`, // Provide fallback for missing name
                url: img.url || img.image_url,
                thumbnail_url: img.thumbnail_url,
                createdAt: new Date(img.created_at || img.createdAt),
                updatedAt: new Date(img.updated_at || img.updatedAt),
                segmentationStatus: segmentationStatus,
                segmentationResult: wasCancelled
                  ? undefined
                  : existingImage?.segmentationResult,
                // Only clear thumbnails for cancelled images, preserve for others
                segmentationThumbnailPath: wasCancelled
                  ? undefined
                  : img.segmentationThumbnailPath ||
                    existingImage?.segmentationThumbnailPath,
                segmentationThumbnailUrl: wasCancelled
                  ? undefined
                  : img.segmentationThumbnailUrl ||
                    existingImage?.segmentationThumbnailUrl,
              };
            });

            updateImages(formattedImages);
          } catch (error) {
            logger.error('Failed to fetch images after cancellation', error);
          }
        }

        // Reset batch submitted state
        setBatchSubmitted(false);
        // Navigation state cleanup removed
      }
    },
    [id, user?.id, updateImages, images]
  );

  // Optimized refresh function for real-time updates
  const _debouncedRefreshSegmentation = useCallback(
    (imageId: string, currentStatus: string) => {
      // Clear existing timeout for this image
      if (debounceTimeoutRef.current[imageId]) {
        clearTimeout(debounceTimeoutRef.current[imageId]);
      }

      // Check if status actually changed
      const lastStatus = lastStatusRef.current[imageId];
      if (lastStatus === currentStatus) {
        return;
      }

      // Update last status
      lastStatusRef.current[imageId] = currentStatus;

      // For completed segmentation, refresh immediately for real-time updates
      // For other statuses, use minimal debounce
      const delay =
        currentStatus === 'completed' || currentStatus === 'segmented'
          ? 100
          : 300;

      debounceTimeoutRef.current[imageId] = setTimeout(() => {
        refreshImageSegmentationRef.current(imageId);
        delete debounceTimeoutRef.current[imageId];
      }, delay);
    },
    []
  );

  // Handle batch completion to refresh gallery
  const handleBatchCompleted = useCallback(async () => {
    if (!id || !user?.id) return;

    logger.info(
      '🔄 Batch segmentation completed, refreshing image gallery...',
      {
        projectId: id,
      }
    );

    try {
      // Fetch updated images to refresh statuses and thumbnails
      let allImages: any[] = [];
      let page = 1;
      let hasMore = true;
      const limit = 50;

      while (hasMore) {
        const imagesResponse = await apiClient.getProjectImages(id, {
          limit,
          page,
        });

        if (!imagesResponse.images || !Array.isArray(imagesResponse.images)) {
          break;
        }

        allImages = [...allImages, ...imagesResponse.images];
        hasMore = page * limit < imagesResponse.total;
        page++;

        if (page > 40) break; // Safety limit
      }

      const formattedImages = (allImages || []).map(img => {
        let segmentationStatus =
          img.segmentationStatus || img.segmentation_status;
        if (segmentationStatus === 'segmented') {
          segmentationStatus = 'completed';
        }

        // Find existing image to preserve segmentation thumbnails if not provided
        const existingImage = images.find(existing => existing.id === img.id);

        return {
          id: img.id,
          name: img.name || `Image ${img.id}`, // Provide fallback for missing name
          url: img.url || img.image_url,
          thumbnail_url: img.thumbnail_url,
          createdAt: new Date(img.created_at || img.createdAt),
          updatedAt: new Date(img.updated_at || img.updatedAt),
          segmentationStatus: segmentationStatus,
          segmentationResult:
            img.segmentationResult || existingImage?.segmentationResult,
          // CRITICAL: Preserve existing thumbnails if not provided by API
          segmentationThumbnailPath:
            img.segmentationThumbnailPath ||
            existingImage?.segmentationThumbnailPath,
          segmentationThumbnailUrl:
            img.segmentationThumbnailUrl ||
            existingImage?.segmentationThumbnailUrl,
        };
      });

      updateImages(formattedImages);

      logger.info('✅ Gallery refreshed successfully after batch completion', {
        imageCount: formattedImages.length,
        completedCount: formattedImages.filter(
          img => img.segmentationStatus === 'completed'
        ).length,
      });
    } catch (error) {
      logger.error(
        '❌ Failed to refresh gallery after batch completion:',
        error
      );
    }
  }, [id, user?.id, updateImages, images]);

  // Queue management - must be declared before using queueStats
  const {
    isConnected,
    queueStats,
    lastUpdate,
    parallelStats,
    requestQueueStats,
  } = useSegmentationQueue(
    id,
    handleSegmentationCancelled,
    handleBulkSegmentationCancelled,
    handleBatchCompleted
  );

  // Global queue stats for Cancel All button
  const { queueStats: globalQueueStats } = useSegmentationQueue(undefined);

  // Export progress tracking - use ONLY shared hook for SSOT
  const exportHook = useSharedAdvancedExport(id || '', projectTitle);

  // Thumbnail updates removed - unified system uses server-generated thumbnails only

  // Filtering and sorting with memoization
  const {
    filteredImages,
    searchTerm,
    sortField,
    sortDirection,
    handleSearch,
    handleSort,
  } = useImageFilter(images);

  // Pagination
  const {
    currentPage,
    totalPages,
    itemsPerPage: _itemsPerPage,
    startIndex,
    endIndex,
    canGoNext,
    canGoPrevious,
    setCurrentPage,
    goToNextPage,
    goToPreviousPage,
    pageNumbers,
    paginatedIndices,
  } = usePagination({
    totalItems: filteredImages.length,
    itemsPerPage: 30,
    initialPage: 1,
  });

  // Get paginated images
  const paginatedImages = useMemo(
    () => filteredImages.slice(paginatedIndices.start, paginatedIndices.end),
    [filteredImages, paginatedIndices]
  );

  // Lazy-load segmentation data for visible images only
  useEffect(() => {
    const loadVisibleSegmentationData = async () => {
      if (!paginatedImages.length) return;

      const imagesToEnrich = paginatedImages.filter(img => {
        const status = img.segmentationStatus;
        return (
          (status === 'completed' || status === 'segmented') &&
          !img.segmentationResult // Only fetch if not already loaded
        );
      });

      if (imagesToEnrich.length === 0) return;

      try {
        // Fetch segmentation data for visible images only
        const segmentationPromises = imagesToEnrich.map(async img => {
          try {
            const segmentationData = await apiClient.getSegmentationResults(
              img.id
            );
            return {
              imageId: img.id,
              segmentationData: segmentationData
                ? {
                    polygons: segmentationData.polygons || [],
                    imageWidth:
                      segmentationData.imageWidth || img.width || null,
                    imageHeight:
                      segmentationData.imageHeight || img.height || null,
                    modelUsed: segmentationData.modelUsed,
                    confidence: segmentationData.confidence,
                    processingTime: segmentationData.processingTime,
                    levelOfDetail: 'medium',
                    polygonCount: segmentationData.polygons?.length || 0,
                    pointCount:
                      segmentationData.polygons?.reduce(
                        (sum, p) => sum + p.points.length,
                        0
                      ) || 0,
                    compressionRatio: 1.0,
                  }
                : null,
            };
          } catch (error) {
            if (
              error &&
              typeof error === 'object' &&
              'response' in error &&
              (error as { response?: { status?: number } }).response?.status ===
                404
            ) {
              // 404 is normal for images without segmentation
              return null;
            }
            logger.error(
              `Failed to fetch segmentation for image ${img.id}:`,
              error
            );
            return null;
          }
        });

        const results = await Promise.all(segmentationPromises);

        // Update only the images that have new segmentation data
        updateImages(prevImages =>
          prevImages.map(img => {
            const result = results.find(r => r?.imageId === img.id);
            if (result?.segmentationData) {
              return {
                ...img,
                segmentationResult: result.segmentationData,
              };
            }
            return img;
          })
        );
      } catch (error) {
        logger.error('Error loading visible segmentation data:', error);
      }
    };

    // Debounce the loading to avoid excessive API calls during rapid pagination
    const timeoutId = setTimeout(loadVisibleSegmentationData, 300);
    return () => clearTimeout(timeoutId);
  }, [paginatedImages, updateImages]);

  // Memoized calculations for heavy operations
  const imagesToSegmentCount = useMemo(
    () =>
      images.filter(img =>
        ['pending', 'failed', 'no_segmentation'].includes(
          img.segmentationStatus
        )
      ).length,
    [images]
  );

  // Check if there are any images currently processing
  const hasProcessingImages = useMemo(
    () => images.some(img => img.segmentationStatus === 'processing'),
    [images]
  );

  // Check if queue has any items (processing or queued)
  const hasActiveQueue = useMemo(
    () => queueStats && (queueStats.processing > 0 || queueStats.queued > 0),
    [queueStats]
  );

  // Auto-reset batchSubmitted if WebSocket disconnects for too long
  useEffect(() => {
    if (!isConnected && batchSubmitted) {
      const disconnectionTimeout = setTimeout(() => {
        logger.warn(
          'WebSocket disconnected for 60s with batchSubmitted=true - auto-resetting',
          'ProjectDetail',
          {
            projectId: id,
            disconnectedForMs: 60000,
          }
        );
        setBatchSubmitted(false);
        // Navigation state cleanup removed
      }, 60000); // 60 second timeout for disconnection

      return () => clearTimeout(disconnectionTimeout);
    }
  }, [isConnected, batchSubmitted, id]);

  // Image operations
  const { handleDeleteImage, handleOpenSegmentationEditor } =
    useProjectImageActions({
      projectId: id,
      onImagesChange: updateImages,
      images,
    });

  // Status reconciliation for keeping UI in sync with backend
  const { reconcileImageStatuses, hasStaleProcessingImages } =
    useStatusReconciliation({
      projectId: id,
      images,
      onImagesUpdate: updateImages,
      queueStats,
      isConnected,
    });

  // Store reconciliation function in ref to avoid dependency issues
  const reconcileRef = useRef(reconcileImageStatuses);
  reconcileRef.current = reconcileImageStatuses;

  // Separate ref for queue processing timeout to avoid overwriting the function ref
  const queueProcessingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Safety timeout ref to allow cancellation when batch completes
  const safetyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Store updateImages function in ref to avoid dependency issues
  const updateImagesRef = useRef(updateImages);
  updateImagesRef.current = updateImages;

  // Store refreshImageSegmentation function in ref to avoid dependency issues
  const refreshImageSegmentationRef = useRef(refreshImageSegmentation);
  refreshImageSegmentationRef.current = refreshImageSegmentation;

  // Store fetchImages function to call after cancellation
  const fetchImages = useCallback(async () => {
    if (!id || !user?.id) return;

    try {
      // Fetch all images with pagination
      let allImages: any[] = [];
      let page = 1;
      let hasMore = true;
      const limit = 50;

      while (hasMore) {
        const imagesResponse = await apiClient.getProjectImages(id, {
          limit,
          page,
        });

        if (!imagesResponse.images || !Array.isArray(imagesResponse.images)) {
          break;
        }

        allImages = [...allImages, ...imagesResponse.images];
        hasMore = page * limit < imagesResponse.total;
        page++;

        if (page > 40) break; // Safety limit
      }

      const formattedImages = (allImages || []).map(img => {
        let segmentationStatus =
          img.segmentationStatus || img.segmentation_status;
        if (segmentationStatus === 'segmented') {
          segmentationStatus = 'completed';
        }

        // Find existing image to preserve segmentation thumbnails
        const existingImage = images.find(existing => existing.id === img.id);

        return {
          id: img.id,
          name: img.name || `Image ${img.id}`, // Provide fallback for missing name
          url: img.url || img.image_url,
          thumbnail_url: img.thumbnail_url,
          createdAt: new Date(img.created_at || img.createdAt),
          updatedAt: new Date(img.updated_at || img.updatedAt),
          segmentationStatus: segmentationStatus,
          segmentationResult:
            img.segmentationResult || existingImage?.segmentationResult,
          // CRITICAL: Preserve existing segmentation thumbnails if not provided by API
          segmentationThumbnailPath:
            img.segmentationThumbnailPath ||
            existingImage?.segmentationThumbnailPath,
          segmentationThumbnailUrl:
            img.segmentationThumbnailUrl ||
            existingImage?.segmentationThumbnailUrl,
        };
      });

      updateImages(formattedImages);
    } catch (error) {
      logger.error('Failed to fetch images after cancellation', error);
    }
  }, [id, user?.id, updateImages, images]);

  // Batch WebSocket updates to prevent excessive re-renders during bulk operations
  const pendingUpdatesRef = useRef<Map<string, any>>(new Map());
  const batchUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Batch refresh operations to prevent API flooding during bulk operations
  const pendingRefreshRef = useRef<Set<string> | null>(null);
  const refreshBatchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const processBatchUpdates = useCallback(() => {
    const pendingUpdates = pendingUpdatesRef.current;
    if (pendingUpdates.size === 0) return;

    logger.debug(`Processing ${pendingUpdates.size} batched image updates`);

    // Apply all pending updates at once
    updateImagesRef.current(prevImages =>
      prevImages.map(img => {
        const update = pendingUpdates.get(img.id);
        if (update) {
          logger.debug('Applying batched update:', {
            imageId: img.id,
            fromStatus: img.segmentationStatus,
            toStatus: update.normalizedStatus,
          });

          return {
            ...img,
            segmentationStatus: update.normalizedStatus,
            updatedAt: new Date(),
            segmentationResult: update.clearSegmentationData
              ? undefined
              : img.segmentationResult,
            segmentationData: update.clearSegmentationData
              ? undefined
              : img.segmentationData,
            thumbnail_url: update.clearSegmentationData
              ? img.url
              : img.thumbnail_url,
            // Preserve segmentation thumbnails
            segmentationThumbnailPath: update.clearSegmentationData
              ? undefined
              : img.segmentationThumbnailPath,
            segmentationThumbnailUrl: update.clearSegmentationData
              ? undefined
              : img.segmentationThumbnailUrl,
          };
        }
        return img;
      })
    );

    // Clear pending updates
    pendingUpdates.clear();
  }, []);

  // Debounced WebSocket update handler to prevent excessive re-renders
  const debouncedUpdateTimeoutRef = useRef<NodeJS.Timeout>();
  const processWebSocketUpdate = useCallback(
    (update: typeof lastUpdate) => {
      if (!update || update.projectId !== id) {
        return;
      }

      // Skip duplicate updates for the same image with the same status
      // BUT allow updates if enough time has passed (5 seconds) to handle re-segmentation
      const now = Date.now();
      const lastUpdateTime = lastStatusRef.current?.[`${update.imageId}_time`];
      const timeSinceLastUpdate = lastUpdateTime ? now - lastUpdateTime : Infinity;

      if (
        lastStatusRef.current &&
        lastStatusRef.current[update.imageId] === update.status &&
        timeSinceLastUpdate < 5000 // Only skip if within 5 seconds
      ) {
        logger.debug('⏭️ Skipping duplicate status update', 'ProjectDetail', {
          imageId: update.imageId,
          status: update.status,
          timeSinceLastUpdate,
        });
        return;
      }

      // Update last status tracking with timestamp
      if (!lastStatusRef.current) {
        lastStatusRef.current = {};
      }
      lastStatusRef.current[update.imageId] = update.status;
      lastStatusRef.current[`${update.imageId}_time`] = now;

      logger.debug('Processing WebSocket update', 'ProjectDetail', {
        imageId: update.imageId,
        status: update.status,
        projectId: update.projectId,
      });

      // Normalize status to match frontend expectations
      let normalizedStatus = update.status;
      if (update.status === 'segmented' || update.status === 'completed') {
        normalizedStatus = 'completed';
      } else if (update.status === 'no_segmentation') {
        normalizedStatus = 'no_segmentation';
      } else if (update.status === 'failed') {
        normalizedStatus = 'failed';
      } else if (update.status === 'queued') {
        normalizedStatus = 'queued';
      } else if (update.status === 'processing') {
        normalizedStatus = 'processing';
      }

      // Determine if segmentation data should be cleared
      const currentImage = images.find(img => img.id === update.imageId);
      const clearSegmentationData =
        update.status === 'queued' &&
        currentImage &&
        (currentImage.segmentationStatus === 'completed' ||
          currentImage.segmentationStatus === 'segmented');

      // Check if we're in bulk operation mode (more than 10 items in queue)
      // Increased threshold to better detect bulk operations
      const isBulkOperation =
        queueStats && (queueStats.queued > 10 || queueStats.processing > 5);

      if (isBulkOperation) {
        // Batch the update - store in pending map
        pendingUpdatesRef.current.set(update.imageId, {
          normalizedStatus,
          clearSegmentationData,
        });

        // Set up periodic batch processing if not already running
        // Don't reset the timer on every update to ensure all updates get processed
        if (!batchUpdateTimeoutRef.current) {
          // Shorter timeout to ensure updates are visible sooner
          const batchTimeout = queueStats.queued > 100 ? 300 : 200;

          const processBatchAndReschedule = () => {
            processBatchUpdates();

            // If still in bulk mode and have pending updates, schedule another batch
            if (
              pendingUpdatesRef.current.size > 0 ||
              (queueStats &&
                (queueStats.queued > 0 || queueStats.processing > 0))
            ) {
              batchUpdateTimeoutRef.current = setTimeout(
                processBatchAndReschedule,
                batchTimeout
              );
            } else {
              batchUpdateTimeoutRef.current = null;
            }
          };

          batchUpdateTimeoutRef.current = setTimeout(
            processBatchAndReschedule,
            batchTimeout
          );
        }
      } else {
        // Apply update immediately for single operations
        updateImagesRef.current(prevImages =>
          prevImages.map(img => {
            if (img.id === update.imageId) {
              // Only log significant status changes to reduce console spam
              if (img.segmentationStatus !== normalizedStatus) {
                logger.debug('Updating image status', 'ProjectDetail', {
                  imageId: img.id,
                  fromStatus: img.segmentationStatus,
                  toStatus: normalizedStatus,
                });
              }

              return {
                ...img,
                segmentationStatus: normalizedStatus,
                updatedAt: new Date(),
                segmentationResult: clearSegmentationData
                  ? undefined
                  : img.segmentationResult,
                segmentationData: clearSegmentationData
                  ? undefined
                  : img.segmentationData,
                thumbnail_url: clearSegmentationData
                  ? img.url
                  : img.thumbnail_url,
                // Preserve segmentation thumbnails
                segmentationThumbnailPath: clearSegmentationData
                  ? undefined
                  : img.segmentationThumbnailPath,
                segmentationThumbnailUrl: clearSegmentationData
                  ? undefined
                  : img.segmentationThumbnailUrl,
              };
            }
            return img;
          })
        );
      }

      // For completed segmentation, refresh to get polygon data and validate
      // Skip refresh if backend already says no_segmentation
      if (
        (update.status === 'segmented' || update.status === 'completed') &&
        update.status !== 'no_segmentation'
      ) {
        // Batch refresh requests to avoid API flooding
        if (isBulkOperation) {
          // In bulk mode, batch the refresh requests
          if (!pendingRefreshRef.current) {
            pendingRefreshRef.current = new Set();
          }
          pendingRefreshRef.current.add(update.imageId);

          // Clear existing timeout and set new one
          if (refreshBatchTimeoutRef.current) {
            clearTimeout(refreshBatchTimeoutRef.current);
          }

          // Batch refresh after a delay
          refreshBatchTimeoutRef.current = setTimeout(async () => {
            const imageIdsToRefresh = Array.from(
              pendingRefreshRef.current || []
            );
            pendingRefreshRef.current = null;

            logger.debug(
              'Batch refreshing segmentation data (polygon data only, trusts backend status)',
              'ProjectDetail',
              {
                count: imageIdsToRefresh.length,
              }
            );

            // Process in smaller chunks to avoid overwhelming the API
            const chunkSize = 10;
            for (let i = 0; i < imageIdsToRefresh.length; i += chunkSize) {
              const chunk = imageIdsToRefresh.slice(i, i + chunkSize);
              await Promise.all(
                chunk.map(imageId =>
                  refreshImageSegmentationRef.current(imageId).catch(error => {
                    logger.error('Failed to refresh segmentation data', error);
                  })
                )
              );

              // Trigger re-render for successfully loaded images in this chunk
              updateImagesRef.current(prevImages =>
                prevImages.map(img =>
                  chunk.includes(img.id)
                    ? { ...img, lastSegmentationUpdate: Date.now() }
                    : img
                )
              );

              // Small delay between chunks
              if (i + chunkSize < imageIdsToRefresh.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
              }
            }
          }, 2000); // 2 second delay for batching
        } else {
          // Single operation - fetch polygon data for display enrichment
          // IMPORTANT: Do NOT change status based on polygon loading
          // Backend WebSocket status is the Single Source of Truth (SSOT)
          (async () => {
            logger.debug(
              'Fetching polygon data for display enrichment',
              'ProjectDetail',
              {
                imageId: update.imageId,
                backendStatus: update.status,
                normalizedStatus: normalizedStatus,
              }
            );

            try {
              // Fetch polygons to show on image card (async, non-blocking)
              // This is purely for UI enrichment - does NOT affect status
              await refreshImageSegmentationRef.current(update.imageId);

              logger.info(
                '✅ Polygon data loaded successfully',
                'ProjectDetail',
                {
                  imageId: update.imageId,
                  statusKept: normalizedStatus, // Status stays what backend said
                }
              );
            } catch (error) {
              // Log error but DON'T change status - backend status is SSOT
              logger.error(
                '⚠️ Failed to fetch polygons (status unchanged)',
                error,
                'ProjectDetail',
                {
                  imageId: update.imageId,
                  keptStatus: normalizedStatus,
                }
              );
            }
          })();
        }
      }

      // Reset batch submitted state when queue becomes empty and navigate if needed
      if (update.status === 'segmented' || update.status === 'failed') {
        // Trigger status reconciliation after a short delay
        const timeoutId = setTimeout(() => {
          const currentQueueStats = queueStats;
          if (
            currentQueueStats &&
            currentQueueStats.processing <= 1 &&
            currentQueueStats.queued === 0
          ) {
            logger.info(
              'Queue processing complete - resetting batch state',
              'ProjectDetail',
              {
                projectId: id,
                processing: currentQueueStats.processing,
                queued: currentQueueStats.queued,
                batchSubmitted,
              }
            );
            setBatchSubmitted(false);

            // Cancel safety timeout since batch completed normally
            if (safetyTimeoutRef.current) {
              clearTimeout(safetyTimeoutRef.current);
              safetyTimeoutRef.current = null;
              logger.debug(
                'Safety timeout cancelled - batch completed normally',
                'ProjectDetail'
              );
            }

            // Force reconciliation to catch any missed updates
            reconcileRef.current();

            // Automatic navigation to segmentation editor removed per user request
            // Gallery refresh is handled by handleBatchCompleted callback
          }
        }, 2000);

        // Store timeout for cleanup using the dedicated timeout ref
        if (queueProcessingTimeoutRef.current) {
          clearTimeout(queueProcessingTimeoutRef.current);
        }
        queueProcessingTimeoutRef.current = timeoutId;
      }
    },
    [id, queueStats, batchSubmitted, navigate, images]
  );

  // Real-time image status updates - debounced handler
  useEffect(() => {
    // Defensive null checks and type safety
    if (!lastUpdate || !lastUpdate.imageId) {
      return;
    }

    // Only process updates for current project (if projectId is available)
    if (lastUpdate.projectId && lastUpdate.projectId !== id) {
      return;
    }

    // Clear any existing debounce timeout
    if (debouncedUpdateTimeoutRef.current) {
      clearTimeout(debouncedUpdateTimeoutRef.current);
    }

    // Debounce WebSocket updates to prevent excessive re-renders
    debouncedUpdateTimeoutRef.current = setTimeout(() => {
      processWebSocketUpdate(lastUpdate);
    }, 50); // 50ms debounce delay

    return () => {
      if (debouncedUpdateTimeoutRef.current) {
        clearTimeout(debouncedUpdateTimeoutRef.current);
      }
    };
  }, [lastUpdate, id, processWebSocketUpdate]);

  // Cleanup debounce timeouts on unmount
  useEffect(() => {
    return () => {
      // Clear debounce timeouts
      const timeouts = debounceTimeoutRef.current;
      if (timeouts) {
        for (const timeout of Object.values(timeouts)) {
          clearTimeout(timeout);
        }
      }

      // Clear batch update timeout
      if (batchUpdateTimeoutRef.current) {
        clearTimeout(batchUpdateTimeoutRef.current);
      }

      // Clear queue processing timeout
      if (queueProcessingTimeoutRef.current) {
        clearTimeout(queueProcessingTimeoutRef.current);
      }

      // Clear safety timeout
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
      }
    };
  }, []);

  const toggleUploader = () => {
    setShowUploader(!showUploader);
  };

  const handleUploadComplete = async () => {
    // Hide the uploader first
    setShowUploader(false);

    // Refresh the images data
    if (id && user?.id) {
      try {
        // Fetch all images with pagination (same logic as useProjectData)
        let allImages: any[] = [];
        let page = 1;
        let hasMore = true;
        const limit = 50; // Same as useProjectData

        while (hasMore) {
          const imagesResponse = await apiClient.getProjectImages(id, {
            limit,
            page,
          });

          if (!imagesResponse.images || !Array.isArray(imagesResponse.images)) {
            break;
          }

          allImages = [...allImages, ...imagesResponse.images];
          hasMore = page * limit < imagesResponse.total;
          page++;

          // Safety limit (same as useProjectData)
          if (page > 40) {
            break;
          }
        }

        const imagesData = allImages;

        const formattedImages = (imagesData || []).map(img => {
          // Normalize segmentation status from different backend field names
          let segmentationStatus =
            img.segmentationStatus || img.segmentation_status;

          // Normalize status values to consistent format
          if (segmentationStatus === 'segmented') {
            segmentationStatus = 'completed';
          }

          return {
            id: img.id,
            name: img.name || `Image ${img.id}`, // Provide fallback for missing name
            url: img.url || img.image_url,
            thumbnail_url: img.thumbnail_url,
            createdAt: new Date(img.created_at || img.createdAt),
            updatedAt: new Date(img.updated_at || img.updatedAt),
            segmentationStatus: segmentationStatus,
            segmentationResult: undefined,
            // Preserve segmentation thumbnails from backend
            segmentationThumbnailPath: img.segmentationThumbnailPath,
            segmentationThumbnailUrl: img.segmentationThumbnailUrl,
          };
        });

        // Merge new images with existing ones, preserving segmentation results
        updateImages(prevImages => {
          // Create a map of existing images by ID for quick lookup with their segmentation results
          const existingImagesMap = new Map(
            prevImages.map(img => [img.id, img])
          );

          // Process all images from the backend
          const mergedImages = formattedImages.map(newImg => {
            const existingImg = existingImagesMap.get(newImg.id);

            // If this image existed before and had segmentation results, preserve them
            if (existingImg && existingImg.segmentationResult) {
              return {
                ...newImg,
                segmentationResult: existingImg.segmentationResult,
                // Preserve segmentation thumbnail URLs
                segmentationThumbnailUrl:
                  existingImg.segmentationThumbnailUrl ||
                  newImg.segmentationThumbnailUrl,
                segmentationThumbnailPath:
                  existingImg.segmentationThumbnailPath ||
                  newImg.segmentationThumbnailPath,
                // Also preserve the segmentation status if it was completed
                segmentationStatus:
                  existingImg.segmentationStatus === 'completed' ||
                  existingImg.segmentationStatus === 'segmented'
                    ? existingImg.segmentationStatus
                    : newImg.segmentationStatus,
              };
            }

            // For new images or images without segmentation, return as-is
            return newImg;
          });

          // For images with completed status but no segmentation result yet, fetch them
          const needsEnrichment = mergedImages.filter(
            img =>
              (img.segmentationStatus === 'completed' ||
                img.segmentationStatus === 'segmented') &&
              !img.segmentationResult
          );

          if (needsEnrichment.length > 0) {
            // Fetch segmentation results for these images asynchronously
            Promise.all(
              needsEnrichment.map(async img => {
                try {
                  const segmentationData =
                    await apiClient.getSegmentationResults(img.id);
                  if (segmentationData) {
                    // Update the specific image with its segmentation result
                    updateImages(prevImgs =>
                      prevImgs.map(prevImg =>
                        prevImg.id === img.id
                          ? {
                              ...prevImg,
                              segmentationResult: {
                                polygons: segmentationData.polygons || [],
                                imageWidth: segmentationData.imageWidth || null,
                                imageHeight:
                                  segmentationData.imageHeight || null,
                                modelUsed: segmentationData.modelUsed,
                                confidence: segmentationData.confidence,
                                processingTime: segmentationData.processingTime,
                                levelOfDetail: 'medium',
                                polygonCount:
                                  segmentationData.polygons?.length || 0,
                                pointCount:
                                  segmentationData.polygons?.reduce(
                                    (sum, p) => sum + p.points.length,
                                    0
                                  ) || 0,
                                compressionRatio: 1.0,
                              },
                            }
                          : prevImg
                      )
                    );
                  }
                } catch (error) {
                  // Silently fail for individual images - they'll be fetched later if needed
                  logger.debug(
                    `Could not fetch segmentation for image ${img.id}`,
                    error
                  );
                }
              })
            );
          }

          return mergedImages;
        });

        // Emit event to notify Dashboard about image count change
        const firstImage = formattedImages[0];
        const thumbnail =
          firstImage?.thumbnailUrl ||
          firstImage?.thumbnail_url ||
          firstImage?.displayUrl ||
          '/placeholder.svg';

        const event = new CustomEvent('project-images-updated', {
          detail: {
            projectId: id,
            imageCount: formattedImages.length,
            thumbnail: thumbnail,
          },
        });
        window.dispatchEvent(event);
      } catch (error) {
        toast.error(t('toast.upload.failed'));
      }
    }
  };

  // Handle opening an image - now takes the image ID directly
  const handleOpenImage = (imageId: string) => {
    handleOpenSegmentationEditor(imageId);
  };

  // Selection handlers
  const handleImageSelection = useCallback(
    (imageId: string, selected: boolean) => {
      setSelectedImageIds(prev => {
        const newSet = new Set(prev);
        if (selected) {
          newSet.add(imageId);
        } else {
          newSet.delete(imageId);
        }
        return newSet;
      });
    },
    []
  );

  const handleSelectAll = useCallback(() => {
    // Select all filtered images in the project, not just current page
    setSelectedImageIds(new Set(filteredImages.map(img => img.id)));
  }, [filteredImages]);

  const handleDeselectAll = useCallback(() => {
    setSelectedImageIds(new Set());
  }, []);

  const handleSelectAllToggle = useCallback(() => {
    const allSelected =
      filteredImages.length > 0 &&
      filteredImages.every(img => selectedImageIds.has(img.id));
    if (allSelected) {
      handleDeselectAll();
    } else {
      handleSelectAll();
    }
  }, [filteredImages, selectedImageIds, handleSelectAll, handleDeselectAll]);

  const handleBatchDeleteConfirm = async () => {
    if (!id || !user?.id || selectedImageIds.size === 0) {
      toast.error(t('errors.noProjectOrUser'));
      return;
    }

    // Prevent duplicate submissions
    if (isBatchDeleting) {
      return;
    }

    setIsBatchDeleting(true);

    try {
      const imageIds = Array.from(selectedImageIds);

      const result = await apiClient.deleteBatch(imageIds, id);

      if (result.deletedCount > 0) {
        toast.success(
          t('project.imagesDeleted', { count: result.deletedCount })
        );

        // Clear selection
        setSelectedImageIds(new Set());

        // Only remove deleted images from current state instead of refreshing all
        // This preserves thumbnails and other loaded data for remaining images
        const deletedIds = imageIds.filter(
          id => !result.failedIds.includes(id)
        );
        updateImages(prevImages =>
          prevImages.filter(img => !deletedIds.includes(img.id))
        );
      }

      if (result.failedIds.length > 0) {
        toast.warning(
          t('project.imagesDeleteFailed', { count: result.failedIds.length })
        );
      }
    } catch (error) {
      toast.error(t('errors.deleteImages'));
    } finally {
      setShowDeleteDialog(false);
      setIsBatchDeleting(false);
    }
  };

  const handleBatchDelete = () => {
    setShowDeleteDialog(true);
  };

  // Calculate selection state
  const selectedCount = selectedImageIds.size;
  const isAllSelected =
    filteredImages.length > 0 &&
    filteredImages.every(img => selectedImageIds.has(img.id));
  const isPartiallySelected =
    selectedCount > 0 && selectedCount < filteredImages.length;

  // Handle batch segmentation of all images without segmentation + selected images
  const handleCancelSegmentation = async () => {
    if (!id || !user?.id) {
      toast.error(t('errors.noProjectOrUser'));
      return;
    }

    setIsCancelling(true);

    try {
      const result = await apiClient.cancelAllUserSegmentations();

      if (result.success && result.cancelledCount > 0) {
        // Don't show toast - WebSocket events will handle UI updates
        // The handleBulkSegmentationCancelled callback will:
        // - Refetch images to show 'no_segmentation' status
        // - Clear segmentation thumbnails
        // - Reset batch submitted state
        // - Update queue stats

        logger.info('Cancellation request sent successfully', 'ProjectDetail', {
          cancelledCount: result.cancelledCount,
        });
      }
    } catch (error) {
      logger.error('Failed to cancel segmentation', error);
      toast.error(t('queue.cancelFailed'));
    } finally {
      setIsCancelling(false);
    }
  };

  const handleSegmentAll = async () => {
    if (!id || !user?.id) {
      toast.error(t('errors.noProjectOrUser'));
      return;
    }

    // Prevent double submission
    if (batchSubmitted) {
      return;
    }

    try {
      // Get images that don't have segmentation or have failed
      const imagesWithoutSegmentation = images.filter(
        img =>
          img.segmentationStatus === 'pending' ||
          img.segmentationStatus === 'failed' ||
          img.segmentationStatus === 'no_segmentation' ||
          !img.segmentationStatus
      );

      // Get selected images that have segmentation (will be re-segmented)
      const selectedImagesWithSegmentation = images.filter(
        img =>
          selectedImageIds.has(img.id) &&
          (img.segmentationStatus === 'completed' ||
            img.segmentationStatus === 'segmented')
      );

      // Combine both groups
      const allImagesToProcess = [
        ...imagesWithoutSegmentation,
        ...selectedImagesWithSegmentation,
      ];

      if (allImagesToProcess.length === 0) {
        toast.info(t('projects.allImagesAlreadySegmented'));
        // Reset batchSubmitted state since we're not actually processing anything
        setBatchSubmitted(false);
        return;
      }

      // Mark as submitted to prevent double clicks
      setBatchSubmitted(true);

      // Navigation flags removed - user doesn't want automatic navigation to segmentation editor

      // Safety timeout to reset batchSubmitted state if WebSocket updates are missed
      // This prevents the button from getting permanently stuck in "adding to queue" state
      // Store in ref so it can be cancelled when batch completes normally
      safetyTimeoutRef.current = setTimeout(() => {
        logger.warn(
          'Safety timeout triggered - resetting batchSubmitted state',
          'ProjectDetail',
          {
            projectId: id,
            timeoutAfterMs: 60000,
          }
        );
        setBatchSubmitted(false);
        // Navigation state cleanup removed
      }, 60000); // 60 second safety timeout (increased from 30s for large batches)

      // Prepare image IDs for batch processing
      const imageIdsWithoutSegmentation = imagesWithoutSegmentation.map(
        img => img.id
      );
      const imageIdsToResegment = selectedImagesWithSegmentation.map(
        img => img.id
      );

      // Update UI immediately for better UX
      updateImages(prevImages =>
        prevImages.map(img => {
          if (
            imageIdsWithoutSegmentation.includes(img.id) ||
            imageIdsToResegment.includes(img.id)
          ) {
            return {
              ...img,
              segmentationStatus: 'queued',
              // Clear segmentation data for re-segmented images
              segmentationResult: imageIdsToResegment.includes(img.id)
                ? undefined
                : img.segmentationResult,
              segmentationData: imageIdsToResegment.includes(img.id)
                ? undefined
                : img.segmentationData,
            };
          }
          return img;
        })
      );

      let totalQueued = 0;

      // Helper function to process image chunks
      const processImageChunks = async (
        imageIds: string[],
        forceResegment: boolean
      ) => {
        const CHUNK_SIZE = 500; // Process 500 images at a time
        let processedCount = 0;

        for (let i = 0; i < imageIds.length; i += CHUNK_SIZE) {
          const chunk = imageIds.slice(i, i + CHUNK_SIZE);

          // Show progress for large batches - only update every 20%
          if (imageIds.length > CHUNK_SIZE) {
            const progress = Math.round((i / imageIds.length) * 100);
            // Only show toast at 20%, 40%, 60%, 80% to reduce spam
            if (progress % 20 === 0 && progress > 0 && progress < 100) {
              toast.info(
                t('projects.processingBatch', {
                  processed: i,
                  total: imageIds.length,
                  percent: progress,
                }) || `Processing: ${i}/${imageIds.length} (${progress}%)`,
                { id: 'batch-progress', duration: 2000 }
              );
            }
          }

          const response = await apiClient.addBatchToQueue(
            chunk,
            id,
            selectedModel,
            confidenceThreshold,
            0, // priority
            forceResegment,
            detectHoles
          );
          processedCount += response.queuedCount;
        }

        return processedCount;
      };

      // Process images without segmentation (normal segmentation)
      if (imageIdsWithoutSegmentation.length > 0) {
        const queuedCount = await processImageChunks(
          imageIdsWithoutSegmentation,
          false
        );
        totalQueued += queuedCount;
      }

      // Process selected images with segmentation (force re-segment)
      if (imageIdsToResegment.length > 0) {
        const queuedCount = await processImageChunks(imageIdsToResegment, true);
        totalQueued += queuedCount;
      }

      // Dismiss progress toast if it exists
      toast.dismiss('batch-progress');

      // Don't show another toast here - the batch processing hook will show start/end toasts
      // This prevents toast spam

      // Clear selection after successful batch operation
      setSelectedImageIds(new Set());

      // Refresh queue stats
      requestQueueStats();
    } catch (error) {
      toast.error(t('projects.errorAddingToQueue'));
      // Reset submitted state on error so user can try again
      setBatchSubmitted(false);

      // Cancel safety timeout on error
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
        safetyTimeoutRef.current = null;
      }

      // Reset navigation flags on error
      // Navigation state cleanup removed

      // Dismiss progress toast if it exists
      toast.dismiss('batch-progress');

      // Revert UI changes on error
      updateImages(prevImages =>
        prevImages.map(img => {
          // Restore original status for queued images
          const originalImage = images.find(i => i.id === img.id);
          if (originalImage) {
            return {
              ...img,
              segmentationStatus: originalImage.segmentationStatus,
              segmentationResult: originalImage.segmentationResult,
              segmentationData: originalImage.segmentationData,
            };
          }
          return img;
        })
      );
    }
  };

  // Animation variants
  const pageVariants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 0.3 } },
    exit: { opacity: 0, transition: { duration: 0.2 } },
  };

  return (
    <motion.div
      className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800"
      initial="initial"
      animate="animate"
      exit="exit"
      variants={pageVariants}
    >
      <ProjectHeader
        projectTitle={projectTitle}
        imagesCount={filteredImages.length}
        loading={loading}
      />

      <div className="container mx-auto px-4 py-8">
        {showUploader ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <ProjectUploaderSection
              onCancel={toggleUploader}
              onUploadComplete={handleUploadComplete}
            />
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <ProjectToolbar
              searchTerm={searchTerm}
              onSearchChange={handleSearch}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              onToggleUploader={toggleUploader}
              viewMode={viewMode}
              setViewMode={setViewMode}
              projectName={projectTitle}
              images={images}
              selectedCount={selectedCount}
              isAllSelected={isAllSelected}
              isPartiallySelected={isPartiallySelected}
              onSelectAllToggle={handleSelectAllToggle}
              onBatchDelete={handleBatchDelete}
              showSelectAll={true}
              onExportingChange={() => {}} // No longer needed - hook handles state
              onDownloadingChange={() => {}} // No longer needed - hook handles state
            />

            {/* Queue Stats Panel */}
            <QueueStatsPanel
              stats={queueStats}
              isConnected={isConnected}
              onSegmentAll={handleSegmentAll}
              onCancelSegmentation={handleCancelSegmentation}
              batchSubmitted={batchSubmitted || hasActiveQueue}
              isCancelling={isCancelling}
              imagesToSegmentCount={imagesToSegmentCount}
              selectedImageIds={selectedImageIds}
              images={images}
              parallelStats={parallelStats}
              currentUserId={user?.id}
              globalQueueStats={globalQueueStats}
            />

            {/* Export Progress Panel */}
            <ExportProgressPanel
              isExporting={exportHook.isExporting}
              isDownloading={exportHook.isDownloading}
              exportProgress={exportHook.exportProgress}
              exportStatus={exportHook.exportStatus}
              completedJobId={exportHook.completedJobId}
              onCancelExport={exportHook.cancelExport}
              onTriggerDownload={exportHook.triggerDownload}
              onDismissExport={exportHook.dismissExport}
              wsConnected={exportHook.wsConnected}
            />

            {loading ? (
              <motion.div
                className="flex justify-center items-center h-64"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
              >
                <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
              </motion.div>
            ) : filteredImages.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                <EmptyState
                  hasSearchTerm={!!searchTerm}
                  onUpload={toggleUploader}
                />
              </motion.div>
            ) : (
              <>
                <ProjectImages
                  images={paginatedImages}
                  onDelete={handleDeleteImage}
                  onOpen={handleOpenImage}
                  viewMode={viewMode}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                  canGoNext={canGoNext}
                  canGoPrevious={canGoPrevious}
                  goToNextPage={goToNextPage}
                  goToPreviousPage={goToPreviousPage}
                  pageNumbers={pageNumbers}
                  selectedImageIds={selectedImageIds}
                  onSelectionChange={handleImageSelection}
                />
                {/* Show pagination info */}
                {totalPages > 0 && (
                  <div className="mt-4 text-sm text-muted-foreground text-center">
                    {t('export.showingImages', {
                      start: startIndex,
                      end: endIndex,
                      total: filteredImages.length,
                    })}
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('projects.deleteDialog.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('projects.deleteDialog.description', { count: selectedCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBatchDeleteConfirm}
              className="bg-red-600 hover:bg-red-700"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
};

export default ProjectDetail;
