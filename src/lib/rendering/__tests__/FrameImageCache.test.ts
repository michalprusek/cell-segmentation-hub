import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('rejects only after retries are exhausted', async () => {
    vi.useFakeTimers();
    try {
      const cache = new FrameImageCache();
      const promise = cache.prefetch('/broken.png');
      // Swallow the eventual rejection so unhandled-rejection
      // diagnostics in the test runner don't blow up — we assert
      // on it via the wrapped promise below.
      const settled = expect(promise).rejects.toThrow(/after 3 retries/);
      // Each error fire schedules the next attempt via setTimeout;
      // we need 1 initial + 3 retries = 4 onerror events. The retry
      // body re-assigns `image.src`, which on the fake harness does
      // NOT auto-fire — so we keep grabbing the entry's image and
      // firing manually.
      let img = cache.get('/broken.png')! as unknown as FakeImage;
      img._fireError();
      await vi.advanceTimersByTimeAsync(300);
      img = cache.get('/broken.png')! as unknown as FakeImage;
      img._fireError();
      await vi.advanceTimersByTimeAsync(600);
      img = cache.get('/broken.png')! as unknown as FakeImage;
      img._fireError();
      await vi.advanceTimersByTimeAsync(1200);
      img = cache.get('/broken.png')! as unknown as FakeImage;
      img._fireError();
      await settled;
      expect(cache.isReady('/broken.png')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers after a transient error via automatic retry', async () => {
    vi.useFakeTimers();
    try {
      const cache = new FrameImageCache();
      const promise = cache.prefetch('/flaky.png');
      // First attempt fails — cache should schedule retry, not reject.
      const img1 = cache.get('/flaky.png')! as unknown as FakeImage;
      img1._fireError();
      // Promise must still be pending: race a sentinel that resolves
      // immediately on the next microtask.
      const racer = await Promise.race([
        promise
          .then(() => 'resolved' as const)
          .catch(() => 'rejected' as const),
        Promise.resolve('pending' as const),
      ]);
      expect(racer).toBe('pending');
      // Advance past the first backoff and let the second attempt
      // succeed. The same Image element is reused, so the onload
      // handler is still attached.
      await vi.advanceTimersByTimeAsync(300);
      const img2 = cache.get('/flaky.png')! as unknown as FakeImage;
      img2._fireLoad();
      await expect(promise).resolves.toBeTruthy();
      expect(cache.isReady('/flaky.png')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
