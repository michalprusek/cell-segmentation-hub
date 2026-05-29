/**
 * Tests for race condition handling in useProjectData hook.
 * Verifies that status is preserved correctly during segmentation data refresh.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useProjectData } from '../useProjectData';
import apiClient from '@/lib/api';
import { performanceMonitor } from '@/lib/performanceMonitor';

// Mock dependencies
vi.mock('@/lib/api');
vi.mock('@/lib/performanceMonitor');
vi.mock('@/lib/logger');
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));
// Stable t function reference to prevent useEffect infinite re-runs
const stableT = (key: string) => key;
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: stableT,
  }),
}));
vi.mock('@/contexts/useAuth', () => ({
  useAuth: () => ({
    signOut: vi.fn(),
  }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe('useProjectData - Race Condition Handling', () => {
  const mockProjectId = 'test-project-id';
  const mockUserId = 'test-user-id';
  const mockImageId = 'test-image-id';

  const mockProject = { id: mockProjectId, name: 'Test Project' };
  // The hook normalizes 'segmented' → 'completed' in its status mapping
  const makeMockImage = (status: string) => ({
    id: mockImageId,
    name: 'test.jpg',
    url: 'http://test.jpg',
    segmentationStatus: status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Status Override Prevention', () => {
    it('should NOT change status to no_segmentation when data fetch fails', async () => {
      (apiClient.getProject as any).mockResolvedValue(mockProject);
      (apiClient.getProjectImagesWithThumbnails as any).mockResolvedValue({
        images: [makeMockImage('segmented')],
        total: 1,
      });
      // Always returns null — simulates fetch failure (retries 3 times)
      (apiClient.getSegmentationResults as any).mockResolvedValue(null);

      const { result } = renderHook(() =>
        useProjectData(mockProjectId, mockUserId)
      );

      await waitFor(() => expect(result.current.loading).toBe(false), {
        timeout: 5000,
      });

      // Hook normalizes 'segmented' → 'completed'
      expect(result.current.images).toHaveLength(1);
      expect(result.current.images[0].segmentationStatus).toBe('completed');

      // Run refresh with real timers (retry delays: 500 + 1000 + 2000 = 3.5s)
      await act(async () => {
        await result.current.refreshImageSegmentation(mockImageId);
      });

      // CRITICAL: status must remain 'completed' — must NOT become 'no_segmentation'
      expect(result.current.images[0].segmentationStatus).toBe('completed');
      expect(result.current.images[0].segmentationStatus).not.toBe(
        'no_segmentation'
      );
    }, 15000);

    it('should retry multiple times before giving up', async () => {
      const mockSegmentationData = {
        polygons: [
          {
            points: [
              [0, 0],
              [100, 0],
              [100, 100],
              [0, 100],
            ],
          },
        ],
        imageWidth: 1024,
        imageHeight: 768,
      };

      (apiClient.getProject as any).mockResolvedValue(mockProject);
      (apiClient.getProjectImagesWithThumbnails as any).mockResolvedValue({
        images: [makeMockImage('segmented')],
        total: 1,
      });
      // Fail first two, succeed on third
      (apiClient.getSegmentationResults as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockSegmentationData);

      (performanceMonitor.recordDatabaseFetch as any) = vi.fn();

      const { result } = renderHook(() =>
        useProjectData(mockProjectId, mockUserId)
      );

      await waitFor(() => expect(result.current.loading).toBe(false), {
        timeout: 5000,
      });

      // Run refresh with real timers (max retry delay = 500 + 1000 = 1.5s since 3rd attempt succeeds)
      await act(async () => {
        await result.current.refreshImageSegmentation(mockImageId);
      });

      // 3 calls: 1 initial + 2 retries
      expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(3);

      expect(performanceMonitor.recordDatabaseFetch).toHaveBeenCalledWith(
        mockImageId,
        expect.any(Number),
        false,
        0
      );
      expect(performanceMonitor.recordDatabaseFetch).toHaveBeenCalledWith(
        mockImageId,
        expect.any(Number),
        false,
        1
      );
      expect(performanceMonitor.recordDatabaseFetch).toHaveBeenCalledWith(
        mockImageId,
        expect.any(Number),
        true,
        2
      );

      expect(result.current.images[0].segmentationResult).toEqual({
        polygons: mockSegmentationData.polygons,
        imageWidth: mockSegmentationData.imageWidth,
        imageHeight: mockSegmentationData.imageHeight,
        modelUsed: undefined,
        confidence: undefined,
        processingTime: undefined,
      });
      // Status stays 'completed' (normalized from original 'segmented')
      expect(result.current.images[0].segmentationStatus).toBe('completed');
    }, 10000);

    it('should handle successful data fetch on first attempt', async () => {
      const mockSegmentationData = {
        polygons: [
          {
            points: [
              [0, 0],
              [100, 0],
              [100, 100],
              [0, 100],
            ],
          },
        ],
        imageWidth: 1024,
        imageHeight: 768,
        modelUsed: 'hrnet',
        confidence: 0.95,
        processingTime: 1.2,
      };

      (apiClient.getProject as any).mockResolvedValue(mockProject);
      (apiClient.getProjectImagesWithThumbnails as any).mockResolvedValue({
        images: [makeMockImage('segmented')],
        total: 1,
      });
      (apiClient.getSegmentationResults as any).mockResolvedValue(
        mockSegmentationData
      );
      (performanceMonitor.recordDatabaseFetch as any) = vi.fn();

      const { result } = renderHook(() =>
        useProjectData(mockProjectId, mockUserId)
      );

      await waitFor(() => expect(result.current.loading).toBe(false), {
        timeout: 5000,
      });

      // First attempt succeeds — no retry delay
      await act(async () => {
        await result.current.refreshImageSegmentation(mockImageId);
      });

      // Should only call once (no retries needed)
      expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(1);
      expect(performanceMonitor.recordDatabaseFetch).toHaveBeenCalledWith(
        mockImageId,
        expect.any(Number),
        true,
        0
      );
      expect(result.current.images[0].segmentationResult).toMatchObject({
        polygons: mockSegmentationData.polygons,
        imageWidth: mockSegmentationData.imageWidth,
        imageHeight: mockSegmentationData.imageHeight,
        modelUsed: mockSegmentationData.modelUsed,
        confidence: mockSegmentationData.confidence,
        processingTime: mockSegmentationData.processingTime,
      });
      expect(result.current.images[0].segmentationStatus).toBe('completed');
    }, 10000);

    it('should not change status for images without segmentation results', async () => {
      (apiClient.getProject as any).mockResolvedValue(mockProject);
      (apiClient.getProjectImagesWithThumbnails as any).mockResolvedValue({
        images: [makeMockImage('no_segmentation')],
        total: 1,
      });
      (apiClient.getSegmentationResults as any).mockResolvedValue(null);

      const { result } = renderHook(() =>
        useProjectData(mockProjectId, mockUserId)
      );

      await waitFor(() => expect(result.current.loading).toBe(false), {
        timeout: 5000,
      });

      // 'no_segmentation' stays as-is (no normalization for this status)
      expect(result.current.images[0].segmentationStatus).toBe(
        'no_segmentation'
      );

      // Run refresh with real timers
      await act(async () => {
        await result.current.refreshImageSegmentation(mockImageId);
      });

      // Status must remain 'no_segmentation'
      expect(result.current.images[0].segmentationStatus).toBe(
        'no_segmentation'
      );
    }, 15000);
  });
});
