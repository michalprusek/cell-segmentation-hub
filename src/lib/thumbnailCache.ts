/**
 * Lightweight in-memory thumbnail cache used by segmentation update hooks.
 * Stores thumbnail polygon data keyed by imageId + level-of-detail.
 */

type LevelOfDetail = 'low' | 'medium' | 'high';

interface CacheEntry {
  data: unknown;
  storedAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(imageId: string, lod: LevelOfDetail): string {
  return `${imageId}:${lod}`;
}

export const thumbnailCache = {
  async get(imageId: string, lod: LevelOfDetail): Promise<unknown | null> {
    const entry = cache.get(cacheKey(imageId, lod));
    return entry ? entry.data : null;
  },

  async set(imageId: string, lod: LevelOfDetail, data: unknown): Promise<void> {
    cache.set(cacheKey(imageId, lod), { data, storedAt: Date.now() });
  },

  async invalidate(imageId: string): Promise<void> {
    for (const key of cache.keys()) {
      if (key.startsWith(`${imageId}:`)) {
        cache.delete(key);
      }
    }
  },

  async clear(): Promise<void> {
    cache.clear();
  },
};
