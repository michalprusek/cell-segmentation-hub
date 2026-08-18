/**
 * The cache holds 4 MB objects, so the property that matters is not "does it
 * remember things" but "does it stay inside its budget while remembering the
 * right ones". These tests are about eviction order and byte accounting.
 */

import { describe, it, expect } from 'vitest';
import { DecodedFrameCache, frameCacheKey } from '../decodedFrameCache';
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
