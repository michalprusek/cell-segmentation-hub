import { useEffect, useCallback } from 'react';
import { useWebSocket } from '@/contexts/exports';
import { logger } from '@/lib/logger';

interface ThumbnailUpdateData {
  imageId: string;
  thumbnailData: {
    levelOfDetail: number;
    url?: string;
  };
}

interface UseThumbnailUpdatesOptions {
  projectId?: string;
  enabled?: boolean;
  onThumbnailUpdate?: (update: ThumbnailUpdateData) => void;
}

/**
 * Hook for handling real-time thumbnail updates via WebSocket
 * Listens for thumbnail generation events and notifies components
 */
export const useThumbnailUpdates = ({
  projectId,
  enabled = true,
  onThumbnailUpdate,
}: UseThumbnailUpdatesOptions) => {
  const { socket, isConnected } = useWebSocket();

  const handleThumbnailUpdate = useCallback(
    (data: ThumbnailUpdateData) => {
      if (!enabled || !projectId) return;

      logger.debug('Thumbnail update received', 'useThumbnailUpdates', {
        projectId,
        imageId: data.imageId,
        levelOfDetail: data.thumbnailData.levelOfDetail,
      });

      onThumbnailUpdate?.(data);
    },
    [enabled, projectId, onThumbnailUpdate]
  );

  useEffect(() => {
    if (!socket || !isConnected || !enabled || !projectId) {
      return;
    }

    // Listen for thumbnail update events
    const eventName = `thumbnailUpdate:${projectId}`;
    socket.on(eventName, handleThumbnailUpdate);

    // Also listen for generic thumbnail updates
    socket.on('thumbnailUpdate', handleThumbnailUpdate);

    logger.debug(
      'Thumbnail update listener registered',
      'useThumbnailUpdates',
      {
        projectId,
        eventName,
      }
    );

    return () => {
      socket.off(eventName, handleThumbnailUpdate);
      socket.off('thumbnailUpdate', handleThumbnailUpdate);

      logger.debug(
        'Thumbnail update listener unregistered',
        'useThumbnailUpdates',
        {
          projectId,
          eventName,
        }
      );
    };
  }, [socket, isConnected, enabled, projectId, handleThumbnailUpdate]);

  return {
    isConnected,
    enabled: enabled && !!projectId,
  };
};
