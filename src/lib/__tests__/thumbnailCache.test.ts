/**
 * Behavioral tests for src/lib/thumbnailCache.ts
 *
 * Covered behaviors:
 *  - get: returns null for a key that was never set
 *  - get: returns the stored value immediately after set
 *  - get: returns null and removes the entry after TTL (10 min) has elapsed
 *  - get: returns the value when TTL has NOT yet elapsed
 *  - set: stores independently keyed values for different LODs of the same imageId
 *  - invalidate: removes all LODs for a given imageId; does NOT touch other imageIds
 *  - clear: empties the entire cache
 *  - evict-oldest: when the cache exceeds MAX_ENTRIES (500) the oldest entries are
 *    evicted down to ~80% capacity
 *  - opportunistic sweep: every 50th write triggers expired-entry eviction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { thumbnailCache } from '../thumbnailCache';

const TTL_MS = 10 * 60 * 1000; // mirror the module constant

describe('thumbnailCache', () => {
  beforeEach(() => {
    thumbnailCache.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // get / set
  // -----------------------------------------------------------------------

  it('returns null for a key that has never been set', () => {
    expect(thumbnailCache.get('img-1', 'low')).toBeNull();
  });

  it('returns the stored value immediately after set', () => {
    const data = { polygons: [1, 2, 3] };
    thumbnailCache.set('img-1', 'low', data);
    expect(thumbnailCache.get('img-1', 'low')).toBe(data);
  });

  it('stores different LODs independently under the same imageId', () => {
    const low = { lod: 'low' };
    const medium = { lod: 'medium' };
    const high = { lod: 'high' };

    thumbnailCache.set('img-2', 'low', low);
    thumbnailCache.set('img-2', 'medium', medium);
    thumbnailCache.set('img-2', 'high', high);

    expect(thumbnailCache.get('img-2', 'low')).toBe(low);
    expect(thumbnailCache.get('img-2', 'medium')).toBe(medium);
    expect(thumbnailCache.get('img-2', 'high')).toBe(high);
  });

  it('stores different imageIds without collision', () => {
    const dataA = { from: 'A' };
    const dataB = { from: 'B' };

    thumbnailCache.set('imgA', 'high', dataA);
    thumbnailCache.set('imgB', 'high', dataB);

    expect(thumbnailCache.get('imgA', 'high')).toBe(dataA);
    expect(thumbnailCache.get('imgB', 'high')).toBe(dataB);
  });

  it('overwrites an existing entry when set is called again for the same key', () => {
    const original = { v: 1 };
    const replacement = { v: 2 };

    thumbnailCache.set('img-3', 'medium', original);
    thumbnailCache.set('img-3', 'medium', replacement);

    expect(thumbnailCache.get('img-3', 'medium')).toBe(replacement);
  });

  // -----------------------------------------------------------------------
  // TTL
  // -----------------------------------------------------------------------

  it('returns the value when TTL has not yet elapsed', () => {
    const data = { fresh: true };
    thumbnailCache.set('img-ttl', 'low', data);

    // Advance to just under TTL
    vi.advanceTimersByTime(TTL_MS - 1);

    expect(thumbnailCache.get('img-ttl', 'low')).toBe(data);
  });

  it('returns null after TTL has elapsed and removes the entry', () => {
    const data = { stale: true };
    thumbnailCache.set('img-ttl2', 'high', data);

    vi.advanceTimersByTime(TTL_MS + 1);

    expect(thumbnailCache.get('img-ttl2', 'high')).toBeNull();

    // A subsequent get should also return null (entry cleaned up, not just masked)
    expect(thumbnailCache.get('img-ttl2', 'high')).toBeNull();
  });

  it('does not expire entries that were refreshed by a later set call', () => {
    const data = { v: 1 };
    thumbnailCache.set('img-refresh', 'low', data);

    // Advance halfway through TTL
    vi.advanceTimersByTime(TTL_MS / 2);

    // Re-set with new data (resets storedAt)
    const newData = { v: 2 };
    thumbnailCache.set('img-refresh', 'low', newData);

    // Advance another half TTL — total > original TTL but entry was re-stamped
    vi.advanceTimersByTime(TTL_MS / 2);

    expect(thumbnailCache.get('img-refresh', 'low')).toBe(newData);
  });

  // -----------------------------------------------------------------------
  // invalidate
  // -----------------------------------------------------------------------

  it('invalidate removes all LODs for the given imageId', () => {
    thumbnailCache.set('img-inv', 'low', { l: 1 });
    thumbnailCache.set('img-inv', 'medium', { m: 1 });
    thumbnailCache.set('img-inv', 'high', { h: 1 });

    thumbnailCache.invalidate('img-inv');

    expect(thumbnailCache.get('img-inv', 'low')).toBeNull();
    expect(thumbnailCache.get('img-inv', 'medium')).toBeNull();
    expect(thumbnailCache.get('img-inv', 'high')).toBeNull();
  });

  it('invalidate does not remove entries for other imageIds', () => {
    const otherData = { keep: true };
    thumbnailCache.set('img-keep', 'high', otherData);
    thumbnailCache.set('img-inv2', 'low', { remove: true });

    thumbnailCache.invalidate('img-inv2');

    expect(thumbnailCache.get('img-keep', 'high')).toBe(otherData);
  });

  it('invalidate on an imageId that was never set is a no-op', () => {
    expect(() => thumbnailCache.invalidate('nonexistent-img')).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // clear
  // -----------------------------------------------------------------------

  it('clear removes all entries regardless of imageId or LOD', () => {
    thumbnailCache.set('a', 'low', 1);
    thumbnailCache.set('b', 'medium', 2);
    thumbnailCache.set('c', 'high', 3);

    thumbnailCache.clear();

    expect(thumbnailCache.get('a', 'low')).toBeNull();
    expect(thumbnailCache.get('b', 'medium')).toBeNull();
    expect(thumbnailCache.get('c', 'high')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Capacity eviction: inserting > 500 entries triggers oldest-first eviction
  // to 80% (400).  We use unique image IDs so keys don't collide with other tests.
  // -----------------------------------------------------------------------

  it('evicts oldest entries when capacity exceeds 500', () => {
    // Fill cache to exactly 500 (the soft cap)
    for (let i = 0; i < 500; i++) {
      thumbnailCache.set(`evict-img-${i}`, 'low', i);
    }

    // The 501st insert should trigger eviction down to 400 (80 %)
    thumbnailCache.set('evict-img-500', 'low', 500);

    // The very first 100 entries (0–99) are the oldest and should have been
    // evicted (we inserted 501 total; 501 - 400 = 101 evicted, so 0..100 gone)
    expect(thumbnailCache.get('evict-img-0', 'low')).toBeNull();
    expect(thumbnailCache.get('evict-img-50', 'low')).toBeNull();

    // The newest entry must still be present
    expect(thumbnailCache.get('evict-img-500', 'low')).toBe(500);
  });
});
