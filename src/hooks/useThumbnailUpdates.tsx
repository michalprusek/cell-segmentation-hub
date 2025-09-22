import { useEffect, useCallback } from 'react';
import { useWebSocket } from '@/contexts/useWebSocket';
import { thumbnailCache } from '@/lib/thumbnailCache';
import { logger } from '@/lib/logger';

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

interface UseThumbnailUpdatesProps {
  projectId?: string;
  onThumbnailUpdate?: (update: ThumbnailUpdateData) => void;
  enabled?: boolean;
}

export const useThumbnailUpdates = ({
  projectId,
  onThumbnailUpdate,
  enabled = true,
}: UseThumbnailUpdatesProps) => {
  const { socket, isConnected } = useWebSocket();

  // Handle thumbnail update from WebSocket
  const handleThumbnailUpdate = useCallback(
    (data: ThumbnailUpdateData) => {
      if (!enabled) return;

      logger.debug('🔄 Received thumbnail update via WebSocket', {
        imageId: data.imageId,
        projectId: data.projectId,
        levelOfDetail: data.thumbnailData.levelOfDetail,
        polygonCount: data.thumbnailData.polygonCount,
      });

      // Update cache with new thumbnail data
      thumbnailCache
        .set(data.imageId, data.thumbnailData.levelOfDetail, data.thumbnailData)
        .catch(error => {
          logger.error(
            'Failed to cache thumbnail update',
            error instanceof Error ? error : new Error(String(error)),
            'useThumbnailUpdates'
          );
        });

      // Trigger callback if provided
      if (onThumbnailUpdate) {
        onThumbnailUpdate(data);
      }
    },
    [enabled, onThumbnailUpdate]
  );

  // Set up WebSocket listeners
  useEffect(() => {
    if (!socket || !isConnected || !enabled) return;

    // Join project room if projectId is provided
    if (projectId) {
      socket.emit('join-project', projectId);
      logger.debug('🏠 Joined project room for thumbnail updates', {
        projectId,
      });
    }

    // Listen for thumbnail updates
    socket.on('thumbnail:updated', handleThumbnailUpdate);

    return () => {
      socket.off('thumbnail:updated', handleThumbnailUpdate);

      if (projectId) {
        socket.emit('leave-project', projectId);
        logger.debug('🚪 Left project room', { projectId });
      }
    };
  }, [socket, isConnected, projectId, enabled, handleThumbnailUpdate]);

  return {
    isConnected,
    isEnabled: enabled,
  };
};

export default useThumbnailUpdates;
