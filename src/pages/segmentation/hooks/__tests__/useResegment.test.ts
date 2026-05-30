import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { useResegment } from '../useResegment';

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

const mockGetSegmentation = vi.fn();
const mockRequestBatch = vi.fn();
vi.mock('@/lib/api', () => ({
  default: {
    getSegmentationResults: (...args: any[]) => mockGetSegmentation(...args),
    requestBatchSegmentation: (...args: any[]) => mockRequestBatch(...args),
  },
}));

const mockSetCached = vi.fn();
vi.mock('../segmentationPolygonCache', () => ({
  setCachedSegmentationPolygons: (...args: any[]) => mockSetCached(...args),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

const makeParams = (
  overrides: Partial<Parameters<typeof useResegment>[0]> = {}
) => ({
  projectId: 'proj-1',
  imageId: 'img-1',
  projectType: 'spheroid' as string,
  selectedModel: 'hrnet',
  confidenceThreshold: 0.5,
  detectHoles: false,
  videoChannels: null,
  queryClient: new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
  t: (key: string) => key,
  onReloaded: vi.fn(),
  setImageDimensions: vi.fn(),
  currentImageIdRef: {
    current: 'img-1',
  } as React.MutableRefObject<string | undefined>,
  ...overrides,
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('useResegment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGetSegmentation.mockResolvedValue({
      polygons: [],
      updatedAt: '2026-01-01T00:00:00Z',
    });
    mockRequestBatch.mockResolvedValue({
      successful: 1,
      failed: 0,
      results: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── initial state ─────────────────────────────────────────────────────────

  it('initialises with isResegmenting=false and dialog closed', () => {
    const { result } = renderHook(() => useResegment(makeParams()));
    expect(result.current.isResegmenting).toBe(false);
    expect(result.current.showResegmentChannelDialog).toBe(false);
  });

  // ─── effectiveResegmentModel gating ────────────────────────────────────────

  it.each([
    ['microtubules', 'microtubule'],
    ['sperm', 'sperm'],
    ['wound', 'wound'],
    ['spheroid_invasive', 'unet_attention_aspp'],
    ['spheroid', 'hrnet'],
  ])(
    'maps projectType=%s → effectiveResegmentModel=%s',
    (projectType, expected) => {
      const { result } = renderHook(() =>
        useResegment(makeParams({ projectType, selectedModel: 'hrnet' }))
      );
      expect(result.current.effectiveResegmentModel).toBe(expected);
    }
  );

  // ─── handleResegmentCurrentFrame — single channel ─────────────────────────

  it('calls runResegment directly when videoChannels is null', async () => {
    const params = makeParams({ videoChannels: null });
    const { result } = renderHook(() => useResegment(params));

    await act(async () => {
      result.current.handleResegmentCurrentFrame();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRequestBatch).toHaveBeenCalledWith(
      ['img-1'],
      'hrnet',
      0.5,
      false,
      undefined
    );
    expect(result.current.showResegmentChannelDialog).toBe(false);
  });

  it('calls runResegment directly when videoChannels has 1 channel', async () => {
    const params = makeParams({
      videoChannels: [{ name: 'DAPI', isSegmentationSource: true }],
    });
    const { result } = renderHook(() => useResegment(params));

    await act(async () => {
      result.current.handleResegmentCurrentFrame();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRequestBatch).toHaveBeenCalled();
    expect(result.current.showResegmentChannelDialog).toBe(false);
  });

  it('opens channel dialog when videoChannels has >1 channels', () => {
    const params = makeParams({
      videoChannels: [
        { name: 'DAPI', isSegmentationSource: false },
        { name: 'GFP', isSegmentationSource: true },
      ],
    });
    const { result } = renderHook(() => useResegment(params));

    act(() => {
      result.current.handleResegmentCurrentFrame();
    });

    expect(result.current.showResegmentChannelDialog).toBe(true);
    expect(mockRequestBatch).not.toHaveBeenCalled();
  });

  // ─── runResegment — success ────────────────────────────────────────────────

  it('clears isResegmenting after a successful batch call', async () => {
    const { result } = renderHook(() => useResegment(makeParams()));

    await act(async () => {
      await result.current.runResegment();
    });

    expect(result.current.isResegmenting).toBe(false);
  });

  it('passes channel argument to requestBatchSegmentation', async () => {
    const { result } = renderHook(() => useResegment(makeParams()));

    await act(async () => {
      await result.current.runResegment('GFP');
    });

    expect(mockRequestBatch).toHaveBeenCalledWith(
      ['img-1'],
      'hrnet',
      0.5,
      false,
      'GFP'
    );
  });

  // ─── runResegment — 0 successes ────────────────────────────────────────────

  it('shows error toast when batch returns 0 successful', async () => {
    const { toast } = await import('sonner');
    mockRequestBatch.mockResolvedValue({
      successful: 0,
      failed: 1,
      results: [{ success: false, error: 'model OOM' }],
    });

    const { result } = renderHook(() => useResegment(makeParams()));

    await act(async () => {
      await result.current.runResegment();
    });

    expect(toast.error).toHaveBeenCalled();
    expect(result.current.isResegmenting).toBe(false);
  });

  // ─── runResegment — partial failure ───────────────────────────────────────

  it('shows warning toast when some results fail', async () => {
    const { toast } = await import('sonner');
    mockRequestBatch.mockResolvedValue({
      successful: 1,
      failed: 1,
      results: [{ success: true }, { success: false, error: 'partial OOM' }],
    });

    const { result } = renderHook(() => useResegment(makeParams()));

    await act(async () => {
      await result.current.runResegment();
    });

    expect(toast.warning).toHaveBeenCalled();
  });

  // ─── startResegmentPoll — poll fires on new updatedAt ─────────────────────
  // Test the poll mechanism by kicking off runResegment and advancing fake
  // timers to the first tick. On tick 1 the stamp changed → onReloaded fires.

  it('calls onReloaded when poll tick detects a new updatedAt', async () => {
    const onReloaded = vi.fn();
    const setImageDimensions = vi.fn();
    const freshPolygons = [{ id: 'p-new', points: [], type: 'external' }];

    // prevStamp snapshot call: returns old timestamp
    mockGetSegmentation
      .mockResolvedValueOnce({
        updatedAt: 'old-ts',
        polygons: [],
      })
      // poll tick 1: new timestamp — triggers apply immediately
      .mockResolvedValue({
        updatedAt: 'new-ts',
        polygons: freshPolygons,
        imageWidth: 800,
        imageHeight: 600,
      });

    const params = makeParams({ onReloaded, setImageDimensions });
    const { result } = renderHook(() => useResegment(params));

    // Run the resegment call (snapshots prevStamp, enqueues the first poll tick)
    await act(async () => {
      await result.current.runResegment();
    });

    // Advance past the 2000 ms poll delay so tick() fires
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // Flush all pending microtasks so the async tick body resolves
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onReloaded).toHaveBeenCalledWith(freshPolygons);
    expect(setImageDimensions).toHaveBeenCalledWith({
      width: 800,
      height: 600,
    });
  });

  // ─── does not re-enter when isResegmenting=true ───────────────────────────

  it('does nothing when called while already resegmenting', async () => {
    const { result } = renderHook(() => useResegment(makeParams()));

    // Start first resegment (don't await so it stays in-flight)
    let firstResegmentResolve!: () => void;
    mockRequestBatch.mockImplementation(
      () =>
        new Promise<{ successful: number; failed: number; results: any[] }>(
          resolve => {
            firstResegmentResolve = () =>
              resolve({ successful: 1, failed: 0, results: [] });
          }
        )
    );

    act(() => {
      void result.current.runResegment();
    });

    // At this point isResegmenting should be true
    expect(result.current.isResegmenting).toBe(true);

    // Second call should be a no-op
    await act(async () => {
      await result.current.runResegment();
    });

    // Only 1 prevStamp + 1 batch call, not 2 batch calls
    // (the second runResegment returned immediately)
    expect(mockRequestBatch).toHaveBeenCalledTimes(1);

    // Cleanup: resolve the first batch so the hook settles
    await act(async () => {
      firstResegmentResolve();
      await Promise.resolve();
    });
  });
});
