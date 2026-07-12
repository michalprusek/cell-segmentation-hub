import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSegmentationReload } from '../useSegmentationReload';
import apiClient from '@/lib/api';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/api', () => ({
  default: { getSegmentationResults: vi.fn() },
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

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// retryWithBackoff runs the fn once (no real delays); the hook's own
// scheduleRetry drives the exponential back-off exercised below.
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

vi.mock('../segmentationPolygonCache', () => ({
  setCachedSegmentationPolygons: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Shared fixtures + helpers
// ---------------------------------------------------------------------------

const PROJECT_ID = 'project-123';
const IMAGE_ID = 'image-456';
const STORAGE_KEY = `segmentation-reload-${IMAGE_ID}`;

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

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

let wrapper: ReturnType<typeof createWrapper>;

// Render the hook with the standard project/image, overridable per test.
const renderReload = (
  props: Partial<Parameters<typeof useSegmentationReload>[0]> = {}
) =>
  renderHook(
    () =>
      useSegmentationReload({
        projectId: PROJECT_ID,
        imageId: IMAGE_ID,
        ...props,
      }),
    { wrapper }
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  localStorage.clear();
  wrapper = createWrapper();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

// ===========================================================================

describe('useSegmentationReload', () => {
  describe('reload flow', () => {
    it('initializes with isReloading false', () => {
      const { result } = renderReload();
      expect(result.current.isReloading).toBe(false);
    });

    it('reloads segmentation data and forwards polygons + dimensions', async () => {
      const onPolygonsLoaded = vi.fn();
      const onDimensionsUpdated = vi.fn();

      vi.mocked(apiClient.getSegmentationResults).mockResolvedValue({
        polygons: mockPolygons,
        imageWidth: mockDimensions.width,
        imageHeight: mockDimensions.height,
      });

      const { result } = renderReload({
        onPolygonsLoaded,
        onDimensionsUpdated,
      });

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

    it('handles empty segmentation data (polygons=null)', async () => {
      const onPolygonsLoaded = vi.fn();

      vi.mocked(apiClient.getSegmentationResults).mockResolvedValue({
        polygons: null,
      });

      const { result } = renderReload({ onPolygonsLoaded });

      const success = await act(
        async () => await result.current.reloadSegmentation()
      );

      expect(success).toBe(true);
      expect(onPolygonsLoaded).toHaveBeenCalledWith(null);
    });

    it('updates dimensions only when the response carries them', async () => {
      const onPolygonsLoaded = vi.fn();
      const onDimensionsUpdated = vi.fn();

      // Response without width/height.
      vi.mocked(apiClient.getSegmentationResults).mockResolvedValue({
        polygons: mockPolygons,
      });

      const { result } = renderReload({
        onPolygonsLoaded,
        onDimensionsUpdated,
      });

      await act(async () => {
        await result.current.reloadSegmentation();
      });

      expect(onPolygonsLoaded).toHaveBeenCalledWith(mockPolygons);
      expect(onDimensionsUpdated).not.toHaveBeenCalled();
    });

    it('does not throw when no onPolygonsLoaded callback is provided', async () => {
      vi.mocked(apiClient.getSegmentationResults).mockResolvedValue({
        polygons: mockPolygons,
      });

      const { result } = renderReload();

      await expect(
        act(async () => {
          await result.current.reloadSegmentation();
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('retry + error handling', () => {
    it('retries on failure with exponential backoff', async () => {
      // Real timers: scheduleRetry uses actual setTimeout delays.
      vi.useRealTimers();
      const onPolygonsLoaded = vi.fn();

      vi.mocked(apiClient.getSegmentationResults)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ polygons: mockPolygons });

      const { result } = renderReload({ onPolygonsLoaded, maxRetries: 2 });

      // First call fails, schedules retry after 2^0 * 1000ms.
      await act(async () => {
        await result.current.reloadSegmentation();
      });
      expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(1);

      // Wait for first retry.
      await new Promise(resolve => setTimeout(resolve, 1200));
      await act(async () => {});
      expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(2);

      // Wait for second retry (2^1 * 1000ms), then succeed.
      await new Promise(resolve => setTimeout(resolve, 2200));
      await act(async () => {});

      await waitFor(
        () => {
          expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(3);
          expect(onPolygonsLoaded).toHaveBeenCalledWith(mockPolygons);
        },
        { timeout: 1000 }
      );
    }, 10000);

    it('shows an error toast after all retries fail', async () => {
      vi.useRealTimers();
      vi.mocked(apiClient.getSegmentationResults).mockRejectedValue(
        new Error('Persistent error')
      );

      const { result } = renderReload({ maxRetries: 1 });

      await act(async () => {
        await result.current.reloadSegmentation();
      });
      expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(1);

      await new Promise(resolve => setTimeout(resolve, 1200));
      await act(async () => {});

      // Second attempt fails, exceeds maxRetries=1 → error toast.
      await waitFor(
        () => {
          expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(2);
          expect(toast.error).toHaveBeenCalledWith(
            expect.stringContaining('toast.segmentation.reloadFailed')
          );
        },
        { timeout: 1000 }
      );
    }, 5000);
  });

  describe('abort + cleanup', () => {
    it('handles aborted requests gracefully (no error toast)', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      vi.mocked(apiClient.getSegmentationResults).mockRejectedValue(abortError);

      const { result } = renderReload();

      const success = await act(
        async () => await result.current.reloadSegmentation()
      );

      expect(success).toBe(false);
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('aborts the in-flight request when cleanup is called', async () => {
      vi.mocked(apiClient.getSegmentationResults).mockImplementation(
        () => new Promise(() => {}) // never resolves
      );

      const { result } = renderReload();

      act(() => {
        result.current.reloadSegmentation();
      });
      expect(result.current.isReloading).toBe(true);

      act(() => {
        result.current.cleanupReloadOperations();
      });

      expect(apiClient.getSegmentationResults).toHaveBeenCalledWith(
        IMAGE_ID,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('supersedes an in-flight reload with a second concurrent request', async () => {
      vi.useRealTimers();

      let resolveSecond: (value: any) => void;
      const firstPromise = new Promise(() => {}); // never resolves
      const secondPromise = new Promise(resolve => {
        resolveSecond = resolve;
      });

      vi.mocked(apiClient.getSegmentationResults)
        .mockReturnValueOnce(firstPromise as any)
        .mockReturnValueOnce(secondPromise as any);

      const { result } = renderReload();

      act(() => {
        result.current.reloadSegmentation();
      });
      act(() => {
        result.current.reloadSegmentation();
      });
      act(() => {
        resolveSecond!({ polygons: mockPolygons });
      });

      await waitFor(
        () => {
          expect(result.current.isReloading).toBe(false);
        },
        { timeout: 3000 }
      );

      expect(apiClient.getSegmentationResults).toHaveBeenCalledTimes(2);
    });

    it('clears pending timers and the localStorage entry on unmount', () => {
      // Fresh persisted entry → hook mounts with isReloading=true and
      // rewrites the key; the unmount cleanup must remove it and leave no
      // timers pending.
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ timestamp: Date.now(), isLoading: true })
      );

      const { unmount } = renderReload();

      unmount();

      expect(vi.getTimerCount()).toBe(0);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('guards (missing projectId / imageId)', () => {
    it('does not reload when projectId or imageId is missing', async () => {
      const onPolygonsLoaded = vi.fn();

      const { result: noProject } = renderReload({
        projectId: undefined,
        onPolygonsLoaded,
      });
      const successNoProject = await act(
        async () => await noProject.current.reloadSegmentation()
      );
      expect(successNoProject).toBe(false);
      expect(onPolygonsLoaded).not.toHaveBeenCalled();

      const { result: noImage } = renderReload({
        imageId: undefined,
        onPolygonsLoaded,
      });
      const successNoImage = await act(
        async () => await noImage.current.reloadSegmentation()
      );
      expect(successNoImage).toBe(false);
      expect(onPolygonsLoaded).not.toHaveBeenCalled();
    });
  });

  describe('persisted loading state (mount)', () => {
    it('starts false and clears the entry when it is just past the 5-min window', () => {
      const justExpired = Date.now() - (5 * 60 * 1000 + 1);
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ timestamp: justExpired, isLoading: true })
      );

      const { result } = renderReload();

      expect(result.current.isReloading).toBe(false);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('starts false when the persisted entry has isLoading=false', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ timestamp: Date.now(), isLoading: false })
      );

      const { result } = renderReload();

      expect(result.current.isReloading).toBe(false);
    });

    it('starts false and clears the entry when the JSON is corrupt', () => {
      localStorage.setItem(STORAGE_KEY, '{bad-json');

      const { result } = renderReload();

      expect(result.current.isReloading).toBe(false);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('starts false when imageId is undefined', () => {
      const { result } = renderReload({ imageId: undefined });
      expect(result.current.isReloading).toBe(false);
    });
  });

  describe('persist effect', () => {
    it('removes the localStorage entry when isReloading returns to false', async () => {
      vi.mocked(apiClient.getSegmentationResults).mockResolvedValue({
        polygons: mockPolygons,
      });

      // Pre-populate as if a previous operation was in progress.
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ timestamp: Date.now(), isLoading: true })
      );

      const { result } = renderReload();

      await act(async () => {
        await result.current.reloadSegmentation();
      });

      expect(result.current.isReloading).toBe(false);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('does not write localStorage when imageId is undefined', async () => {
      vi.mocked(apiClient.getSegmentationResults).mockResolvedValue({
        polygons: null,
      });

      const { result } = renderReload({ imageId: undefined });

      await act(async () => {
        await result.current.reloadSegmentation();
      });

      const reloadKeys = Object.keys(localStorage).filter(k =>
        k.startsWith('segmentation-reload-')
      );
      expect(reloadKeys).toHaveLength(0);
    });
  });
});
