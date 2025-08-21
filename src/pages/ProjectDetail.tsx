import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useModel } from '@/contexts/ModelContext';
import ProjectHeader from '@/components/project/ProjectHeader';
import ProjectToolbar from '@/components/project/ProjectToolbar';
import EmptyState from '@/components/project/EmptyState';
import ProjectImages from '@/components/project/ProjectImages';
import ProjectUploaderSection from '@/components/project/ProjectUploaderSection';
import { QueueStatsPanel } from '@/components/project/QueueStatsPanel';
import { useProjectData } from '@/hooks/useProjectData';
import { useImageFilter } from '@/hooks/useImageFilter';
import { useProjectImageActions } from '@/hooks/useProjectImageActions';
import { useStatusReconciliation } from '@/hooks/useStatusReconciliation';
import { usePagination } from '@/hooks/usePagination';
import { useUnifiedSegmentationUpdate } from '@/hooks/useUnifiedSegmentationUpdate';
import { motion } from 'framer-motion';
import apiClient from '@/lib/api';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
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

  // Fetch project data
  const {
    projectTitle,
    images,
    loading,
    updateImages,
    refreshImageSegmentation,
  } = useProjectData(id, user?.id);

  // Unified segmentation update handling - no dependency on queueStats
  const handleUnifiedUpdate = useCallback((update: any) => {
    logger.debug(
      `🔄 Processing unified update for image ${update.imageId.slice(0, 8)}`,
      {
        status: update.status,
        hasSegmentationResult: !!update.segmentationResult,
        hasThumbnailData: !!update.thumbnailData,
      }
    );

    // Normalize status for consistency
    let normalizedStatus = update.status;
    if (update.status === 'segmented') {
      normalizedStatus = 'completed';
    }

    // Update the specific image with unified data - IMMEDIATELY
    updateImagesRef.current(prevImages =>
      prevImages.map(img => {
        if (img.id === update.imageId) {
          // Clear segmentation data if this is a re-segmentation being queued
          const clearSegmentationData =
            update.status === 'queued' &&
            (img.segmentationStatus === 'completed' ||
              img.segmentationStatus === 'segmented');

          const updatedImage = {
            ...img,
            segmentationStatus: normalizedStatus,
            updatedAt: new Date(), // Update timestamp for tracking
            // Update segmentation result with new data or clear if re-segmenting
            segmentationResult: clearSegmentationData
              ? undefined
              : update.segmentationResult ||
                update.thumbnailData ||
                img.segmentationResult,
            segmentationData: clearSegmentationData
              ? undefined
              : img.segmentationData,
          };

          logger.debug(
            `✨ Updated image ${update.imageId.slice(0, 8)} with unified data`,
            {
              oldStatus: img.segmentationStatus,
              newStatus: normalizedStatus,
              hasResult: !!updatedImage.segmentationResult,
              cleared: clearSegmentationData,
            }
          );

          return updatedImage;
        }
        return img;
      })
    );
  }, []);

  // Use unified segmentation update hook
  const { isConnected, queueStats, lastUpdate, requestQueueStats } =
    useUnifiedSegmentationUpdate({
      projectId: id,
      onImageUpdate: handleUnifiedUpdate,
      enabled: !!id,
    });

  // Handle batch state reset separately when queue becomes empty
  useEffect(() => {
    if (
      queueStats &&
      queueStats.processing <= 1 &&
      queueStats.queued === 0 &&
      batchSubmitted
    ) {
      const timer = setTimeout(() => {
        setBatchSubmitted(false);
        // Force reconciliation to catch any missed updates
        reconcileRef.current();
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [queueStats, batchSubmitted]);

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

  const toggleUploader = () => {
    setShowUploader(!showUploader);
  };

  const handleUploadComplete = async () => {
    // Hide the uploader first
    setShowUploader(false);

    // Refresh the images data - use the same enrichment process as initial load
    if (id && user?.id) {
      try {
        // First fetch all images with pagination to ensure we get everything
        let allImages: any[] = [];
        let page = 1;
        let hasMore = true;
        const limit = 50;

        while (hasMore) {
          try {
            const imagesResponse = await apiClient.getProjectImages(id, {
              limit,
              page,
            });

            if (
              !imagesResponse.images ||
              !Array.isArray(imagesResponse.images)
            ) {
              console.error('Invalid images response format');
              break;
            }

            allImages = [...allImages, ...imagesResponse.images];
            hasMore = page * limit < imagesResponse.total;
            page++;

            if (page > 40) {
              console.warn('Reached maximum pagination limit (2000 images)');
              break;
            }
          } catch (error) {
            console.error(`Error fetching images page ${page}:`, error);
            break;
          }
        }

        const formattedImages = (allImages || []).map(img => {
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
            width: img.width,
            height: img.height,
            thumbnail_url: img.thumbnail_url,
            createdAt: new Date(img.created_at || img.createdAt),
            updatedAt: new Date(img.updated_at || img.updatedAt),
            segmentationStatus: segmentationStatus,
            segmentationResult: undefined,
          };
        });

        // Import enrichImagesWithSegmentation function from useProjectData hook
        const { enrichImagesWithSegmentation } = await import(
          '@/hooks/useProjectData'
        );

        // Enrich images with segmentation results for completed images
        const enrichedImages =
          await enrichImagesWithSegmentation(formattedImages);

        updateImages(enrichedImages);
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

      // Process images without segmentation (normal segmentation)
      if (imageIdsWithoutSegmentation.length > 0) {
        const response = await apiClient.addBatchToQueue(
          imageIdsWithoutSegmentation,
          id,
          selectedModel,
          confidenceThreshold,
          0, // priority
          false, // not force re-segment
          detectHoles
        );
        totalQueued += response.queuedCount;
      }

      // Process selected images with segmentation (force re-segment)
      if (imageIdsToResegment.length > 0) {
        const response = await apiClient.addBatchToQueue(
          imageIdsToResegment,
          id,
          selectedModel,
          confidenceThreshold,
          0, // priority
          true, // force re-segment
          detectHoles
        );
        totalQueued += response.queuedCount;
      }

      toast.success(
        t('projects.imagesQueuedForSegmentation', {
          count: totalQueued,
        })
      );

      // Clear selection after successful batch operation
      setSelectedImageIds(new Set());

      // Refresh queue stats
      requestQueueStats();
    } catch (error) {
      toast.error(t('projects.errorAddingToQueue'));
      // Reset submitted state on error so user can try again
      setBatchSubmitted(false);

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
