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
  /** The container has channels whose list may not be applied yet; see
   *  `VideoFrameImage`. Until it is, the visible set is empty and this
   *  component would warm `/display` for the whole window. */
  awaitChannelSetup?: boolean;
}

export default function FrameWindowPrefetcher({
  frames,
  currentIndex,
  enabled,
  registerBufferProbe,
  awaitChannelSetup = false,
}: FrameWindowPrefetcherProps) {
  const {
    visibleChannels,
    channel,
    channelCoverage,
    channelWindows,
    fallbackWindow,
    proxyRangeMax,
    channelsSeeded,
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

  // Hold the neighbours back until the displayed frame has decoded.
  //
  // No visible channel has a window before that first decode, and the gate
  // above answers "full depth" for a channel it cannot judge — right for the
  // canvas, whose first decode is what measures the window, but it sent the
  // prefetcher after the neighbours' 16-bit PNGs at the same moment. Measured
  // on production at 10 Mbit/s (container dbf5e30c, 2026-09-14): the Min/Max
  // sliders appeared after 27.0 s, with 21.5 MB started to show a frame that
  // needs about 10. Once any window exists the frame is on screen, and the
  // warm proceeds in whichever representation the gate then picks.
  const setupPending = awaitChannelSetup && !channelsSeeded;
  const awaitingFirstDecode =
    visibleChannels.length > 0 &&
    !visibleChannels.some(c => channelWindows[c] !== undefined);
  const imagesEnabled = !setupPending && !awaitingFirstDecode;

  useFrameWindowPrefetch({
    repr,
    frames,
    currentIndex,
    channels,
    enabled,
    channelCoverage,
    imagesEnabled,
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
    enabled: enabled && imagesEnabled,
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
