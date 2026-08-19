/**
 * Decode the next few frames BEFORE they are displayed.
 *
 * The existing `useFrameWindowPrefetch` warms the HTTP cache, so a frame's
 * compressed bytes are usually already local when the playhead reaches it. That
 * was never the expensive half: un-filtering a 1474x1412 16-bit channel costs
 * ~10 ms of JavaScript on top of ~15 ms of inflate, and with two channels the
 * editor stalled on the loading gate every time playback outran the warm window.
 *
 * This closes the gap: the decoded samples land in `decodedFrameCache` ahead of
 * the playhead, so `MultiChannelCanvas` finds them already there and the frame
 * costs a cache lookup.
 *
 * DELIBERATELY MODEST, and sequential. Speculative work must never delay the
 * frame the user is actually looking at, so this decodes ONE channel at a time
 * and only a few frames ahead. The worker pool dispatches to its least-loaded
 * worker, so a displayed frame's two channels still go out in parallel while
 * this trickles along behind them.
 *
 * Its fetches go through `speculativeFrameRequests`, the SAME limiter
 * `useFrameWindowPrefetch` uses. Sequential-per-hook is not a budget: the two
 * hooks run concurrently and compete for one nginx rate-limit zone, so a
 * private limit here would only guarantee that this hook alone stays polite.
 */

import { useEffect, useRef } from 'react';
import { decodeGrayPngPooled } from '@/lib/png16Client';
import {
  decodedFrameCache,
  frameCacheKey,
  getOrDecode,
} from '@/lib/decodedFrameCache';
import { buildFrameImageUrl } from './segmentationPolygonCache';
import { speculativeFrameRequests } from '@/lib/requestThrottle';
import { logger } from '@/lib/logger';

/** Frames to run ahead of the playhead. Three covers the decode latency of a
 *  frame at playback rates without turning the cache over faster than the
 *  5-back window can benefit from. */
export const DECODE_AHEAD_FRAMES = 3;

export interface DecodeAheadFrame {
  id: string;
}

interface UseDecodeAheadOptions {
  frames: readonly DecodeAheadFrame[];
  currentIndex: number;
  /** Visible channel names. Empty (single-channel `/display` mode) disables
   *  this entirely — that path renders through an `<img>` and never decodes. */
  channels: readonly string[];
  enabled: boolean;
  /** channel → frame ids it covers. Absent means "covers every frame". */
  channelCoverage?: Record<string, string[]>;
  lookahead?: number;
}

export function useDecodeAhead({
  frames,
  currentIndex,
  channels,
  enabled,
  channelCoverage = {},
  lookahead = DECODE_AHEAD_FRAMES,
}: UseDecodeAheadOptions): void {
  const channelsKey = channels.join('|');
  // Read inside the effect without making it a dependency: a new object
  // identity for the same coverage must not restart the walk.
  const coverageRef = useRef(channelCoverage);
  coverageRef.current = channelCoverage;
  const framesRef = useRef(frames);
  framesRef.current = frames;
  // Same reason, and it matters more here: `channels` used to be a raw
  // dependency, so every parent render that rebuilt the array aborted the walk
  // and restarted it — re-issuing the fetches of anything not yet decoded.
  // `channelsKey` is the primitive fingerprint that actually changes content.
  const channelsRef = useRef(channels);
  channelsRef.current = channels;

  useEffect(() => {
    if (!enabled || channelsRef.current.length === 0) return;
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      const all = framesRef.current;
      const coverage = coverageRef.current;
      const activeChannels = channelsRef.current;
      for (let step = 1; step <= lookahead; step++) {
        const frame = all[currentIndex + step];
        if (!frame) return;
        for (const channel of activeChannels) {
          if (cancelled) return;
          const covers = coverage[channel];
          if (covers && !covers.includes(frame.id)) continue;
          const key = frameCacheKey(frame.id, channel);
          if (decodedFrameCache.get(key)) continue;
          try {
            // Through the SHARED throttle. The fetch and the body read are
            // inside the slot because that whole cycle is what nginx counts
            // and what bounds the issue rate; the DECODE deliberately is not —
            // it is worker CPU, not a request, and holding a request slot
            // during it would starve the window prefetcher for no reason.
            const blob = await speculativeFrameRequests.schedule(async () => {
              const res = await fetch(buildFrameImageUrl(frame.id, channel), {
                signal: controller.signal,
              });
              if (!res.ok) return null;
              return res.blob();
            }, controller.signal);
            if (cancelled) return;
            if (!blob) continue;
            // Shared entry point with MultiChannelCanvas: if the playhead has
            // just arrived at this frame and started its own decode, we join it
            // instead of duplicating it.
            await getOrDecode(key, () => decodeGrayPngPooled(blob));
            if (cancelled) return;
          } catch (err) {
            if (controller.signal.aborted) return;
            // Speculative work: a failure here costs nothing but the
            // opportunity, and the displayed frame will fetch it itself.
            logger.debug(
              `useDecodeAhead: skipped ${channel} of ${frame.id.slice(0, 8)}`,
              err
            );
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `channels` is intentionally absent: `channelsKey` fingerprints it, and
    // depending on the array identity restarted (and re-fetched) the walk on
    // every unrelated parent render. Reading it through `channelsRef` is what
    // keeps exhaustive-deps satisfied without lying to it.
  }, [enabled, currentIndex, channelsKey, lookahead]);
}
