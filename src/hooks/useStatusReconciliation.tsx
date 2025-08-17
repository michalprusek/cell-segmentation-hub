import { useEffect, useRef, useCallback } from 'react';
import { logger } from '@/lib/logger';
import apiClient from '@/lib/api';
import type { ProjectImage } from '@/types';

interface UseStatusReconciliationProps {
  projectId?: string;
  images: ProjectImage[];
  onImagesUpdate: (images: ProjectImage[]) => void;
  queueStats: { processing: number; queued: number } | null;
  isConnected: boolean;
}

/**
 * Hook that provides status reconciliation to ensure UI stays in sync with backend
 * Checks for stale statuses and refreshes when needed
 */
export const useStatusReconciliation = ({
  projectId,
  images,
  onImagesUpdate,
  queueStats,
  isConnected,
}: UseStatusReconciliationProps) => {
  const reconciliationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastReconciliationRef = useRef<number>(0);
  const RECONCILIATION_INTERVAL = 5000; // 5 seconds
  const MIN_RECONCILIATION_DELAY = 2000; // Minimum 2 seconds between reconciliations

  // Check if any images have stale processing status
  const hasStaleProcessingImages = useCallback(() => {
    return images.some(img => {
      // If image is marked as processing but queue has no processing items
      if (
        img.segmentationStatus === 'processing' &&
        queueStats?.processing === 0
      ) {
        return true;
      }

      // If image has been processing for too long (over 5 minutes) without updates
      if (img.segmentationStatus === 'processing' && img.updatedAt) {
        const timeSinceUpdate = Date.now() - new Date(img.updatedAt).getTime();
        return timeSinceUpdate > 300000; // 5 minutes
      }

      return false;
    });
  }, [images, queueStats]);

  // Force refresh of all image statuses from backend
  const reconcileImageStatuses = useCallback(async () => {
    if (!projectId || !isConnected) return;

    const now = Date.now();
    if (now - lastReconciliationRef.current < MIN_RECONCILIATION_DELAY) {
      return; // Too soon since last reconciliation
    }

    try {
      logger.debug('🔄 Reconciling image statuses with backend...');
      lastReconciliationRef.current = now;

      const imagesResponse = await apiClient.getProjectImages(projectId);
      const backendImages = imagesResponse.images;

      // Map backend statuses to our format
      const reconciledImages = images.map(currentImg => {
        const backendImg = backendImages.find(img => img.id === currentImg.id);
        if (!backendImg) return currentImg;

        // Normalize backend status
        let backendStatus =
          backendImg.segmentationStatus || backendImg.segmentation_status;
        if (backendStatus === 'segmented') {
          backendStatus = 'completed';
        }

        // Check if status changed and if it's safe to update
        if (currentImg.segmentationStatus !== backendStatus) {
          // Don't override recently completed or segmented images back to processing
          // If frontend shows 'completed'/'segmented' and backend shows 'processing',
          // and the image was updated recently (within 30 seconds), trust frontend
          const timeSinceUpdate =
            Date.now() - new Date(currentImg.updatedAt || 0).getTime();
          const isRecentlyCompleted =
            (currentImg.segmentationStatus === 'completed' ||
              currentImg.segmentationStatus === 'segmented') &&
            backendStatus === 'processing' &&
            timeSinceUpdate < 30000; // Reduced to 30 seconds

          // Don't revert from completed to processing recently, but allow correction for no_segmentation
          // This allows fixing premature "segmented" status when no polygons exist
          const isStatusDowngrade =
            (currentImg.segmentationStatus === 'completed' ||
              currentImg.segmentationStatus === 'segmented') &&
            (backendStatus === 'processing' || backendStatus === 'queued') &&
            timeSinceUpdate < 30000; // Reduced to 30 seconds, removed no_segmentation

          if (isRecentlyCompleted || isStatusDowngrade) {
            logger.debug(
              `⏭️ Skipping reconciliation: Image ${currentImg.id.slice(0, 8)} recently completed/segmented, not reverting from ${currentImg.segmentationStatus} to ${backendStatus}`
            );
            return currentImg; // Keep current status
          }

          logger.debug(
            `📊 Status reconciliation: Image ${currentImg.id.slice(0, 8)} changed from ${currentImg.segmentationStatus} to ${backendStatus}`
          );

          return {
            ...currentImg,
            segmentationStatus: backendStatus,
            updatedAt: new Date(backendImg.updated_at || backendImg.updatedAt),
          };
        }

        return currentImg;
      });

      // Update images if any changes were found
      const hasChanges = reconciledImages.some(
        (img, index) =>
          img.segmentationStatus !== images[index].segmentationStatus
      );

      if (hasChanges) {
        logger.debug(
          '✅ Status reconciliation found updates, applying changes'
        );
        onImagesUpdate(reconciledImages);
      } else {
        logger.debug('ℹ️ Status reconciliation: No changes needed');
      }
    } catch (error) {
      logger.error('❌ Status reconciliation failed:', error);
    }
  }, [projectId, images, onImagesUpdate, isConnected]);

  // Periodic reconciliation effect
  useEffect(() => {
    // Clear existing timeout
    if (reconciliationTimeoutRef.current) {
      clearTimeout(reconciliationTimeoutRef.current);
    }

    // Only run reconciliation if:
    // 1. We have a project ID and are connected
    // 2. There are images to check
    // 3. Either queue is active or we have stale processing images
    if (!projectId || !isConnected || images.length === 0) {
      return;
    }

    const hasActiveQueue =
      queueStats && (queueStats.processing > 0 || queueStats.queued > 0);

    // Check for stale images inline to avoid dependency issues
    const hasStaleImages = images.some(img => {
      if (
        img.segmentationStatus === 'processing' &&
        queueStats?.processing === 0
      ) {
        return true;
      }
      if (img.segmentationStatus === 'processing' && img.updatedAt) {
        const timeSinceUpdate = Date.now() - new Date(img.updatedAt).getTime();
        return timeSinceUpdate > 300000;
      }
      return false;
    });

    if (hasActiveQueue || hasStaleImages) {
      logger.debug('⏰ Scheduling status reconciliation check');

      reconciliationTimeoutRef.current = setTimeout(() => {
        reconcileImageStatuses();
      }, RECONCILIATION_INTERVAL);
    }

    return () => {
      if (reconciliationTimeoutRef.current) {
        clearTimeout(reconciliationTimeoutRef.current);
      }
    };
  }, [projectId, isConnected, images, queueStats, reconcileImageStatuses]);

  // Trigger reconciliation when queue becomes empty (but with longer delay)
  useEffect(() => {
    if (!queueStats) return;

    const isNowEmpty = queueStats.processing === 0 && queueStats.queued === 0;

    // If queue just became empty, do reconciliation with longer delay
    if (isNowEmpty) {
      logger.debug(
        '🎯 Queue became empty, scheduling delayed status reconciliation'
      );

      // Clear any existing timeout before setting a new one
      if (reconciliationTimeoutRef.current) {
        clearTimeout(reconciliationTimeoutRef.current);
      }

      reconciliationTimeoutRef.current = setTimeout(() => {
        reconcileImageStatuses();
      }, 5000); // Longer delay to let all WebSocket updates arrive and settle
    }
  }, [queueStats, reconcileImageStatuses]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconciliationTimeoutRef.current) {
        clearTimeout(reconciliationTimeoutRef.current);
      }
    };
  }, []);

  return {
    reconcileImageStatuses,
    hasStaleProcessingImages: hasStaleProcessingImages(),
  };
};
