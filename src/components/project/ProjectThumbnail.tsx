import { logger } from '@/lib/logger';

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
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

  // `onAccessError` is an OUTPUT of the fetch, never an input to it — but it
  // used to sit in the effect's dependency array, and both call sites
  // (`ProjectCard`, `ProjectListItem`) declare it as a plain inline function,
  // so its identity changed on every render of the card. Any parent re-render
  // therefore re-ran the effect and issued a fresh
  // `GET /projects/<id>/images?limit=1`. Measured on production 2026-09-04:
  // one click on the dashboard sort menu produced 5 duplicate requests for a
  // single card (4 on the next click), and a dashboard page holds up to 10
  // cards. Holding the callback in a ref keeps the latest function without
  // making the fetch depend on its identity, and — unlike stabilising it at
  // the two call sites — cannot be re-broken by a third caller. The ref is
  // synced in a LAYOUT effect rather than during render (React documents a
  // render-phase ref write as unsupported); it still lands before the passive
  // effect below, so the fetch never reads a stale callback.
  const onAccessErrorRef = useRef(onAccessError);
  useLayoutEffect(() => {
    onAccessErrorRef.current = onAccessError;
  }, [onAccessError]);

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
            const response = (error as { response?: { status?: number } })
              .response;
            const status = response?.status;

            if (status === 403 || status === 500) {
              // Access denied or server error - notify parent component
              logger.error(
                `Access error for project ${projectId} thumbnail:`,
                error
              );
              onAccessErrorRef.current?.(projectId, error);
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
