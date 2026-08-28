/**
 * "Are the next N frames ready to show?" — the readiness signal playback gates
 * on.
 *
 * WHY. `useVideoFrames` used to advance `frameIndex` on a bare 100 ms
 * `setInterval` with no idea whether the frame it was leaving had ever reached
 * the screen. Measured on the 621-frame ND2 through a 400 kbps / 200 ms link:
 * the playhead ran 0 → 254 in 25 s (10.2 fps, exactly the timer) while only 18
 * distinct frame images arrived, the loading overlay was up 87 % of the time,
 * and 224 of the 254 transitions left a frame the canvas had not painted. That
 * is the user-visible "frames skip, the video is stuck, it says Loading frame".
 *
 * WHAT COUNTS AS READY. Not "the canvas emitted onLoad" — that signal is keyed
 * on the URL `imageId`, which during playback trails `frameIndex` by a
 * navigation, so it cannot answer "is frame N ready" without a race. It is the
 * DECODE caches instead: the very things the frame prefetcher and the
 * decode-ahead walk fill, and the very things `MultiChannelCanvas` looks in
 * before it does any work. A frame whose samples are all resident composites in
 * a couple of milliseconds, which is what "will not stutter" means.
 *
 * The rules mirror what the renderer actually asks for, because a probe that
 * checked a different key than the canvas reads would gate on nothing:
 *
 *   - Multi-channel (`visibleChannels` non-empty → `MultiChannelCanvas`):
 *     ready iff every channel that COVERS the frame is in `decodedFrameCache`
 *     under the same `repr` the canvas will request. A partial channel that
 *     does not cover the frame is skipped exactly as `fetchChannels` skips it,
 *     so a sparse channel's gap frame is "ready without it" rather than
 *     "forever missing" — `does not exist` and `not loaded yet` are different
 *     states (PR #377).
 *   - Single channel via `/display` (`<img>`, no channel selected): ready iff
 *     `frameImageCache` has the element loaded. That is the URL
 *     `useFrameWindowPrefetch` warms for this case and the URL `CanvasImage`
 *     shows, so the two agree.
 *   - Single channel with a NAMED channel selected: `null` — unknown. The
 *     window prefetcher warms that URL with a bare `fetch` (and possibly the
 *     proxy representation), so neither cache can be asked about the bytes the
 *     `<img>` will actually paint. `null` means "do not gate", i.e. the
 *     pre-existing free-running behaviour, which is the only safe answer for a
 *     path whose readiness is not observable.
 */

import { decodedFrameCache, frameCacheKey } from '@/lib/decodedFrameCache';
import { frameImageCache } from '@/lib/rendering/FrameImageCache';
import { buildFrameImageUrl } from './segmentationPolygonCache';

export interface BufferProbeFrame {
  id: string;
}

/**
 * How many consecutive frames starting at `index` are ready, examining at most
 * `count`. `null` means readiness is not observable for the current render path
 * and the caller must not gate on it.
 */
export type FrameBufferProbe = (index: number, count: number) => number | null;

export interface CountBufferedFramesOptions {
  frames: readonly BufferProbeFrame[];
  index: number;
  count: number;
  /** `visibleChannels`. Empty means the single-channel `<img>` path. */
  channels: readonly string[];
  /** channel → frame ids it covers. A channel absent from the map covers all. */
  channelCoverage: Record<string, string[]>;
  /** The representation the canvas will ask for — must match, or the probe
   *  answers about samples nothing will read. */
  repr?: 'proxy';
  /** Selected channel for the single-channel `<img>` path (`null` → /display). */
  imgChannel: string | null;
}

function isMultiChannelFrameReady(
  frameId: string,
  channels: readonly string[],
  channelCoverage: Record<string, string[]>,
  repr: 'proxy' | undefined
): boolean {
  // `every` on the empty set is true, and deliberately so: a frame that no
  // visible channel covers is one the canvas paints blank immediately.
  return channels.every(channel => {
    const coverage = channelCoverage[channel];
    if (coverage && !coverage.includes(frameId)) return true;
    return decodedFrameCache.has(frameCacheKey(frameId, channel, repr));
  });
}

export function countBufferedFrames({
  frames,
  index,
  count,
  channels,
  channelCoverage,
  repr,
  imgChannel,
}: CountBufferedFramesOptions): number | null {
  if (channels.length === 0 && imgChannel !== null) return null;

  let ready = 0;
  for (let i = 0; i < count; i++) {
    const frame = frames[index + i];
    if (!frame) break;
    const ok =
      channels.length > 0
        ? isMultiChannelFrameReady(frame.id, channels, channelCoverage, repr)
        : frameImageCache.isReady(buildFrameImageUrl(frame.id, null));
    if (!ok) break;
    ready++;
  }
  return ready;
}
