/**
 * Canvas image source resolver for video-mode editing.
 *
 * Resolves the right URL for the canvas `<img>`:
 *   - Video mode: /api/images/<currentFrameId>/frame-data?channel=<channel>
 *     so flipping the channel in the sidebar swaps PNG to the right
 *     per-channel file, and so changing frameIndex (Play / scrubber /
 *     Next / Back) follows the play head instead of staying on the
 *     URL imageId.
 *   - Otherwise: pass through the static URL the parent computed.
 *
 * The playback-time prefetch loop that used to live here has been
 * promoted into `useFrameWindowPrefetch` (driven by
 * `FrameWindowPrefetcher`), which now warms the cache symmetrically
 * around the current frame for both scrub and playback.
 *
 * Lives in the JSX subtree wrapped by ImageDisplayProvider so it can
 * read the current channel via useImageDisplay().
 */

import { useMemo } from 'react';
import CanvasImage from './CanvasImage';
import MultiChannelCanvas from './MultiChannelCanvas';
import { useImageDisplay } from '../../contexts/ImageDisplayContext';
import { buildFrameImageUrl } from '../../hooks/segmentationPolygonCache';

interface VideoFrameImageProps {
  /** True when the row is part of a video container. Off → fallback. */
  isVideoMode: boolean;
  /** Frame id from useVideoFrames.currentFrame.id — drives playback,
   *  scrubber, prev/next. */
  currentFrameId: string | null;
  /** Static image URL used when not in video mode (standalone image). */
  fallbackSrc: string;
  /** Forwarded to <CanvasImage>. */
  width?: number;
  height?: number;
  alt?: string;
  onLoad?: (width: number, height: number) => void;
}

export default function VideoFrameImage({
  isVideoMode,
  currentFrameId,
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
      return buildFrameImageUrl(currentFrameId, channel);
    }
    return fallbackSrc;
  }, [isVideoMode, currentFrameId, channel, fallbackSrc]);

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
