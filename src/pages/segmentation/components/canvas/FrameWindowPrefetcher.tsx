/**
 * Headless component that drives the sliding-window frame prefetch
 * from inside the `ImageDisplayProvider` subtree.
 *
 * Reads `visibleChannels` from `useImageDisplay()` (only available
 * under the provider) and forwards everything else from props. The
 * editor mounts this once next to the canvas so the prefetch hook
 * fires whenever the container, frame index, or channel set changes.
 *
 * Returns null — all side effects live inside `useFrameWindowPrefetch`.
 */

import { useImageDisplay } from '../../contexts/ImageDisplayContext';
import {
  useFrameWindowPrefetch,
  type FrameMinimal,
} from '../../hooks/useFrameWindowPrefetch';

interface FrameWindowPrefetcherProps {
  frames: readonly FrameMinimal[];
  currentIndex: number;
  enabled: boolean;
}

export default function FrameWindowPrefetcher({
  frames,
  currentIndex,
  enabled,
}: FrameWindowPrefetcherProps) {
  const { visibleChannels, channel, channelCoverage } = useImageDisplay();

  // The single-channel fallback uses `/display` (encoded as `null`
  // channel in `buildFrameImageUrl`). Multi-channel mode prefetches
  // every visible channel so MultiChannelCanvas's `fetch()` calls
  // hit the browser HTTP cache populated by `frameImageCache`.
  const channels =
    visibleChannels.length > 0 ? visibleChannels : channel ? [channel] : [];

  useFrameWindowPrefetch({
    frames,
    currentIndex,
    channels,
    enabled,
    channelCoverage,
  });

  return null;
}
