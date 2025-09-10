import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth, useLanguage, useModel } from '@/contexts/exports';
import ProjectHeader from '@/components/project/ProjectHeader';
import ProjectToolbar from '@/components/project/ProjectToolbar';
import EmptyState from '@/components/project/EmptyState';
import ProjectImages from '@/components/project/ProjectImages';
import ProjectUploaderSection from '@/components/project/ProjectUploaderSection';
import { QueueStatsPanel } from '@/components/project/QueueStatsPanel';
import { useProjectData } from '@/hooks/useProjectData';
import { useImageFilter } from '@/hooks/useImageFilter';
import { useProjectImageActions } from '@/hooks/useProjectImageActions';
import { useSegmentationQueue } from '@/hooks/useSegmentationQueue';
import { useThumbnailUpdates } from '@/hooks/useThumbnailUpdates';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';

const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { selectedModel, confidenceThreshold, detectHoles } = useModel();
  const [showUploader, setShowUploader] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [batchSubmitted, setBatchSubmitted] = useState<boolean>(false);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(
    new Set()
  );
  const [showDeleteDialog, setShowDeleteDialog] = useState<boolean>(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState<boolean>(false);

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

  // Optimized refresh function for real-time updates
  const debouncedRefreshSegmentation = useCallback(
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

  // Queue management - must be declared before using queueStats
  const { isConnected, queueStats, lastUpdate, requestQueueStats } =
    useSegmentationQueue(id);

  // Handle thumbnail updates via WebSocket
  useThumbnailUpdates({
    projectId: id,
    enabled: true,
    onThumbnailUpdate: useCallback(
      update => {
        logger.debug('Thumbnail update received', 'ProjectDetail', {
          imageId: update.imageId,
          levelOfDetail: update.thumbnailData.levelOfDetail,
        });

        // Fetch updated image with new thumbnail URL
        (async () => {
          try {
            const img = await apiClient.getImage(id, update.imageId);
            if (img?.thumbnail_url) {
              updateImagesRef.current(prevImages =>
                prevImages.map(prevImg => {
                  if (prevImg.id === update.imageId) {
                    return {
                      ...prevImg,
                      thumbnail_url: `${img.thumbnail_url}?t=${Date.now()}`,
                    };
                  }
                  return prevImg;
                })
              );
            }
          } catch (error) {
            logger.error(
              'Failed to fetch updated image after thumbnail update',
              error,
              'ProjectDetail'
            );
          }
        })();
      },
      [id]
    ),
  });

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
    itemsPerPage,
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

  // Store updateImages function in ref to avoid dependency issues
  const updateImagesRef = useRef(updateImages);
  updateImagesRef.current = updateImages;

  // Store refreshImageSegmentation function in ref to avoid dependency issues
  const refreshImageSegmentationRef = useRef(refreshImageSegmentation);
  refreshImageSegmentationRef.current = refreshImageSegmentation;

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
          };
        }
        return img;
      })
    );

    // Clear pending updates
    pendingUpdates.clear();
  }, []);

  // Real-time image status updates with batching for bulk operations
  useEffect(() => {
    if (!lastUpdate || lastUpdate.projectId !== id) {
      return;
    }

    // Real-time update processing
    logger.debug('Real-time WebSocket update received', 'ProjectDetail', {
      imageId: lastUpdate.imageId,
      status: lastUpdate.status,
      projectId: lastUpdate.projectId,
    });

    // Normalize status to match frontend expectations
    let normalizedStatus = lastUpdate.status;
    if (
      lastUpdate.status === 'segmented' ||
      lastUpdate.status === 'completed'
    ) {
      normalizedStatus = 'completed';
    } else if (lastUpdate.status === 'no_segmentation') {
      normalizedStatus = 'no_segmentation';
    } else if (lastUpdate.status === 'failed') {
      normalizedStatus = 'failed';
    } else if (lastUpdate.status === 'queued') {
      normalizedStatus = 'queued';
    } else if (lastUpdate.status === 'processing') {
      normalizedStatus = 'processing';
    }

    // Determine if segmentation data should be cleared
    const currentImage = images.find(img => img.id === lastUpdate.imageId);
    const clearSegmentationData =
      lastUpdate.status === 'queued' &&
      currentImage &&
      (currentImage.segmentationStatus === 'completed' ||
        currentImage.segmentationStatus === 'segmented');

    // Check if we're in bulk operation mode (more than 10 items in queue)
    // Increased threshold to better detect bulk operations
    const isBulkOperation =
      queueStats && (queueStats.queued > 10 || queueStats.processing > 5);

    if (isBulkOperation) {
      // Batch the update
      pendingUpdatesRef.current.set(lastUpdate.imageId, {
        normalizedStatus,
        clearSegmentationData,
      });

      // Clear existing timeout and set new one
      if (batchUpdateTimeoutRef.current) {
        clearTimeout(batchUpdateTimeoutRef.current);
      }

      // Longer batch timeout for bulk operations to reduce UI updates
      const batchTimeout = queueStats.queued > 100 ? 1000 : 500;
      batchUpdateTimeoutRef.current = setTimeout(
        processBatchUpdates,
        batchTimeout
      );
    } else {
      // Apply update immediately for single operations
      updateImagesRef.current(prevImages =>
        prevImages.map(img => {
          if (img.id === lastUpdate.imageId) {
            logger.debug('Updating image status immediately', 'ProjectDetail', {
              imageId: img.id,
              fromStatus: img.segmentationStatus,
              toStatus: normalizedStatus,
            });

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
            };
          }
          return img;
        })
      );
    }

    // For completed segmentation, refresh immediately to get polygon data and validate
    // Skip refresh if backend already says no_segmentation
    if (
      (lastUpdate.status === 'segmented' ||
        lastUpdate.status === 'completed') &&
      lastUpdate.status !== 'no_segmentation'
    ) {
      // Batch refresh requests to avoid API flooding
      if (isBulkOperation) {
        // In bulk mode, batch the refresh requests
        if (!pendingRefreshRef.current) {
          pendingRefreshRef.current = new Set();
        }
        pendingRefreshRef.current.add(lastUpdate.imageId);

        // Clear existing timeout and set new one
        if (refreshBatchTimeoutRef.current) {
          clearTimeout(refreshBatchTimeoutRef.current);
        }

        // Batch refresh after a delay
        refreshBatchTimeoutRef.current = setTimeout(async () => {
          const imageIdsToRefresh = Array.from(pendingRefreshRef.current || []);
          pendingRefreshRef.current = null;

          logger.debug('Batch refreshing segmentation data', 'ProjectDetail', {
            count: imageIdsToRefresh.length,
          });

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
            // Small delay between chunks
            if (i + chunkSize < imageIdsToRefresh.length) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
        }, 2000); // 2 second delay for batching
      } else {
        // Single operation - refresh immediately but only one call
        (async () => {
          logger.debug('Refreshing segmentation data', 'ProjectDetail', {
            imageId: lastUpdate.imageId,
          });

          try {
            // Only call refreshImageSegmentation which should fetch everything needed
            // DO NOT make duplicate apiClient.getImage call
            await refreshImageSegmentationRef.current(lastUpdate.imageId);

            // Wait for state update
            await new Promise(resolve => setTimeout(resolve, 200));

            // Get the current segmentation data from state after refresh
            updateImagesRef.current(prevImages => {
              const currentImg = prevImages.find(
                i => i.id === lastUpdate.imageId
              );
              const hasPolygons =
                currentImg?.segmentationResult?.polygons &&
                currentImg.segmentationResult.polygons.length > 0;

              logger.debug('Image polygon count', 'ProjectDetail', {
                imageId: lastUpdate.imageId,
                polygonCount: hasPolygons
                  ? currentImg.segmentationResult.polygons.length
                  : 0,
              });

              return prevImages.map(prevImg => {
                if (prevImg.id === lastUpdate.imageId) {
                  const finalStatus = hasPolygons
                    ? 'completed'
                    : 'no_segmentation';

                  return {
                    ...prevImg,
                    segmentationStatus: finalStatus,
                    // Keep the segmentation data that was already updated by refreshImageSegmentation
                    // Force re-render by updating a timestamp
                    lastSegmentationUpdate: Date.now(),
                    // Keep existing thumbnail URL - it should be updated via WebSocket
                    thumbnail_url: prevImg.thumbnail_url,
                    updatedAt: new Date(),
                  };
                }
                return prevImg;
              });
            });
          } catch (error) {
            logger.error('Failed to refresh image data', error);

            // Even if refresh fails, ensure correct status based on segmentation data
            updateImagesRef.current(prevImages => {
              const currentImg = prevImages.find(
                i => i.id === lastUpdate.imageId
              );
              const hasPolygons =
                currentImg?.segmentationResult?.polygons &&
                currentImg.segmentationResult.polygons.length > 0;

              return prevImages.map(prevImg => {
                if (prevImg.id === lastUpdate.imageId) {
                  return {
                    ...prevImg,
                    segmentationStatus: hasPolygons
                      ? 'completed'
                      : 'no_segmentation',
                    updatedAt: new Date(),
                  };
                }
                return prevImg;
              });
            });
          }
        })().catch(err => {
          logger.error('Unhandled error in segmentation refresh IIFE', err);
          // Ensure state is updated even on unhandled rejection
          updateImagesRef.current(prevImages =>
            prevImages.map(prevImg => {
              if (prevImg.id === lastUpdate.imageId) {
                return {
                  ...prevImg,
                  segmentationStatus: 'error',
                  updatedAt: new Date(),
                };
              }
              return prevImg;
            })
          );
        });
      }
    }

    // Reset batch submitted state when queue becomes empty
    if (lastUpdate.status === 'segmented' || lastUpdate.status === 'failed') {
      // Trigger status reconciliation after a short delay
      const timeoutId = setTimeout(() => {
        const currentQueueStats = queueStats;
        if (
          currentQueueStats &&
          currentQueueStats.processing <= 1 &&
          currentQueueStats.queued === 0
        ) {
          setBatchSubmitted(false);
          // Force reconciliation to catch any missed updates
          reconcileRef.current();
        }
      }, 2000);

      // Cleanup timeout if component unmounts
      return () => clearTimeout(timeoutId);
    }
  }, [
    lastUpdate,
    id,
    queueStats,
    setBatchSubmitted,
    images,
    processBatchUpdates,
  ]);

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
            name: img.name,
            url: img.url || img.image_url,
            thumbnail_url: img.thumbnail_url,
            createdAt: new Date(img.created_at || img.createdAt),
            updatedAt: new Date(img.updated_at || img.updatedAt),
            segmentationStatus: segmentationStatus,
            segmentationResult: undefined,
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
        const event = new CustomEvent('project-images-updated', {
          detail: { projectId: id, newImageCount: formattedImages.length },
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
    setSelectedImageIds(new Set(paginatedImages.map(img => img.id)));
  }, [paginatedImages]);

  const handleDeselectAll = useCallback(() => {
    setSelectedImageIds(new Set());
  }, []);

  const handleSelectAllToggle = useCallback(() => {
    const allSelected =
      paginatedImages.length > 0 &&
      paginatedImages.every(img => selectedImageIds.has(img.id));
    if (allSelected) {
      handleDeselectAll();
    } else {
      handleSelectAll();
    }
  }, [paginatedImages, selectedImageIds, handleSelectAll, handleDeselectAll]);

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
    paginatedImages.length > 0 &&
    paginatedImages.every(img => selectedImageIds.has(img.id));
  const isPartiallySelected =
    selectedCount > 0 && selectedCount < paginatedImages.length;

  // Handle batch segmentation of all images without segmentation + selected images
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
        return;
      }

      // Mark as submitted to prevent double clicks
      setBatchSubmitted(true);

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
            />

            {/* Queue Stats Panel */}
            <QueueStatsPanel
              stats={queueStats}
              isConnected={isConnected}
              onSegmentAll={handleSegmentAll}
              batchSubmitted={batchSubmitted || hasActiveQueue}
              imagesToSegmentCount={imagesToSegmentCount}
              selectedImageIds={selectedImageIds}
              images={images}
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
