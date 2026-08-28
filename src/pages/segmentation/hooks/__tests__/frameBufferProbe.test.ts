/**
 * Contract of the playback readiness probe.
 *
 * The gate is only as good as this function: it decides what "ready" means, and
 * an answer that disagrees with what `MultiChannelCanvas` / `CanvasImage`
 * actually read would either stall forever or gate on nothing. So the cases
 * here are the ones where the two could drift — the `repr` suffix, a partial
 * channel's uncovered frame, and the single-channel path whose readiness is not
 * observable at all.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { decodedFrameCache, frameCacheKey } from '@/lib/decodedFrameCache';
import { countBufferedFrames } from '../frameBufferProbe';
import { buildFrameImageUrl } from '../segmentationPolygonCache';
import type { DecodedGray } from '@/lib/png16';

// The `<img>` path's readiness lives in an element cache that only a real
// browser can fill; a Set of "loaded" URLs is the same contract.
const readyUrls = new Set<string>();
vi.mock('@/lib/rendering/FrameImageCache', () => ({
  frameImageCache: {
    isReady: (url: string) => readyUrls.has(url),
  },
}));

const frames = [
  { id: 'f0' },
  { id: 'f1' },
  { id: 'f2' },
  { id: 'f3' },
  { id: 'f4' },
];

function decoded(): DecodedGray {
  return {
    width: 2,
    height: 2,
    bitDepth: 8,
    data: new Uint8Array(4),
    min: 0,
    max: 255,
  } as unknown as DecodedGray;
}

function seed(frameId: string, channel: string, repr?: 'proxy') {
  decodedFrameCache.set(frameCacheKey(frameId, channel, repr), decoded());
}

describe('countBufferedFrames — multi-channel', () => {
  beforeEach(() => {
    decodedFrameCache.clear();
  });

  const base = {
    frames,
    index: 0,
    count: 3,
    channels: ['irm', 'tirf'],
    channelCoverage: {} as Record<string, string[]>,
    imgChannel: null,
  };

  it('counts a run of frames whose every visible channel is decoded', () => {
    seed('f0', 'irm');
    seed('f0', 'tirf');
    seed('f1', 'irm');
    seed('f1', 'tirf');
    expect(countBufferedFrames(base)).toBe(2);
  });

  it('stops at the first frame missing any one channel', () => {
    seed('f0', 'irm');
    seed('f0', 'tirf');
    seed('f1', 'irm'); // tirf missing
    seed('f2', 'irm');
    seed('f2', 'tirf');
    expect(countBufferedFrames(base)).toBe(1);
  });

  it('answers about the representation the canvas will request', () => {
    seed('f0', 'irm', 'proxy');
    seed('f0', 'tirf', 'proxy');
    // The canvas is asking for full-depth PNGs, so proxy samples are not it.
    expect(countBufferedFrames(base)).toBe(0);
    expect(countBufferedFrames({ ...base, repr: 'proxy' })).toBe(1);
  });

  it('treats a channel that does not cover the frame as satisfied', () => {
    // `tirf` is a sparse channel with no plane on f0 — the canvas skips it
    // there, so waiting for it would wait forever.
    seed('f0', 'irm');
    expect(
      countBufferedFrames({
        ...base,
        channelCoverage: { tirf: ['f1', 'f2'] },
      })
    ).toBe(1);
  });

  it('asks the cache without using it', () => {
    // `has` rather than `get`, so twenty polls a second while stalled cannot
    // reorder eviction. The order itself is asserted on the cache in
    // `decodedFrameCache.test.ts`; here it is only that the probe goes through
    // the non-promoting door.
    seed('f0', 'irm');
    seed('f0', 'tirf');
    const get = vi.spyOn(decodedFrameCache, 'get');
    const has = vi.spyOn(decodedFrameCache, 'has');
    countBufferedFrames(base);
    expect(has).toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    get.mockRestore();
    has.mockRestore();
  });

  it('stops at the end of the frame list rather than reporting phantom frames', () => {
    for (const id of ['f3', 'f4']) {
      seed(id, 'irm');
      seed(id, 'tirf');
    }
    expect(countBufferedFrames({ ...base, index: 3, count: 3 })).toBe(2);
  });
});

describe('countBufferedFrames — single-channel', () => {
  beforeEach(() => {
    readyUrls.clear();
  });

  it('reads the /display element cache when no channel is selected', () => {
    readyUrls.add(buildFrameImageUrl('f0', null));
    const n = countBufferedFrames({
      frames,
      index: 0,
      count: 3,
      channels: [],
      channelCoverage: {},
      imgChannel: null,
    });
    expect(n).toBe(1);
  });

  it('returns null (do not gate) for a named single channel', () => {
    // The window prefetcher warms that URL with a bare fetch, possibly in the
    // proxy representation — neither cache can answer for the bytes the <img>
    // will paint, so the honest answer is "unknown".
    expect(
      countBufferedFrames({
        frames,
        index: 0,
        count: 3,
        channels: [],
        channelCoverage: {},
        imgChannel: 'irm',
      })
    ).toBeNull();
  });
});
