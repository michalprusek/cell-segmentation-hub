/**
 * Frame navigation hook for video-container images.
 *
 * Given a video container image ID, loads its child frame metadata via a
 * single React Query (cached 60 s), exposes ``frameIndex`` (currently
 * displayed) + setters + a play/pause loop running at ``fps`` (default
 * 10). Per-frame image prefetching is *not* owned here — that lives in
 * SegmentationEditor's adjacent-image prefetch helper. This hook only
 * owns the frame-list metadata + playback loop.
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '@/lib/api';
import { logger } from '@/lib/logger';
import type { FrameBufferProbe } from './frameBufferProbe';
import type { VideoChannel, ProjectImage } from '@/types';

// Playback rate is fixed at 10 fps — biology users' target. The
// user-facing FPS combobox was removed in the 2026-05 editor UI
// reorganization since switching rates mid-playback wasn't useful in
// practice and only added top-bar clutter.
const PLAYBACK_FPS = 10;
const PLAYBACK_INTERVAL_MS = 1000 / PLAYBACK_FPS;

/** How often a stalled playhead re-asks whether the next frame has arrived.
 *
 *  Well under the frame budget on purpose: this is the granularity of the delay
 *  a stall adds, so at 50 ms a frame that becomes ready mid-wait costs at most
 *  half a frame time instead of a whole one. It is a poll because the buffer
 *  lives in two plain caches (`decodedFrameCache`, `frameImageCache`) that
 *  nothing subscribes to — and a poll of a few Map lookups, only while stalled,
 *  is cheaper than making them observable. */
const BUFFER_RECHECK_MS = 50;

/** Frames to have ready before RESUMING from a stall (the current frame plus
 *  this many after it).
 *
 *  Resuming the instant one frame lands is what turns a stall into a stutter:
 *  the playhead advances once, immediately finds the frame after it missing,
 *  and stalls again. So the low watermark (advance) is 1 frame and the high
 *  watermark (resume) is 3 — see `DECODE_AHEAD_FRAMES`, which is also 3, so
 *  this is exactly the depth the decode-ahead walk maintains, minus the one
 *  still in flight. Demanding more would wait for work nothing is doing. */
const REBUFFER_FRAMES = 3;

/** Longest a stall may go WITHOUT the buffer growing before playback gives up
 *  on the frame and steps over it.
 *
 *  A frame can be permanently unavailable — a 404, a decode that threw, a
 *  channel the server cannot serve — and nothing else in this loop would ever
 *  free it. The clock resets whenever the probe reports more frames ready than
 *  it did before, so a genuinely slow link keeps waiting as long as it is
 *  making progress; only a buffer that is stuck outright runs it out. */
const MAX_STALL_MS = 6000;

export interface VideoFrame {
  id: string;
  frameIndex: number;
  /** Same union used elsewhere by ProjectImage so consumers don't need
   *  to map between divergent string sets. */
  segmentationStatus: NonNullable<ProjectImage['segmentationStatus']>;
}

export interface VideoContainerMeta {
  id: string;
  name: string;
  frameCount: number;
  width: number | null;
  height: number | null;
  videoDurationMs: number | null;
  channels: VideoChannel[] | null;
  frames: VideoFrame[];
}

interface UseVideoFramesResult {
  container: VideoContainerMeta | null;
  isLoading: boolean;
  error: Error | null;
  frameIndex: number;
  currentFrame: VideoFrame | null;
  setFrameIndex: (i: number) => void;
  step: (delta: number) => void;
  isPlaying: boolean;
  /** Playing, but held on the current frame because the next one has not
   *  finished loading. Distinct from `!isPlaying`: nothing was paused and
   *  playback resumes by itself. Surface it — a play button that shows "Pause"
   *  over a frozen picture is lying about which of the two is happening. */
  isBuffering: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Supplies the readiness signal playback gates on. Called by
   *  `FrameWindowPrefetcher`, which lives inside `ImageDisplayProvider` and so
   *  is the only place that knows the visible channels and representation the
   *  canvas will ask for. Pass `null` to unregister; with no probe registered
   *  playback free-runs on the timer exactly as it did before. */
  registerBufferProbe: (probe: FrameBufferProbe | null) => void;
}

/** Internal client helper. Backend currently returns frames sorted by
 *  ``frameIndex`` ascending; we re-sort defensively. */
async function fetchVideoContainer(
  videoContainerId: string
): Promise<VideoContainerMeta> {
  const { data } = await apiClient.get(
    `/images/${videoContainerId}/video-frames`
  );
  // The route returns the container fields + a frames array. We don't
  // strictly own the API client wrapper, so guard against either shape.
  const payload = data?.data ?? data;
  const frames: VideoFrame[] = (payload?.frames ?? [])
    .slice()
    .sort((a: VideoFrame, b: VideoFrame) => a.frameIndex - b.frameIndex);
  return {
    id: payload.id,
    name: payload.name,
    frameCount: payload.frameCount ?? frames.length,
    width: payload.width ?? null,
    height: payload.height ?? null,
    videoDurationMs: payload.videoDurationMs ?? null,
    channels: payload.channels ?? null,
    frames,
  };
}

