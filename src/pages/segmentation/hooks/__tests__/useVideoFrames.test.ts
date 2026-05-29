/**
 * Unit tests for useVideoFrames.
 *
 * Coverage targets:
 *  - Returns null container + loading=true while data is in flight
 *  - Returns populated container after successful fetch
 *  - container is null when data.id !== videoContainerId (keepPreviousData guard)
 *  - Frames are sorted by frameIndex ascending
 *  - frameIndex resets to 0 when videoContainerId changes
 *  - setFrameIndex clamps to [0, frames.length-1]
 *  - step() moves frameIndex by delta, clamped
 *  - play / pause / toggle update isPlaying
 *  - Playback timer: interval advances frameIndex; stops at last frame
 *  - error state exposed when API fails
 *  - currentFrame is null when container is null
 *
 * Timer note: useVideoFrames uses setInterval internally. We use
 * vi.useFakeTimers() + vi.advanceTimersByTime() for the playback tests.
 * For async query tests we use real timers + waitFor — mixing real and
 * fake timers in the same test causes waitFor deadlock, so they are kept
 * in separate describe blocks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useVideoFrames, type VideoContainerMeta } from '../useVideoFrames';

// ------------------------------------------------------------------
// Mock apiClient (useVideoFrames uses apiClient.get directly)
// ------------------------------------------------------------------
const mockGet = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
  },
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function makeContainerPayload(
  id: string,
  frameCount: number
): VideoContainerMeta {
  const frames = Array.from({ length: frameCount }, (_, i) => ({
    id: `frame-${i}`,
    frameIndex: i,
    segmentationStatus: 'segmented' as const,
  }));
  return {
    id,
    name: `Video ${id}`,
    frameCount,
    width: 1920,
    height: 1080,
    videoDurationMs: frameCount * 100,
    channels: null,
    frames,
  };
}

function apiResponse(payload: VideoContainerMeta) {
  return Promise.resolve({ data: { data: payload } });
}

function makeQC() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });
}

function wrapQC(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ------------------------------------------------------------------
// Query behaviour tests (real timers)
// ------------------------------------------------------------------

describe('useVideoFrames — query behaviour', () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    qc = makeQC();
  });

  afterEach(() => {
    qc.clear();
  });

  it('returns isLoading=true and null container on mount', () => {
    // Promise that never resolves → stay in loading state
    mockGet.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.container).toBeNull();
    expect(result.current.currentFrame).toBeNull();
  });

  it('returns populated container after successful fetch', async () => {
    const payload = makeContainerPayload('vid-1', 5);
    mockGet.mockReturnValue(apiResponse(payload));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.container).not.toBeNull();
    expect(result.current.container?.id).toBe('vid-1');
    expect(result.current.container?.frames).toHaveLength(5);
  });

  it('sorts frames by frameIndex ascending even when API returns them reversed', async () => {
    const payload = makeContainerPayload('vid-1', 3);
    // Reverse the frames order in the response
    const shuffled = {
      ...payload,
      frames: [...payload.frames].reverse(),
    };
    mockGet.mockResolvedValue({ data: { data: shuffled } });

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const frameIndexes = result.current.container!.frames.map(
      f => f.frameIndex
    );
    expect(frameIndexes).toEqual([0, 1, 2]);
  });

  it('sets error state when API call rejects', async () => {
    mockGet.mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.container).toBeNull();
  });

  it('does not fetch when videoContainerId is null', () => {
    const { result } = renderHook(() => useVideoFrames(null), {
      wrapper: wrapQC(qc),
    });

    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.container).toBeNull();
  });

  it('exposes currentFrame as the frame at frameIndex', async () => {
    const payload = makeContainerPayload('vid-1', 3);
    mockGet.mockReturnValue(apiResponse(payload));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    await waitFor(() => expect(result.current.container).not.toBeNull());

    // frameIndex starts at 0
    expect(result.current.currentFrame?.frameIndex).toBe(0);
  });

  it('guards against keepPreviousData from a different container', async () => {
    // Seed cache with vid-1 data
    const payload1 = makeContainerPayload('vid-1', 5);
    qc.setQueryData(['video-frames', 'vid-1'], payload1);

    // Ask for vid-2 — data is not in cache yet; mock returns a promise
    // that never resolves so we stay in loading state but with previous data
    mockGet.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useVideoFrames('vid-2'), {
      wrapper: wrapQC(qc),
    });

    // container should be null because data.id ('vid-1') !== 'vid-2'
    expect(result.current.container).toBeNull();
  });
});

// ------------------------------------------------------------------
// Frame index state tests (no timers needed)
// ------------------------------------------------------------------

describe('useVideoFrames — frameIndex state', () => {
  let qc: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    qc = makeQC();
  });

  afterEach(() => {
    qc.clear();
  });

  it('starts at frameIndex 0', async () => {
    const payload = makeContainerPayload('vid-1', 5);
    mockGet.mockReturnValue(apiResponse(payload));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    await waitFor(() => expect(result.current.container).not.toBeNull());

    expect(result.current.frameIndex).toBe(0);
  });

  it('setFrameIndex moves to the given index', async () => {
    const payload = makeContainerPayload('vid-1', 10);
    mockGet.mockReturnValue(apiResponse(payload));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    await waitFor(() => expect(result.current.container).not.toBeNull());

    act(() => {
      result.current.setFrameIndex(5);
    });

    expect(result.current.frameIndex).toBe(5);
  });

  it('setFrameIndex clamps to 0 on negative input', async () => {
    const payload = makeContainerPayload('vid-1', 5);
    mockGet.mockReturnValue(apiResponse(payload));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    await waitFor(() => expect(result.current.container).not.toBeNull());

    act(() => {
      result.current.setFrameIndex(-10);
    });

    expect(result.current.frameIndex).toBe(0);
  });

  it('setFrameIndex clamps to last frame on out-of-bound input', async () => {
    const payload = makeContainerPayload('vid-1', 5);
    mockGet.mockReturnValue(apiResponse(payload));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    await waitFor(() => expect(result.current.container).not.toBeNull());

    act(() => {
      result.current.setFrameIndex(999);
    });

    expect(result.current.frameIndex).toBe(4);
  });

  it('setFrameIndex floors float values', async () => {
    const payload = makeContainerPayload('vid-1', 10);
    mockGet.mockReturnValue(apiResponse(payload));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    await waitFor(() => expect(result.current.container).not.toBeNull());

    act(() => {
      result.current.setFrameIndex(3.7);
    });

    expect(result.current.frameIndex).toBe(3);
  });

  it('setFrameIndex is a no-op when container is null', () => {
    const { result } = renderHook(() => useVideoFrames(null), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.setFrameIndex(5);
    });

    expect(result.current.frameIndex).toBe(0);
  });

  it('step() increments frameIndex by delta', async () => {
    const payload = makeContainerPayload('vid-1', 10);
    mockGet.mockReturnValue(apiResponse(payload));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    await waitFor(() => expect(result.current.container).not.toBeNull());

    act(() => {
      result.current.step(3);
    });

    expect(result.current.frameIndex).toBe(3);
  });

  it('step() decrements frameIndex by negative delta', async () => {
    const payload = makeContainerPayload('vid-1', 10);
    mockGet.mockReturnValue(apiResponse(payload));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    await waitFor(() => expect(result.current.container).not.toBeNull());

    act(() => {
      result.current.setFrameIndex(5);
    });
    act(() => {
      result.current.step(-2);
    });

    expect(result.current.frameIndex).toBe(3);
  });

  it('step() clamps at 0 when stepping past beginning', async () => {
    const payload = makeContainerPayload('vid-1', 5);
    mockGet.mockReturnValue(apiResponse(payload));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    await waitFor(() => expect(result.current.container).not.toBeNull());

    act(() => {
      result.current.step(-10);
    });

    expect(result.current.frameIndex).toBe(0);
  });

  it('step() clamps at last frame when stepping past end', async () => {
    const payload = makeContainerPayload('vid-1', 5);
    mockGet.mockReturnValue(apiResponse(payload));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    await waitFor(() => expect(result.current.container).not.toBeNull());

    act(() => {
      result.current.step(100);
    });

    expect(result.current.frameIndex).toBe(4);
  });

  it('frameIndex resets to 0 when videoContainerId changes', async () => {
    const payload1 = makeContainerPayload('vid-1', 10);
    const payload2 = makeContainerPayload('vid-2', 5);

    mockGet
      .mockReturnValueOnce(apiResponse(payload1))
      .mockReturnValueOnce(apiResponse(payload2));

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useVideoFrames(id),
      { initialProps: { id: 'vid-1' }, wrapper: wrapQC(qc) }
    );

    await waitFor(() => expect(result.current.container?.id).toBe('vid-1'));

    act(() => {
      result.current.setFrameIndex(7);
    });
    expect(result.current.frameIndex).toBe(7);

    rerender({ id: 'vid-2' });

    // After id change the reset effect fires
    expect(result.current.frameIndex).toBe(0);
  });
});

// ------------------------------------------------------------------
// Play / pause / toggle tests (fake timers)
// ------------------------------------------------------------------

describe('useVideoFrames — play / pause / toggle', () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    qc = makeQC();
  });

  afterEach(() => {
    vi.useRealTimers();
    qc.clear();
  });

  it('starts with isPlaying=false', () => {
    mockGet.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    expect(result.current.isPlaying).toBe(false);
  });

  it('play() sets isPlaying=true', () => {
    mockGet.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.play();
    });

    expect(result.current.isPlaying).toBe(true);
  });

  it('pause() sets isPlaying=false', () => {
    mockGet.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.play();
    });
    act(() => {
      result.current.pause();
    });

    expect(result.current.isPlaying).toBe(false);
  });

  it('toggle() flips isPlaying', () => {
    mockGet.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.toggle();
    });
    expect(result.current.isPlaying).toBe(true);

    act(() => {
      result.current.toggle();
    });
    expect(result.current.isPlaying).toBe(false);
  });

  it('playback interval advances frameIndex at 10 fps', () => {
    // Pre-seed the cache so container is available synchronously
    const payload = makeContainerPayload('vid-1', 10);
    qc.setQueryData(['video-frames', 'vid-1'], payload);
    mockGet.mockResolvedValue({ data: { data: payload } });

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.play();
    });

    // Advance 100 ms = 1 interval tick at 10 fps (PLAYBACK_INTERVAL_MS = 100)
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.frameIndex).toBe(1);

    act(() => {
      vi.advanceTimersByTime(300); // 3 more ticks
    });

    expect(result.current.frameIndex).toBe(4);
  });

  it('playback stops at the last frame (does not loop)', () => {
    const payload = makeContainerPayload('vid-1', 3);
    qc.setQueryData(['video-frames', 'vid-1'], payload);
    mockGet.mockResolvedValue({ data: { data: payload } });

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.play();
    });

    // Advance past all frames (3 frames × 100 ms = 300 ms)
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.frameIndex).toBe(2); // last frame
    expect(result.current.isPlaying).toBe(false);
  });
});
