import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStatusReconciliation } from '@/hooks/useStatusReconciliation';
import type { ProjectImage } from '@/types';

vi.mock('@/lib/api', () => ({
  default: {
    getProjectImages: vi.fn(),
  },
  apiClient: {
    getProjectImages: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import apiClient from '@/lib/api';

const makeImage = (
  id: string,
  segmentationStatus: string,
  overrides: Partial<ProjectImage> = {}
): ProjectImage => ({
  id,
  name: `image-${id}.jpg`,
  url: `http://localhost:3001/images/${id}.jpg`,
  thumbnailUrl: `http://localhost:3001/thumbs/${id}.jpg`,
  displayUrl: `http://localhost:3001/images/${id}.jpg`,
  originalPath: `/uploads/${id}.jpg`,
  thumbnailPath: `/thumbs/${id}.jpg`,
  segmentationStatus: segmentationStatus as ProjectImage['segmentationStatus'],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

const defaultProps = {
  projectId: 'proj-1',
  images: [] as ProjectImage[],
  onImagesUpdate: vi.fn(),
  queueStats: null as { processing: number; queued: number } | null,
  isConnected: true,
};

describe('useStatusReconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('hasStaleProcessingImages', () => {
    it('returns true when image is processing but queue shows 0 processing', () => {
      const images = [makeImage('img-1', 'processing')];

      const { result } = renderHook(() =>
        useStatusReconciliation({
          ...defaultProps,
          images,
          queueStats: { processing: 0, queued: 0 },
        })
      );

      expect(result.current.hasStaleProcessingImages).toBe(true);
    });

    it('returns false when image is processing and queue also shows processing', () => {
      // Use a fresh updatedAt to avoid the 5-minute stale timeout condition
      const recentlyUpdated = new Date(Date.now() - 10000); // 10 seconds ago
      const images = [makeImage('img-1', 'processing', { updatedAt: recentlyUpdated })];

      const { result } = renderHook(() =>
        useStatusReconciliation({
          ...defaultProps,
          images,
          queueStats: { processing: 1, queued: 0 },
        })
      );

      expect(result.current.hasStaleProcessingImages).toBe(false);
    });

    it('returns true when image has been processing for over 5 minutes', () => {
      const staleTime = new Date(Date.now() - 310000); // 310 seconds ago
      const images = [makeImage('img-1', 'processing', { updatedAt: staleTime })];

      const { result } = renderHook(() =>
        useStatusReconciliation({
          ...defaultProps,
          images,
          queueStats: { processing: 1, queued: 0 },
        })
      );

      expect(result.current.hasStaleProcessingImages).toBe(true);
    });

    it('returns false when no images are processing', () => {
      const images = [makeImage('img-1', 'completed'), makeImage('img-2', 'pending')];

      const { result } = renderHook(() =>
        useStatusReconciliation({
          ...defaultProps,
          images,
          queueStats: { processing: 0, queued: 0 },
        })
      );

      expect(result.current.hasStaleProcessingImages).toBe(false);
    });
  });

  describe('reconcileImageStatuses', () => {
    it('fetches backend images and updates changed statuses', async () => {
      const onImagesUpdate = vi.fn();
      const images = [makeImage('img-1', 'processing')];

      vi.mocked(apiClient.getProjectImages).mockResolvedValue({
        images: [
          {
            id: 'img-1',
            segmentationStatus: 'completed',
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const { result } = renderHook(() =>
        useStatusReconciliation({
          ...defaultProps,
          images,
          onImagesUpdate,
          queueStats: { processing: 0, queued: 0 },
        })
      );

      await act(async () => {
        await result.current.reconcileImageStatuses();
      });

      expect(vi.mocked(apiClient.getProjectImages)).toHaveBeenCalledWith('proj-1');
      expect(onImagesUpdate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'img-1', segmentationStatus: 'completed' }),
        ])
      );
    });

    it('does not call onImagesUpdate when no statuses changed', async () => {
      const onImagesUpdate = vi.fn();
      const images = [makeImage('img-1', 'completed')];

      vi.mocked(apiClient.getProjectImages).mockResolvedValue({
        images: [
          {
            id: 'img-1',
            segmentationStatus: 'completed',
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const { result } = renderHook(() =>
        useStatusReconciliation({
          ...defaultProps,
          images,
          onImagesUpdate,
          queueStats: { processing: 0, queued: 0 },
        })
      );

      await act(async () => {
        await result.current.reconcileImageStatuses();
      });

      expect(onImagesUpdate).not.toHaveBeenCalled();
    });

    it('normalizes backend "segmented" status to "completed"', async () => {
      const onImagesUpdate = vi.fn();
      const images = [makeImage('img-1', 'processing')];

      vi.mocked(apiClient.getProjectImages).mockResolvedValue({
        images: [
          {
            id: 'img-1',
            segmentationStatus: 'segmented',
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const { result } = renderHook(() =>
        useStatusReconciliation({
          ...defaultProps,
          images,
          onImagesUpdate,
          queueStats: { processing: 0, queued: 0 },
        })
      );

      await act(async () => {
        await result.current.reconcileImageStatuses();
      });

      expect(onImagesUpdate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'img-1', segmentationStatus: 'completed' }),
        ])
      );
    });

    it('does not revert recently completed images back to processing', async () => {
      const onImagesUpdate = vi.fn();
      // Completed just 5 seconds ago
      const recentlyCompleted = new Date(Date.now() - 5000);
      const images = [makeImage('img-1', 'completed', { updatedAt: recentlyCompleted })];

      vi.mocked(apiClient.getProjectImages).mockResolvedValue({
        images: [
          {
            id: 'img-1',
            segmentationStatus: 'processing',
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const { result } = renderHook(() =>
        useStatusReconciliation({
          ...defaultProps,
          images,
          onImagesUpdate,
          queueStats: { processing: 1, queued: 0 },
        })
      );

      await act(async () => {
        await result.current.reconcileImageStatuses();
      });

      // Should not downgrade recently completed image back to processing
      expect(onImagesUpdate).not.toHaveBeenCalled();
    });

    it('skips reconciliation when not connected', async () => {
      const images = [makeImage('img-1', 'processing')];

      const { result } = renderHook(() =>
        useStatusReconciliation({
          ...defaultProps,
          images,
          isConnected: false,
          queueStats: { processing: 0, queued: 0 },
        })
      );

      await act(async () => {
        await result.current.reconcileImageStatuses();
      });

      expect(vi.mocked(apiClient.getProjectImages)).not.toHaveBeenCalled();
    });

    it('skips reconciliation when projectId is missing', async () => {
      const images = [makeImage('img-1', 'processing')];

      const { result } = renderHook(() =>
        useStatusReconciliation({
          ...defaultProps,
          projectId: undefined,
          images,
          queueStats: { processing: 0, queued: 0 },
        })
      );

      await act(async () => {
        await result.current.reconcileImageStatuses();
      });

      expect(vi.mocked(apiClient.getProjectImages)).not.toHaveBeenCalled();
    });

    it('handles API errors gracefully without crashing', async () => {
      const onImagesUpdate = vi.fn();
      const images = [makeImage('img-1', 'processing')];

      vi.mocked(apiClient.getProjectImages).mockRejectedValue(new Error('API error'));

      const { result } = renderHook(() =>
        useStatusReconciliation({
          ...defaultProps,
          images,
          onImagesUpdate,
          queueStats: { processing: 0, queued: 0 },
        })
      );

      // Should not throw
      await act(async () => {
        await result.current.reconcileImageStatuses();
      });

      expect(onImagesUpdate).not.toHaveBeenCalled();
    });
  });

  describe('throttling', () => {
    it('ignores rapid successive calls within MIN_RECONCILIATION_DELAY', async () => {
      const onImagesUpdate = vi.fn();
      const images = [makeImage('img-1', 'processing')];

      vi.mocked(apiClient.getProjectImages).mockResolvedValue({
        images: [
          {
            id: 'img-1',
            segmentationStatus: 'completed',
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const { result } = renderHook(() =>
        useStatusReconciliation({
          ...defaultProps,
          images,
          onImagesUpdate,
          queueStats: { processing: 0, queued: 0 },
        })
      );

      // First call succeeds
      await act(async () => {
        await result.current.reconcileImageStatuses();
      });

      const firstCallCount = vi.mocked(apiClient.getProjectImages).mock.calls.length;

      // Second immediate call should be throttled
      await act(async () => {
        await result.current.reconcileImageStatuses();
      });

      // API should not have been called again within the throttle window
      expect(vi.mocked(apiClient.getProjectImages).mock.calls.length).toBe(firstCallCount);
    });

    it('schedules reconciliation via setTimeout when stale images exist', async () => {
      const images = [makeImage('img-1', 'processing')];

      renderHook(() =>
        useStatusReconciliation({
          ...defaultProps,
          images,
          queueStats: { processing: 0, queued: 0 },
        })
      );

      // Advance timers to trigger the scheduled reconciliation
      vi.mocked(apiClient.getProjectImages).mockResolvedValue({
        images: [{ id: 'img-1', segmentationStatus: 'processing', updated_at: new Date().toISOString() }],
      });

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(vi.mocked(apiClient.getProjectImages)).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('clears timeout on unmount', () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const images = [makeImage('img-1', 'processing')];

      vi.mocked(apiClient.getProjectImages).mockResolvedValue({ images: [] });

      const { unmount } = renderHook(() =>
        useStatusReconciliation({
          ...defaultProps,
          images,
          queueStats: { processing: 0, queued: 0 },
        })
      );

      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });
});
