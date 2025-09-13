import { logger } from '@/lib/logger';
import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/useLanguage';
import { useAuth } from '@/contexts/useAuth';
import apiClient, { SegmentationResultData } from '@/lib/api';
import {
  getErrorMessage,
  type SegmentationData,
  type ProjectImage,
} from '@/types';
import { getLocalizedErrorMessage } from '@/lib/errorUtils';

// Utility function to enrich images with segmentation results
// Now supports pagination to only fetch data for visible images
const enrichImagesWithSegmentation = async (
  images: ProjectImage[],
  options?: {
    startIndex?: number;
    endIndex?: number;
    fetchAll?: boolean;
  }
): Promise<ProjectImage[]> => {
  const {
    startIndex = 0,
    endIndex = images.length,
    fetchAll = false,
  } = options || {};

  // Filter images that need segmentation data
  const imagesToEnrich = fetchAll
    ? images.filter(img => {
        const status = img.segmentationStatus;
        return status === 'completed' || status === 'segmented';
      })
    : images
        .slice(startIndex, endIndex) // Only visible images
        .filter(img => {
          const status = img.segmentationStatus;
          return status === 'completed' || status === 'segmented';
        });

  logger.debug(
    `📊 Enriching images with segmentation data: ${images.length} total images, ${imagesToEnrich.length} to enrich (${fetchAll ? 'all' : `visible ${startIndex}-${endIndex}`})`
  );

  if (imagesToEnrich.length === 0) {
    logger.debug('ℹ️ No completed images found for segmentation enrichment');
    return images;
  }

  try {
    logger.debug(
      `🔄 Fetching segmentation data for ${imagesToEnrich.length} images using batch API...`
    );

    // Use the new batch API endpoint for massive performance improvement
    // This reduces 640 individual API calls to just 1-2 batch calls
    const imageIds = imagesToEnrich.map(img => img.id);
    const batchResults = await apiClient.getBatchSegmentationResults(imageIds);

    // Defensive check for batch results
    if (!batchResults || typeof batchResults !== 'object') {
      logger.error('Invalid batch results received from API:', batchResults);
      throw new Error(
        'Failed to batch fetch segmentation results: Invalid response format'
      );
    }

    logger.debug(
      `✅ Batch fetch complete: received ${Object.keys(batchResults).length} results`
    );

    // Transform batch results into the expected format
    const segmentationResults = [];

    for (const img of imagesToEnrich) {
      const segmentationData = batchResults[img.id];

      // Check if segmentation data exists and is valid
      if (
        segmentationData &&
        typeof segmentationData === 'object' &&
        segmentationData.polygons
      ) {
        logger.debug(
          `✅ Segmentation data for ${img.id.slice(0, 8)}: ${segmentationData.polygons?.length || 0} polygons`
        );

        segmentationResults.push({
          imageId: img.id,
          result: {
            polygons: segmentationData.polygons || [],
            imageWidth: segmentationData.imageWidth || img.width || null,
            imageHeight: segmentationData.imageHeight || img.height || null,
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
          },
        });
      } else {
        logger.debug(
          `ℹ️ No segmentation found for image ${img.id.slice(0, 8)}`
        );
        segmentationResults.push({
          imageId: img.id,
          result: null,
        });
      }
    }

    // Create a map of imageId to segmentation results
    const segmentationMap = new Map();
    let successfulEnrichments = 0;
    segmentationResults.forEach(result => {
      if (result) {
        segmentationMap.set(result.imageId, result.result);
        successfulEnrichments++;
      }
    });

    logger.debug(
      `📈 Successfully enriched ${successfulEnrichments} out of ${imagesToEnrich.length} images with segmentation data`
    );

    // Enrich images with segmentation results
    const enrichedImages = images.map(img => {
      const segmentationResult = segmentationMap.get(img.id);
      if (segmentationResult) {
        logger.debug(
          `🎯 Image ${img.id.slice(0, 8)} enriched with ${segmentationResult.polygons?.length || 0} polygons`
        );
      }
      return {
        ...img,
        segmentationResult: segmentationResult || img.segmentationResult,
      };
    });

    return enrichedImages;
  } catch (error) {
    logger.error('Error enriching images with segmentation results:', error);
    // Return original images if enrichment fails
    return images;
  }
};

