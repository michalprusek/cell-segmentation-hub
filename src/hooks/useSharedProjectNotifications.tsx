/**
 * Shared Project Notifications Hook
 *
 * Handles notifications for users who have access to shared projects.
 * Shows appropriate alerts when shared projects are updated by their owners.
 */

import { useEffect, useCallback } from 'react';
import { useWebSocket } from '@/contexts/useWebSocket';
import { useAuth } from '@/contexts/useAuth';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import {
  isSharedProjectUpdateMessage,
  isUserActivityUpdateMessage,
  SharedProjectUpdateMessage,
  UserActivityUpdateMessage
} from '@/types/websocket';

interface UseSharedProjectNotificationsProps {
  enableToasts?: boolean;
  showOwnerActivity?: boolean;
  quietMode?: boolean;
}

export const useSharedProjectNotifications = ({
  enableToasts = true,
  showOwnerActivity = true,
  quietMode = false
}: UseSharedProjectNotificationsProps = {}) => {
  const { manager } = useWebSocket();
  const { user } = useAuth();

  // Handle shared project updates
  const handleSharedProjectUpdate = useCallback((data: SharedProjectUpdateMessage) => {
    if (!user || !data.sharedWithUserIds.includes(user.id)) return;

    logger.info('Shared project notification received', 'useSharedProjectNotifications', {
      projectId: data.projectId,
      updateType: data.updateType,
      ownerId: data.ownerId
    });

    if (!enableToasts || quietMode) return;

    // Show different notifications based on update type
    switch (data.updateType) {
      case 'images_added':
        toast.info('New images added to shared project', {
          description: `${data.stats.imageCount} total images (${data.stats.segmentedCount} segmented)`,
          action: {
            label: 'View Project',
            onClick: () => {
              // Navigate to project - could be implemented with router
              window.location.href = `/projects/${data.projectId}`;
            }
          }
        });
        break;

      case 'images_deleted':
        toast.info('Images removed from shared project', {
          description: `${data.stats.imageCount} images remaining`,
        });
        break;

      case 'segmentation_completed':
        toast.success('Segmentation completed in shared project', {
          description: `${data.stats.segmentedCount}/${data.stats.imageCount} images processed`,
          action: {
            label: 'View Results',
            onClick: () => {
              window.location.href = `/projects/${data.projectId}`;
            }
          }
        });
        break;

      case 'project_updated':
        toast.info('Shared project has been updated', {
          description: 'Check the project for latest changes'
        });
        break;

      default:
        break;
    }
  }, [user, enableToasts, quietMode]);

  // Handle user activity from project owners (if enabled)
  const handleUserActivity = useCallback((data: UserActivityUpdateMessage) => {
    if (!user || !showOwnerActivity || !enableToasts || quietMode) return;

    // Only show notifications for significant activities
    const { activity } = data;

    switch (activity.type) {
      case 'project_shared':
        if (activity.projectName) {
          toast.success('New project shared with you', {
            description: `You now have access to "${activity.projectName}"`,
            action: {
              label: 'View Project',
              onClick: () => {
                if (activity.projectId) {
                  window.location.href = `/projects/${activity.projectId}`;
                }
              }
            }
          });
        }
        break;

      default:
        // Don't show notifications for other user activities
        break;
    }
  }, [user, showOwnerActivity, enableToasts, quietMode]);

  // Handle WebSocket connection errors
  const handleWebSocketError = useCallback((error: Error) => {
    logger.error('WebSocket error in shared project notifications', error, 'useSharedProjectNotifications');

    if (enableToasts && !quietMode) {
      toast.error('Connection lost', {
        description: 'Shared project updates may be delayed'
      });
    }
  }, [enableToasts, quietMode]);

  // Set up WebSocket event listeners
  useEffect(() => {
    if (!manager || !user) return;

    // Generic event handler for all WebSocket messages
    const handleWebSocketMessage = (event: string, data: any) => {
      try {
        // Handle shared project updates
        if (event === 'shared-project-update' && isSharedProjectUpdateMessage(data)) {
          handleSharedProjectUpdate(data);
        }
        // Handle user activity updates
        else if (event === 'user-activity-update' && isUserActivityUpdateMessage(data)) {
          handleUserActivity(data);
        }
      } catch (error) {
        logger.error('Error handling shared project notification', error instanceof Error ? error : new Error(String(error)), 'useSharedProjectNotifications', {
          event
        });
      }
    };

    // Register event listeners
    manager.on('shared-project-update', (data) => handleWebSocketMessage('shared-project-update', data));
    manager.on('user-activity-update', (data) => handleWebSocketMessage('user-activity-update', data));
    manager.on('error', handleWebSocketError);

    // Cleanup function
    return () => {
      manager.off('shared-project-update', (data) => handleWebSocketMessage('shared-project-update', data));
      manager.off('user-activity-update', (data) => handleWebSocketMessage('user-activity-update', data));
      manager.off('error', handleWebSocketError);
    };
  }, [
    manager,
    user,
    handleSharedProjectUpdate,
    handleUserActivity,
    handleWebSocketError
  ]);

  return {
    // Could return state or methods if needed in the future
    isConnected: manager?.isConnected ?? false
  };
};;

// Export convenience hooks with different configurations
export const useSharedProjectNotificationsQuiet = () => {
  return useSharedProjectNotifications({
    enableToasts: true,
    showOwnerActivity: false,
    quietMode: true
  });
};

export const useSharedProjectNotificationsFull = () => {
  return useSharedProjectNotifications({
    enableToasts: true,
    showOwnerActivity: true,
    quietMode: false
  });
};

export default useSharedProjectNotifications;