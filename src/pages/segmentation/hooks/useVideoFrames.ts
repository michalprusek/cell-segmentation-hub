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

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '@/lib/api';
import type { VideoChannel, ProjectImage } from '@/types';

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
  play: () => void;
  pause: () => void;
  toggle: () => void;
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
  });
  const container = data ?? null;

  const [frameIndex, setFrameIndexState] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Playback rate is fixed at 10 fps — biology users' target. The
  // user-facing FPS combobox was removed in the 2026-05 editor UI
  // reorganization since switching frame rates mid-playback wasn't
  // useful in practice and only added top-bar clutter.
  const PLAYBACK_FPS = 10;
  const PLAYBACK_INTERVAL_MS = 1000 / PLAYBACK_FPS;

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

  // Play/pause loop — driven by setInterval (requestAnimationFrame would
  // over-render at 60fps; 10fps is the biology user's target).
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!isPlaying || !container) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setInterval(() => {
      setFrameIndexState(prev => {
        if (!container) return prev;
        if (prev + 1 >= container.frames.length) {
          // Stop at the end. Could loop instead, but for a kymograph
          // workflow stopping is the safer default.
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, PLAYBACK_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
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
    play,
    pause,
    toggle,
  };
}
