import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FrameImageCache } from '../FrameImageCache';

// jsdom provides a working `Image` constructor but onload doesn't fire
// because no real network is involved. Override it so tests can drive
// load/error transitions deterministically.
class FakeImage {
  src = '';
  decoding = 'auto';
  loading = 'auto';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  /** Manually resolve the pending load — simulates HTTP success. */
  _fireLoad() {
    this.onload?.();
  }
  /** Manually reject the pending load — simulates HTTP error. */
  _fireError() {
    this.onerror?.();
  }
}

const originalImage = global.Image;
beforeEach(() => {
  (global as unknown as { Image: typeof FakeImage }).Image = FakeImage;
});

afterEach(() => {
  (global as unknown as { Image: typeof Image }).Image = originalImage;
});

describe('FrameImageCache', () => {
  it('returns undefined and miss-stats for an unknown url', () => {
    const cache = new FrameImageCache();
    expect(cache.get('/missing')).toBeUndefined();
    expect(cache.has('/missing')).toBe(false);
    expect(cache.isReady('/missing')).toBe(false);
    expect(cache.getStats()).toMatchObject({
      size: 0,
      ready: 0,
      hits: 0,
      misses: 1,
    });
  });

  it('prefetch dedupes concurrent requests for the same url', () => {
    const cache = new FrameImageCache();
    const p1 = cache.prefetch('/a.png');
    const p2 = cache.prefetch('/a.png');
    expect(p1).toBe(p2);
    expect(cache.getStats().size).toBe(1);
  });

  it('isReady flips true once onload fires', async () => {
    const cache = new FrameImageCache();
    const promise = cache.prefetch('/a.png');
    expect(cache.isReady('/a.png')).toBe(false);

    const img = cache.get('/a.png')! as unknown as FakeImage;
    img._fireLoad();
    await promise;

    expect(cache.isReady('/a.png')).toBe(true);
  });

  it('rejects the ready promise when the image errors', async () => {
    const cache = new FrameImageCache();
    const promise = cache.prefetch('/broken.png');
    const img = cache.get('/broken.png')! as unknown as FakeImage;
    img._fireError();
    await expect(promise).rejects.toThrow(/failed to load/);
    expect(cache.isReady('/broken.png')).toBe(false);
  });

  it('evicts oldest entries past maxEntries', () => {
    const cache = new FrameImageCache(2);
    cache.prefetch('/a');
    cache.prefetch('/b');
    cache.prefetch('/c');
    expect(cache.has('/a')).toBe(false);
    expect(cache.has('/b')).toBe(true);
    expect(cache.has('/c')).toBe(true);
  });

  it('get() promotes the entry so it survives the next eviction', () => {
    const cache = new FrameImageCache(2);
    cache.prefetch('/a');
    cache.prefetch('/b');
    // Touch /a — promotes it to MRU. /b should now evict first.
    cache.get('/a');
    cache.prefetch('/c');
    expect(cache.has('/a')).toBe(true);
    expect(cache.has('/b')).toBe(false);
    expect(cache.has('/c')).toBe(true);
  });

  it('abort cancels pending loads and removes the entry', () => {
    const cache = new FrameImageCache();
    cache.prefetch('/slow.png');
    const img = cache.get('/slow.png')! as unknown as FakeImage;
    expect(img.src).toBe('/slow.png');
    cache.abort('/slow.png');
    expect(cache.has('/slow.png')).toBe(false);
  });

  it('readyCount reports loaded URLs only', async () => {
    const cache = new FrameImageCache();
    const a = cache.prefetch('/a');
    cache.prefetch('/b'); // never loaded
    (cache.get('/a')! as unknown as FakeImage)._fireLoad();
    await a;
    expect(cache.readyCount(['/a', '/b', '/c'])).toBe(1);
  });

  it('clear cancels pending entries and resets stats', () => {
    const cache = new FrameImageCache();
    cache.prefetch('/a');
    cache.prefetch('/b');
    cache.clear();
    expect(cache.getStats()).toMatchObject({ size: 0, hits: 0, misses: 0 });
  });
});
