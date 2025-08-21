import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import apiClient, { SegmentationPolygon } from '@/lib/api';
import { logger } from '@/lib/logger';

interface UseSegmentationReloadProps {
  projectId?: string;
  imageId?: string;
  onPolygonsLoaded?: (polygons: SegmentationPolygon[] | null) => void;
  onDimensionsUpdated?: (dimensions: { width: number; height: number }) => void;
  maxRetries?: number;
}

interface UseSegmentationReloadReturn {
  isReloading: boolean;
  reloadSegmentation: (retryCount?: number) => Promise<boolean>;
  cleanupReloadOperations: () => void;
}

/**
 * Custom hook for managing segmentation data reloading
 * Handles retry logic, abort controllers, and cleanup
 */
export function useSegmentationReload({
  projectId,
  imageId,
  onPolygonsLoaded,
  onDimensionsUpdated,
  maxRetries = 2,
}: UseSegmentationReloadProps): UseSegmentationReloadReturn {
  const { t } = useLanguage();

  // Check for persisted loading state on mount
  const getPersistedLoadingState = () => {
    if (!imageId) return false;
    const storageKey = `segmentation-reload-${imageId}`;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const { timestamp, isLoading } = JSON.parse(stored);
        // Only consider it valid if it's less than 5 minutes old
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        if (timestamp > fiveMinutesAgo && isLoading) {
          return true;
        }
        // Clean up old entry
        localStorage.removeItem(storageKey);
      } catch {
        localStorage.removeItem(storageKey);
      }
    }
    return false;
  };

  const [isReloading, setIsReloading] = useState(getPersistedLoadingState);
  const reloadTimeoutRef = useRef<NodeJS.Timeout>();
  const abortControllerRef = useRef<AbortController>();

  // Persist loading state changes
  useEffect(() => {
    if (!imageId) return;
    const storageKey = `segmentation-reload-${imageId}`;

    if (isReloading) {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          timestamp: Date.now(),
          isLoading: true,
        })
      );
    } else {
      localStorage.removeItem(storageKey);
    }
  }, [isReloading, imageId]);

  /**
   * Cleanup function for timeouts and abort controllers
   */
  const cleanupReloadOperations = useCallback(() => {
    if (reloadTimeoutRef.current) {
      clearTimeout(reloadTimeoutRef.current);
      reloadTimeoutRef.current = undefined;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = undefined;
    }
  }, []);

  /**
   * Fetch segmentation data from API
   */
  const fetchSegmentationData = async (
    signal: AbortSignal
  ): Promise<{
    polygons: SegmentationPolygon[] | null;
    imageWidth?: number;
    imageHeight?: number;
  } | null> => {
    try {
      const data = await apiClient.getSegmentationResults(imageId!, { signal });

      if (signal.aborted) {
        logger.debug('Segmentation fetch was aborted:', { imageId });
        return null;
      }

      if (!data || !data.polygons) {
        logger.debug('No segmentation data found:', imageId);
        return { polygons: null };
      }

      return {
        polygons: data.polygons,
        imageWidth: data.imageWidth,
        imageHeight: data.imageHeight,
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        logger.debug('Segmentation fetch was aborted:', { imageId });
        return null;
      }
      throw error;
    }
  };

  /**
   * Process fetched segmentation data
   */
  const processSegmentationData = (data: {
    polygons: SegmentationPolygon[] | null;
    imageWidth?: number;
    imageHeight?: number;
  }) => {
    // Update dimensions if available
    if (data.imageWidth && data.imageHeight && onDimensionsUpdated) {
      logger.debug('📐 Updating image dimensions from segmentation data:', {
        width: data.imageWidth,
        height: data.imageHeight,
      });
      onDimensionsUpdated({
        width: data.imageWidth,
        height: data.imageHeight,
      });
    }

    // Update polygons
    if (onPolygonsLoaded) {
      if (data.polygons) {
        logger.debug('✅ Successfully loaded segmentation polygons:', {
          imageId,
          polygonCount: data.polygons.length,
        });
      }
      onPolygonsLoaded(data.polygons);
    }
  };

  /**
   * Schedule a retry with exponential backoff
   */
  const scheduleRetry = (retryCount: number, reloadFn: () => void) => {
    const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
    logger.debug(`Retrying segmentation reload in ${delay}ms:`, {
      imageId,
      retryCount: retryCount + 1,
    });

    reloadTimeoutRef.current = setTimeout(reloadFn, delay);
  };

  /**
   * Main reload function with retry logic
   */
  const reloadSegmentation = useCallback(
    async (retryCount = 0): Promise<boolean> => {
      if (!projectId || !imageId) {
        logger.debug('Missing projectId or imageId for segmentation reload');
        return false;
      }

      try {
        // Cleanup any existing operations
        cleanupReloadOperations();

        setIsReloading(true);
        logger.debug('🔄 Reloading segmentation after completion:', {
          imageId,
          retryCount,
        });

        // Create new AbortController for this request
        abortControllerRef.current = new AbortController();

        // Fetch data
        const data = await fetchSegmentationData(
          abortControllerRef.current.signal
        );

        if (!data) {
          setIsReloading(false);
          return false; // Request was aborted
        }

        // Process the data
        processSegmentationData(data);
        setIsReloading(false);
        return true;
      } catch (error: any) {
        setIsReloading(false);
        logger.error('Failed to reload segmentation:', {
          error,
          imageId,
          retryCount,
          maxRetries,
        });

        // Retry logic with exponential backoff
        if (retryCount < maxRetries) {
          scheduleRetry(retryCount, () => {
            reloadSegmentation(retryCount + 1);
          });
          return false;
        }

        // Show error after all retries failed with context
        const errorMessage =
          t('toast.segmentation.reloadFailed') ||
          'Failed to load segmentation results. Please refresh the page.';
        toast.error(
          `${errorMessage} (Image: ${imageId}, Attempts: ${retryCount + 1})`
        );
        return false;
      }
    },
    [
      projectId,
      imageId,
      cleanupReloadOperations,
      onPolygonsLoaded,
      onDimensionsUpdated,
      maxRetries,
      t,
    ]
  );

  // Cleanup on unmount or when dependencies change
  useEffect(() => {
    return () => {
      cleanupReloadOperations();
      // Also clean up localStorage on unmount
      if (imageId) {
        const storageKey = `segmentation-reload-${imageId}`;
        localStorage.removeItem(storageKey);
      }
    };
  }, [imageId, cleanupReloadOperations]);

  return {
    isReloading,
    reloadSegmentation,
    cleanupReloadOperations,
  };
}

export default useSegmentationReload;
