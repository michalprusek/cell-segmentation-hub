import { describe, expect, it } from 'vitest';
import { BoundingBoxCache } from '../BoundingBoxCache';

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('BoundingBoxCache', () => {
  it('computes the bounding box on first lookup', () => {
    const cache = new BoundingBoxCache();
    const box = cache.get('a', square);

    expect(box.minX).toBe(0);
    expect(box.minY).toBe(0);
    expect(box.maxX).toBe(10);
    expect(box.maxY).toBe(10);

    const stats = cache.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(1);
    expect(stats.size).toBe(1);
  });

  it('reuses the cached box when points reference is unchanged', () => {
    const cache = new BoundingBoxCache();
    const first = cache.get('a', square);
    const second = cache.get('a', square);

    expect(second).toBe(first);
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it('recomputes when points reference changes (mutation-safe)', () => {
    const cache = new BoundingBoxCache();
    cache.get('a', square);

    const moved = square.map(p => ({ x: p.x + 100, y: p.y }));
    const box = cache.get('a', moved);

    expect(box.minX).toBe(100);
    expect(box.maxX).toBe(110);
  });

  it('bulk lookup returns boxes for all requested ids', () => {
    const cache = new BoundingBoxCache();
    const triangle = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 3 },
    ];

    const result = cache.getBulkBoundingBoxes([
      { id: 'a', points: square },
      { id: 'b', points: triangle },
    ]);

    expect(result.size).toBe(2);
    expect(result.get('a')?.maxX).toBe(10);
    expect(result.get('b')?.maxY).toBe(3);
  });

  it('invalidate forces recomputation on next lookup', () => {
    const cache = new BoundingBoxCache();
    cache.get('a', square);
    cache.invalidate('a');

    cache.get('a', square);
    const stats = cache.getStats();
    expect(stats.misses).toBe(2);
  });

  it('rejects invalid maxEntries at construction time', () => {
    expect(() => new BoundingBoxCache(0)).toThrow(/maxEntries/);
    expect(() => new BoundingBoxCache(-1)).toThrow(/maxEntries/);
    expect(() => new BoundingBoxCache(Infinity)).toThrow(/maxEntries/);
    expect(() => new BoundingBoxCache(NaN)).toThrow(/maxEntries/);
  });

  it('evicts least-recently-used entry when over capacity', () => {
    const cache = new BoundingBoxCache(2);
    cache.get('a', square);
    cache.get('b', square);
    cache.get('a', square); // re-touches a -> b is now oldest
    cache.get('c', square); // should evict b

    expect(cache.getStats().size).toBe(2);
    // 'b' was evicted — asking for it with the same array should still
    // work (recomputes) but registers a miss.
    const missesBefore = cache.getStats().misses;
    cache.get('b', square);
    expect(cache.getStats().misses).toBe(missesBefore + 1);
  });
});
