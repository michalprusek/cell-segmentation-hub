import { logger } from '@/lib/logger';

interface ThumbnailCacheEntry {
  id: string;
  imageId: string;
  levelOfDetail: 'low' | 'medium' | 'high';
  thumbnailData: any;
  cachedAt: number;
  expiresAt: number;
}

interface CacheStats {
  totalSize: number;
  entryCount: number;
  hitRate: number;
  memoryUsage: number;
}

class ThumbnailCache {
  private dbName = 'SegmentationThumbnailCache';
  private dbVersion = 1;
  private storeName = 'thumbnails';
  private db: IDBDatabase | null = null;

  // Memory cache for frequently accessed thumbnails
  private memoryCache = new Map<string, ThumbnailCacheEntry>();
  private maxMemoryEntries = 100;

  // Cache statistics
  private stats = {
    hits: 0,
    misses: 0,
    memoryHits: 0,
    dbHits: 0,
  };

  // Cache TTL: 24 hours for thumbnails
  private readonly TTL = 24 * 60 * 60 * 1000;

  // Store the initialization promise
  private ready: Promise<void>;

  constructor() {
    this.ready = this.initDB();
  }

  /**
   * Initialize IndexedDB
   */
  private async initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        logger.error(
          'Failed to open IndexedDB for thumbnail cache',
          request.error,
          'ThumbnailCache'
        );
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        logger.debug(
          '📦 Thumbnail cache IndexedDB initialized',
          'ThumbnailCache'
        );
        resolve();
      };

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store for thumbnails
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('imageId', 'imageId', { unique: false });
          store.createIndex('levelOfDetail', 'levelOfDetail', {
            unique: false,
          });
          store.createIndex('expiresAt', 'expiresAt', { unique: false });

          logger.debug(
            '📦 Created thumbnail cache object store',
            'ThumbnailCache'
          );
        }
      };
    });
  }

  /**
   * Generate cache key
   */
  private getCacheKey(
    imageId: string,
    levelOfDetail: 'low' | 'medium' | 'high'
  ): string {
    return `${imageId}:${levelOfDetail}`;
  }

  /**
   * Get thumbnail from cache
   */
  async get(
    imageId: string,
    levelOfDetail: 'low' | 'medium' | 'high' = 'low'
  ): Promise<any | null> {
    await this.ready;
    const cacheKey = this.getCacheKey(imageId, levelOfDetail);

    // Check memory cache first
    const memoryEntry = this.memoryCache.get(cacheKey);
    if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
      this.stats.hits++;
      this.stats.memoryHits++;

      logger.debug('🎯 Thumbnail cache hit (memory)', 'ThumbnailCache', {
        imageId,
        levelOfDetail,
        cacheKey,
      });

      return memoryEntry.thumbnailData;
    }

    // Check IndexedDB
    if (this.db) {
      try {
        const dbEntry = await this.getFromDB(cacheKey);
        if (dbEntry && dbEntry.expiresAt > Date.now()) {
          this.stats.hits++;
          this.stats.dbHits++;

          // Store in memory cache for next time
          this.memoryCache.set(cacheKey, dbEntry);
          this.evictMemoryCache();

          logger.debug('🎯 Thumbnail cache hit (IndexedDB)', 'ThumbnailCache', {
            imageId,
            levelOfDetail,
            cacheKey,
          });

          return dbEntry.thumbnailData;
        }
      } catch (error) {
        logger.error(
          'Failed to get thumbnail from IndexedDB',
          error instanceof Error ? error : new Error(String(error)),
          'ThumbnailCache'
        );
      }
    }

    this.stats.misses++;
    logger.debug('❌ Thumbnail cache miss', 'ThumbnailCache', {
      imageId,
      levelOfDetail,
      cacheKey,
    });

    return null;
  }

  /**
   * Store thumbnail in cache
   */
  async set(
    imageId: string,
    levelOfDetail: 'low' | 'medium' | 'high',
    thumbnailData: any
  ): Promise<void> {
    await this.ready;
    const cacheKey = this.getCacheKey(imageId, levelOfDetail);
    const now = Date.now();

    const entry: ThumbnailCacheEntry = {
      id: cacheKey,
      imageId,
      levelOfDetail,
      thumbnailData,
      cachedAt: now,
      expiresAt: now + this.TTL,
    };

    // Store in memory cache
    this.memoryCache.set(cacheKey, entry);
    this.evictMemoryCache();

    // Store in IndexedDB
    if (this.db) {
      try {
        await this.storeInDB(entry);

        logger.debug('💾 Thumbnail cached successfully', 'ThumbnailCache', {
          imageId,
          levelOfDetail,
          cacheKey,
          dataSize: JSON.stringify(thumbnailData).length,
        });
      } catch (error) {
        logger.error(
          'Failed to store thumbnail in IndexedDB',
          error instanceof Error ? error : new Error(String(error)),
          'ThumbnailCache'
        );
      }
    }
  }

  /**
   * Invalidate cache for specific image
   */
  async invalidate(imageId: string): Promise<void> {
    await this.ready;
    const levels: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];

    // Remove from memory cache
    for (const level of levels) {
      const cacheKey = this.getCacheKey(imageId, level);
      this.memoryCache.delete(cacheKey);
    }

    // Remove from IndexedDB
    if (this.db) {
      try {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const index = store.index('imageId');

        const request = index.openCursor(IDBKeyRange.only(imageId));
        request.onsuccess = event => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };

        logger.debug(
          '🗑️ Invalidated thumbnail cache for image',
          'ThumbnailCache',
          { imageId }
        );
      } catch (error) {
        logger.error(
          'Failed to invalidate thumbnail cache',
          error instanceof Error ? error : new Error(String(error)),
          'ThumbnailCache'
        );
      }
    }
  }

  /**
   * Get thumbnail from IndexedDB
   */
  private async getFromDB(
    cacheKey: string
  ): Promise<ThumbnailCacheEntry | null> {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(cacheKey);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Store thumbnail in IndexedDB
   */
  private async storeInDB(entry: ThumbnailCacheEntry): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(entry);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * Evict old entries from memory cache
   */
  private evictMemoryCache(): void {
    if (this.memoryCache.size <= this.maxMemoryEntries) return;

    // Convert to array and sort by access time
    const entries = Array.from(this.memoryCache.entries());
    entries.sort((a, b) => a[1].cachedAt - b[1].cachedAt);

    // Remove oldest entries
    const toRemove = entries.slice(0, entries.length - this.maxMemoryEntries);
    for (const [key] of toRemove) {
      this.memoryCache.delete(key);
    }

    logger.debug('🧹 Evicted old entries from memory cache', 'ThumbnailCache', {
      removed: toRemove.length,
      remaining: this.memoryCache.size,
    });
  }

  /**
   * Clean expired entries from IndexedDB
   */
  async cleanExpired(): Promise<void> {
    if (!this.db) return;

    try {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('expiresAt');

      const now = Date.now();
      const request = index.openCursor(IDBKeyRange.upperBound(now));

      let deletedCount = 0;
      request.onsuccess = event => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          logger.debug(
            '🧹 Cleaned expired thumbnails from cache',
            'ThumbnailCache',
            {
              deletedCount,
            }
          );
        }
      };
    } catch (error) {
      logger.error(
        'Failed to clean expired thumbnails',
        error instanceof Error ? error : new Error(String(error)),
        'ThumbnailCache'
      );
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const hitRate = this.stats.hits / (this.stats.hits + this.stats.misses);

    return {
      totalSize: this.memoryCache.size,
      entryCount: this.memoryCache.size,
      hitRate: isNaN(hitRate) ? 0 : hitRate,
      memoryUsage: this.estimateMemoryUsage(),
    };
  }

  /**
   * Estimate memory usage of cache
   */
  private estimateMemoryUsage(): number {
    let totalSize = 0;
    for (const [, entry] of this.memoryCache) {
      totalSize += JSON.stringify(entry).length * 2; // Rough estimate (UTF-16)
    }
    return totalSize;
  }

  /**
   * Clear all cache data
   */
  async clear(): Promise<void> {
    await this.ready;
    // Clear memory cache
    this.memoryCache.clear();

    // Clear IndexedDB
    if (this.db) {
      try {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        await store.clear();

        logger.debug('🧹 Cleared all thumbnail cache data', 'ThumbnailCache');
      } catch (error) {
        logger.error(
          'Failed to clear thumbnail cache',
          error instanceof Error ? error : new Error(String(error)),
          'ThumbnailCache'
        );
      }
    }

    // Reset stats
    this.stats = {
      hits: 0,
      misses: 0,
      memoryHits: 0,
      dbHits: 0,
    };
  }
}

// Singleton instance
export const thumbnailCache = new ThumbnailCache();

// Auto-cleanup every hour
setInterval(
  () => {
    thumbnailCache.cleanExpired().catch(error => {
      logger.error(
        'Failed to clean expired thumbnails during scheduled cleanup',
        error instanceof Error ? error : new Error(String(error)),
        'ThumbnailCache'
      );
    });
  },
  60 * 60 * 1000
);
