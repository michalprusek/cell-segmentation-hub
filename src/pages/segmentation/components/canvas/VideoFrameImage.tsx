/**
 * Canvas image source resolver for video-mode editing.
 *
 * Two jobs:
 *   1. Compute the right URL for the canvas <img>:
 *      - Video mode: /api/images/<currentFrameId>/frame-data?channel=<channel>
 *        so flipping the channel in the sidebar swaps PNG to the right
 *        per-channel file, and so changing frameIndex (Play / scrubber /
 *        Next / Back) follows the play head instead of staying on the
 *        URL imageId.
 *      - Otherwise: pass through the static URL the parent computed.
 *   2. Prefetch the next N frames while playback is live so when the
 *      timer ticks, the browser already has the PNG cached and the
 *      <img> swap is instant rather than a full HTTP roundtrip per
 *      frame.
 *
 * Lives in the JSX subtree wrapped by ImageDisplayProvider so it can
 * read the current channel via useImageDisplay().
 */

import { useEffect, useMemo } from 'react';
import CanvasImage from './CanvasImage';
import MultiChannelCanvas from './MultiChannelCanvas';
import { useImageDisplay } from '../../contexts/ImageDisplayContext';

interface VideoFrameImageProps {
  /** True when the row is part of a video container. Off → fallback. */
  isVideoMode: boolean;
  /** Frame id from useVideoFrames.currentFrame.id — drives playback,
   *  scrubber, prev/next. */
  currentFrameId: string | null;
  /** Frame ids to warm in the browser HTTP cache. Caller supplies the
   *  ones it expects the user to hit next (e.g. the next 10 forward
   *  frames during playback). */
  upcomingFrameIds?: string[];
  /** Static image URL used when not in video mode (standalone image). */
  fallbackSrc: string;
  /** Forwarded to <CanvasImage>. */
  width?: number;
  height?: number;
  alt?: string;
  onLoad?: (width: number, height: number) => void;
}

const PREFETCH_FRAME_COUNT = 10;

/** Build the per-channel display URL for one video frame. The channel
 *  query is omitted when there is no active channel (single-channel
 *  videos / channel-context not initialised yet); the backend resolver
 *  falls back to the segmentation-source channel in that case. */
function buildFrameSrc(frameId: string, channel: string | null): string {
  if (channel) {
    return `/api/images/${frameId}/frame-data?channel=${encodeURIComponent(channel)}`;
  }
  return `/api/images/${frameId}/display`;
}

export default function VideoFrameImage({
  isVideoMode,
  currentFrameId,
  upcomingFrameIds,
  fallbackSrc,
  width,
  height,
  alt,
  onLoad,
}: VideoFrameImageProps) {
  const { channel, visibleChannels, channelColors } = useImageDisplay();

  // Compute the legacy single-channel URL. We still use it when there
  // is no multi-channel overlay configured (visibleChannels is empty)
  // and for non-video standalone images. The MultiChannelCanvas pipeline
  // takes over the moment the user picks any channels.
  const src = useMemo(() => {
    if (isVideoMode && currentFrameId) {
      return buildFrameSrc(currentFrameId, channel);
    }
    return fallbackSrc;
  }, [isVideoMode, currentFrameId, channel, fallbackSrc]);

  // Prefetch warm-up: kick off HTTP requests for the upcoming frames so
  // the browser has them cached when the <img> src swap happens. We
  // never read the resulting Image objects — they exist only to populate
  // the disk/memory cache. Cleanup via .src = '' aborts in-flight
  // requests when the dependency changes (e.g. user pauses).
  useEffect(() => {
    if (!isVideoMode || !upcomingFrameIds || upcomingFrameIds.length === 0) {
      return;
    }
    const slice = upcomingFrameIds.slice(0, PREFETCH_FRAME_COUNT);
    const handles: HTMLImageElement[] = [];
    for (const frameId of slice) {
      const img = new Image();
      img.src = buildFrameSrc(frameId, channel);
      handles.push(img);
    }
    return () => {
      for (const img of handles) {
        // Setting src='' is the documented way to cancel a pending
        // HTTP request issued by `new Image()`. Browsers ignore the
        // partial response and the connection is reused.
        img.src = '';
      }
    };
  }, [isVideoMode, upcomingFrameIds, channel]);

  // Multi-channel overlay mode: composite each visible channel via
  // canvas with per-channel colour + min/max LUT remap. Falls through
  // to the legacy single-channel <img> when there are no visible
  // channels picked (covers standalone images and the first paint
  // before initialisation has run).
  if (isVideoMode && currentFrameId && visibleChannels.length > 0) {
    return (
      <MultiChannelCanvas
        frameId={currentFrameId}
        visibleChannels={visibleChannels}
        channelColors={channelColors}
        width={width}
        height={height}
        onLoad={onLoad}
      />
    );
  }

  return (
    <CanvasImage
      src={src}
      width={width}
      height={height}
      alt={alt}
      onLoad={onLoad}
    />
  );
}