export const useProjectData = (
  projectId: string | undefined,
  userId: string | undefined,
  options?: {
    fetchAll?: boolean;
    visibleRange?: { start: number; end: number };
  }
) => {
  const { t } = useLanguage();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [projectTitle, setProjectTitle] = useState<string>('');
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Track pending requests to prevent duplicates
  const pendingRequestsRef = useRef<Set<string>>(new Set());

  // Store navigate function in ref to avoid dependency issues
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Store images without segmentation data
  const [imagesBase, setImagesBase] = useState<ProjectImage[]>([]);

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

        // Fetch all images by making multiple requests if needed
        // Backend has a max limit of 50 images per request
        let allImages: any[] = [];
        let page = 1;
        let hasMore = true;
        const limit = 50; // Maximum allowed by backend

        // Always fetch all images to ensure proper pagination on frontend
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

            // Check if we've fetched all images
            // The new endpoint returns pagination.total
            const totalImages =
              imagesResponse.pagination?.total || imagesResponse.total || 0;
            hasMore = page * limit < totalImages;
            page++;

            // Safety limit to prevent infinite loops (max 2000 images)
            if (page > 40) {
              logger.warn('Reached maximum pagination limit (2000 images)');
              break;
            }
          } catch (error) {
            logger.error(`Error fetching images page ${page}`, error);
            break;
          }
        }

        const imagesData = allImages;

        const formattedImages: ProjectImage[] = (imagesData || []).map(img => {
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
            url: img.url || img.image_url, // Use url field that's already mapped in api.ts
            width: img.width,
            height: img.height,
            thumbnail_url: img.thumbnail_url,
            segmentationThumbnailUrl: img.segmentationThumbnailUrl,
            segmentationThumbnailPath: img.segmentationThumbnailPath,
            createdAt: new Date(img.created_at || img.createdAt),
            updatedAt: new Date(img.updated_at || img.updatedAt),
            segmentationStatus: segmentationStatus,
            // Will be populated by enriching with segmentation results
            segmentationResult: img.segmentationResult || undefined,
          };
        });

        // Store base images
        setImagesBase(formattedImages);

        // Initial enrichment for visible range only
        const enrichedImages = await enrichImagesWithSegmentation(
          formattedImages,
          {
            fetchAll: options?.fetchAll || false,
            startIndex: options?.visibleRange?.start,
            endIndex: options?.visibleRange?.end,
          }
        );

        setImages(enrichedImages);
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
  }, [projectId, userId, t]);

  // Update segmentation data when visible range changes
  useEffect(() => {
    if (!imagesBase.length || loading) return;
    if (!options?.visibleRange) return;

    const enrichVisibleImages = async () => {
      logger.debug('Enriching visible images', {
        start: options.visibleRange?.start,
        end: options.visibleRange?.end,
      });

      const enrichedImages = await enrichImagesWithSegmentation(imagesBase, {
        fetchAll: false,
        startIndex: options.visibleRange.start,
        endIndex: options.visibleRange.end,
      });

      setImages(enrichedImages);
    };

    enrichVisibleImages();
  }, [
    options?.visibleRange?.start,
    options?.visibleRange?.end,
    imagesBase,
    loading,
  ]);

  const updateImages = (
    newImages: ProjectImage[] | ((prev: ProjectImage[]) => ProjectImage[])
  ): void => {
    setImages(newImages);
    // Also update base images to maintain consistency
    setImagesBase(prevBase => {
      const updatedImages =
        typeof newImages === 'function' ? newImages(prevBase) : newImages;
      return updatedImages;
    });
  };

  // Function to refresh segmentation data for a specific image with deduplication
  const refreshImageSegmentation = async (imageId: string) => {
    // Check if request is already in progress
    if (pendingRequestsRef.current.has(imageId)) {
      logger.debug(
        `⏭️ Skipping duplicate request for image ${imageId.slice(0, 8)} - already in progress`
      );
      return;
    }

    try {
      // Mark request as pending
      pendingRequestsRef.current.add(imageId);
      logger.debug(
        `🔄 Refreshing segmentation data for image ${imageId.slice(0, 8)}...`
      );

      const segmentationData = await apiClient.getSegmentationResults(imageId);

      // Check if segmentation data exists before accessing properties
      if (!segmentationData) {
        logger.debug(
          `ℹ️ No segmentation data available for image ${imageId.slice(0, 8)} - API returned null`
        );
        return; // Exit early if no data
      }

      logger.debug(
        `✅ Successfully refreshed segmentation for ${imageId.slice(0, 8)}: ${segmentationData.polygons?.length || 0} polygons, ${segmentationData.imageWidth}x${segmentationData.imageHeight}`
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
        `❌ Failed to refresh segmentation data for image ${imageId.slice(0, 8)}:`,
        error
      );
    } finally {
      // Remove from pending requests
      pendingRequestsRef.current.delete(imageId);
    }
  };

  return {
    projectTitle,
    images,
    loading,
    updateImages,
    refreshImageSegmentation,
  };
};
