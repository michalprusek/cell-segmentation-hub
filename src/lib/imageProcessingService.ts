import apiClient from '@/lib/api';
import type { SegmentationData } from '@/types';
import { toast } from 'sonner';
import { getErrorMessage } from '@/types';
import { logger } from '@/lib/logger';

interface ProcessImageParams {
  projectId: string;
  imageId: string;
  imageUrl: string;
  model?: string;
  threshold?: number;
  detectHoles?: boolean;
  onComplete?: (result: SegmentationData) => void;
  onError?: (error: Error) => void;
}

export const updateImageProcessingStatus = async ({
  projectId,
  imageId,
  imageUrl,
  model,
  threshold,
  detectHoles,
  onComplete,
  onError,
}: ProcessImageParams) => {
  const abortController = new AbortController();
  let timeoutId: NodeJS.Timeout | null = null;
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    abortController.abort();
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  try {
    // Request segmentation through the batch API (more efficient)
    await apiClient.requestBatchSegmentation(
      [imageId],
      model,
      threshold,
      detectHoles
    );

    toast.success('Segmentation request submitted');

    // Poll for completion (in a real app, you might use WebSockets or Server-Sent Events)
    const pollForCompletion = async () => {
      if (cancelled) return;

      try {
        const segmentationData =
          await apiClient.getSegmentationResults(imageId);

        if (cancelled) return;

        // Validate that segmentation data exists and has polygons
        if (
          !segmentationData ||
          !Array.isArray(segmentationData.polygons) ||
          segmentationData.polygons.length === 0
        ) {
          // No results yet, continue polling
          if (!cancelled) {
            timeoutId = setTimeout(pollForCompletion, 2000); // Poll every 2 seconds
          }
          return;
        }

        const results = segmentationData.polygons;

        const latestResult = results[0]; // Now safe to access after validation

        if (latestResult?.status === 'completed') {
          toast.success('Image segmentation completed');

          // Call the onComplete callback with the result if provided
          if (onComplete && latestResult) {
            // Convert API result to expected format
            const segmentationData: SegmentationData = {
              polygons: latestResult.polygons || [],
              // Add other expected properties as needed
            };
            onComplete(segmentationData);
          }
          return;
        } else if (latestResult?.status === 'failed') {
          const error = new Error('Segmentation failed');
          toast.error('Segmentation failed');
          if (onError) {
            onError(error);
          }
          return;
        }

        // If still processing, poll again after a delay
        if (
          latestResult?.status === 'processing' ||
          latestResult?.status === 'pending'
        ) {
          if (!cancelled) {
            timeoutId = setTimeout(pollForCompletion, 2000); // Poll every 2 seconds
          }
        } else if (!latestResult) {
          const error = new Error('No segmentation result found');
          logger.error('No segmentation result found');
          toast.error('Failed to get segmentation result');
          if (onError) {
            onError(error);
          }
        }
      } catch (error) {
        if (!cancelled) {
          logger.error('Error polling segmentation status:', error);
          toast.error('Failed to check segmentation status');
          if (onError && error instanceof Error) {
            onError(error);
          }
        }
      }
    };

    // Start polling
    if (!cancelled) {
      timeoutId = setTimeout(pollForCompletion, 1000); // Initial delay of 1 second
    }

    return { cancel };
  } catch (error: unknown) {
    logger.error('Error requesting segmentation:', error);
    const errorMessage = getErrorMessage(error) || 'Failed to process image';
    toast.error('Failed to process image: ' + errorMessage);
    if (onError && error instanceof Error) {
      onError(error);
    }
    return { cancel };
  }
};
