import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
    loading: vi.fn(),
    dismiss: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock retryWithBackoff to execute the fn directly (no delays in tests)
vi.mock('@/lib/retryUtils', () => ({
  retryWithBackoff: vi.fn(async (fn: () => Promise<any>) => {
    try {
      const data = await fn();
      return { success: true, data, attempts: 1 };
    } catch (error) {
      return { success: false, error, attempts: 1 };
    }
  }),
  RETRY_CONFIGS: {
    api: {
      maxAttempts: 3,
      initialDelay: 300,
      maxDelay: 1200,
      backoffFactor: 2,
    },
  },
}));

// Mock the polygon cache helper
vi.mock('../segmentationPolygonCache', () => ({
  setCachedSegmentationPolygons: vi.fn(),
}));

// Wrapper with QueryClientProvider required by useSegmentationReload
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useSegmentationReload', () => {
  const mockProjectId = 'project-123';
  const mockImageId = 'image-456';
  let wrapper: ReturnType<typeof createWrapper>;
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
    wrapper = createWrapper();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize with isReloading as false', () => {
    const { result } = renderHook(
      () =>
        useSegmentationReload({
          projectId: mockProjectId,
          imageId: mockImageId,
        }),
      { wrapper }
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

    const { result } = renderHook(
      () =>
        useSegmentationReload({
          projectId: mockProjectId,
          imageId: mockImageId,
          onPolygonsLoaded,
          onDimensionsUpdated,
        }),
      { wrapper }
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

    const { result } = renderHook(
      () =>
        useSegmentationReload({
          projectId: mockProjectId,
          imageId: mockImageId,
          onPolygonsLoaded,
        }),
      { wrapper }
    );

    const success = await act(
      async () => await result.current.reloadSegmentation()
    );

    expect(success).toBe(true);
    expect(onPolygonsLoaded).toHaveBeenCalledWith(null);
  });

  it('should retry on failure with exponential backoff', async () => {
    // Use real timers for this test to avoid waitFor deadlock with fake timers
    vi.useRealTimers();
    const onPolygonsLoaded = vi.fn();

    // First two calls fail, third succeeds
    vi.mocked(apiClient.getSegmentationResults)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        polygons: mockPolygons,
      });

    const { result } = renderHook(
      () =>
        useSegmentationReload({
          projectId: mockProjectId,
          imageId: mockImageId,
          onPolygonsLoaded,
          maxRetries: 2,
        }),
      { wrapper }
    );

    // First call - fails, schedules retry after 1s
    await act(async () => {
      await result.current.reloadSegmentation();
    });

    // First attempt was called, retry is scheduled
    expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(1);

    // Wait for first retry (scheduleRetry uses 2^0 * 1000 = 1000ms)
    await new Promise(resolve => setTimeout(resolve, 1200));
    await act(async () => {}); // flush

    // Second attempt called
    expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(2);

    // Wait for second retry (scheduleRetry uses 2^1 * 1000 = 2000ms)
    await new Promise(resolve => setTimeout(resolve, 2200));
    await act(async () => {}); // flush

    // Third attempt called, should succeed
    await waitFor(
      () => {
        expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(3);
        expect(onPolygonsLoaded).toHaveBeenCalledWith(mockPolygons);
      },
      { timeout: 1000 }
    );
  }, 10000); // 10s test timeout for the backoff waits

  it('should show error toast after all retries fail', async () => {
    // Use real timers for this test to avoid waitFor deadlock with fake timers
    vi.useRealTimers();
    vi.mocked(apiClient.getSegmentationResults).mockRejectedValue(
      new Error('Persistent error')
    );

    const { result } = renderHook(
      () =>
        useSegmentationReload({
          projectId: mockProjectId,
          imageId: mockImageId,
          maxRetries: 1,
        }),
      { wrapper }
    );

    // First call - fails, schedules retry after 1s
    await act(async () => {
      await result.current.reloadSegmentation();
    });
    expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(1);

    // Wait for retry (2^0 * 1000 = 1000ms)
    await new Promise(resolve => setTimeout(resolve, 1200));
    await act(async () => {}); // flush

    // Second attempt - also fails, now exceeds maxRetries=1, toast.error is called
    await waitFor(
      () => {
        expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(2);
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining('toast.segmentation.reloadFailed')
        );
      },
      { timeout: 1000 }
    );
  }, 5000); // 5s test timeout

  it('should handle aborted requests gracefully', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';

    vi.mocked(apiClient.getSegmentationResults).mockRejectedValue(abortError);

    const { result } = renderHook(
      () =>
        useSegmentationReload({
          projectId: mockProjectId,
          imageId: mockImageId,
        }),
      { wrapper }
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

    const { result } = renderHook(
      () =>
        useSegmentationReload({
          projectId: mockProjectId,
          imageId: mockImageId,
        }),
      { wrapper }
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

    const { result: resultNoProject } = renderHook(
      () =>
        useSegmentationReload({
          projectId: undefined,
          imageId: mockImageId,
          onPolygonsLoaded,
        }),
      { wrapper }
    );

    const successNoProject = await act(
      async () => await resultNoProject.current.reloadSegmentation()
    );

    expect(successNoProject).toBe(false);
    expect(onPolygonsLoaded).not.toHaveBeenCalled();

    const { result: resultNoImage } = renderHook(
      () =>
        useSegmentationReload({
          projectId: mockProjectId,
          imageId: undefined,
          onPolygonsLoaded,
        }),
      { wrapper }
    );

    const successNoImage = await act(
      async () => await resultNoImage.current.reloadSegmentation()
    );

    expect(successNoImage).toBe(false);
    expect(onPolygonsLoaded).not.toHaveBeenCalled();
  });

  it('should cleanup on unmount', () => {
    const { unmount } = renderHook(
      () =>
        useSegmentationReload({
          projectId: mockProjectId,
          imageId: mockImageId,
        }),
      { wrapper }
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

    const { result } = renderHook(
      () =>
        useSegmentationReload({
          projectId: mockProjectId,
          imageId: mockImageId,
          onPolygonsLoaded,
          onDimensionsUpdated,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.reloadSegmentation();
    });

    expect(onPolygonsLoaded).toHaveBeenCalledWith(mockPolygons);
    expect(onDimensionsUpdated).not.toHaveBeenCalled();
  });

  it('should handle concurrent reload requests', async () => {
    // Use real timers to avoid waitFor deadlock
    vi.useRealTimers();

    let resolveSecond: (value: any) => void;

    const firstPromise = new Promise(() => {
      // Never resolves - simulates an in-flight request
    });

    const secondPromise = new Promise(resolve => {
      resolveSecond = resolve;
    });

    vi.mocked(apiClient.getSegmentationResults)
      .mockReturnValueOnce(firstPromise as any)
      .mockReturnValueOnce(secondPromise as any);

    const { result } = renderHook(
      () =>
        useSegmentationReload({
          projectId: mockProjectId,
          imageId: mockImageId,
        }),
      { wrapper }
    );

    // Start first reload (never resolves)
    act(() => {
      result.current.reloadSegmentation();
    });

    // Start second reload (should abort/supersede first)
    act(() => {
      result.current.reloadSegmentation();
    });

    // Resolve second request
    act(() => {
      resolveSecond!({ polygons: mockPolygons });
    });

    await waitFor(
      () => {
        expect(result.current.isReloading).toBe(false);
      },
      { timeout: 3000 }
    );

    // Both requests were initiated
    expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(2);
  });
});
