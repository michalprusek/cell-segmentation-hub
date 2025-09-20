/**
 * Real-time Project Card Updates Hook
 *
 * Provides real-time updates for project cards including image counts,
 * segmentation status, and last updated timestamps.
 */

import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '@/contexts/useWebSocket';
import { useAuth } from '@/contexts/useAuth';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import {
  ProjectStats,
  isProjectStatsUpdateMessage,
  isSharedProjectUpdateMessage,
  ProjectStatsUpdateMessage,
  SharedProjectUpdateMessage,
} from '@/types/websocket';

interface UseProjectCardUpdatesProps {
  projectId?: string;
  isShared?: boolean;
  ownerId?: string;
}

interface ProjectCardState {
  stats: ProjectStats | null;
  lastUpdate: Date | null;
  isLoading: boolean;
  error: string | null;
}

export const useProjectCardUpdates = ({
  projectId,
  isShared = false,
  ownerId: _ownerId,
}: UseProjectCardUpdatesProps) => {
  const { manager } = useWebSocket();
  const { user } = useAuth();
  const [state, setState] = useState<ProjectCardState>({
    stats: null,
    lastUpdate: null,
    isLoading: false,
    error: null,
  });

  // Handle project stats updates (for owned projects)
  const handleProjectStatsUpdate = useCallback(
    (data: ProjectStatsUpdateMessage) => {
      if (!projectId || data.projectId !== projectId) return;

      logger.info('Project stats update received', 'useProjectCardUpdates', {
        projectId: data.projectId,
        operation: data.operation,
        stats: data.stats,
      });

      setState(prev => ({
        ...prev,
        stats: data.stats,
        lastUpdate: new Date(),
        error: null,
      }));

      // Show appropriate toast notification based on operation
      switch (data.operation) {
        case 'images_added':
        case 'batch_uploaded': {
          const addedCount = data.affectedImageIds?.length || 0;
          if (addedCount > 0) {
            toast.success(
              `${addedCount} image${addedCount > 1 ? 's' : ''} added to project`
            );
          }
          break;
        }

        case 'images_deleted':
        case 'batch_deleted': {
          const deletedCount = data.affectedImageIds?.length || 0;
          if (deletedCount > 0) {
            toast.success(
              `${deletedCount} image${deletedCount > 1 ? 's' : ''} deleted from project`
            );
          }
          break;
        }

        case 'segmentation_completed':
          toast.success('Segmentation completed');
          break;

        case 'segmentation_failed':
          toast.error('Segmentation failed');
          break;

        default:
          break;
      }
    },
    [projectId]
  );

  // Handle shared project updates (for shared projects)
  const handleSharedProjectUpdate = useCallback(
    (data: SharedProjectUpdateMessage) => {
      if (!projectId || data.projectId !== projectId) return;
      if (!isShared || !user || !data.sharedWithUserIds.includes(user.id))
        return;

      logger.info('Shared project update received', 'useProjectCardUpdates', {
        projectId: data.projectId,
        updateType: data.updateType,
        stats: data.stats,
      });

      setState(prev => ({
        ...prev,
        stats: data.stats,
        lastUpdate: new Date(),
        error: null,
      }));

      // Show subtle notifications for shared project updates
      switch (data.updateType) {
        case 'images_added':
          toast.info('New images added to shared project');
          break;

        case 'images_deleted':
          toast.info('Images removed from shared project');
          break;

        case 'segmentation_completed':
          toast.success('Segmentation completed in shared project');
          break;

        default:
          break;
      }
    },
    [projectId, isShared, user]
  );

  // Handle WebSocket connection errors
  const handleWebSocketError = useCallback(
    (error: Error) => {
      logger.error(
        'WebSocket error in project card updates',
        error,
        'useProjectCardUpdates',
        {
          projectId,
        }
      );

      setState(prev => ({
        ...prev,
        error: error.message,
        isLoading: false,
      }));
    },
    [projectId]
  );

  // Handle WebSocket connection status
  const handleConnectionStatus = useCallback(
    (data: { status: string; reason?: string }) => {
      if (data.status === 'disconnected') {
        setState(prev => ({
          ...prev,
          error: 'Connection lost',
          isLoading: false,
        }));
      } else if (data.status === 'connected') {
        setState(prev => ({
          ...prev,
          error: null,
        }));
      }
    },
    []
  );

  // Set up WebSocket event listeners
  useEffect(() => {
    if (!manager || !projectId) return;

    setState(prev => ({ ...prev, isLoading: true }));

    // Generic event handler for all WebSocket messages
    const handleWebSocketMessage = (event: string, data: any) => {
      try {
        // Handle project stats updates - FIXED: Using camelCase event names
        if (
          event === 'projectStatsUpdate' &&
          isProjectStatsUpdateMessage(data)
        ) {
          handleProjectStatsUpdate(data);
        }
        // Handle shared project updates - FIXED: Using camelCase event names
        else if (
          event === 'sharedProjectUpdate' &&
          isSharedProjectUpdateMessage(data)
        ) {
          handleSharedProjectUpdate(data);
        }
      } catch (error) {
        logger.error(
          'Error handling WebSocket message',
          error instanceof Error ? error : new Error(String(error)),
          'useProjectCardUpdates',
          {
            event,
            projectId,
          }
        );
      }
    };

    // Register event listeners - FIXED: Using camelCase event names to match backend
    manager.on('projectStatsUpdate', data =>
      handleWebSocketMessage('projectStatsUpdate', data)
    );
    manager.on('sharedProjectUpdate', data =>
      handleWebSocketMessage('sharedProjectUpdate', data)
    );
    manager.on('error', handleWebSocketError);
    manager.on('connectionStatus', handleConnectionStatus);

    setState(prev => ({ ...prev, isLoading: false }));

    // Cleanup function - FIXED: Using camelCase event names
    return () => {
      manager.off('projectStatsUpdate', data =>
        handleWebSocketMessage('projectStatsUpdate', data)
      );
      manager.off('sharedProjectUpdate', data =>
        handleWebSocketMessage('sharedProjectUpdate', data)
      );
      manager.off('error', handleWebSocketError);
      manager.off('connectionStatus', handleConnectionStatus);
    };
  }, [
    manager,
    projectId,
    handleProjectStatsUpdate,
    handleSharedProjectUpdate,
    handleWebSocketError,
    handleConnectionStatus,
  ]);

  // Optimistic update function for immediate UI feedback
  const updateOptimistically = useCallback(
    (operation: 'add_images' | 'delete_images', count: number) => {
      setState(prev => {
        if (!prev.stats) return prev;

        const newStats = { ...prev.stats };
        if (operation === 'add_images') {
          newStats.imageCount += count;
        } else if (operation === 'delete_images') {
          newStats.imageCount = Math.max(0, newStats.imageCount - count);
        }
        newStats.lastUpdated = new Date();

        return {
          ...prev,
          stats: newStats,
          lastUpdate: new Date(),
        };
      });

      // Clear optimistic update after 5 seconds (real update should arrive by then)
      setTimeout(() => {
        setState(prev => ({
          ...prev,
          lastUpdate: new Date(),
        }));
      }, 5000);
    },
    []
  );

  return {
    stats: state.stats,
    lastUpdate: state.lastUpdate,
    isLoading: state.isLoading,
    error: state.error,
    updateOptimistically,
  };
};

// Export convenience hook for project cards
export const useProjectStats = (projectId?: string) => {
  return useProjectCardUpdates({ projectId });
};

// Export convenience hook for shared project cards
export const useSharedProjectStats = (projectId?: string, ownerId?: string) => {
  return useProjectCardUpdates({ projectId, isShared: true, ownerId });
};

export default useProjectCardUpdates;
