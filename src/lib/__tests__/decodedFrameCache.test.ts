/**
 * The cache holds 4 MB objects, so the property that matters is not "does it
 * remember things" but "does it stay inside its budget while remembering the
 * right ones". These tests are about eviction order and byte accounting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DecodedFrameCache,
  decodedFrameCache,
  frameCacheKey,
  getOrDecode,
  __resetInFlightForTests,
} from '../decodedFrameCache';
import type { DecodedGray } from '../png16';

/** A decoded frame of exactly `bytes` bytes (16-bit ⇒ 2 bytes per sample). */
function frame(bytes: number): DecodedGray {
  return {
    width: bytes / 2,
    height: 1,
    bitDepth: 16,
    data: new Uint16Array(bytes / 2),
    min: 0,
    max: 0,
  };
}

describe('frameCacheKey', () => {
  it('separates the same frame in different channels', () => {
    expect(frameCacheKey('f1', 'DAPI')).not.toBe(frameCacheKey('f1', 'GFP'));
  });
});

describe('DecodedFrameCache', () => {
  it('returns what it stored and tracks bytes, not entries', () => {
    const c = new DecodedFrameCache(1000);
    c.set('a', frame(400));
    expect(c.get('a')?.data.byteLength).toBe(400);
    expect(c.byteSize).toBe(400);
    expect(c.size).toBe(1);
  });

  it('misses cleanly on an unknown key', () => {
    expect(new DecodedFrameCache(1000).get('nope')).toBeUndefined();
  });

  it('evicts the LEAST RECENTLY USED, not the oldest inserted', () => {
    // The distinction is the whole point during playback: stepping back to a
    // frame must keep it alive even though it was inserted first.
    const c = new DecodedFrameCache(1000);
    c.set('a', frame(400));
    c.set('b', frame(400));
    c.get('a'); // 'a' is now the young one
    c.set('c', frame(400)); // 1200 > 1000, something must go

    expect(c.get('b')).toBeUndefined(); // evicted
    expect(c.get('a')).toBeDefined();
    expect(c.get('c')).toBeDefined();
    expect(c.byteSize).toBe(800);
  });

  it('never exceeds its budget, however many frames arrive', () => {
    const c = new DecodedFrameCache(1000);
    for (let i = 0; i < 50; i++) c.set(`f${i}`, frame(400));
    expect(c.byteSize).toBeLessThanOrEqual(1000);
    expect(c.size).toBeLessThanOrEqual(2);
  });

  it('does not double-count a key that is overwritten', () => {
    const c = new DecodedFrameCache(1000);
    c.set('a', frame(400));
    c.set('a', frame(200));
    expect(c.byteSize).toBe(200);
    expect(c.size).toBe(1);
  });

  it('refuses a single frame bigger than the whole budget', () => {
    // Emptying the cache to make room for something that still will not fit is
    // the worst of both outcomes.
    const c = new DecodedFrameCache(1000);
    c.set('keep', frame(400));
    c.set('huge', frame(2000));

    expect(c.get('huge')).toBeUndefined();
    expect(c.get('keep')).toBeDefined();
    expect(c.byteSize).toBe(400);
  });

  it('keeps the just-stored entry even when it alone fills the budget', () => {
    const c = new DecodedFrameCache(1000);
    c.set('a', frame(400));
    c.set('b', frame(1000));

    expect(c.get('b')).toBeDefined();
    expect(c.get('a')).toBeUndefined();
    expect(c.byteSize).toBe(1000);
  });

  it('clear() resets the byte count too, not just the map', () => {
    const c = new DecodedFrameCache(1000);
    c.set('a', frame(400));
    c.clear();
    expect(c.size).toBe(0);
    expect(c.byteSize).toBe(0);
    c.set('b', frame(1000)); // would not fit if bytes had leaked
    expect(c.get('b')).toBeDefined();
  });
});

describe('getOrDecode', () => {
  beforeEach(() => {
    decodedFrameCache.clear();
    __resetInFlightForTests();
  });

  it('does not call the producer at all when the frame is cached', async () => {
    decodedFrameCache.set('k', frame(400));
    const produce = vi.fn();
    await expect(getOrDecode('k', produce)).resolves.toBeDefined();
    expect(produce).not.toHaveBeenCalled();
  });

  it('collapses concurrent requests for the same frame into ONE decode', async () => {
    // The real race: decode-ahead is working on frame N+1 when the playhead
    // arrives, the canvas misses the cache because the decode has not finished,
    // and without this both decode 4 MB of the same samples — with the
    // duplicate occupying a worker the next frame needs.
    let release!: (v: ReturnType<typeof frame>) => void;
    const produce = vi.fn(
      () => new Promise<ReturnType<typeof frame>>(res => (release = res))
    );

    const a = getOrDecode('k', produce);
    const b = getOrDecode('k', produce);
    expect(produce).toHaveBeenCalledTimes(1);

    release(frame(400));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb); // the same object, not two decodes of equal content
    expect(decodedFrameCache.get('k')).toBe(ra);
  });

  it('starts a fresh decode once the previous one has settled', async () => {
    const produce = vi.fn().mockResolvedValue(frame(400));
    await getOrDecode('k', produce);
    decodedFrameCache.clear();
    await getOrDecode('k', produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it('caches nothing and forgets the flight when the decode yields null', async () => {
    // Null is the decoder's ordinary "not a grayscale 8/16-bit PNG" answer, and
    // the caller has an 8-bit fallback for it. Leaving a null in flight would
    // wedge every later request for that frame.
    const produce = vi.fn().mockResolvedValue(null);
    await expect(getOrDecode('k', produce)).resolves.toBeNull();
    expect(decodedFrameCache.get('k')).toBeUndefined();

    await getOrDecode('k', produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it('does not wedge the key when the decode rejects', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('worker died'));
    await expect(getOrDecode('k', failing)).rejects.toThrow('worker died');

    const ok = vi.fn().mockResolvedValue(frame(400));
    await expect(getOrDecode('k', ok)).resolves.toBeDefined();
  });
});
