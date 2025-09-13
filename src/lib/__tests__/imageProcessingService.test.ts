import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { updateImageProcessingStatus } from '../imageProcessingService';
import { getErrorMessage, type SegmentationData } from '@/types';

// Mock dependencies
vi.mock('@/lib/api', () => ({
  default: {
    requestBatchSegmentation: vi.fn(),
    getSegmentationResults: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/types', () => ({
  getErrorMessage: vi.fn(error => error?.message || 'Unknown error'),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

// Import mocked dependencies
import apiClient from '@/lib/api';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

describe('ImageProcessingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('updateImageProcessingStatus', () => {
    const defaultParams = {
      projectId: 'project1',
      imageId: 'image1',
      imageUrl: 'https://example.com/image.jpg',
    };

    test('should successfully submit segmentation request', async () => {
      (apiClient.requestBatchSegmentation as any).mockResolvedValue({
        id: 'batch1',
        status: 'queued',
      });

      (apiClient.getSegmentationResults as any).mockResolvedValue({
        polygons: [
          {
            status: 'completed',
            polygons: [
              {
                id: 'poly1',
                points: [
                  { x: 0, y: 0 },
                  { x: 100, y: 100 },
                ],
                type: 'external',
              },
            ],
          },
        ],
      });

      const result = await updateImageProcessingStatus(defaultParams);

      expect(apiClient.requestBatchSegmentation).toHaveBeenCalledWith([
        'image1',
      ]);
      expect(toast.success).toHaveBeenCalledWith(
        'Segmentation request submitted'
      );
      expect(result).toHaveProperty('cancel');
      expect(typeof result.cancel).toBe('function');
    });

    test('should handle segmentation request failure', async () => {
      const error = new Error('Network error');
      (apiClient.requestBatchSegmentation as any).mockRejectedValue(error);

      const mockOnError = vi.fn();
      const result = await updateImageProcessingStatus({
        ...defaultParams,
        onError: mockOnError,
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Error requesting segmentation:',
        error
      );
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to process image: Network error'
      );
      expect(mockOnError).toHaveBeenCalledWith(error);
      expect(result).toHaveProperty('cancel');
    });

    test('should poll for completion and call onComplete when successful', async () => {
      (apiClient.requestBatchSegmentation as any).mockResolvedValue({
        id: 'batch1',
        status: 'queued',
      });

      const mockSegmentationData = {
        polygons: [
          {
            status: 'completed',
            polygons: [
              {
                id: 'poly1',
                points: [
                  { x: 0, y: 0 },
                  { x: 100, y: 100 },
                ],
                type: 'external',
              },
            ],
          },
        ],
      };

      (apiClient.getSegmentationResults as any).mockResolvedValue(
        mockSegmentationData
      );

      const mockOnComplete = vi.fn();
      await updateImageProcessingStatus({
        ...defaultParams,
        onComplete: mockOnComplete,
      });

      // Fast-forward timers to trigger polling
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      expect(apiClient.getSegmentationResults).toHaveBeenCalledWith('image1');
      expect(toast.success).toHaveBeenCalledWith(
        'Image segmentation completed'
      );
      expect(mockOnComplete).toHaveBeenCalledWith({
        polygons: mockSegmentationData.polygons[0].polygons,
      });
    });

    test('should handle failed segmentation result', async () => {
      (apiClient.requestBatchSegmentation as any).mockResolvedValue({
        id: 'batch1',
        status: 'queued',
      });

      (apiClient.getSegmentationResults as any).mockResolvedValue({
        polygons: [
          {
            status: 'failed',
            error: 'Processing failed',
          },
        ],
      });

      const mockOnError = vi.fn();
      await updateImageProcessingStatus({
        ...defaultParams,
        onError: mockOnError,
      });

      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      expect(toast.error).toHaveBeenCalledWith('Segmentation failed');
      expect(mockOnError).toHaveBeenCalledWith(
        new Error('Segmentation failed')
      );
    });

    test('should continue polling while processing', async () => {
      (apiClient.requestBatchSegmentation as any).mockResolvedValue({
        id: 'batch1',
        status: 'queued',
      });

      (apiClient.getSegmentationResults as any)
        .mockResolvedValueOnce({
          polygons: [{ status: 'processing' }],
        })
        .mockResolvedValueOnce({
          polygons: [{ status: 'pending' }],
        })
        .mockResolvedValue({
          polygons: [
            {
              status: 'completed',
              polygons: [{ id: 'poly1', points: [], type: 'external' }],
            },
          ],
        });

      const mockOnComplete = vi.fn();
      await updateImageProcessingStatus({
        ...defaultParams,
        onComplete: mockOnComplete,
      });

      // First poll - processing
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      // Second poll - still pending
      vi.advanceTimersByTime(2000);
      await vi.runAllTimersAsync();

      // Third poll - completed
      vi.advanceTimersByTime(2000);
      await vi.runAllTimersAsync();

      expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(3);
      expect(mockOnComplete).toHaveBeenCalledTimes(1);
    });

    test('should continue polling when no results yet', async () => {
      (apiClient.requestBatchSegmentation as any).mockResolvedValue({
        id: 'batch1',
        status: 'queued',
      });

      (apiClient.getSegmentationResults as any)
        .mockResolvedValueOnce(null) // No results yet
        .mockResolvedValueOnce({ polygons: [] }) // Empty polygons
        .mockResolvedValue({
          polygons: [
            {
              status: 'completed',
              polygons: [{ id: 'poly1', points: [], type: 'external' }],
            },
          ],
        });

      const mockOnComplete = vi.fn();
      await updateImageProcessingStatus({
        ...defaultParams,
        onComplete: mockOnComplete,
      });

      // First poll - null result
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      // Second poll - empty polygons
      vi.advanceTimersByTime(2000);
      await vi.runAllTimersAsync();

      // Third poll - completed
      vi.advanceTimersByTime(2000);
      await vi.runAllTimersAsync();

      expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(3);
      expect(mockOnComplete).toHaveBeenCalledTimes(1);
    });

    test('should handle polling errors gracefully', async () => {
      (apiClient.requestBatchSegmentation as any).mockResolvedValue({
        id: 'batch1',
        status: 'queued',
      });

      const pollingError = new Error('Polling failed');
      (apiClient.getSegmentationResults as any).mockRejectedValue(pollingError);

      const mockOnError = vi.fn();
      await updateImageProcessingStatus({
        ...defaultParams,
        onError: mockOnError,
      });

      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      expect(logger.error).toHaveBeenCalledWith(
        'Error polling segmentation status:',
        pollingError
      );
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to check segmentation status'
      );
      expect(mockOnError).toHaveBeenCalledWith(pollingError);
    });

    test('should handle no segmentation result found', async () => {
      (apiClient.requestBatchSegmentation as any).mockResolvedValue({
        id: 'batch1',
        status: 'queued',
      });

      (apiClient.getSegmentationResults as any).mockResolvedValue({
        polygons: [null], // Invalid result
      });

      const mockOnError = vi.fn();
      await updateImageProcessingStatus({
        ...defaultParams,
        onError: mockOnError,
      });

      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      expect(logger.error).toHaveBeenCalledWith('No segmentation result found');
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to get segmentation result'
      );
      expect(mockOnError).toHaveBeenCalledWith(
        new Error('No segmentation result found')
      );
    });

    test('should cancel polling when cancel function is called', async () => {
      (apiClient.requestBatchSegmentation as any).mockResolvedValue({
        id: 'batch1',
        status: 'queued',
      });

      (apiClient.getSegmentationResults as any).mockResolvedValue({
        polygons: [{ status: 'processing' }],
      });

      const mockOnComplete = vi.fn();
      const result = await updateImageProcessingStatus({
        ...defaultParams,
        onComplete: mockOnComplete,
      });

      // Cancel before polling starts
      result.cancel();

      vi.advanceTimersByTime(5000);
      await vi.runAllTimersAsync();

      // Should not have called the API or completed
      expect(apiClient.getSegmentationResults).not.toHaveBeenCalled();
      expect(mockOnComplete).not.toHaveBeenCalled();
    });

    test('should handle cancellation during polling', async () => {
      (apiClient.requestBatchSegmentation as any).mockResolvedValue({
        id: 'batch1',
        status: 'queued',
      });

      let pollCount = 0;
      (apiClient.getSegmentationResults as any).mockImplementation(async () => {
        pollCount++;
        if (pollCount === 1) {
          return { polygons: [{ status: 'processing' }] };
        }
        // This should not be reached due to cancellation
        return { polygons: [{ status: 'completed', polygons: [] }] };
      });

      const mockOnComplete = vi.fn();
      const result = await updateImageProcessingStatus({
        ...defaultParams,
        onComplete: mockOnComplete,
      });

      // Start first poll
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      // Cancel after first poll
      result.cancel();

      // Try to advance more - should not trigger additional polls
      vi.advanceTimersByTime(5000);
      await vi.runAllTimersAsync();

      expect(pollCount).toBe(1);
      expect(mockOnComplete).not.toHaveBeenCalled();
    });

    test('should ignore responses after cancellation', async () => {
      (apiClient.requestBatchSegmentation as any).mockResolvedValue({
        id: 'batch1',
        status: 'queued',
      });

      let resolveGetResults: (value: any) => void;
      (apiClient.getSegmentationResults as any).mockImplementation(() => {
        return new Promise(resolve => {
          resolveGetResults = resolve;
        });
      });

      const mockOnComplete = vi.fn();
      const result = await updateImageProcessingStatus({
        ...defaultParams,
        onComplete: mockOnComplete,
      });

      // Start polling
      vi.advanceTimersByTime(1000);

      // Cancel while request is in flight
      result.cancel();

      // Resolve the request after cancellation
      resolveGetResults({
        polygons: [
          {
            status: 'completed',
            polygons: [{ id: 'poly1', points: [], type: 'external' }],
          },
        ],
      });

      await vi.runAllTimersAsync();

      // Should not call onComplete since cancelled
      expect(mockOnComplete).not.toHaveBeenCalled();
    });

    test('should handle non-Error exceptions in onError callback', async () => {
      const error = 'String error';
      (apiClient.requestBatchSegmentation as any).mockRejectedValue(error);

      const mockOnError = vi.fn();
      await updateImageProcessingStatus({
        ...defaultParams,
        onError: mockOnError,
      });

      // onError should receive the error wrapped as an Error object for consistency
      expect(mockOnError).toHaveBeenCalledWith(expect.any(Error));
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to process image: String error'
      );
    });

    test('should handle polling with non-Error exceptions', async () => {
      (apiClient.requestBatchSegmentation as any).mockResolvedValue({
        id: 'batch1',
        status: 'queued',
      });

      const nonError = 'String error';
      (apiClient.getSegmentationResults as any).mockRejectedValue(nonError);

      const mockOnError = vi.fn();
      await updateImageProcessingStatus({
        ...defaultParams,
        onError: mockOnError,
      });

      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      // onError should receive the error wrapped as an Error object for consistency
      expect(mockOnError).toHaveBeenCalledWith(expect.any(Error));
      expect(logger.error).toHaveBeenCalledWith(
        'Error polling segmentation status:',
        nonError
      );
    });

    test('should handle edge case with undefined polygons', async () => {
      (apiClient.requestBatchSegmentation as any).mockResolvedValue({
        id: 'batch1',
        status: 'queued',
      });

      (apiClient.getSegmentationResults as any).mockResolvedValue({
        polygons: [
          {
            status: 'completed',
            polygons: undefined, // Edge case
          },
        ],
      });

      const mockOnComplete = vi.fn();
      await updateImageProcessingStatus({
        ...defaultParams,
        onComplete: mockOnComplete,
      });

      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      expect(mockOnComplete).toHaveBeenCalledWith({
        polygons: [],
      });
    });

    test('should use correct polling intervals', async () => {
      (apiClient.requestBatchSegmentation as any).mockResolvedValue({
        id: 'batch1',
        status: 'queued',
      });

      (apiClient.getSegmentationResults as any)
        .mockResolvedValueOnce({ polygons: [{ status: 'processing' }] })
        .mockResolvedValue({
          polygons: [
            {
              status: 'completed',
              polygons: [{ id: 'poly1', points: [], type: 'external' }],
            },
          ],
        });

      await updateImageProcessingStatus(defaultParams);

      // Initial delay should be 1 second
      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000);

      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      // Subsequent polls should be every 2 seconds
      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 2000);
    });

    test('should properly clean up timeouts on completion', async () => {
      (apiClient.requestBatchSegmentation as any).mockResolvedValue({
        id: 'batch1',
        status: 'queued',
      });

      (apiClient.getSegmentationResults as any).mockResolvedValue({
        polygons: [
          {
            status: 'completed',
            polygons: [{ id: 'poly1', points: [], type: 'external' }],
          },
        ],
      });

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const result = await updateImageProcessingStatus(defaultParams);

      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      // Cancel should clean up any remaining timeouts
      result.cancel();
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });
});
