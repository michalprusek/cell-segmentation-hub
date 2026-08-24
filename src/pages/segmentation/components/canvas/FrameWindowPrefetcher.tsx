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
import { useDecodeAhead } from '../../hooks/useDecodeAhead';
import { anyWindowNeedsFullDepth } from '@/lib/playbackProxyWindow';
import { canDecodeWebpGray } from '@/lib/webpGray';

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
  const {
    visibleChannels,
    channel,
    channelCoverage,
    channelWindows,
    fallbackWindow,
    proxyRangeMax,
  } = useImageDisplay();
  // The same decision the canvas makes. Warming the representation the canvas
  // will not ask for is worse than not warming at all: it spends the request
  // budget and the HTTP cache on bytes nothing reads.
  const repr =
    canDecodeWebpGray() &&
    !anyWindowNeedsFullDepth(
      channelWindows,
      proxyRangeMax,
      visibleChannels,
      fallbackWindow
    )
      ? ('proxy' as const)
      : undefined;

  // The single-channel fallback uses `/display` (encoded as `null`
  // channel in `buildFrameImageUrl`). Multi-channel mode prefetches
  // every visible channel so MultiChannelCanvas's `fetch()` calls
  // hit the browser HTTP cache populated by `frameImageCache`.
  const channels =
    visibleChannels.length > 0 ? visibleChannels : channel ? [channel] : [];

  useFrameWindowPrefetch({
    repr,
    frames,
    currentIndex,
    channels,
    enabled,
    channelCoverage,
  });

  // Warming the HTTP cache above only removes the network from the critical
  // path; the ~25 ms per-channel decode was the half that stalled playback.
  // This runs a few frames ahead so the samples are already decoded when the
  // playhead arrives. Multi-channel only — the single-channel `/display` path
  // renders through an <img> and never decodes.
  useDecodeAhead({
    repr,
    frames,
    currentIndex,
    channels: visibleChannels,
    enabled,
    channelCoverage,
  });

  return null;
}
