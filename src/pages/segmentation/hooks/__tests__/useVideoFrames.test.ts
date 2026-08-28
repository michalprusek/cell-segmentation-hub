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
 *  - Buffer gate: stalls instead of skipping, resumes by itself, re-buffers to
 *    a watermark, and gives up on a frame that never arrives
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

// ------------------------------------------------------------------
// Buffer-aware playback (fake timers)
//
// The bug these cover: the loop used to advance on a bare interval whether or
// not the frame it was moving onto existed yet, so on a slow link the playhead
// ran away from the picture. Measured on the 621-frame ND2 through 400 kbps:
// 254 frames traversed, 18 images actually delivered, the loading overlay up
// 87% of the time. The gate makes the playhead wait for the buffer instead.
// ------------------------------------------------------------------

describe('useVideoFrames — buffer-gated playback', () => {
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

  /** Renders the hook over a seeded container and registers `probe`. */
  function playWith(probe: (index: number, count: number) => number | null) {
    const payload = makeContainerPayload('vid-1', 40);
    qc.setQueryData(['video-frames', 'vid-1'], payload);
    mockGet.mockResolvedValue({ data: { data: payload } });

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });
    act(() => {
      result.current.registerBufferProbe(probe);
      result.current.play();
    });
    return result;
  }

  it('holds the playhead on the current frame while the next one is not buffered', () => {
    const result = playWith(() => 0);

    act(() => {
      vi.advanceTimersByTime(1000); // ten frame times
    });

    expect(result.current.frameIndex).toBe(0);
    // Stalled, NOT paused — the distinction the play button has to show.
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.isBuffering).toBe(true);
  });

  it('resumes on its own once the buffer fills, with no further input', () => {
    let buffered = 0;
    const result = playWith(() => buffered);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.frameIndex).toBe(0);
    expect(result.current.isBuffering).toBe(true);

    // The prefetch window catches up. Nobody touches the play button.
    buffered = 3;
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.isBuffering).toBe(false);
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.frameIndex).toBeGreaterThan(0);
  });

  it('needs a run of frames to resume, not just the next one', () => {
    // Resuming on a single frame is what turns a stall into a stutter: advance
    // once, find the frame after it missing, stall again.
    let buffered = 0;
    const result = playWith(() => buffered);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.isBuffering).toBe(true);

    buffered = 1; // one frame is enough to KEEP flowing, not to resume
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.frameIndex).toBe(0);
    expect(result.current.isBuffering).toBe(true);

    buffered = 3;
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.frameIndex).toBe(1);
  });

  it('advances on a single ready frame while it is already flowing', () => {
    // The low watermark. Demanding the resume depth on every tick would cap
    // playback at whatever the decode-ahead walk happens to be holding.
    const result = playWith(() => 1);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.frameIndex).toBe(3);
    expect(result.current.isBuffering).toBe(false);
  });

  it('steps over a frame that never buffers rather than hanging for ever', () => {
    const result = playWith(() => 0);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.frameIndex).toBe(0);

    // MAX_STALL_MS is 6 s of NO progress; past it the frame is presumed dead
    // (404, decode error) and playback steps over it.
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(result.current.frameIndex).toBeGreaterThan(0);
    expect(result.current.isPlaying).toBe(true);
  });

  it('keeps waiting while the buffer is still growing', () => {
    // A slow-but-progressing link must not trip the give-up clock: it restarts
    // whenever the probe reports more than it did before, so the budget is
    // "time since the buffer last grew", not "time since the stall began".
    let buffered = 0;
    const result = playWith(() => buffered);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.isBuffering).toBe(true);

    buffered = 1;
    act(() => {
      vi.advanceTimersByTime(1000); // under the budget, measured from the growth
    });
    expect(result.current.frameIndex).toBe(0);

    buffered = 2; // grew again → the clock restarts
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.frameIndex).toBe(0);
    expect(result.current.isBuffering).toBe(true);

    buffered = 3; // the resume watermark
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.frameIndex).toBe(1);
    expect(result.current.isBuffering).toBe(false);
  });

  it('does not gate when the probe cannot tell (single named channel)', () => {
    const result = playWith(() => null);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.frameIndex).toBe(3);
    expect(result.current.isBuffering).toBe(false);
  });

  it('does not leave the spinner stuck when the container object is replaced', () => {
    // `container` is a fresh object on every ['video-frames', id] invalidation
    // (a channel rename does exactly that), so the playback effect restarts
    // mid-play. Stall bookkeeping that restarted with it would believe the
    // spinner is off while the state still says on, and nothing would ever turn
    // it back off.
    const payload = makeContainerPayload('vid-1', 40);
    qc.setQueryData(['video-frames', 'vid-1'], payload);
    mockGet.mockResolvedValue({ data: { data: payload } });

    let buffered = 0;
    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });
    act(() => {
      result.current.registerBufferProbe(() => buffered);
      result.current.play();
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.isBuffering).toBe(true);

    // What a channel rename produces: same frames, a payload that differs. It
    // has to actually differ — React Query's structural sharing keeps the old
    // object when the new one is deeply equal, and then nothing restarts.
    act(() => {
      qc.setQueryData(['video-frames', 'vid-1'], {
        ...payload,
        name: 'renamed while playing',
      });
    });
    // React Query's notify is scheduled, and fake timers hold it: without this
    // flush the hook never sees the new container and the effect never restarts
    // — the test would pass on a version that has the bug.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current.container?.name).toBe('renamed while playing');
    buffered = 3;
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current.frameIndex).toBeGreaterThan(0);
    expect(result.current.isBuffering).toBe(false);
  });

  it('gives up on the resume DEPTH quickly when the next frame is ready', () => {
    // One permanently dead frame inside the horizon caps the count below the
    // watermark for ever. Charging the full no-progress budget for that would
    // freeze 6 s at a time on frames that were decoded all along, so a stall
    // that is only short of the DEPTH is bounded far tighter.
    let buffered = 0;
    const result = playWith(() => buffered);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.frameIndex).toBe(0);

    buffered = 1; // enough to show, never enough to resume
    act(() => {
      vi.advanceTimersByTime(1300); // under REBUFFER_MAX_MS — still holding
    });
    expect(result.current.frameIndex).toBe(0);

    act(() => {
      vi.advanceTimersByTime(400); // past it, and far short of MAX_STALL_MS
    });
    expect(result.current.frameIndex).toBeGreaterThan(0);
  });

  it('clears the buffering flag when the user pauses mid-stall', () => {
    const result = playWith(() => 0);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.isBuffering).toBe(true);

    act(() => {
      result.current.pause();
    });
    expect(result.current.isBuffering).toBe(false);
    expect(result.current.isPlaying).toBe(false);
  });

  it('stops at the last frame even when the buffer is full', () => {
    const payload = makeContainerPayload('vid-1', 3);
    qc.setQueryData(['video-frames', 'vid-1'], payload);
    mockGet.mockResolvedValue({ data: { data: payload } });

    const { result } = renderHook(() => useVideoFrames('vid-1'), {
      wrapper: wrapQC(qc),
    });
    act(() => {
      result.current.registerBufferProbe(() => 3);
      result.current.play();
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.frameIndex).toBe(2);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isBuffering).toBe(false);
  });
});
