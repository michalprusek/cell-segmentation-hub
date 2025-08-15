
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from '@/contexts/LanguageContext';
import ProjectHeader from "@/components/project/ProjectHeader";
import ProjectToolbar from "@/components/project/ProjectToolbar";
import EmptyState from "@/components/project/EmptyState";
import ProjectImages from "@/components/project/ProjectImages";
import ProjectUploaderSection from "@/components/project/ProjectUploaderSection";
import { QueueStatsPanel } from "@/components/project/QueueStatsPanel";
import { useProjectData } from "@/hooks/useProjectData";
import { useImageFilter } from "@/hooks/useImageFilter";
import { useProjectImageActions } from "@/hooks/useProjectImageActions";
import { useSegmentationQueue } from "@/hooks/useSegmentationQueue";
import { motion } from "framer-motion";
import apiClient from "@/lib/api";
import { toast } from "sonner";

const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [showUploader, setShowUploader] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [batchSubmitted, setBatchSubmitted] = useState<boolean>(false);

  // Debouncing and deduplication for segmentation refresh
  const debounceTimeoutRef = useRef<{ [imageId: string]: NodeJS.Timeout }>({});
  const lastStatusRef = useRef<{ [imageId: string]: string }>({});

  // Fetch project data
  const { projectTitle, images, loading, updateImages, refreshImageSegmentation } = useProjectData(id, user?.id);

  // Debounced refresh function to prevent excessive API calls
  const debouncedRefreshSegmentation = useCallback((imageId: string, currentStatus: string) => {
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

    // Set new timeout
    debounceTimeoutRef.current[imageId] = setTimeout(() => {
      refreshImageSegmentation(imageId);
      delete debounceTimeoutRef.current[imageId];
    }, 500); // 500ms debounce delay
  }, [refreshImageSegmentation]);
  
  // Filtering and sorting with memoization
  const { 
    filteredImages, 
    searchTerm, 
    sortField, 
    sortDirection, 
    handleSearch, 
    handleSort 
  } = useImageFilter(images);

  // Memoized calculations for heavy operations
  const imagesToSegmentCount = useMemo(() => 
    images.filter(img => 
      ['pending', 'failed', 'no_segmentation'].includes(img.segmentationStatus)
    ).length, 
    [images]
  );
  
  // Image operations
  const { 
    handleDeleteImage, 
    handleOpenSegmentationEditor 
  } = useProjectImageActions({
    projectId: id,
    onImagesChange: updateImages,
    images
  });

  // Queue management
  const {
    isConnected,
    queueStats,
    lastUpdate,
    requestQueueStats
  } = useSegmentationQueue(id);

  // Memoized update function to prevent unnecessary re-renders
  const memoizedUpdateImages = useCallback(updateImages, []);
  
  // Real-time image status updates with optimized dependencies
  useEffect(() => {
    if (lastUpdate?.projectId === id) {
      // Real-time update processing
      
      // Normalize status to match frontend expectations
      const normalizedStatus = lastUpdate.status === 'segmented' ? 'completed' : lastUpdate.status;
      
      // Update the specific image status in the images array
      memoizedUpdateImages(prevImages => 
        prevImages.map(img => 
          img.id === lastUpdate.imageId 
            ? { ...img, segmentationStatus: normalizedStatus }
            : img
        )
      );

      // Use debounced refresh for completed segmentation
      if (lastUpdate.status === 'segmented' || lastUpdate.status === 'completed') {
        debouncedRefreshSegmentation(lastUpdate.imageId, normalizedStatus);
      }

      // Reset batch submitted state when processing starts or completes
      if (['processing', 'segmented', 'failed'].includes(lastUpdate.status)) {
        setBatchSubmitted(false);
      }
    }
  }, [lastUpdate?.imageId, lastUpdate?.status, lastUpdate?.projectId, id, memoizedUpdateImages, debouncedRefreshSegmentation]);

  // Cleanup debounce timeouts on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        for (const timeout of Object.values(debounceTimeoutRef.current)) {
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
          let segmentationStatus = img.segmentationStatus || img.segmentation_status;
          
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
            segmentationResult: undefined
          };
        });
        
        updateImages(formattedImages);
      } catch (error) {
        toast.error("Failed to refresh images after upload");
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
      const imagesToSegment = images.filter(img => 
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
        'hrnet', // Default model, could be configurable
        0.5
      );

      toast.success(t('projects.imagesQueuedForSegmentation', { count: response.queuedCount }));
      
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
    exit: { opacity: 0, transition: { duration: 0.2 } }
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
            />

            {/* Queue Stats Panel */}
            <QueueStatsPanel
              stats={queueStats}
              isConnected={isConnected}
              onSegmentAll={handleSegmentAll}
              batchSubmitted={batchSubmitted}
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
