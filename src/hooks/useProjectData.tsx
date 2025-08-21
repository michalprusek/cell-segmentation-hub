import { logger } from '@/lib/logger';
import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import apiClient, { SegmentationResultData } from '@/lib/api';
import type { SegmentationData } from '@/types';
import type { ProjectImage } from '@/types';
import { getErrorMessage } from '@/types';
import { getLocalizedErrorMessage } from '@/lib/errorUtils';

// Utility function to enrich images with segmentation results
export const enrichImagesWithSegmentation = async (
  images: ProjectImage[]
): Promise<ProjectImage[]> => {
  // Filter images that have completed segmentation
  const completedImages = images.filter(img => {
    const status = img.segmentationStatus;
    return status === 'completed' || status === 'segmented';
  });

  logger.debug(
    `📊 Enriching images with segmentation data: ${images.length} total images, ${completedImages.length} completed`
  );
  logger.debug(
    'Image statuses:',
    images.map(img => ({
      id: img.id.slice(0, 8),
      status: img.segmentationStatus,
    }))
  );

  if (completedImages.length === 0) {
    logger.debug('ℹ️ No completed images found for segmentation enrichment');
    return images;
  }

  try {
    // Fetch segmentation results for completed images in parallel
    logger.debug(
      `🔄 Fetching segmentation data for ${completedImages.length} images...`
    );
    const segmentationPromises = completedImages.map(async (img, index) => {
      try {
        logger.debug(
          `📥 Fetching segmentation for image ${index + 1}/${completedImages.length} (ID: ${img.id.slice(0, 8)}...)`
        );
        const segmentationData = await apiClient.getSegmentationResults(img.id);

        logger.debug(
          `✅ Successfully fetched segmentation for ${img.id.slice(0, 8)}: ${segmentationData?.polygons?.length || 0} polygons, ${segmentationData?.imageWidth || 'unknown'}x${segmentationData?.imageHeight || 'unknown'}`,
          {
            segmentationData,
          }
        );

        return {
          imageId: img.id,
          result: segmentationData
            ? {
                polygons: segmentationData.polygons || [],
                imageWidth: segmentationData.imageWidth || img.width || null,
                imageHeight: segmentationData.imageHeight || img.height || null,
                modelUsed: segmentationData.modelUsed,
                confidence: segmentationData.confidence,
                processingTime: segmentationData.processingTime,
                levelOfDetail: 'medium', // Default level of detail for thumbnails
                polygonCount: segmentationData.polygons?.length || 0,
                pointCount:
                  segmentationData.polygons?.reduce(
                    (sum, p) => sum + p.points.length,
                    0
                  ) || 0,
                compressionRatio: 1.0, // Default compression ratio
              }
            : null,
        };
      } catch (error) {
        // Check if it's a 404 error (no segmentation found)
        if (
          error &&
          typeof error === 'object' &&
          'response' in error &&
          (error as { response?: { status?: number } }).response?.status === 404
        ) {
          logger.debug(
            `ℹ️ No segmentation found for image ${img.id.slice(0, 8)} (404) - this is normal for images pending segmentation`
          );
        } else {
          logger.error(
            `❌ Failed to fetch segmentation results for image ${img.id.slice(0, 8)}:`,
            error
          );
        }
        return null;
      }
    });

    const segmentationResults = await Promise.all(segmentationPromises);

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
      `📈 Successfully enriched ${successfulEnrichments} out of ${completedImages.length} images with segmentation data`
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
  userId: string | undefined
) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [projectTitle, setProjectTitle] = useState<string>('');
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

        // Fetch all images by making multiple requests if needed
        // Backend has a max limit of 50 images per request
        let allImages: any[] = [];
        let page = 1;
        let hasMore = true;
        const limit = 50; // Maximum allowed by backend

        // Always fetch all images to ensure proper pagination on frontend
        while (hasMore) {
          try {
            const imagesResponse = await apiClient.getProjectImages(projectId, {
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

            // Check if we've fetched all images
            hasMore = page * limit < imagesResponse.total;
            page++;

            // Safety limit to prevent infinite loops (max 2000 images)
            if (page > 40) {
              console.warn('Reached maximum pagination limit (2000 images)');
              break;
            }
          } catch (error) {
            console.error(`Error fetching images page ${page}:`, error);
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
            createdAt: new Date(img.created_at || img.createdAt),
            updatedAt: new Date(img.updated_at || img.updatedAt),
            segmentationStatus: segmentationStatus,
            // Will be populated by enriching with segmentation results
            segmentationResult: undefined,
          };
        });

        // Enrich images with segmentation results for completed images
        const enrichedImages =
          await enrichImagesWithSegmentation(formattedImages);

        setImages(enrichedImages);
      } catch (error: unknown) {
        logger.error('Error fetching project:', error);

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

  const updateImages = (
    newImages: ProjectImage[] | ((prev: ProjectImage[]) => ProjectImage[])
  ): void => {
    setImages(newImages);
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

      if (!segmentationData) {
        logger.warn(
          `⚠️ No segmentation data returned for image ${imageId.slice(0, 8)}`
        );
        return;
      }

      logger.debug(
        `✅ Successfully refreshed segmentation for ${imageId.slice(0, 8)}: ${segmentationData.polygons?.length || 0} polygons, ${segmentationData.imageWidth}x${segmentationData.imageHeight}`
      );

      setImages(prevImages =>
        prevImages.map(img => {
          if (img.id === imageId) {
            const updatedImage = {
              ...img,
              segmentationStatus: 'completed', // Ensure status is set to completed
              segmentationResult: {
                polygons: segmentationData.polygons || [],
                imageWidth: segmentationData.imageWidth || img.width || null,
                imageHeight: segmentationData.imageHeight || img.height || null,
                modelUsed: segmentationData.modelUsed,
                confidence: segmentationData.confidence,
                processingTime: segmentationData.processingTime,
                levelOfDetail: 'medium', // Set default level of detail for thumbnails
                polygonCount: segmentationData.polygons?.length || 0,
                pointCount:
                  segmentationData.polygons?.reduce(
                    (sum, p) => sum + p.points.length,
                    0
                  ) || 0,
                compressionRatio: 1.0, // Default compression ratio
              },
            };

            logger.debug(
              `✨ Updated image ${imageId.slice(0, 8)} with segmentation result: ${segmentationData.polygons?.length || 0} polygons`,
              {
                imageId,
                polygonCount: segmentationData.polygons?.length || 0,
                hasSegmentationResult: !!updatedImage.segmentationResult,
                segmentationStatus: updatedImage.segmentationStatus,
              }
            );

            return updatedImage;
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
