import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/useAuth';
import { useWebSocket } from '@/contexts/useWebSocket';
import { useLanguage } from '@/contexts/useLanguage';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { logger } from '@/lib/logger';
import { thumbnailCache } from '@/lib/thumbnailCache';
import WebSocketManager from '@/services/webSocketManager';
import type {
  QueueStats,
  SegmentationUpdate,
  WebSocketEventMap as _WebSocketEventMap,
} from '@/types/websocket';

interface ThumbnailUpdateData {
  imageId: string;
  projectId: string;
  segmentationId: string;
  thumbnailData: {
    levelOfDetail: 'low' | 'medium' | 'high';
    polygons: any[];
    polygonCount: number;
    pointCount: number;
    compressionRatio: number;
  };
}

interface UnifiedUpdateData {
  imageId: string;
  projectId: string;
  status: string;
  segmentationResult?: any;
  thumbnailData?: any;
  error?: string;
}

interface UseUnifiedSegmentationUpdateProps {
  projectId?: string;
  onImageUpdate?: (update: UnifiedUpdateData) => void;
  enabled?: boolean;
}

/**
 * Unified hook for handling all segmentation-related updates:
 * - Status changes via WebSocket
 * - Thumbnail updates via WebSocket
 * - Automatic segmentation data fetching
 * - Toast notifications
 * - Queue statistics
 */
