import { logger } from '@/lib/logger';
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/useLanguage';
import { useAuth } from '@/contexts/useAuth';
import { performanceMonitor } from '@/lib/performanceMonitor';
import apiClient from '@/lib/api';
import { type ProjectImage } from '@/types';
import { getLocalizedErrorMessage } from '@/lib/errorUtils';

export const useProjectData = (
  projectId: string | undefined,
  userId: string | undefined
) => {
  const { t } = useLanguage();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [projectTitle, setProjectTitle] = useState<string>('');
  const [projectType, setProjectType] = useState<
    import('@/types').ProjectType | undefined
  >(undefined);
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Track pending requests to prevent duplicates
  const pendingRequestsRef = useRef<Set<string>>(new Set());

  // Store navigate function in ref to avoid dependency issues
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const fetchData = async () => {
      if (!projectId || !userId) {
        setLoading(false);
        return;
      }

      try {
        // First check if project exists
        const project = await apiClient.getProject(projectId);

        if (!project) {
          toast.error(t('errors.notFound'));
          navigateRef.current('/dashboard');
          return;
        }

        setProjectTitle(project.name);
        setProjectType(project.type);

        // Fetch all images by making multiple requests if needed.
        // Backend max is 100 per request; we use lod: 'low' which
        // returns only metadata counts (no polygon arrays) — fast & light.
        let allImages: any[] = [];
        let page = 1;
        let hasMore = true;
        const limit = 100; // Use max backend limit for fewer round-trips

        while (hasMore) {
          try {
            const imagesResponse =
              await apiClient.getProjectImagesWithThumbnails(projectId, {
                limit,
                page,
                lod: 'low',
              });

            if (
              !imagesResponse.images ||
              !Array.isArray(imagesResponse.images)
            ) {
              logger.error('Invalid images response format');
              break;
            }

            allImages = [...allImages, ...imagesResponse.images];

            const totalImages =
              imagesResponse.pagination?.total || imagesResponse.total || 0;
            hasMore = page * limit < totalImages;
            page++;

            // Safety limit to prevent infinite loops (max 2000 images)
            if (page > 20) {
              logger.warn('Reached maximum pagination limit (2000 images)');
              break;
            }
          } catch (error) {
            logger.error(`Error fetching images page ${page}`, error);
            break;
          }
        }

        const formattedImages: ProjectImage[] = (allImages || []).map(img => {
          // Normalize segmentation status from different backend field names
          let segmentationStatus =
            img.segmentationStatus || img.segmentation_status;

          // Normalize status values to consistent format
          if (segmentationStatus === 'segmented') {
            segmentationStatus = 'completed';
          }

          return {
            id: img.id,
            name: img.name || `Image ${img.id}`,
            url: img.url || img.image_url,
            width: img.width,
            height: img.height,
            thumbnail_url: img.thumbnail_url,
            segmentationThumbnailUrl: img.segmentationThumbnailUrl,
            segmentationThumbnailPath: img.segmentationThumbnailPath,
            createdAt: new Date(img.created_at || img.createdAt),
            updatedAt: new Date(img.updated_at || img.updatedAt),
            segmentationStatus: segmentationStatus,
            // segmentationResult from lod:'low' has empty polygons[] with
            // counts only — sufficient for the grid view. The segmentation
            // editor loads full polygon data independently.
            segmentationResult: img.segmentationResult || undefined,
          };
        });

        // Set images directly — no enrichment needed.
        // The grid view uses server-generated thumbnail images, not raw polygons.
        // The segmentation editor loads full polygon data on its own.
        setImages(formattedImages);

        logger.debug(
          `Loaded ${formattedImages.length} images for project ${projectId}`
        );
      } catch (error: unknown) {
        logger.error('Error fetching project:', error);

        // Check for missing token error
        if (
          error &&
          typeof error === 'object' &&
          'response' in error &&
          'data' in (error as any).response &&
          (error as any).response?.data?.message === 'Chybí autentizační token'
        ) {
          // Missing authentication token - sign out and redirect
          await signOut();
          navigateRef.current('/sign-in');
          return;
        }

        if (
          error &&
          typeof error === 'object' &&
          'response' in error &&
          (error as { response?: { status?: number } }).response?.status === 404
        ) {
          toast.error(t('errors.notFound'));
          navigateRef.current('/dashboard');
        } else {
          const errorMessage = getLocalizedErrorMessage(
            error,
            t,
            'errors.operations.loadProject'
          );
          toast.error(errorMessage);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // signOut is stable from AuthContext but not memoized; including it would
    // re-fetch on every auth state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, userId, t]);

  const updateImages = useCallback(
    (
      newImages: ProjectImage[] | ((prev: ProjectImage[]) => ProjectImage[])
    ): void => {
      setImages(newImages);
    },
    []
  );

  // Function to refresh segmentation data for a specific image with deduplication
  const refreshImageSegmentation = async (imageId: string) => {
    // Check if request is already in progress
    if (pendingRequestsRef.current.has(imageId)) {
      logger.debug(
        `Skipping duplicate request for image ${imageId.slice(0, 8)} - already in progress`
      );
      return;
    }

    try {
      // Mark request as pending
      pendingRequestsRef.current.add(imageId);
      logger.debug(
        `Refreshing segmentation data for image ${imageId.slice(0, 8)}...`
      );

      const startTime = performance.now();
      let segmentationData = await apiClient.getSegmentationResults(imageId);
      const firstFetchDuration = performance.now() - startTime;

      // If no data on first attempt and image was just marked as segmented,
      // retry multiple times with increasing delays (race condition with backend update)
      let retryCount = 0;
      const maxRetries = 3;
      const retryDelays = [500, 1000, 2000]; // Increasing delays

      while (!segmentationData && retryCount < maxRetries) {
        const delay = retryDelays[retryCount];
        logger.info(
          `No segmentation data yet for ${imageId.slice(0, 8)}, retry ${retryCount + 1}/${maxRetries} in ${delay}ms...`
        );

        // Record failed attempt
        performanceMonitor.recordDatabaseFetch(
          imageId,
          retryCount === 0 ? firstFetchDuration : performance.now() - startTime,
          false,
          retryCount
        );

        await new Promise(resolve => setTimeout(resolve, delay));

        segmentationData = await apiClient.getSegmentationResults(imageId);
        retryCount++;
      }

      // Record final attempt result
      if (segmentationData) {
        performanceMonitor.recordDatabaseFetch(
          imageId,
          performance.now() - startTime,
          true,
          retryCount
        );
      }

      // Check if segmentation data exists after retry
      if (!segmentationData) {
        logger.warn(
          `No segmentation data available for image ${imageId.slice(0, 8)} after retry - keeping existing status`
        );
        return;
      }

      logger.debug(
        `Successfully refreshed segmentation for ${imageId.slice(0, 8)}: ${segmentationData.polygons?.length || 0} polygons, ${segmentationData.imageWidth}x${segmentationData.imageHeight}`
      );

      setImages(prevImages =>
        prevImages.map(img => {
          if (img.id === imageId) {
            return {
              ...img,
              segmentationResult: {
                polygons: segmentationData.polygons || [],
                imageWidth: segmentationData.imageWidth || img.width || null,
                imageHeight: segmentationData.imageHeight || img.height || null,
                modelUsed: segmentationData.modelUsed,
                confidence: segmentationData.confidence,
                processingTime: segmentationData.processingTime,
              },
            };
          }
          return img;
        })
      );
    } catch (error) {
      logger.error(
        `Failed to refresh segmentation data for image ${imageId.slice(0, 8)}:`,
        error
      );
    } finally {
      // Remove from pending requests
      pendingRequestsRef.current.delete(imageId);
    }
  };

  return {
    projectTitle,
    projectType,
    setProjectType,
    images,
    loading,
    updateImages,
    refreshImageSegmentation,
  };
};
