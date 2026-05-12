/**
 * Composes the video-mode UI (frame slider, channel switcher, window/level
 * slider, kymograph modal) into a single overlay that the
 * SegmentationEditor can mount when the active image is a video
 * container. Keeps the editor itself agnostic of video specifics so the
 * static-image code path stays untouched.
 *
 * Wired up via two hooks on the editor side:
 *   const overlay = useVideoModeOverlay(imageId);
 *   {overlay.isActive && <VideoModeOverlay {...overlay.props} />}
 */

import { useCallback, useEffect, useState } from 'react';
import { ChannelSwitcher } from './ChannelSwitcher';
import { FrameSlider } from './FrameSlider';
import { WindowLevelSlider } from './WindowLevelSlider';
import { KymographModal } from './KymographModal';
import {
  ImageDisplayProvider,
  useImageDisplay,
} from '../contexts/ImageDisplayContext';
import { useVideoFrames, VideoFrame } from '../hooks/useVideoFrames';
import type { ProjectType, VideoChannel } from '@/types';

interface VideoModeOverlayProps {
  videoContainerId: string;
  projectType?: ProjectType;
  /** Called whenever the editor should reload its polygons for a different
   *  frame imageId. */
  onActiveFrameChange?: (frame: VideoFrame | null) => void;
}

/** Top-of-canvas controls: channel + window/level. Bottom-of-canvas
 *  controls (frame slider) are rendered separately so the layout
 *  matches the editor's existing left-toolbar / bottom-controls split. */
function TopControls({
  channels,
}: {
  channels: VideoChannel[] | null | undefined;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-background border-b">
      <ChannelSwitcher channels={channels} />
      <WindowLevelSlider />
    </div>
  );
}

/** Keyboard handler: ←/→ step frames, Space toggle playback. Mounted on
 *  document so it works regardless of which subtree has focus, but
 *  yields to inputs / textareas so the user can still type frame numbers. */
function useFrameNavigationKeys(
  step: (delta: number) => void,
  toggle: () => void
) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      } else if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [step, toggle]);
}

function VideoModeOverlayInner({
  videoContainerId,
  projectType,
  onActiveFrameChange,
}: VideoModeOverlayProps) {
  const {
    container,
    frameIndex,
    currentFrame,
    setFrameIndex,
    step,
    isPlaying,
    toggle,
    fps,
    setFps,
  } = useVideoFrames(videoContainerId);
  const { setFrameIndex: setDisplayFrame } = useImageDisplay();

  useFrameNavigationKeys(step, toggle);

  // Propagate frame changes outward: tell the editor "load polygons for
  // this image id" and update the display context.
  useEffect(() => {
    setDisplayFrame(frameIndex);
    onActiveFrameChange?.(currentFrame);
  }, [frameIndex, currentFrame, setDisplayFrame, onActiveFrameChange]);

  // Kymograph modal state — selected polyline + open flag. The editor
  // wires PolygonContextMenu around its polyline-body hit area and calls
  // openKymograph with the polylineId.
  const [kymographFor, setKymographFor] = useState<string | null>(null);
  const openKymograph = useCallback(
    (polylineId: string) => setKymographFor(polylineId),
    []
  );
  const closeKymograph = useCallback(() => setKymographFor(null), []);

  // Expose to the editor via DOM events — the editor's existing
  // PolygonContextMenu wiring dispatches 'segmentation:open-kymograph'
  // when the user picks "Show kymograph" in the right-click menu.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ polylineId: string }>).detail;
      if (detail?.polylineId) openKymograph(detail.polylineId);
    };
    document.addEventListener('segmentation:open-kymograph', handler);
    return () =>
      document.removeEventListener('segmentation:open-kymograph', handler);
  }, [openKymograph]);

  if (!container) return null;

  return (
    <>
      <TopControls channels={container.channels} />
      <FrameSlider
        frameIndex={frameIndex}
        frameCount={container.frameCount}
        isPlaying={isPlaying}
        fps={fps}
        onFrameChange={setFrameIndex}
        onStep={step}
        onToggle={toggle}
        onFpsChange={setFps}
      />
      {kymographFor && projectType === 'microtubules' && (
        <KymographModal
          open={true}
          onClose={closeKymograph}
          videoContainerId={videoContainerId}
          polylineId={kymographFor}
          frameIndex={frameIndex}
          channels={container.channels}
        />
      )}
    </>
  );
}

export function VideoModeOverlay(props: VideoModeOverlayProps) {
  return (
    <ImageDisplayProvider>
      <VideoModeOverlayInner {...props} />
    </ImageDisplayProvider>
  );
}

/** Convenience helper for the editor: returns the overlay props bundle
 *  if the given image is a video container, null otherwise. The editor
 *  can early-return without any video pieces when null. */
export function useVideoModeProps(
  imageId: string | null | undefined,
  isVideoContainer: boolean | undefined,
  projectType?: ProjectType
): VideoModeOverlayProps | null {
  if (!imageId || !isVideoContainer) return null;
  return { videoContainerId: imageId, projectType };
}
