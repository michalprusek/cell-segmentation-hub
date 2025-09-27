import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useSegmentationReload } from '../useSegmentationReload';
import apiClient from '@/lib/api';
import { toast } from 'sonner';

// Mock dependencies
vi.mock('@/lib/api', () => ({
  default: {
    getSegmentationResults: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useSegmentationReload', () => {
  const mockProjectId = 'project-123';
  const mockImageId = 'image-456';
  const mockPolygons = [
    {
      id: 'poly-1',
      points: [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
    },
    {
      id: 'poly-2',
      points: [
        [3, 3],
        [4, 4],
        [5, 3],
      ],
    },
  ];
  const mockDimensions = { width: 800, height: 600 };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize with isReloading as false', () => {
    const { result } = renderHook(() =>
      useSegmentationReload({
        projectId: mockProjectId,
        imageId: mockImageId,
      })
    );

    expect(result.current.isReloading).toBe(false);
  });

  it('should successfully reload segmentation data', async () => {
    const onPolygonsLoaded = vi.fn();
    const onDimensionsUpdated = vi.fn();

    vi.mocked(apiClient.getSegmentationResults).mockResolvedValue({
      polygons: mockPolygons,
      imageWidth: mockDimensions.width,
      imageHeight: mockDimensions.height,
    });

    const { result } = renderHook(() =>
      useSegmentationReload({
        projectId: mockProjectId,
        imageId: mockImageId,
        onPolygonsLoaded,
        onDimensionsUpdated,
      })
    );

    let reloadPromise: Promise<boolean>;
    act(() => {
      reloadPromise = result.current.reloadSegmentation();
    });

    expect(result.current.isReloading).toBe(true);

    const success = await act(async () => await reloadPromise!);

    expect(success).toBe(true);
    expect(result.current.isReloading).toBe(false);
    expect(onPolygonsLoaded).toHaveBeenCalledWith(mockPolygons);
    expect(onDimensionsUpdated).toHaveBeenCalledWith(mockDimensions);
  });

  it('should handle empty segmentation data', async () => {
    const onPolygonsLoaded = vi.fn();

    vi.mocked(apiClient.getSegmentationResults).mockResolvedValue({
      polygons: null,
    });

    const { result } = renderHook(() =>
      useSegmentationReload({
        projectId: mockProjectId,
        imageId: mockImageId,
        onPolygonsLoaded,
      })
    );

    const success = await act(
      async () => await result.current.reloadSegmentation()
    );

    expect(success).toBe(true);
    expect(onPolygonsLoaded).toHaveBeenCalledWith(null);
  });

  it('should retry on failure with exponential backoff', async () => {
    const onPolygonsLoaded = vi.fn();

    // First two calls fail, third succeeds
    vi.mocked(apiClient.getSegmentationResults)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        polygons: mockPolygons,
      });

    const { result } = renderHook(() =>
      useSegmentationReload({
        projectId: mockProjectId,
        imageId: mockImageId,
        onPolygonsLoaded,
        maxRetries: 2,
      })
    );

    act(() => {
      result.current.reloadSegmentation();
    });

    // First attempt fails immediately
    await waitFor(() => {
      expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(1);
    });

    // Wait for first retry (1s delay)
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(2);
    });

    // Wait for second retry (2s delay)
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(3);
      expect(onPolygonsLoaded).toHaveBeenCalledWith(mockPolygons);
    });
  });

  it('should show error toast after all retries fail', async () => {
    vi.mocked(apiClient.getSegmentationResults).mockRejectedValue(
      new Error('Persistent error')
    );

    const { result } = renderHook(() =>
      useSegmentationReload({
        projectId: mockProjectId,
        imageId: mockImageId,
        maxRetries: 1,
      })
    );

    act(() => {
      result.current.reloadSegmentation();
    });

    // First attempt fails
    await waitFor(() => {
      expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(1);
    });

    // Wait for retry
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(2);
      expect(toast.error).toHaveBeenCalledWith(
        'toast.segmentation.reloadFailed'
      );
    });
  });

  it('should handle aborted requests gracefully', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';

    vi.mocked(apiClient.getSegmentationResults).mockRejectedValue(abortError);

    const { result } = renderHook(() =>
      useSegmentationReload({
        projectId: mockProjectId,
        imageId: mockImageId,
      })
    );

    const success = await act(
      async () => await result.current.reloadSegmentation()
    );

    expect(success).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('should cleanup operations when called', async () => {
    vi.mocked(apiClient.getSegmentationResults).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const { result } = renderHook(() =>
      useSegmentationReload({
        projectId: mockProjectId,
        imageId: mockImageId,
      })
    );

    act(() => {
      result.current.reloadSegmentation();
    });

    expect(result.current.isReloading).toBe(true);

    act(() => {
      result.current.cleanupReloadOperations();
    });

    // The abort should have been called
    expect(apiClient.getSegmentationResults).toHaveBeenCalledWith(
      mockImageId,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('should not reload without projectId or imageId', async () => {
    const onPolygonsLoaded = vi.fn();

    const { result: resultNoProject } = renderHook(() =>
      useSegmentationReload({
        projectId: undefined,
        imageId: mockImageId,
        onPolygonsLoaded,
      })
    );

    const successNoProject = await act(
      async () => await resultNoProject.current.reloadSegmentation()
    );

    expect(successNoProject).toBe(false);
    expect(onPolygonsLoaded).not.toHaveBeenCalled();

    const { result: resultNoImage } = renderHook(() =>
      useSegmentationReload({
        projectId: mockProjectId,
        imageId: undefined,
        onPolygonsLoaded,
      })
    );

    const successNoImage = await act(
      async () => await resultNoImage.current.reloadSegmentation()
    );

    expect(successNoImage).toBe(false);
    expect(onPolygonsLoaded).not.toHaveBeenCalled();
  });

  it('should cleanup on unmount', () => {
    const { unmount } = renderHook(() =>
      useSegmentationReload({
        projectId: mockProjectId,
        imageId: mockImageId,
      })
    );

    unmount();

    // Cleanup should have been called - verify no pending operations
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should handle dimensions update only when provided', async () => {
    const onPolygonsLoaded = vi.fn();
    const onDimensionsUpdated = vi.fn();

    // Response without dimensions
    vi.mocked(apiClient.getSegmentationResults).mockResolvedValue({
      polygons: mockPolygons,
    });

    const { result } = renderHook(() =>
      useSegmentationReload({
        projectId: mockProjectId,
        imageId: mockImageId,
        onPolygonsLoaded,
        onDimensionsUpdated,
      })
    );

    await act(async () => {
      await result.current.reloadSegmentation();
    });

    expect(onPolygonsLoaded).toHaveBeenCalledWith(mockPolygons);
    expect(onDimensionsUpdated).not.toHaveBeenCalled();
  });

  it('should handle concurrent reload requests', async () => {
    let resolveFirst: (value: any) => void;
    let resolveSecond: (value: any) => void;

    const firstPromise = new Promise(resolve => {
      resolveFirst = resolve;
    });

    const secondPromise = new Promise(resolve => {
      resolveSecond = resolve;
    });

    vi.mocked(apiClient.getSegmentationResults)
      .mockReturnValueOnce(firstPromise as any)
      .mockReturnValueOnce(secondPromise as any);

    const { result } = renderHook(() =>
      useSegmentationReload({
        projectId: mockProjectId,
        imageId: mockImageId,
      })
    );

    // Start first reload
    act(() => {
      result.current.reloadSegmentation();
    });

    // Start second reload (should cancel first)
    act(() => {
      result.current.reloadSegmentation();
    });

    // Resolve second request
    act(() => {
      resolveSecond!({ polygons: mockPolygons });
    });

    await waitFor(() => {
      expect(result.current.isReloading).toBe(false);
    });

    // First request should have been aborted
    expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(2);
  });
});
