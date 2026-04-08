/**
 * Lightweight in-memory thumbnail cache used by segmentation update hooks.
 * Stores thumbnail polygon data keyed by imageId + level-of-detail.
 *
 * Bounded with TTL eviction (default 10 min) and a max-entry soft cap to
 * prevent unbounded memory growth in long-lived browser sessions. Issue #75.
 */

type LevelOfDetail = 'low' | 'medium' | 'high';

interface CacheEntry {
  data: unknown;
  storedAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ENTRIES = 500;

const cache = new Map<string, CacheEntry>();

function cacheKey(imageId: string, lod: LevelOfDetail): string {
  return `${imageId}:${lod}`;
}

function isExpired(entry: CacheEntry, now: number): boolean {
  return now - entry.storedAt > TTL_MS;
}

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (isExpired(entry, now)) {
      cache.delete(key);
    }
  }
}

function evictOldestIfOverCapacity(): void {
  if (cache.size <= MAX_ENTRIES) return;
  // Map iterates in insertion order, so the oldest entry is the first one.
  // Evict down to 80% of the cap so we don't thrash on every insert.
  const target = Math.floor(MAX_ENTRIES * 0.8);
  const iter = cache.keys();
  while (cache.size > target) {
    const next = iter.next();
    if (next.done) break;
    cache.delete(next.value);
  }
}

export const thumbnailCache = {
  get(imageId: string, lod: LevelOfDetail): unknown | null {
    const entry = cache.get(cacheKey(imageId, lod));
    if (!entry) return null;
    if (isExpired(entry, Date.now())) {
      cache.delete(cacheKey(imageId, lod));
      return null;
    }
    return entry.data;
  },

  set(imageId: string, lod: LevelOfDetail, data: unknown): void {
    cache.set(cacheKey(imageId, lod), { data, storedAt: Date.now() });
    evictOldestIfOverCapacity();
    // Opportunistically sweep expired entries on write so the cache
    // doesn't grow unbounded even if nothing ever reads it back.
    if (cache.size % 50 === 0) {
      evictExpired();
    }
  },

  invalidate(imageId: string): void {
    for (const key of cache.keys()) {
      if (key.startsWith(`${imageId}:`)) {
        cache.delete(key);
      }
    }
  },

  clear(): void {
    cache.clear();
  },
};
