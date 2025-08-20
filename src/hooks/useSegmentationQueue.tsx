import { logger } from '@/lib/logger';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import WebSocketManager from '@/services/webSocketManager';
import type {
  QueueStats,
  SegmentationUpdate,
} from '@/services/webSocketManager';

interface Notification {
  type: string;
  imageId: string;
  projectId: string;
  polygonCount: number;
  timestamp: string;
}

interface SystemMessage {
  type: 'info' | 'warning' | 'error';
  message: string;
  timestamp: string;
}

export type { QueueStats, SegmentationUpdate };

export const useSegmentationQueue = (projectId?: string) => {
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
  const isInitializedRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [lastUpdate, setLastUpdate] = useState<SegmentationUpdate | null>(null);

  // Store t function in ref to avoid dependency issues
  const tRef = useRef(t);
  tRef.current = t;

  // Create stable callback that has access to current t function
  const handleSegmentationUpdate = useCallback((update: SegmentationUpdate) => {
    setLastUpdate(update);

    // Show toast notifications for status changes
    if (update.status === 'segmented') {
      toast.success(
        tRef.current('notifications.segmentationCompleted') ||
          tRef.current('segmentationCompleted')
      );
    } else if (update.status === 'no_segmentation') {
      toast.warning(
        tRef.current('segmentationNoPolygons') ||
          'No segmentation polygons detected'
      );
    } else if (update.status === 'failed') {
      toast.error(
        `${tRef.current('segmentationFailed')}: ${update.error || tRef.current('errors.unknown')}`
      );
    } else if (update.status === 'processing') {
      toast.info(tRef.current('segmentationStarted'));
    }
  }, []); // No dependencies

  const handleQueueStatsUpdate = useCallback((stats: QueueStats) => {
    if (
      !currentProjectRef.current ||
      stats.projectId === currentProjectRef.current
    ) {
      setQueueStats(stats);
    }
  }, []);

  const handleNotification = useCallback((notification: Notification) => {
    if (notification.type === 'segmentation-complete') {
      toast.success(
        tRef.current('segmentationCompleteWithCount', {
          count: notification.polygonCount,
        }),
        { duration: 5000 }
      );
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

  // Update connection status based on context
  useEffect(() => {
    setIsConnected(contextIsConnected);
  }, [contextIsConnected]);

  // Initialize event listeners - use context manager if available, fallback to singleton
  useEffect(() => {
    // Don't setup event listeners if this hook is disabled
    if (isDisabled) {
      return;
    }

    if (process.env.NODE_ENV === 'development') {
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

    if (process.env.NODE_ENV === 'development') {
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
  ]);

  // Join project room when projectId changes and connection is ready
  useEffect(() => {
    if (isDisabled || !wsManagerRef.current || !isConnected || !projectId) {
      return;
    }

    if (process.env.NODE_ENV === 'development') {
      logger.debug('Joining project room:', projectId);
    }
    wsManagerRef.current.joinProject(projectId);
    wsManagerRef.current.requestQueueStats(projectId);
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
    requestQueueStats,
    joinProject,
    leaveProject,
  };
};
