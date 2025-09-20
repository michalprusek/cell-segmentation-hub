/**
 * Real-time Dashboard Metrics Hook
 *
 * Provides real-time updates for dashboard metrics including project counts,
 * image statistics, processing queue status, and storage information.
 */

import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '@/contexts/useWebSocket';
import { useAuth } from '@/contexts/useAuth';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import {
  DashboardMetrics,
  isDashboardMetricsUpdateMessage,
  isUserActivityUpdateMessage,
  DashboardMetricsUpdateMessage,
  UserActivityUpdateMessage,
} from '@/types/websocket';

interface UseDashboardMetricsProps {
  enableNotifications?: boolean;
  notificationThreshold?: number; // Minimum change to show notification
}

interface DashboardState {
  metrics: DashboardMetrics | null;
  lastUpdate: Date | null;
  isLoading: boolean;
  error: string | null;
  recentActivity: UserActivityUpdateMessage['activity'][];
}

export const useDashboardMetrics = ({
  enableNotifications = true,
  notificationThreshold = 1,
}: UseDashboardMetricsProps = {}) => {
  const { manager } = useWebSocket();
  const { user } = useAuth();
  const [state, setState] = useState<DashboardState>({
    metrics: null,
    lastUpdate: null,
    isLoading: false,
    error: null,
    recentActivity: [],
  });

  // Store previous values for comparison
  const [previousMetrics, setPreviousMetrics] =
    useState<DashboardMetrics | null>(null);

  // Handle dashboard metrics updates
  const handleDashboardMetricsUpdate = useCallback(
    (data: DashboardMetricsUpdateMessage) => {
      if (!user) return;

      logger.info('Dashboard metrics update received', 'useDashboardMetrics', {
        userId: user.id,
        changedFields: data.changedFields,
        metrics: data.metrics,
      });

      setState(prev => ({
        ...prev,
        metrics: data.metrics,
        lastUpdate: new Date(data.timestamp),
        error: null,
      }));

      // Show notifications for significant changes
      if (enableNotifications && previousMetrics) {
        const changes: string[] = [];

        // Check for significant changes in key metrics
        if (data.changedFields.includes('totalImages')) {
          const diff = data.metrics.totalImages - previousMetrics.totalImages;
          if (Math.abs(diff) >= notificationThreshold) {
            changes.push(`${diff > 0 ? '+' : ''}${diff} images`);
          }
        }

        if (data.changedFields.includes('totalSegmented')) {
          const diff =
            data.metrics.totalSegmented - previousMetrics.totalSegmented;
          if (Math.abs(diff) >= notificationThreshold) {
            changes.push(`${diff > 0 ? '+' : ''}${diff} segmented`);
          }
        }

        if (data.changedFields.includes('totalProjects')) {
          const diff =
            data.metrics.totalProjects - previousMetrics.totalProjects;
          if (Math.abs(diff) >= notificationThreshold) {
            changes.push(`${diff > 0 ? '+' : ''}${diff} projects`);
          }
        }

        // Show subtle notification for significant changes
        if (changes.length > 0) {
          toast.info(`Dashboard updated: ${changes.join(', ')}`);
        }
      }

      // Update previous metrics for next comparison
      setPreviousMetrics(data.metrics);
    },
    [user, enableNotifications, previousMetrics, notificationThreshold]
  );

  // Handle user activity updates
  const handleUserActivityUpdate = useCallback(
    (data: UserActivityUpdateMessage) => {
      if (!user) return;

      logger.info('User activity update received', 'useDashboardMetrics', {
        userId: user.id,
        activity: data.activity,
      });

      setState(prev => ({
        ...prev,
        recentActivity: [data.activity, ...prev.recentActivity.slice(0, 9)], // Keep last 10 activities
        lastUpdate: new Date(data.timestamp),
      }));

      // Show notifications for important activities
      if (enableNotifications) {
        switch (data.activity.type) {
          case 'project_created':
            toast.success(
              `New project created: ${data.activity.projectName || 'Unknown'}`
            );
            break;

          case 'images_uploaded': {
            const uploadCount = data.activity.details.count || 0;
            if (uploadCount >= notificationThreshold) {
              toast.success(`${uploadCount} images uploaded`);
            }
            break;
          }

          case 'segmentation_completed':
            if (data.activity.details.success) {
              toast.success('Segmentation completed successfully');
            } else {
              toast.error('Segmentation failed');
            }
            break;

          case 'images_deleted': {
            const deleteCount = data.activity.details.count || 0;
            if (deleteCount >= notificationThreshold) {
              toast.info(`${deleteCount} images deleted`);
            }
            break;
          }

          default:
            break;
        }
      }
    },
    [user, enableNotifications, notificationThreshold]
  );

  // Handle WebSocket connection errors
  const handleWebSocketError = useCallback((error: Error) => {
    logger.error(
      'WebSocket error in dashboard metrics',
      error,
      'useDashboardMetrics'
    );

    setState(prev => ({
      ...prev,
      error: error.message,
      isLoading: false,
    }));
  }, []);

  // Handle WebSocket connection status
  const handleConnectionStatus = useCallback(
    (data: { status: string; reason?: string }) => {
      if (data.status === 'disconnected') {
        setState(prev => ({
          ...prev,
          error: 'Connection lost - metrics may be outdated',
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
    if (!manager || !user) return;

    setState(prev => ({ ...prev, isLoading: true }));

    // Generic event handler for all WebSocket messages
    const handleWebSocketMessage = (event: string, data: any) => {
      try {
        // Handle dashboard metrics updates
        if (
          event === 'dashboard-metrics-update' &&
          isDashboardMetricsUpdateMessage(data)
        ) {
          handleDashboardMetricsUpdate(data);
        }
        // Handle user activity updates
        else if (
          event === 'user-activity-update' &&
          isUserActivityUpdateMessage(data)
        ) {
          handleUserActivityUpdate(data);
        }
      } catch (error) {
        logger.error(
          'Error handling WebSocket message',
          error instanceof Error ? error : new Error(String(error)),
          'useDashboardMetrics',
          {
            event,
          }
        );
      }
    };

    // Register event listeners
    manager.on('dashboard-metrics-update', data =>
      handleWebSocketMessage('dashboard-metrics-update', data)
    );
    manager.on('user-activity-update', data =>
      handleWebSocketMessage('user-activity-update', data)
    );
    manager.on('error', handleWebSocketError);
    manager.on('connectionStatus', handleConnectionStatus);

    setState(prev => ({ ...prev, isLoading: false }));

    // Cleanup function
    return () => {
      manager.off('dashboard-metrics-update', data =>
        handleWebSocketMessage('dashboard-metrics-update', data)
      );
      manager.off('user-activity-update', data =>
        handleWebSocketMessage('user-activity-update', data)
      );
      manager.off('error', handleWebSocketError);
      manager.off('connectionStatus', handleConnectionStatus);
    };
  }, [
    manager,
    user,
    handleDashboardMetricsUpdate,
    handleUserActivityUpdate,
    handleWebSocketError,
    handleConnectionStatus,
  ]);

  // Refresh metrics manually (useful for initial load or retry)
  const refreshMetrics = useCallback(async () => {
    if (!user) return;

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // This would typically trigger a refresh from the backend
      // For now, we'll just emit a request through WebSocket if available
      if (manager) {
        // Could emit a request for fresh metrics here
        logger.info('Manual metrics refresh requested', 'useDashboardMetrics', {
          userId: user.id,
        });
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        error:
          error instanceof Error ? error.message : 'Failed to refresh metrics',
        isLoading: false,
      }));
    }
  }, [user, manager]);

  // Format metrics for display
  const formattedMetrics = useCallback((metrics: DashboardMetrics | null) => {
    if (!metrics) return null;

    return {
      ...metrics,
      storageFormatted: {
        totalSize:
          metrics.storageStats.totalStorageGB >= 1
            ? `${metrics.storageStats.totalStorageGB} GB`
            : `${metrics.storageStats.totalStorageMB} MB`,
        averageImageSize: `${metrics.storageStats.averageImageSizeMB} MB`,
        efficiency:
          metrics.totalImages > 0
            ? Math.round((metrics.totalSegmented / metrics.totalImages) * 100)
            : 0,
      },
      activitySummary: {
        totalToday:
          metrics.recentActivity.imagesUploadedToday +
          metrics.recentActivity.segmentationsCompletedToday,
        uploadTrend:
          metrics.recentActivity.imagesUploadedToday > 0 ? 'up' : 'stable',
        segmentationTrend:
          metrics.recentActivity.segmentationsCompletedToday > 0
            ? 'up'
            : 'stable',
      },
    };
  }, []);

  return {
    metrics: state.metrics,
    formattedMetrics: formattedMetrics(state.metrics),
    recentActivity: state.recentActivity,
    lastUpdate: state.lastUpdate,
    isLoading: state.isLoading,
    error: state.error,
    refreshMetrics,
  };
};

// Export convenience hook with default settings
export const useDashboardStats = () => {
  return useDashboardMetrics({
    enableNotifications: true,
    notificationThreshold: 1,
  });
};

// Export convenience hook with minimal notifications
export const useDashboardStatsQuiet = () => {
  return useDashboardMetrics({
    enableNotifications: false,
  });
};

export default useDashboardMetrics;
