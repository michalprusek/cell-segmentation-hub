/**
 * Tests for race condition handling in useProjectData hook
 * Verifies the fix for the "no_segmentation" status override issue
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
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));
vi.mock('@/contexts/useAuth', () => ({
  useAuth: () => ({
    signOut: vi.fn(),
  }),
}));

describe('useProjectData - Race Condition Handling', () => {
  const mockProjectId = 'test-project-id';
  const mockUserId = 'test-user-id';
  const mockImageId = 'test-image-id';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Status Override Prevention', () => {
    it('should NOT change status to no_segmentation when data fetch fails', async () => {
      // Setup: Project with an image that has "segmented" status
      const mockProject = {
        id: mockProjectId,
        name: 'Test Project',
      };

      const mockImage = {
        id: mockImageId,
        name: 'test.jpg',
        url: 'http://test.jpg',
        segmentationStatus: 'segmented',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Mock API responses
      (apiClient.getProject as any).mockResolvedValue(mockProject);
      (apiClient.getProjectImagesWithThumbnails as any).mockResolvedValue({
        images: [mockImage],
        total: 1,
      });
      (apiClient.getSegmentationResults as any).mockResolvedValue(null); // Simulate no data

      // Render hook
      const { result } = renderHook(() =>
        useProjectData(mockProjectId, mockUserId)
      );

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Verify initial state
      expect(result.current.images).toHaveLength(1);
      expect(result.current.images[0].segmentationStatus).toBe('segmented');

      // Trigger refresh that will fail to get segmentation data
      await act(async () => {
        await result.current.refreshImageSegmentation(mockImageId);
      });

      // Fast-forward through retry attempts
      await act(async () => {
        vi.advanceTimersByTime(500); // First retry
        vi.advanceTimersByTime(1000); // Second retry
        vi.advanceTimersByTime(2000); // Third retry
      });

      // CRITICAL: Status should remain 'segmented', NOT change to 'no_segmentation'
      expect(result.current.images[0].segmentationStatus).toBe('segmented');
      expect(result.current.images[0].segmentationStatus).not.toBe(
        'no_segmentation'
      );
    });

    it('should retry multiple times before giving up', async () => {
      // Setup
      const mockProject = {
        id: mockProjectId,
        name: 'Test Project',
      };

      const mockImage = {
        id: mockImageId,
        name: 'test.jpg',
        url: 'http://test.jpg',
        segmentationStatus: 'segmented',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockSegmentationData = {
        polygons: [{ points: [[0, 0], [100, 0], [100, 100], [0, 100]] }],
        imageWidth: 1024,
        imageHeight: 768,
      };

      // Mock API responses
      (apiClient.getProject as any).mockResolvedValue(mockProject);
      (apiClient.getProjectImagesWithThumbnails as any).mockResolvedValue({
        images: [mockImage],
        total: 1,
      });

      // Fail first attempts, succeed on third retry
      (apiClient.getSegmentationResults as any)
        .mockResolvedValueOnce(null) // First attempt fails
        .mockResolvedValueOnce(null) // Second attempt fails
        .mockResolvedValueOnce(mockSegmentationData); // Third attempt succeeds

      // Mock performance monitor
      (performanceMonitor.recordDatabaseFetch as any) = vi.fn();

      // Render hook
      const { result } = renderHook(() =>
        useProjectData(mockProjectId, mockUserId)
      );

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Trigger refresh
      await act(async () => {
        const refreshPromise = result.current.refreshImageSegmentation(mockImageId);

        // Advance timers for each retry
        vi.advanceTimersByTime(500); // First retry delay
        vi.advanceTimersByTime(1000); // Second retry delay

        await refreshPromise;
      });

      // Verify retries happened
      expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(3);

      // Verify performance monitoring
      expect(performanceMonitor.recordDatabaseFetch).toHaveBeenCalledWith(
        mockImageId,
        expect.any(Number),
        false,
        0
      ); // First fail
      expect(performanceMonitor.recordDatabaseFetch).toHaveBeenCalledWith(
        mockImageId,
        expect.any(Number),
        false,
        1
      ); // Second fail
      expect(performanceMonitor.recordDatabaseFetch).toHaveBeenCalledWith(
        mockImageId,
        expect.any(Number),
        true,
        2
      ); // Third success

      // Verify segmentation data was updated
      expect(result.current.images[0].segmentationResult).toEqual({
        polygons: mockSegmentationData.polygons,
        imageWidth: mockSegmentationData.imageWidth,
        imageHeight: mockSegmentationData.imageHeight,
        modelUsed: undefined,
        confidence: undefined,
        processingTime: undefined,
      });

      // Status should remain 'segmented'
      expect(result.current.images[0].segmentationStatus).toBe('segmented');
    });

    it('should handle successful data fetch on first attempt', async () => {
      // Setup
      const mockProject = {
        id: mockProjectId,
        name: 'Test Project',
      };

      const mockImage = {
        id: mockImageId,
        name: 'test.jpg',
        url: 'http://test.jpg',
        segmentationStatus: 'segmented',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockSegmentationData = {
        polygons: [{ points: [[0, 0], [100, 0], [100, 100], [0, 100]] }],
        imageWidth: 1024,
        imageHeight: 768,
        modelUsed: 'hrnet',
        confidence: 0.95,
        processingTime: 1.2,
      };

      // Mock API responses
      (apiClient.getProject as any).mockResolvedValue(mockProject);
      (apiClient.getProjectImagesWithThumbnails as any).mockResolvedValue({
        images: [mockImage],
        total: 1,
      });
      (apiClient.getSegmentationResults as any).mockResolvedValue(
        mockSegmentationData
      );

      // Mock performance monitor
      (performanceMonitor.recordDatabaseFetch as any) = vi.fn();

      // Render hook
      const { result } = renderHook(() =>
        useProjectData(mockProjectId, mockUserId)
      );

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Trigger refresh
      await act(async () => {
        await result.current.refreshImageSegmentation(mockImageId);
      });

      // Should only call once (no retries needed)
      expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(1);

      // Verify performance monitoring for successful first attempt
      expect(performanceMonitor.recordDatabaseFetch).toHaveBeenCalledWith(
        mockImageId,
        expect.any(Number),
        true,
        0
      );

      // Verify segmentation data was updated
      expect(result.current.images[0].segmentationResult).toMatchObject({
        polygons: mockSegmentationData.polygons,
        imageWidth: mockSegmentationData.imageWidth,
        imageHeight: mockSegmentationData.imageHeight,
        modelUsed: mockSegmentationData.modelUsed,
        confidence: mockSegmentationData.confidence,
        processingTime: mockSegmentationData.processingTime,
      });

      // Status should remain 'segmented'
      expect(result.current.images[0].segmentationStatus).toBe('segmented');
    });

    it('should not change status for images without segmentation results', async () => {
      // Setup: Image with 'no_segmentation' status from backend
      const mockProject = {
        id: mockProjectId,
        name: 'Test Project',
      };

      const mockImage = {
        id: mockImageId,
        name: 'test.jpg',
        url: 'http://test.jpg',
        segmentationStatus: 'no_segmentation', // Already no segmentation
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Mock API responses
      (apiClient.getProject as any).mockResolvedValue(mockProject);
      (apiClient.getProjectImagesWithThumbnails as any).mockResolvedValue({
        images: [mockImage],
        total: 1,
      });
      (apiClient.getSegmentationResults as any).mockResolvedValue(null);

      // Render hook
      const { result } = renderHook(() =>
        useProjectData(mockProjectId, mockUserId)
      );

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Trigger refresh
      await act(async () => {
        await result.current.refreshImageSegmentation(mockImageId);
      });

      // Status should remain 'no_segmentation' as set by backend
      expect(result.current.images[0].segmentationStatus).toBe('no_segmentation');
    });
  });
});