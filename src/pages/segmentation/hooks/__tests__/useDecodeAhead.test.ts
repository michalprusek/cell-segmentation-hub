/**
 * Decode-ahead is speculative work running next to the frame the user is
 * actually watching, so the properties worth pinning are about restraint:
 * it must not re-decode what is cached, must not run in single-channel mode,
 * must stop when the playhead moves, and must never let a failure escape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDecodeAhead } from '../useDecodeAhead';
import { decodedFrameCache, frameCacheKey } from '@/lib/decodedFrameCache';
import * as client from '@/lib/png16Client';
import type { DecodedGray } from '@/lib/png16';
import {
  MAX_SPECULATIVE_REQUESTS,
  speculativeFrameRequests,
} from '@/lib/requestThrottle';

const DECODED: DecodedGray = {
  width: 1,
  height: 1,
  bitDepth: 16,
  data: new Uint16Array([1]),
  min: 1,
  max: 1,
};

const frames = Array.from({ length: 10 }, (_, i) => ({ id: `frame-${i}` }));

beforeEach(() => {
  decodedFrameCache.clear();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    // A real Response always has headers; the hook reads `X-Proxy-Range` off
    // them to learn what an 8-bit proxy's 255 stands for.
    headers: new Headers(),
    blob: async () => new Blob(['png']),
  }) as unknown as typeof fetch;
  vi.spyOn(client, 'decodeGrayPngPooled').mockResolvedValue(DECODED);
});

afterEach(() => {
  vi.restoreAllMocks();
  decodedFrameCache.clear();
});

describe('useDecodeAhead', () => {
  it('decodes the next frames into the cache, ahead of the playhead', async () => {
    renderHook(() =>
      useDecodeAhead({
        frames,
        currentIndex: 0,
        channels: ['a'],
        enabled: true,
      })
    );

    await waitFor(() =>
      expect(decodedFrameCache.get(frameCacheKey('frame-3', 'a'))).toBeDefined()
    );
    // Three ahead, and NOT the current frame — that one is the canvas's job and
    // racing it would waste a worker slot on a duplicate.
    expect(
      decodedFrameCache.get(frameCacheKey('frame-0', 'a'))
    ).toBeUndefined();
    expect(
      decodedFrameCache.get(frameCacheKey('frame-4', 'a'))
    ).toBeUndefined();
  });

  it('does nothing in single-channel mode', async () => {
    // The `/display` path renders through an <img>; there is no decode to skip.
    renderHook(() =>
      useDecodeAhead({ frames, currentIndex: 0, channels: [], enabled: true })
    );
    await new Promise(r => setTimeout(r, 20));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', async () => {
    renderHook(() =>
      useDecodeAhead({
        frames,
        currentIndex: 0,
        channels: ['a'],
        enabled: false,
      })
    );
    await new Promise(r => setTimeout(r, 20));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('skips frames already decoded', async () => {
    decodedFrameCache.set(frameCacheKey('frame-1', 'a'), DECODED);
    decodedFrameCache.set(frameCacheKey('frame-2', 'a'), DECODED);
    renderHook(() =>
      useDecodeAhead({
        frames,
        currentIndex: 0,
        channels: ['a'],
        enabled: true,
      })
    );

    await waitFor(() =>
      expect(decodedFrameCache.get(frameCacheKey('frame-3', 'a'))).toBeDefined()
    );
    // Only the one that was missing.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('honours per-channel coverage instead of 404ing on partial channels', async () => {
    renderHook(() =>
      useDecodeAhead({
        frames,
        currentIndex: 0,
        channels: ['a'],
        enabled: true,
        channelCoverage: { a: ['frame-2'] },
      })
    );

    await waitFor(() =>
      expect(decodedFrameCache.get(frameCacheKey('frame-2', 'a'))).toBeDefined()
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('swallows a failed prefetch rather than surfacing it', async () => {
    // Speculative work: losing it costs an opportunity, and the displayed frame
    // will fetch the channel itself.
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    const { unmount } = renderHook(() =>
      useDecodeAhead({
        frames,
        currentIndex: 0,
        channels: ['a'],
        enabled: true,
      })
    );
    await new Promise(r => setTimeout(r, 20));
    expect(decodedFrameCache.size).toBe(0);
    expect(() => unmount()).not.toThrow();
  });

  it('draws from the SAME limiter as the window prefetcher', async () => {
    // The two hooks run side by side and compete for one nginx rate-limit
    // zone, so they have to share one budget. A private limiter here would
    // guarantee only that this hook alone stays polite while the pair of them
    // busted the zone — which is how the 503s happened.
    const release: Array<() => void> = [];
    for (let i = 0; i < MAX_SPECULATIVE_REQUESTS; i++) {
      void speculativeFrameRequests
        .schedule(() => new Promise<void>(r => release.push(r)))
        .catch(() => undefined);
    }
    expect(release).toHaveLength(MAX_SPECULATIVE_REQUESTS);

    renderHook(() =>
      useDecodeAhead({
        frames,
        currentIndex: 0,
        channels: ['a'],
        enabled: true,
      })
    );

    // Every slot is taken by (simulated) window warms: decode-ahead waits its
    // turn instead of adding a request on top.
    await new Promise(r => setTimeout(r, 20));
    expect(global.fetch).not.toHaveBeenCalled();

    release.forEach(r => r());
    await waitFor(() =>
      expect(decodedFrameCache.get(frameCacheKey('frame-3', 'a'))).toBeDefined()
    );
  });

  it('stops walking when the playhead moves on', async () => {
    const { rerender, unmount } = renderHook(
      ({ i }) =>
        useDecodeAhead({
          frames,
          currentIndex: i,
          channels: ['a'],
          enabled: true,
        }),
      { initialProps: { i: 0 } }
    );
    rerender({ i: 5 });
    await waitFor(() =>
      expect(decodedFrameCache.get(frameCacheKey('frame-8', 'a'))).toBeDefined()
    );
    unmount();
  });
});
