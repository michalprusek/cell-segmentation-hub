import { logger } from '@/lib/logger';

import React, { useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import { getErrorMessage } from '@/types';
import { useLanguage } from '@/contexts/useLanguage';

interface ProjectThumbnailProps {
  projectId: string;
  fallbackSrc: string;
  imageCount: number;
  onAccessError?: (projectId: string, error: unknown) => void;
}

const ProjectThumbnail = ({
  projectId,
  fallbackSrc,
  imageCount,
  onAccessError,
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
          // Handle different types of errors with better granularity
          if (error && typeof error === 'object' && 'response' in error) {
            const response = (error as any).response;
            const status = response?.status;

            if (status === 403 || status === 500) {
              // Access denied or server error - notify parent component
              logger.error(
                `Access error for project ${projectId} thumbnail:`,
                error
              );
              onAccessError?.(projectId, error);
            } else if (status === 404) {
              // Not found is expected for projects without images, don't log as error
              logger.debug(`No images found for project ${projectId}`);
            } else {
              // Other errors should be logged as warnings
              const errorMessage =
                getErrorMessage(error) || 'Failed to fetch thumbnail';
              logger.warn(
                `Thumbnail fetch failed for project ${projectId} (status: ${status}):`,
                errorMessage
              );
            }
          } else {
            // Network or other non-HTTP errors
            logger.warn(
              `Network error fetching thumbnail for project ${projectId}:`,
              error
            );
          }

          // Clear stale imageUrl on any fetch error
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