export function useVideoFrames(
  videoContainerId: string | null
): UseVideoFramesResult {
  const { data, isLoading, error } = useQuery({
    queryKey: ['video-frames', videoContainerId],
    queryFn: () => fetchVideoContainer(videoContainerId as string),
    enabled: !!videoContainerId,
    staleTime: 60_000,
    // Keep the previous container's frame metadata visible while a
    // background refetch is in flight (token refresh, network blip).
    // Without this the slider snaps to 0/0 and the canvas dims during
    // the brief window before fresh data arrives — same trade-off as
    // the editor's overlay debounce: stale-then-correct is smoother
    // than empty-then-correct.
    placeholderData: keepPreviousData,
  });
  // `placeholderData: keepPreviousData` means `data` can still be the
  // PREVIOUS container's frames briefly while a new container loads
  // — guard so the consumer never derives `currentFrame` from a
  // mismatched container (see review pass-2 #1).
  const container = data && data.id === videoContainerId ? data : null;

  const [frameIndex, setFrameIndexState] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);

  // Latest frameIndex for the playback loop to read. The loop must not list
  // `frameIndex` as an effect dependency — re-creating the timer on every frame
  // would reset the interval phase and make the cadence jitter — so it reads
  // the position through a ref instead of a closure snapshot.
  const frameIndexRef = useRef(frameIndex);
  frameIndexRef.current = frameIndex;

  // Registered by FrameWindowPrefetcher; null until it mounts (and always null
  // outside video mode), which is the "do not gate" case.
  const bufferProbeRef = useRef<FrameBufferProbe | null>(null);
  const registerBufferProbe = useCallback((probe: FrameBufferProbe | null) => {
    bufferProbeRef.current = probe;
  }, []);

  // Reset frameIndex when the container itself changes — without
  // this, navigating from a 600-frame video at index 250 to a
  // 50-frame video would derive a stale frame for one render.
  useEffect(() => {
    setFrameIndexState(0);
    setIsPlaying(false);
  }, [videoContainerId]);

  // Clamp index whenever the frame list changes (e.g., on first load).
  useEffect(() => {
    if (!container) return;
    if (frameIndex >= container.frames.length) {
      setFrameIndexState(Math.max(0, container.frames.length - 1));
    }
  }, [container, frameIndex]);

  const setFrameIndex = useCallback(
    (i: number) => {
      if (!container) return;
      const clamped = Math.max(
        0,
        Math.min(container.frames.length - 1, Math.floor(i))
      );
      setFrameIndexState(clamped);
    },
    [container]
  );

  const step = useCallback(
    (delta: number) => {
      setFrameIndexState(prev => {
        if (!container) return prev;
        return Math.max(0, Math.min(container.frames.length - 1, prev + delta));
      });
    },
    [container]
  );

  // Play/pause loop — a self-rescheduling timeout rather than a bare interval
  // (requestAnimationFrame would over-render at 60fps; 10fps is the biology
  // user's target).
  //
  // It advances ONLY onto a frame that is already buffered. Waiting instead of
  // skipping is the whole point: the old fixed interval moved the index whether
  // or not the canvas had caught up, so on any link slower than 10 frames a
  // second the playhead ran away from the picture — frames skipped, "Loading
  // frame…" over a video that claimed to be playing. Two watermarks keep the
  // wait from becoming a stutter of its own: one ready frame is enough to keep
  // flowing, but coming OUT of a stall needs `REBUFFER_FRAMES`, so a resume has
  // a run of frames behind it rather than a single one.
  //
  // `isPlaying` deliberately stays true across a stall — the user asked for
  // stop-and-resume, not stop-and-stay-stopped — so the loop picks itself back
  // up with no input. `isBuffering` is what says which of the two is happening.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isPlaying || !container) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setIsBuffering(false);
      return;
    }

    const frames = container.frames;
    // Stall bookkeeping is per playback session, so it lives in the effect
    // rather than in refs: pausing and playing again starts a fresh one.
    let stalledSince: number | null = null;
    let bestBuffered = -1;
    let bufferingShown = false;

    const setBuffering = (value: boolean) => {
      if (value === bufferingShown) return;
      bufferingShown = value;
      setIsBuffering(value);
    };

    const schedule = (delay: number) => {
      timerRef.current = setTimeout(tick, delay);
    };

    function tick() {
      const prev = frameIndexRef.current;
      const next = prev + 1;
      if (next >= frames.length) {
        // Stop at the end. Could loop instead, but for a kymograph
        // workflow stopping is the safer default.
        setBuffering(false);
        setIsPlaying(false);
        return;
      }

      // Ask about the resume depth every time, not just the depth we need right
      // now: the extra frames are what tell a slow-but-progressing buffer apart
      // from a stuck one, and the probe's answer is what resets the give-up
      // clock below.
      const horizon = Math.min(REBUFFER_FRAMES, frames.length - next);
      const buffered = bufferProbeRef.current?.(next, horizon) ?? null;
      const required = stalledSince === null ? 1 : horizon;

      if (buffered !== null && buffered < required) {
        const now = Date.now();
        if (stalledSince === null || buffered > bestBuffered) {
          // Either the stall just began, or the buffer grew since the last
          // look — both mean progress, so the give-up clock restarts.
          stalledSince = now;
          bestBuffered = buffered;
        }
        setBuffering(true);
        if (now - stalledSince < MAX_STALL_MS) {
          schedule(BUFFER_RECHECK_MS);
          return;
        }
        // Bounded, so a frame that will never arrive cannot hang playback for
        // good. Step over it; the buffering indicator was up the whole time.
        logger.debug(
          `useVideoFrames: frame ${next} never buffered (${buffered}/${required} after ${MAX_STALL_MS} ms) — skipping`
        );
      }

      stalledSince = null;
      bestBuffered = -1;
      setBuffering(false);
      frameIndexRef.current = next;
      setFrameIndexState(next);
      schedule(PLAYBACK_INTERVAL_MS);
    }

    schedule(PLAYBACK_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [isPlaying, container]);

  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const toggle = useCallback(() => setIsPlaying(p => !p), []);

  return {
    container,
    isLoading,
    error: error as Error | null,
    frameIndex,
    currentFrame: container?.frames[frameIndex] ?? null,
    setFrameIndex,
    step,
    isPlaying,
    isBuffering,
    play,
    pause,
    toggle,
    registerBufferProbe,
  };
}
