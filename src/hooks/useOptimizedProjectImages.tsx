import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { thumbnailCache } from '@/lib/thumbnailCache';
import { useUnifiedSegmentationUpdate } from './useUnifiedSegmentationUpdate';
import { logger } from '@/lib/logger';
import type { ProjectImage } from '@/types';

interface OptimizedProjectImage extends ProjectImage {
  segmentationResult?: {
    polygons: Array<{
      id: string;
      points: Array<{ x: number; y: number }>;
      type: 'external' | 'internal';
      class?: string;
      originalPointCount?: number;
      compressionRatio?: number;
    }>;
    imageWidth: number;
    imageHeight: number;
    levelOfDetail: 'low' | 'medium' | 'high';
    polygonCount: number;
    pointCount: number;
    compressionRatio: number;
  };
}

interface UseOptimizedProjectImagesOptions {
  projectId: string;
  levelOfDetail?: 'low' | 'medium' | 'high';
  page?: number;
  limit?: number;
  enabled?: boolean;
}

interface UseOptimizedProjectImagesResult {
  images: OptimizedProjectImage[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
  metadata: {
    levelOfDetail: 'low' | 'medium' | 'high';
    totalImages: number;
    imagesWithThumbnails: number;
  };
  refetch: () => Promise<void>;
  invalidateCache: (imageId?: string) => Promise<void>;
}

export const useOptimizedProjectImages = ({
  projectId,
  levelOfDetail = 'low',
  page = 1,
  limit = 50,
  enabled = true,
}: UseOptimizedProjectImagesOptions): UseOptimizedProjectImagesResult => {
  const queryClient = useQueryClient();
  const [localImages, setLocalImages] = useState<
    Map<string, OptimizedProjectImage>
  >(new Map());

  // Query key for React Query
  const queryKey = useMemo(
    () => ['optimized-project-images', projectId, levelOfDetail, page, limit],
    [projectId, levelOfDetail, page, limit]
  );

  // Fetch images with thumbnails from API
  const {
    data: apiData,
    isLoading,
    isError,
    error,
    refetch: apiRefetch,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      logger.debug('🔄 Fetching optimized project images', {
        projectId,
        levelOfDetail,
        page,
        limit,
      });

      const result = await apiClient.getProjectImagesWithThumbnails(projectId, {
        lod: levelOfDetail,
        page,
        limit,
      });

      // Enhance images with cached thumbnail data if available
      const enhancedImages = await Promise.all(
        result.images.map(async image => {
          try {
            const cachedThumbnail = await thumbnailCache.get(
              image.id,
              levelOfDetail
            );
            if (cachedThumbnail) {
              return {
                ...image,
                segmentationResult: {
                  polygons: cachedThumbnail.polygons,
                  imageWidth: cachedThumbnail.imageWidth || image.width || 0,
                  imageHeight: cachedThumbnail.imageHeight || image.height || 0,
                  levelOfDetail: cachedThumbnail.levelOfDetail,
                  polygonCount: cachedThumbnail.polygonCount,
                  pointCount: cachedThumbnail.pointCount,
                  compressionRatio: cachedThumbnail.compressionRatio,
                },
              };
            }
          } catch (error) {
            logger.debug('No cached thumbnail found', { imageId: image.id });
          }

          return image;
        })
      );

      // Cache fresh thumbnail data
      for (const image of enhancedImages) {
        if (image.segmentationResult) {
          try {
            await thumbnailCache.set(
              image.id,
              levelOfDetail,
              image.segmentationResult
            );
          } catch (error) {
            logger.error(
              `Failed to cache thumbnail for image ${image.id}`,
              error instanceof Error ? error : new Error(String(error)),
              'useOptimizedProjectImages'
            );
          }
        }
      }

      return {
        ...result,
        images: enhancedImages,
      };
    },
    enabled: enabled && !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  // Handle real-time unified segmentation updates
  const handleUnifiedUpdate = useCallback(
    (update: any) => {
      if (update.projectId !== projectId) return;

      logger.debug('🔄 Processing real-time unified update in optimized hook', {
        imageId: update.imageId,
        status: update.status,
        hasSegmentationResult: !!update.segmentationResult,
        hasThumbnailData: !!update.thumbnailData,
      });

      // Update local images map
      setLocalImages(prev => {
        const updated = new Map(prev);
        const existingImage = updated.get(update.imageId);

        if (existingImage) {
          // Use segmentation result or thumbnail data
          const resultData = update.segmentationResult || update.thumbnailData;

          if (resultData) {
            updated.set(update.imageId, {
              ...existingImage,
              segmentationStatus: update.status,
              segmentationResult: {
                polygons: resultData.polygons || [],
                imageWidth: resultData.imageWidth || existingImage.width || 0,
                imageHeight:
                  resultData.imageHeight || existingImage.height || 0,
                levelOfDetail: resultData.levelOfDetail || levelOfDetail,
                polygonCount:
                  resultData.polygonCount || resultData.polygons?.length || 0,
                pointCount: resultData.pointCount || 0,
                compressionRatio: resultData.compressionRatio || 1,
              },
            });
          } else {
            // Just update status if no result data
            updated.set(update.imageId, {
              ...existingImage,
              segmentationStatus: update.status,
            });
          }
        }

        return updated;
      });

      // Invalidate React Query cache to trigger background refetch
      queryClient.invalidateQueries({ queryKey });
    },
    [projectId, queryClient, queryKey, levelOfDetail]
  );

  // Set up real-time updates using unified hook
  useUnifiedSegmentationUpdate({
    projectId,
    onImageUpdate: handleUnifiedUpdate,
    enabled,
  });

  // Update local images when API data changes
  useEffect(() => {
    if (apiData?.images) {
      const imageMap = new Map<string, OptimizedProjectImage>();
      apiData.images.forEach(image => {
        imageMap.set(image.id, image);
      });
      setLocalImages(imageMap);
    }
  }, [apiData?.images]);

  // Merge API data with local updates
  const mergedImages = useMemo(() => {
    if (!apiData?.images) return [];

    return apiData.images.map(apiImage => {
      const localImage = localImages.get(apiImage.id);
      return localImage || apiImage;
    });
  }, [apiData?.images, localImages]);

  // Cache invalidation helper
  const invalidateCache = useCallback(
    async (imageId?: string) => {
      try {
        if (imageId) {
          await thumbnailCache.invalidate(imageId);
          logger.debug('🗑️ Invalidated cache for specific image', { imageId });
        } else {
          await thumbnailCache.clear();
          logger.debug('🗑️ Cleared entire thumbnail cache');
        }

        // Refetch data
        apiRefetch();
      } catch (error) {
        logger.error(
          'Failed to invalidate thumbnail cache',
          error instanceof Error ? error : new Error(String(error)),
          'useOptimizedProjectImages'
        );
      }
    },
    [apiRefetch]
  );

  return {
    images: mergedImages,
    isLoading,
    isError,
    error: error as Error | null,
    pagination: apiData?.pagination || {
      page: 1,
      limit: 50,
      total: 0,
      pages: 0,
    },
    metadata: apiData?.metadata || {
      levelOfDetail: 'low',
      totalImages: 0,
      imagesWithThumbnails: 0,
    },
    refetch: apiRefetch,
    invalidateCache,
  };
};

export default useOptimizedProjectImages;
