/**
 * Headless video-mode wiring for the segmentation editor.
 *
 * Previously this component owned the entire visual chrome (channel
 * switcher, window/level, frame slider, FPS combobox). After the
 * 2026-05 reorganization those pieces moved into the editor's header
 * (Play, scrubber, editable frame #) and the right sidebar (Channels
 * card, Display card with 4 sliders).
 *
 * What remains here:
 *   1. Keyboard navigation (`←` / `→` step a frame, `Space` toggles
 *      playback). Mounted on `document` so it works regardless of focus.
 *   2. Sync of `frameIndex` from `useVideoFrames` into `ImageDisplayContext`
 *      so the canvas + sidebar consume one source of truth.
 *   3. The kymograph modal mount (microtubule projects only) — opened
 *      via the global "segmentation:open-kymograph" CustomEvent from
 *      the polyline right-click menu.
 *
 * The component renders nothing visible by itself.
 */

import { useCallback, useEffect, useState } from 'react';
import { KymographModal } from './KymographModal';
import { useImageDisplay } from '../contexts/ImageDisplayContext';
import { useVideoFrames, VideoFrame } from '../hooks/useVideoFrames';
import type { ProjectType } from '@/types';

interface VideoModeOverlayProps {
  videoContainerId: string;
  projectType?: ProjectType;
  /** Called whenever the editor should reload its polygons for a different
   *  frame imageId. */
  onActiveFrameChange?: (frame: VideoFrame | null) => void;
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

export function VideoModeOverlay({
  videoContainerId,
  projectType,
  onActiveFrameChange,
}: VideoModeOverlayProps) {
  const { container, frameIndex, currentFrame, step, toggle } =
    useVideoFrames(videoContainerId);
  const { setFrameIndex: setDisplayFrame } = useImageDisplay();

  useFrameNavigationKeys(step, toggle);

  // Propagate frame changes outward: tell the editor "load polygons for
  // this image id" and update the display context. The editor itself
  // also calls useVideoFrames (lifted in commit 3) — both calls share
  // React Query cache via the queryKey, but each has its own local
  // frameIndex state. We only sync the *displayed* index here.
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
  if (!kymographFor || projectType !== 'microtubules') return null;

  return (
    <KymographModal
      open={true}
      onClose={closeKymograph}
      videoContainerId={videoContainerId}
      polylineId={kymographFor}
      frameIndex={frameIndex}
      channels={container.channels}
    />
  );
}

/** Convenience helper for the editor: returns the overlay props bundle
 *  if the given image is a video container, null otherwise. The editor
 *  can early-return without any video pieces when null. */
// eslint-disable-next-line react-refresh/only-export-components
export function useVideoModeProps(
  imageId: string | null | undefined,
  isVideoContainer: boolean | undefined,
  projectType?: ProjectType
): VideoModeOverlayProps | null {
  if (!imageId || !isVideoContainer) return null;
  return { videoContainerId: imageId, projectType };
}
