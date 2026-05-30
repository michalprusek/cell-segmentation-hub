import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { useSegmentationLoader } from '../useSegmentationLoader';

// ─── module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

const mockGetSegmentationResults = vi.fn();
vi.mock('@/lib/api', () => ({
  default: {
    getSegmentationResults: (...args: any[]) =>
      mockGetSegmentationResults(...args),
  },
}));

const mockGetCached = vi.fn(() => undefined as any);
const mockSetCached = vi.fn();
vi.mock('../segmentationPolygonCache', () => ({
  getCachedSegmentationPolygons: (...args: any[]) => mockGetCached(...args),
  setCachedSegmentationPolygons: (...args: any[]) => mockSetCached(...args),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

const makeSignal = () =>
  new AbortController().signal as AbortSignal & { aborted: boolean };

const makeParams = (
  overrides: Partial<Parameters<typeof useSegmentationLoader>[0]> = {}
) => ({
  projectId: 'proj-1',
  imageId: 'img-1',
  selectedImage: {
    segmentationStatus: 'segmented',
    width: 800,
    height: 600,
  },
  getSignal: vi.fn(() => makeSignal()),
  queryClient: new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
  t: (key: string) => key,
  currentImageIdRef: { current: 'img-1' } as React.MutableRefObject<
    string | undefined
  >,
  ...overrides,
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('useSegmentationLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCached.mockReturnValue(undefined); // cache miss by default
    mockGetSegmentationResults.mockResolvedValue(null);
  });

  // ─── initial state ─────────────────────────────────────────────────────────

  it('initialises with null polygons, dimensions and loadedFrameKey', () => {
    const params = makeParams();
    const { result } = renderHook(() => useSegmentationLoader(params));

    expect(result.current.segmentationPolygons).toBeNull();
    expect(result.current.imageDimensions).toBeNull();
    expect(result.current.loadedFrameKey).toBeNull();
  });

  // ─── cache hit ─────────────────────────────────────────────────────────────

  it('serves from cache and skips API when cache hit', async () => {
    const polygons = [{ id: 'p1', points: [], type: 'external' }];
    mockGetCached.mockReturnValue({
      polygons,
      imageWidth: 800,
      imageHeight: 600,
    });

    const params = makeParams();
    const { result } = renderHook(() => useSegmentationLoader(params));

    await waitFor(() => {
      expect(result.current.segmentationPolygons).toEqual(polygons);
    });

    expect(mockGetSegmentationResults).not.toHaveBeenCalled();
    expect(result.current.imageDimensions).toEqual({ width: 800, height: 600 });
  });

  // ─── no segmentation status → skip fetch ──────────────────────────────────

  it('skips API fetch when image has no completed segmentation', async () => {
    const params = makeParams({
      selectedImage: {
        segmentationStatus: 'queued',
        width: 512,
        height: 512,
      },
    });

    const { result } = renderHook(() => useSegmentationLoader(params));

    await waitFor(() => {
      expect(result.current.imageDimensions).toEqual({
        width: 512,
        height: 512,
      });
    });

    expect(mockGetSegmentationResults).not.toHaveBeenCalled();
    expect(result.current.segmentationPolygons).toBeNull();
  });

  // ─── successful API fetch ──────────────────────────────────────────────────

  it('fetches from API on cache miss and sets polygons + dimensions', async () => {
    const polygons = [{ id: 'p1', points: [], type: 'external' }];
    mockGetSegmentationResults.mockResolvedValue({
      polygons,
      imageWidth: 1024,
      imageHeight: 768,
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const params = makeParams();
    const { result } = renderHook(() => useSegmentationLoader(params));

    await waitFor(() => {
      expect(result.current.segmentationPolygons).toEqual(polygons);
    });

    expect(result.current.imageDimensions).toEqual({
      width: 1024,
      height: 768,
    });
    expect(mockSetCached).toHaveBeenCalledWith(
      params.queryClient,
      'img-1',
      expect.objectContaining({ polygons })
    );
  });

  // ─── null API response → sets null polygons ────────────────────────────────

  it('sets segmentationPolygons to null when API returns null', async () => {
    mockGetSegmentationResults.mockResolvedValue(null);
    const params = makeParams({
      selectedImage: {
        segmentationStatus: 'segmented',
        width: 800,
        height: 600,
      },
    });

    const { result } = renderHook(() => useSegmentationLoader(params));

    await waitFor(() => {
      // After null response, dims come from selectedImage fallback
      expect(result.current.imageDimensions).toEqual({
        width: 800,
        height: 600,
      });
    });

    expect(result.current.segmentationPolygons).toBeNull();
  });

  // ─── 404 error → silent null (no toast) ───────────────────────────────────

  it('handles 404 error silently (sets null, no toast)', async () => {
    const { toast } = await import('sonner');
    const error = Object.assign(new Error('Not Found'), {
      response: { status: 404 },
    });
    mockGetSegmentationResults.mockRejectedValue(error);

    const params = makeParams();
    const { result } = renderHook(() => useSegmentationLoader(params));

    await waitFor(() => {
      // dims come from selectedImage after 404
      expect(result.current.imageDimensions).toBeNull();
    });

    expect(result.current.segmentationPolygons).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  // ─── non-404 error → toast ─────────────────────────────────────────────────

  it('shows error toast and sets null on non-404 API errors', async () => {
    const { toast } = await import('sonner');
    mockGetSegmentationResults.mockRejectedValue(new Error('Server Error'));

    const params = makeParams();
    const { result } = renderHook(() => useSegmentationLoader(params));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });

    expect(result.current.segmentationPolygons).toBeNull();
  });

  // ─── handleImageLoad ───────────────────────────────────────────────────────

  it('handleImageLoad sets loadedFrameKey and imageDimensions when not yet set', async () => {
    const params = makeParams({
      selectedImage: { segmentationStatus: 'pending' },
    });

    const { result } = renderHook(() => useSegmentationLoader(params));

    act(() => {
      result.current.handleImageLoad(640, 480, 'ch0');
    });

    expect(result.current.loadedFrameKey).toBe('img-1::ch0');
    expect(result.current.imageDimensions).toEqual({ width: 640, height: 480 });
  });

  it('handleImageLoad keeps existing dimensions when already set from segmentation', async () => {
    const polygons = [{ id: 'p1', points: [], type: 'external' }];
    mockGetSegmentationResults.mockResolvedValue({
      polygons,
      imageWidth: 1024,
      imageHeight: 768,
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const params = makeParams();
    const { result } = renderHook(() => useSegmentationLoader(params));

    // Wait for dimensions to be set from segmentation data
    await waitFor(() => {
      expect(result.current.imageDimensions).toEqual({
        width: 1024,
        height: 768,
      });
    });

    // handleImageLoad with different dimensions should keep the segmentation dims
    act(() => {
      result.current.handleImageLoad(640, 480, 'ch0');
    });

    expect(result.current.imageDimensions).toEqual({
      width: 1024,
      height: 768,
    });
  });

  // ─── setters are callable from outside ────────────────────────────────────

  it('exposes setSegmentationPolygons for the orchestrator to call', () => {
    const params = makeParams({
      selectedImage: { segmentationStatus: 'pending' },
    });
    const { result } = renderHook(() => useSegmentationLoader(params));

    const newPolys = [{ id: 'p99', points: [], type: 'external' }] as any;
    act(() => {
      result.current.setSegmentationPolygons(newPolys);
    });

    expect(result.current.segmentationPolygons).toEqual(newPolys);
  });
});
