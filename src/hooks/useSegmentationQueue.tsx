import { logger } from '@/lib/logger';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/useAuth';
import { useWebSocket } from '@/contexts/useWebSocket';
import { useLanguage } from '@/contexts/useLanguage';
import { toast } from 'sonner';
import WebSocketManager from '@/services/webSocketManager';
import type {
  QueueStats,
  SegmentationUpdate,
  SegmentationStatusMessage as _SegmentationStatusMessage,
  QueueStatsMessage as _QueueStatsMessage,
  SegmentationCompletedMessage as _SegmentationCompletedMessage,
  SegmentationFailedMessage as _SegmentationFailedMessage,
  WebSocketEventMap as _WebSocketEventMap,
  ParallelProcessingStatusMessage as _ParallelProcessingStatusMessage,
  ConcurrentUserMessage as _ConcurrentUserMessage,
  ProcessingStreamUpdateMessage as _ProcessingStreamUpdateMessage,
  QueuePositionUpdateMessage as _QueuePositionUpdateMessage,
} from '@/types/websocket';
import type { ParallelProcessingStats } from '@/components/project/QueueStatsPanel';
import type { ProcessingSlot as _ProcessingSlot } from '@/components/project/ProcessingSlots';

export type { QueueStats, SegmentationUpdate } from '@/types/websocket';
export type { ParallelProcessingStats } from '@/components/project/QueueStatsPanel';

