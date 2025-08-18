import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { logger } from '@/lib/logger';

export interface QueueStatusResponse {
  projectId: string;
  queued: number;
  processing: number;
  total: number;
}

/**
 * Hook for polling queue status when WebSocket is not available
 * Only activates when enabled is true (typically when WebSocket is disconnected)
 */
export function useQueueStatusPolling(
  projectId?: string,
  enabled: boolean = false
) {
  return useQuery<QueueStatusResponse, Error>({
    queryKey: ['queue-status', projectId],
    queryFn: async () => {
      if (!projectId) {
        throw new Error('Project ID is required');
      }

      logger.debug('Polling queue status for project:', projectId);

      try {
        const response = await apiClient.get(`/queue/status/${projectId}`);
        return response.data;
      } catch (error) {
        logger.error('Failed to fetch queue status:', error);
        throw error;
      }
    },
    enabled: enabled && !!projectId,
    refetchInterval: 3000, // Poll every 3 seconds
    staleTime: 2000, // Consider data stale after 2 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    retry: (failureCount, error) => {
      // Don't retry on authentication errors
      if (
        error?.message?.includes('401') ||
        error?.message?.includes('unauthorized')
      ) {
        return false;
      }
      // Retry up to 3 times for other errors
      return failureCount < 3;
    },
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
  });
}
