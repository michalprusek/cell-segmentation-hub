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

import { useCallback, useEffect, useRef } from 'react';
import { useImageDisplay } from '../../contexts/ImageDisplayContext';
import {
  useFrameWindowPrefetch,
  type FrameMinimal,
} from '../../hooks/useFrameWindowPrefetch';
import { useDecodeAhead } from '../../hooks/useDecodeAhead';
import {
  countBufferedFrames,
  type FrameBufferProbe,
} from '../../hooks/frameBufferProbe';
import { anyWindowNeedsFullDepth } from '@/lib/playbackProxyWindow';
import { canDecodeWebpGray } from '@/lib/webpGray';

interface FrameWindowPrefetcherProps {
  frames: readonly FrameMinimal[];
  currentIndex: number;
  enabled: boolean;
  /** `useVideoFrames.registerBufferProbe`. This component is where the probe
   *  has to be built: the playback loop lives above `ImageDisplayProvider` and
   *  therefore cannot see the visible channels, the coverage map or the
   *  representation that decide which cache entries the canvas will read. */
  registerBufferProbe?: (probe: FrameBufferProbe | null) => void;
}

export default function FrameWindowPrefetcher({
  frames,
  currentIndex,
  enabled,
  registerBufferProbe,
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

  // Playback readiness. The probe is a STABLE callback reading the latest
  // inputs through a ref: the playback loop keeps it across ticks, and giving
  // it a new identity on every channel/window change would re-run the register
  // effect at the rate the window slider ticks.
  const probeInputsRef = useRef({
    frames,
    visibleChannels,
    channel,
    channelCoverage,
    repr,
  });
  probeInputsRef.current = {
    frames,
    visibleChannels,
    channel,
    channelCoverage,
    repr,
  };
  const bufferProbe = useCallback<FrameBufferProbe>((index, count) => {
    const inputs = probeInputsRef.current;
    return countBufferedFrames({
      frames: inputs.frames,
      index,
      count,
      channels: inputs.visibleChannels,
      channelCoverage: inputs.channelCoverage,
      repr: inputs.repr,
      imgChannel: inputs.channel,
    });
  }, []);

  useEffect(() => {
    if (!registerBufferProbe) return;
    registerBufferProbe(enabled ? bufferProbe : null);
    return () => registerBufferProbe(null);
  }, [registerBufferProbe, bufferProbe, enabled]);

  return null;
}
