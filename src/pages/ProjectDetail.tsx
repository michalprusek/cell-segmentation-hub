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
import { useSegmentationQueue } from '@/hooks/useSegmentationQueue';
import { useStatusReconciliation } from '@/hooks/useStatusReconciliation';
import { motion } from 'framer-motion';
import apiClient from '@/lib/api';
import { toast } from 'sonner';

const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { selectedModel, confidenceThreshold } = useModel();
  const [showUploader, setShowUploader] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [batchSubmitted, setBatchSubmitted] = useState<boolean>(false);

  // Debouncing and deduplication for segmentation refresh
  const debounceTimeoutRef = useRef<{ [imageId: string]: NodeJS.Timeout }>({});
  const lastStatusRef = useRef<{ [imageId: string]: string }>({});

  // Fetch project data
  const {
    projectTitle,
    images,
    loading,
    updateImages,
    refreshImageSegmentation,
  } = useProjectData(id, user?.id);

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

  // Filtering and sorting with memoization
  const {
    filteredImages,
    searchTerm,
    sortField,
    sortDirection,
    handleSearch,
    handleSort,
  } = useImageFilter(images);

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

  // Real-time image status updates with optimized dependencies
  useEffect(() => {
    if (!lastUpdate || lastUpdate.projectId !== id) {
      return;
    }

    // Real-time update processing

    // Normalize status to match frontend expectations, but validate segmented status
    let normalizedStatus = lastUpdate.status;
    if (lastUpdate.status === 'segmented') {
      // Don't immediately set to completed - verify segmentation data exists first
      normalizedStatus = 'processing'; // Keep as processing until we verify data
    }

    // Update the specific image status in the images array immediately
    updateImagesRef.current(prevImages =>
      prevImages.map(img =>
        img.id === lastUpdate.imageId
          ? {
              ...img,
              segmentationStatus: normalizedStatus,
              updatedAt: new Date(), // Update timestamp for tracking and reconciliation
            }
          : img
      )
    );

    // For completed segmentation, refresh immediately to get polygon data and validate
    if (
      lastUpdate.status === 'segmented' ||
      lastUpdate.status === 'completed'
    ) {
      // Immediate refresh for completed status - this will also validate if polygons exist
      refreshImageSegmentationRef
        .current(lastUpdate.imageId)
        .then(() => {
          // After refresh, check if we actually have segmentation data
          updateImagesRef.current(prevImages =>
            prevImages.map(img => {
              if (img.id === lastUpdate.imageId) {
                // Only mark as completed if we have actual polygon data
                const hasPolygons =
                  img.segmentationResult &&
                  img.segmentationResult.polygons &&
                  img.segmentationResult.polygons.length > 0;

                return {
                  ...img,
                  segmentationStatus: hasPolygons
                    ? 'completed'
                    : 'no_segmentation',
                  updatedAt: new Date(),
                };
              }
              return img;
            })
          );
        })
        .catch(() => {
          // If refresh fails, mark as no_segmentation
          updateImagesRef.current(prevImages =>
            prevImages.map(img =>
              img.id === lastUpdate.imageId
                ? {
                    ...img,
                    segmentationStatus: 'no_segmentation',
                    updatedAt: new Date(),
                  }
                : img
            )
          );
        });
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
  }, [lastUpdate, id, queueStats, setBatchSubmitted]);

  // Cleanup debounce timeouts on unmount
  useEffect(() => {
    const timeouts = debounceTimeoutRef.current;
    return () => {
      if (timeouts) {
        for (const timeout of Object.values(timeouts)) {
          clearTimeout(timeout);
        }
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
        const imagesResponse = await apiClient.getProjectImages(id);
        const imagesData = imagesResponse.images;

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

        updateImages(formattedImages);
      } catch (error) {
        toast.error(t('toast.upload.failed'));
      }
    }
  };

  // Handle opening an image - now takes the image ID directly
  const handleOpenImage = (imageId: string) => {
    handleOpenSegmentationEditor(imageId);
  };

  // Handle batch segmentation of all images without segmentation
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
      const imagesToSegment = images.filter(
        img =>
          img.segmentationStatus === 'pending' ||
          img.segmentationStatus === 'failed' ||
          img.segmentationStatus === 'no_segmentation' ||
          !img.segmentationStatus
      );

      if (imagesToSegment.length === 0) {
        toast.info(t('projects.allImagesAlreadySegmented'));
        return;
      }

      // Mark as submitted to prevent double clicks
      setBatchSubmitted(true);

      const imageIds = imagesToSegment.map(img => img.id);

      // Add to queue
      const response = await apiClient.addBatchToQueue(
        imageIds,
        id,
        selectedModel,
        confidenceThreshold
      );

      toast.success(
        t('projects.imagesQueuedForSegmentation', {
          count: response.queuedCount,
        })
      );

      // Refresh queue stats
      requestQueueStats();
    } catch (error) {
      toast.error(t('projects.errorAddingToQueue'));
      // Reset submitted state on error so user can try again
      setBatchSubmitted(false);
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
            />

            {/* Queue Stats Panel */}
            <QueueStatsPanel
              stats={queueStats}
              isConnected={isConnected}
              onSegmentAll={handleSegmentAll}
              batchSubmitted={batchSubmitted || hasActiveQueue}
              imagesToSegmentCount={imagesToSegmentCount}
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
              <ProjectImages
                images={filteredImages}
                onDelete={handleDeleteImage}
                onOpen={handleOpenImage}
                viewMode={viewMode}
              />
            )}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};

export default ProjectDetail;