export const useUnifiedSegmentationUpdate = ({
  projectId,
  onImageUpdate,
  enabled = true,
}: UseUnifiedSegmentationUpdateProps) => {
  const { user, token } = useAuth();
  const { manager: contextManager, isConnected: contextIsConnected } =
    useWebSocket();
  const { t } = useLanguage();

  const wsManagerRef = useRef<WebSocketManager | null>(null);
  const currentProjectRef = useRef<string | undefined>(projectId);
  const tRef = useRef(t);
  const [isConnected, setIsConnected] = useState(false);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [lastUpdate, setLastUpdate] = useState<SegmentationUpdate | null>(null);

  // Track pending segmentation data fetches to prevent duplicates
  const pendingFetchesRef = useRef<Set<string>>(new Set());

  // Update refs
  tRef.current = t;
  currentProjectRef.current = enabled ? projectId : undefined;

  /**
   * Fetch full segmentation data for a completed image
   */
  const fetchSegmentationData = useCallback(
    async (imageId: string): Promise<any> => {
      if (pendingFetchesRef.current.has(imageId)) {
        logger.debug(
          `🔄 Segmentation fetch already in progress for ${imageId.slice(0, 8)}`
        );
        return null;
      }

      try {
        pendingFetchesRef.current.add(imageId);
        logger.debug(
          `📥 Fetching segmentation data for completed image ${imageId.slice(0, 8)}`
        );

        const segmentationData =
          await apiClient.getSegmentationResults(imageId);

        if (segmentationData) {
          logger.debug(
            `✅ Successfully fetched segmentation data for ${imageId.slice(0, 8)}`,
            {
              polygonCount: segmentationData.polygons?.length || 0,
              dimensions: `${segmentationData.imageWidth}x${segmentationData.imageHeight}`,
            }
          );
        }

        return segmentationData;
      } catch (error) {
        logger.warn(
          `⚠️ Failed to fetch segmentation data for ${imageId.slice(0, 8)}:`,
          error
        );
        return null;
      } finally {
        pendingFetchesRef.current.delete(imageId);
      }
    },
    []
  );

  /**
   * Handle segmentation status updates from WebSocket
   */
  const handleSegmentationUpdate = useCallback(
    async (update: SegmentationUpdate & { segmentationResult?: any }) => {
      if (
        !enabled ||
        !currentProjectRef.current ||
        update.projectId !== currentProjectRef.current
      ) {
        return;
      }

      // ENHANCED DEBUG LOGGING
      logger.warn(
        `🔵 UNIFIED HOOK Processing update for ${update.imageId.slice(0, 8)}`,
        {
          status: update.status,
          projectId: update.projectId,
          hasSegmentationResult: !!update.segmentationResult,
          segmentationResultKeys: update.segmentationResult
            ? Object.keys(update.segmentationResult)
            : [],
          polygonCount: update.segmentationResult?.polygonCount,
          timestamp: new Date().toISOString(),
        }
      );

      setLastUpdate(update);

      // Prepare unified update data - check if segmentation result is already included
      const unifiedUpdate: UnifiedUpdateData = {
        imageId: update.imageId,
        projectId: update.projectId,
        status: update.status,
        error: update.error,
        segmentationResult: update.segmentationResult, // Use included result if available
      };

      // Only fetch data if not already included in the update
      if (
        (update.status === 'completed' || update.status === 'segmented') &&
        !update.segmentationResult
      ) {
        const segmentationData = await fetchSegmentationData(update.imageId);
        if (segmentationData) {
          unifiedUpdate.segmentationResult = segmentationData;
        }
      }

      // Trigger callback with unified update FIRST
      if (onImageUpdate) {
        onImageUpdate(unifiedUpdate);
      }

      // Show toast notifications AFTER data update
      if (update.status === 'completed' || update.status === 'segmented') {
        // Show success toast with polygon count if available
        const polygonCount =
          unifiedUpdate.segmentationResult?.polygonCount ||
          update.segmentationResult?.polygonCount;
        if (polygonCount !== undefined) {
          toast.success(
            tRef.current('toast.segmentation.completedWithCount', {
              count: polygonCount,
            }) || `Segmentation completed: ${polygonCount} polygons detected`,
            { duration: 5000 }
          );
        } else {
          toast.success(
            tRef.current('toast.segmentation.completed') ||
              tRef.current('projects.segmentationCompleted')
          );
        }
      } else if (update.status === 'no_polygons') {
        toast.warning(
          tRef.current('toast.segmentation.noPolygons') ||
            'No segmentation polygons detected'
        );
      } else if (update.status === 'failed') {
        const errorMessage = update.error || tRef.current('errors.unknown');
        toast.error(
          `${tRef.current('toast.segmentation.failed') || tRef.current('projects.segmentationFailed')}: ${errorMessage}`
        );
      } else if (update.status === 'processing') {
        toast.info(
          tRef.current('toast.segmentation.started') ||
            tRef.current('projects.segmentationStarted')
        );
      }
    },
    [enabled, onImageUpdate, fetchSegmentationData]
  );

  /**
   * Handle thumbnail updates from WebSocket
   */
  const handleThumbnailUpdate = useCallback(
    async (thumbnailUpdate: ThumbnailUpdateData) => {
      if (
        !enabled ||
        !currentProjectRef.current ||
        thumbnailUpdate.projectId !== currentProjectRef.current
      ) {
        return;
      }

      logger.debug(
        `🖼️ Processing thumbnail update for ${thumbnailUpdate.imageId.slice(0, 8)}`,
        {
          levelOfDetail: thumbnailUpdate.thumbnailData.levelOfDetail,
          polygonCount: thumbnailUpdate.thumbnailData.polygonCount,
        }
      );

      // Update thumbnail cache
      try {
        await thumbnailCache.set(
          thumbnailUpdate.imageId,
          thumbnailUpdate.thumbnailData.levelOfDetail,
          thumbnailUpdate.thumbnailData
        );
      } catch (error) {
        logger.error(
          'Failed to cache thumbnail update',
          error instanceof Error ? error : new Error(String(error)),
          'useUnifiedSegmentationUpdate'
        );
      }

      // Create unified update with thumbnail data
      const unifiedUpdate: UnifiedUpdateData = {
        imageId: thumbnailUpdate.imageId,
        projectId: thumbnailUpdate.projectId,
        status: 'completed', // Thumbnails only come for completed segmentations
        thumbnailData: thumbnailUpdate.thumbnailData,
        segmentationResult: {
          polygons: thumbnailUpdate.thumbnailData.polygons,
          polygonCount: thumbnailUpdate.thumbnailData.polygonCount,
          pointCount: thumbnailUpdate.thumbnailData.pointCount,
          compressionRatio: thumbnailUpdate.thumbnailData.compressionRatio,
          levelOfDetail: thumbnailUpdate.thumbnailData.levelOfDetail,
        },
      };

      // Trigger callback with thumbnail update
      if (onImageUpdate) {
        onImageUpdate(unifiedUpdate);
      }
    },
    [enabled, onImageUpdate]
  );

  /**
   * Handle queue statistics updates
   */
  const handleQueueStatsUpdate = useCallback((stats: QueueStats) => {
    if (
      currentProjectRef.current &&
      stats.projectId === currentProjectRef.current
    ) {
      setQueueStats(stats);
    }
  }, []);

  /**
   * Handle notifications
   */
  const handleNotification = useCallback((notification: any) => {
    if (notification.type === 'segmentation-complete') {
      toast.success(
        tRef.current('toast.segmentation.completedWithCount', {
          count: notification.polygonCount,
        }) ||
          tRef.current('projects.segmentationCompleteWithCount', {
            count: notification.polygonCount,
          }),
        { duration: 5000 }
      );
    }
  }, []);

  /**
   * Handle system messages
   */
  const handleSystemMessage = useCallback((message: any) => {
    if (message.type === 'warning') {
      toast.warning(message.message);
    } else if (message.type === 'error') {
      toast.error(message.message);
    } else {
      toast.info(message.message);
    }
  }, []);

  // Update connection status based on context
  useEffect(() => {
    setIsConnected(contextIsConnected);
  }, [contextIsConnected]);

  // Setup WebSocket event listeners
  useEffect(() => {
    if (!enabled || !user || !token) {
      if (wsManagerRef.current) {
        const manager = wsManagerRef.current;
        manager.off('segmentation-update', handleSegmentationUpdate);
        manager.off('thumbnail:updated', handleThumbnailUpdate);
        manager.off('queueStats', handleQueueStatsUpdate);
        manager.off('notification', handleNotification);
        manager.off('system-message', handleSystemMessage);
        wsManagerRef.current = null;
      }
      return;
    }

    // Use context manager if available, otherwise get singleton instance
    const manager = contextManager || WebSocketManager.getInstance();
    wsManagerRef.current = manager;

    // Register all event listeners
    manager.on('segmentation-update', handleSegmentationUpdate);
    manager.on('thumbnail:updated', handleThumbnailUpdate);
    manager.on('queueStats', handleQueueStatsUpdate);
    manager.on('notification', handleNotification);
    manager.on('system-message', handleSystemMessage);

    if (process.env.NODE_ENV === 'development') {
      logger.debug('useUnifiedSegmentationUpdate - event listeners registered');
    }

    // Cleanup function
    return () => {
      if (process.env.NODE_ENV === 'development') {
        logger.debug(
          'useUnifiedSegmentationUpdate - cleaning up event listeners'
        );
      }

      if (manager) {
        manager.off('segmentation-update', handleSegmentationUpdate);
        manager.off('thumbnail:updated', handleThumbnailUpdate);
        manager.off('queueStats', handleQueueStatsUpdate);
        manager.off('notification', handleNotification);
        manager.off('system-message', handleSystemMessage);
      }
    };
  }, [
    user,
    token,
    contextManager,
    enabled,
    handleSegmentationUpdate,
    handleThumbnailUpdate,
    handleQueueStatsUpdate,
    handleNotification,
    handleSystemMessage,
  ]);

  // Join project room when projectId changes and connection is ready
  useEffect(() => {
    if (!enabled || !wsManagerRef.current || !isConnected || !projectId) {
      return;
    }

    if (process.env.NODE_ENV === 'development') {
      logger.debug('Joining project room for unified updates:', projectId);
    }

    // Capture the projectId for cleanup
    const currentProjectId = projectId;

    wsManagerRef.current.joinProject(currentProjectId);
    wsManagerRef.current.requestQueueStats(currentProjectId);

    // Cleanup function to leave the project on unmount or when projectId changes
    return () => {
      if (wsManagerRef.current && currentProjectId) {
        if (process.env.NODE_ENV === 'development') {
          logger.debug('Leaving project room:', currentProjectId);
        }
        wsManagerRef.current.leaveProject(currentProjectId);
      }
    };
  }, [projectId, isConnected, enabled]);

  // Functions for external control
  const requestQueueStats = useCallback(() => {
    if (wsManagerRef.current && isConnected && projectId) {
      wsManagerRef.current.requestQueueStats(projectId);
    }
  }, [isConnected, projectId]);

  const joinProject = useCallback(
    (newProjectId: string) => {
      if (wsManagerRef.current && isConnected) {
        // Leave current project if any
        if (currentProjectRef.current) {
          wsManagerRef.current.leaveProject(currentProjectRef.current);
        }

        // Update ref and join new project
        currentProjectRef.current = newProjectId;
        wsManagerRef.current.joinProject(newProjectId);
        wsManagerRef.current.requestQueueStats(newProjectId);
      }
    },
    [isConnected]
  );

  const leaveProject = useCallback(() => {
    if (wsManagerRef.current && isConnected && currentProjectRef.current) {
      wsManagerRef.current.leaveProject(currentProjectRef.current);
      setQueueStats(null);
      currentProjectRef.current = undefined;
    }
  }, [isConnected]);

  return {
    isConnected,
    queueStats,
    lastUpdate,
    requestQueueStats,
    joinProject,
    leaveProject,
  };
};

export default useUnifiedSegmentationUpdate;