export const useSegmentationQueue = (
  projectId?: string,
  onSegmentationCancelled?: (data: any) => void,
  onBulkSegmentationCancelled?: (data: any) => void,
  onBatchCompleted?: () => void
) => {
  // Check if this hook should be disabled to avoid conflicts
  const isDisabled = projectId === 'DISABLE_GLOBAL';

  const { user, token } = useAuth();
  const { manager: contextManager, isConnected: contextIsConnected } =
    useWebSocket();
  const { t } = useLanguage();
  const wsManagerRef = useRef<WebSocketManager | null>(null);
  const currentProjectRef = useRef<string | undefined>(
    isDisabled ? undefined : projectId
  );
  const _isInitializedRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [lastUpdate, setLastUpdate] = useState<SegmentationUpdate | null>(null);
  const [_parallelStats, _setParallelStats] =
    useState<ParallelProcessingStats | null>(null);

  // Store t function in ref to avoid dependency issues
  const tRef = useRef(t);
  tRef.current = t;

  // Toast throttling state - only show batch start/end notifications
  const batchStateRef = useRef({
    isProcessingBatch: false,
    batchStartTime: 0,
    processedCount: 0,
    totalCount: 0,
    failedCount: 0,
    lastToastTime: 0,
    toastThrottleMs: 2000, // Minimum 2 seconds between similar toasts
    batchToastId: null as string | number | null,
    hasShownStartToast: false,
  });

  // Create stable callback that has access to current t function
  const handleSegmentationUpdate = useCallback((update: SegmentationUpdate) => {
    // ALWAYS set the last update to ensure UI updates occur
    setLastUpdate(update);

    // Debug logging to confirm updates are being propagated
    if (process.env.NODE_ENV === 'development') {
      console.log('🔄 useSegmentationQueue: Setting lastUpdate for image', update.imageId?.slice(0, 8), 'status:', update.status);
    }

    const now = Date.now();
    const batchState = batchStateRef.current;

    // Detect batch processing start - when processing status appears
    if (update.status === 'processing' && !batchState.isProcessingBatch) {
      batchState.isProcessingBatch = true;
      batchState.batchStartTime = now;
      batchState.processedCount = 0;
      batchState.failedCount = 0;
      batchState.hasShownStartToast = false;
      return; // Don't show toast yet, wait for queue stats to determine batch size
    }

    // Track completed/failed images during batch processing
    if (batchState.isProcessingBatch) {
      if (update.status === 'segmented' || update.status === 'completed') {
        batchState.processedCount++;
      } else if (update.status === 'failed') {
        batchState.failedCount++;
      }

      // Don't show individual completion toasts during batch processing
      // But STILL propagate the update for UI changes
      return;
    }

    // For single image operations (not during batch), only show failure notifications
    // Success notifications are suppressed - they will be shown only at batch completion
    if (update.status === 'failed') {
      if (now - batchState.lastToastTime > batchState.toastThrottleMs) {
        const errorMessage = update.error || tRef.current('errors.unknown');
        toast.error(
          `${tRef.current('toast.segmentation.failed') || tRef.current('projects.segmentationFailed')}: ${errorMessage}`
        );
        batchState.lastToastTime = now;
      }
    }
  }, []); // No dependencies

  const handleQueueStatsUpdate = useCallback(
    (stats: QueueStats) => {
      if (
        !currentProjectRef.current ||
        stats.projectId === currentProjectRef.current
      ) {
        setQueueStats(stats);

        const batchState = batchStateRef.current;

        // Show batch start toast when we detect any operation (even single image)
        // But only show the toast for operations with more than 10 items
        if (batchState.isProcessingBatch && !batchState.hasShownStartToast) {
          const totalItems =
            stats.queued + stats.processing + batchState.processedCount;
          batchState.totalCount = totalItems;
          batchState.hasShownStartToast = true;

          // Only show start toast for bulk operations (>10 items)
          if (totalItems > 10) {
            // Dismiss any existing batch toast and show new one
            if (batchState.batchToastId) {
              toast.dismiss(batchState.batchToastId);
            }

            batchState.batchToastId = toast.info(
              tRef.current('toast.segmentation.batchStarted', {
                count: totalItems,
              }) || `Segmentation started for ${totalItems} images`,
              { duration: 4000 }
            );
          }
        }

        // Detect batch completion: when processing batch and queue becomes empty
        if (
          batchState.isProcessingBatch &&
          stats.queued === 0 &&
          stats.processing === 0 &&
          batchState.processedCount > 0
        ) {
          // Dismiss start toast if still showing
          if (batchState.batchToastId) {
            toast.dismiss(batchState.batchToastId);
          }

          // Show batch completion summary - always show, even for single images
          const totalProcessed =
            batchState.processedCount + batchState.failedCount;
          const now = Date.now();
          const duration = Math.round((now - batchState.batchStartTime) / 1000);

          // Only show completion toast if we actually processed something
          if (totalProcessed > 0) {
            if (batchState.failedCount === 0) {
              // For single image, show simpler message
              if (batchState.processedCount === 1) {
                toast.success(
                  tRef.current('toast.segmentation.completed') ||
                    `✅ Segmentation completed`,
                  { duration: 4000 }
                );
              } else {
                // For multiple images, show detailed message
                toast.success(
                  tRef.current('toast.segmentation.batchCompleted', {
                    count: batchState.processedCount,
                    duration: duration,
                  }) ||
                    `✅ ${batchState.processedCount} images segmented successfully (${duration}s)`,
                  { duration: 6000 }
                );
              }
            } else {
              // Show warning if there were any failures
              toast.warning(
                tRef.current('toast.segmentation.batchCompletedWithErrors', {
                  successful: batchState.processedCount,
                  failed: batchState.failedCount,
                  duration: duration,
                }) ||
                  `⚠️ Batch completed: ${batchState.processedCount} successful, ${batchState.failedCount} failed (${duration}s)`,
                { duration: 8000 }
              );
            }
          }

          // *** NEW: Call batch completion callback to refresh gallery ***
          if (onBatchCompleted) {
            try {
              onBatchCompleted();
            } catch (error) {
              logger.error('Error in batch completion callback:', error);
            }
          }

          // Reset batch state
          batchState.isProcessingBatch = false;
          batchState.processedCount = 0;
          batchState.failedCount = 0;
          batchState.totalCount = 0;
          batchState.lastToastTime = now;
          batchState.batchToastId = null;
          batchState.hasShownStartToast = false;
        }
      }
    },
    [onBatchCompleted]
  );

  const handleNotification = useCallback((notification: Notification) => {
    // Individual segmentation-complete notifications are suppressed
    // Only batch completion will show toast notifications
    // Keep this handler for potential future notification types
    if (notification.type === 'segmentation-complete') {
      // Silent - no toast for individual completions
      logger.debug('Segmentation completed for individual image', notification);
    }
  }, []); // No dependencies

  const handleSystemMessage = useCallback((message: SystemMessage) => {
    if (message.type === 'warning') {
      toast.warning(message.message);
    } else if (message.type === 'error') {
      toast.error(message.message);
    } else {
      toast.info(message.message);
    }
  }, []);

  // Update current project reference when projectId changes
  useEffect(() => {
    currentProjectRef.current = isDisabled ? undefined : projectId;
  }, [projectId, isDisabled]);

  // Update connection status based on context and request initial stats
  useEffect(() => {
    setIsConnected(contextIsConnected);

    // When connection is established, immediately request queue stats
    if (
      contextIsConnected &&
      wsManagerRef.current &&
      projectId &&
      !isDisabled
    ) {
      if (process.env.NODE_ENV === 'development') {
        logger.debug(
          'Connection established, requesting initial queue stats for project:',
          projectId
        );
      }
      wsManagerRef.current.requestQueueStats(projectId);
    }
  }, [contextIsConnected, projectId, isDisabled]);

  // Initialize event listeners - use context manager if available, fallback to singleton
  useEffect(() => {
    // Don't setup event listeners if this hook is disabled
    if (isDisabled) {
      return;
    }

    if (process.env.NODE_ENV === 'development' && projectId) {
      // Only log for project-specific instances, not global ones
      logger.debug('useSegmentationQueue - setting up event listeners');
    }

    if (!user || !token) {
      if (process.env.NODE_ENV === 'development') {
        logger.debug(
          'useSegmentationQueue - no auth, cleaning up event listeners'
        );
      }
      if (wsManagerRef.current) {
        const manager = wsManagerRef.current;
        manager.off('segmentation-update', handleSegmentationUpdate);
        manager.off('queue-stats-update', handleQueueStatsUpdate);
        manager.off('notification', handleNotification);
        manager.off('system-message', handleSystemMessage);

        // Also cleanup cancellation handlers
        if (onSegmentationCancelled) {
          manager.off('segmentation:cancelled', onSegmentationCancelled);
        }
        if (onBulkSegmentationCancelled) {
          manager.off(
            'segmentation:bulk-cancelled',
            onBulkSegmentationCancelled
          );
        }

        wsManagerRef.current = null;
      }
      return;
    }

    // Use context manager if available, otherwise get singleton instance
    const manager = contextManager || WebSocketManager.getInstance();
    wsManagerRef.current = manager;

    // Register event listeners
    manager.on('segmentation-update', handleSegmentationUpdate);
    manager.on('queue-stats-update', handleQueueStatsUpdate);
    manager.on('notification', handleNotification);
    manager.on('system-message', handleSystemMessage);

    // Register cancellation event handlers if provided
    if (onSegmentationCancelled) {
      manager.on('segmentation:cancelled', onSegmentationCancelled);
    }
    if (onBulkSegmentationCancelled) {
      manager.on('segmentation:bulk-cancelled', onBulkSegmentationCancelled);
    }

    if (process.env.NODE_ENV === 'development' && projectId) {
      // Only log for project-specific instances, not global ones
      logger.debug('useSegmentationQueue - event listeners registered');
    }

    // Cleanup function - only unregister listeners
    return () => {
      if (process.env.NODE_ENV === 'development') {
        logger.debug('useSegmentationQueue - cleaning up event listeners');
      }

      if (manager) {
        manager.off('segmentation-update', handleSegmentationUpdate);
        manager.off('queue-stats-update', handleQueueStatsUpdate);
        manager.off('notification', handleNotification);
        manager.off('system-message', handleSystemMessage);

        // Cleanup cancellation event handlers if provided
        if (onSegmentationCancelled) {
          manager.off('segmentation:cancelled', onSegmentationCancelled);
        }
        if (onBulkSegmentationCancelled) {
          manager.off(
            'segmentation:bulk-cancelled',
            onBulkSegmentationCancelled
          );
        }
      }
    };
  }, [
    user,
    token,
    contextManager,
    isDisabled,
    handleSegmentationUpdate,
    handleQueueStatsUpdate,
    handleNotification,
    handleSystemMessage,
    onSegmentationCancelled,
    onBulkSegmentationCancelled,
  ]);

  // Join project room when projectId changes and connection is ready
  useEffect(() => {
    if (isDisabled || !wsManagerRef.current || !isConnected || !projectId) {
      return;
    }

    if (process.env.NODE_ENV === 'development') {
      // Log with context to distinguish between multiple instances
      logger.debug(
        `Joining project room${!projectId ? ' (global)' : ''}: ${projectId || 'N/A'}`
      );
    }
    wsManagerRef.current.joinProject(projectId);

    // Request queue stats immediately and set up periodic refresh
    wsManagerRef.current.requestQueueStats(projectId);

    // Request queue stats every 5 seconds to ensure we have fresh data
    const intervalId = setInterval(() => {
      if (wsManagerRef.current && isConnected && projectId) {
        wsManagerRef.current.requestQueueStats(projectId);
      }
    }, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [projectId, isConnected, isDisabled]);

  // Functions for interacting with the queue
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

        // Update ref first to prevent race condition
        currentProjectRef.current = newProjectId;

        // Then join new project and request stats
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
    parallelStats: _parallelStats,
    requestQueueStats,
    joinProject,
    leaveProject,
  };
};
