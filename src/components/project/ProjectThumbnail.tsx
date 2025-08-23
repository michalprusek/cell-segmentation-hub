import { logger } from '@/lib/logger';

import React, { useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import { getErrorMessage } from '@/types';
import { useLanguage } from '@/contexts/useLanguage';

interface ProjectThumbnailProps {
  projectId: string;
  fallbackSrc: string;
  imageCount: number;
}

const ProjectThumbnail = ({
  projectId,
  fallbackSrc,
  imageCount,
}: ProjectThumbnailProps) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    const fetchFirstImage = async () => {
      if (imageCount > 0 && projectId) {
        try {
          const response = await apiClient.getProjectImages(projectId, {
            limit: 1,
          });

          // Validate response structure
          if (
            response &&
            Array.isArray(response.images) &&
            response.images.length > 0
          ) {
            const data = response.images[0];
            // Use thumbnail if available, otherwise use full image
            setImageUrl(data.thumbnail_url || data.image_url);
          } else {
            // Clear imageUrl when no images are returned
            setImageUrl(null);
          }
        } catch (error: unknown) {
          // Only log errors for non-404 responses (404 is expected for projects without images)
          if (error && typeof error === 'object' && 'response' in error) {
            const response = (error as any).response;
            if (response?.status !== 404) {
              const errorMessage =
                getErrorMessage(error) || 'Failed to fetch thumbnail';
              logger.warn(
                `Thumbnail fetch failed for project ${projectId}:`,
                errorMessage
              );
            }
          }
          // Clear stale imageUrl on fetch error
          setImageUrl(null);
        }
      }
    };

    fetchFirstImage();
  }, [projectId, imageCount]);

  return (
    <img
      src={imageUrl || fallbackSrc || '/placeholder.svg'}
      alt={t('common.project')}
      className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
    />
  );
};

export default ProjectThumbnail;
