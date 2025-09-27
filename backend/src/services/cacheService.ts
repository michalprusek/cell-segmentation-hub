import { executeRedisCommand, redisClient } from '../config/redis';
import { logger } from '../utils/logger';

// Augment Express Request interface
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string };
    }
  }
}

/**
 * Generic caching service with TTL management, invalidation strategies, and cache warming
 * Supports different cache patterns and automatic fallback when Redis is unavailable
 */
export interface CacheOptions {
  ttl?: number; // TTL in seconds
  namespace?: string;
  compress?: boolean;
  serializer?: 'json' | 'string';
}

export interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  ttl: number;
  compressed?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRate: number;
}

class CacheService {
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    hitRate: 0,
  };

  // TTL presets for different data types (in seconds)
  static readonly TTL_PRESETS = {
    SHORT: 300, // 5 minutes - real-time data
    MEDIUM: 1800, // 30 minutes - semi-static data
    LONG: 3600, // 1 hour - static data
    VERY_LONG: 86400, // 24 hours - configuration data
    USER_SESSION: 604800, // 7 days - user sessions
    API_RESPONSE: 300, // 5 minutes - API responses
    DATABASE_QUERY: 600, // 10 minutes - database queries
    FILE_METADATA: 3600, // 1 hour - file information
    ML_RESULTS: 7200, // 2 hours - ML processing results
    STATISTICS: 900, // 15 minutes - statistics data
  } as const;

  /**
   * Get value from cache
   */
  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    try {
      const fullKey = this.buildKey(key, options.namespace);

      const cached = await executeRedisCommand(async client => {
        return client.get(fullKey);
      });

      if (!cached) {
        this.stats.misses++;
        this.updateHitRate();
        return null;
      }

      const entry: CacheEntry<T> = JSON.parse(cached);

      // Check if entry has expired (secondary check)
      if (Date.now() - entry.timestamp > entry.ttl * 1000) {
        await this.delete(key, options);
        this.stats.misses++;
        this.updateHitRate();
        return null;
      }

      this.stats.hits++;
      this.updateHitRate();

      return entry.data;
    } catch (error) {
      logger.error('Cache get failed:', error as Error, 'Cache');
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }
  }

  /**
   * Set value in cache with TTL
   */
  async set<T>(
    key: string,
    value: T,
    options: CacheOptions = {}
  ): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key, options.namespace);
      const ttl = options.ttl || CacheService.TTL_PRESETS.MEDIUM;

      const entry: CacheEntry<T> = {
        data: value,
        timestamp: Date.now(),
        ttl,
        compressed: options.compress || false,
      };

      const result = await executeRedisCommand(async client => {
        return client.setEx(fullKey, ttl, JSON.stringify(entry));
      });

      if (result) {
        this.stats.sets++;
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Cache set failed:', error as Error, 'Cache');
      return false;
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key: string, options: CacheOptions = {}): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key, options.namespace);

      const result = await executeRedisCommand(async client => {
        return client.del(fullKey);
      });

      if (result && result > 0) {
        this.stats.deletes++;
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Cache delete failed:', error as Error, 'Cache');
      return false;
    }
  }

  /**
   * Check if key exists in cache
   */
  async exists(key: string, options: CacheOptions = {}): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key, options.namespace);

      const result = await executeRedisCommand(async client => {
        return client.exists(fullKey);
      });

      return (result || 0) > 0;
    } catch (error) {
      logger.error('Cache exists check failed:', error as Error, 'Cache');
      return false;
    }
  }

  /**
   * Get or set pattern - retrieve from cache or compute and cache the result
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T> | T,
    options: CacheOptions = {}
  ): Promise<T | null> {
    try {
      // Try to get from cache first
      const cached = await this.get<T>(key, options);
      if (cached !== null) {
        return cached;
      }

      // Not in cache, compute the value
      const value = await factory();
      if (value !== null && value !== undefined) {
        await this.set(key, value, options);
        return value;
      }

      return null;
    } catch (error) {
      logger.error('Cache getOrSet failed:', error as Error, 'Cache');
      return null;
    }
  }

  /**
   * Increment numeric value in cache (atomic operation)
   */
  async increment(
    key: string,
    amount = 1,
    options: CacheOptions = {}
  ): Promise<number | null> {
    try {
      const fullKey = this.buildKey(key, options.namespace);

      const result = await executeRedisCommand(async client => {
        const value = await client.incrBy(fullKey, amount);

        // Set TTL if this is the first increment
        const ttl = options.ttl || CacheService.TTL_PRESETS.MEDIUM;
        await client.expire(fullKey, ttl);

        return value;
      });

      return result;
    } catch (error) {
      logger.error('Cache increment failed:', error as Error, 'Cache');
      return null;
    }
  }

  /**
   * Set expiration time for existing key
   */
  async expire(
    key: string,
    ttl: number,
    options: CacheOptions = {}
  ): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key, options.namespace);

      const result = await executeRedisCommand(async client => {
        return client.expire(fullKey, ttl);
      });

      return !!result;
    } catch (error) {
      logger.error('Cache expire failed:', error as Error, 'Cache');
      return false;
    }
  }

  /**
   * Get TTL for key
   */
  async getTTL(
    key: string,
    options: CacheOptions = {}
  ): Promise<number | null> {
    try {
      const fullKey = this.buildKey(key, options.namespace);

      const result = await executeRedisCommand(async client => {
        return client.ttl(fullKey);
      });

      return result;
    } catch (error) {
      logger.error('Cache TTL check failed:', error as Error, 'Cache');
      return null;
    }
  }

  /**
   * Invalidate cache by pattern
   */
  async invalidatePattern(
    pattern: string,
    options: CacheOptions = {}
  ): Promise<number> {
    try {
      const fullPattern = this.buildKey(pattern, options.namespace);

      const result = await executeRedisCommand(async client => {
        const keys: string[] = [];
        let cursor = 0;

        // Use SCAN instead of KEYS for better performance
        do {
          const scanResult = await client.scan(cursor, {
            MATCH: fullPattern,
            COUNT: 100,
          });
          cursor = scanResult.cursor;
          keys.push(...scanResult.keys);
        } while (cursor !== 0);

        if (keys.length === 0) {
          return 0;
        }

        // Delete in batches using UNLINK (non-blocking)
        const batchSize = 100;
        let deletedCount = 0;

        for (let i = 0; i < keys.length; i += batchSize) {
          const batch = keys.slice(i, i + batchSize);
          const deleted = await client.unlink(batch);
          deletedCount += deleted || 0;
        }

        return deletedCount;
      });

      const deletedCount = result || 0;
      if (deletedCount > 0) {
        this.stats.deletes += deletedCount;
        logger.info(
          `Invalidated ${deletedCount} cache entries matching pattern: ${fullPattern}`,
          'Cache'
        );
      }

      return deletedCount;
    } catch (error) {
      logger.error(
        'Cache pattern invalidation failed:',
        error as Error,
        'Cache'
      );
      return 0;
    }
  }

  /**
   * Cache warming - preload cache with frequently accessed data
   */
  async warmCache<T>(
    entries: Array<{
      key: string;
      factory: () => Promise<T> | T;
      options?: CacheOptions;
    }>,
    concurrency = 5
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    // Process entries in chunks to avoid overwhelming the system
    for (let i = 0; i < entries.length; i += concurrency) {
      const chunk = entries.slice(i, i + concurrency);

      const results = await Promise.allSettled(
        chunk.map(async entry => {
          try {
            const value = await entry.factory();
            if (value !== null && value !== undefined) {
              await this.set(entry.key, value, entry.options);
              return true;
            }
            return false;
          } catch (error) {
            logger.error(
              `Cache warming failed for key ${entry.key}:`,
              error as Error,
              'Cache'
            );
            return false;
          }
        })
      );

      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          success++;
        } else {
          failed++;
        }
      });
    }

    logger.info(
      `Cache warming completed: ${success} success, ${failed} failed`,
      'Cache'
    );
    return { success, failed };
  }

  /**
   * Cache invalidation strategies
   */
  readonly invalidationStrategies = {
    /**
     * Invalidate user-related caches
     */
    user: async (userId: string): Promise<number> => {
      return this.invalidatePattern(`user:${userId}:*`);
    },

    /**
     * Invalidate project-related caches
     */
    project: async (projectId: string): Promise<number> => {
      const patterns = [
        `project:${projectId}:*`,
        `projects:user:*`, // User project lists
        `stats:user:*`, // User statistics
      ];

      let totalDeleted = 0;
      for (const pattern of patterns) {
        totalDeleted += await this.invalidatePattern(pattern);
      }

      return totalDeleted;
    },

    /**
     * Invalidate image-related caches
     */
    image: async (imageId: string, projectId?: string): Promise<number> => {
      const patterns = [`image:${imageId}:*`, `segmentation:${imageId}:*`];

      if (projectId) {
        patterns.push(`project:${projectId}:images:*`);
      }

      let totalDeleted = 0;
      for (const pattern of patterns) {
        totalDeleted += await this.invalidatePattern(pattern);
      }

      return totalDeleted;
    },

    /**
     * Invalidate API response caches
     */
    apiResponse: async (endpoint?: string): Promise<number> => {
      const pattern = endpoint ? `api:${endpoint}:*` : 'api:*';
      return this.invalidatePattern(pattern);
    },

    /**
     * Invalidate all statistics caches
     */
    statistics: async (): Promise<number> => {
      return this.invalidatePattern('stats:*');
    },
  };

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      hitRate: 0,
    };
  }

  /**
   * Get cache health information
   */
  async getHealthInfo(): Promise<{
    status: 'healthy' | 'unhealthy' | 'disabled';
    stats: CacheStats;
    memoryUsage?: string;
    keyCount?: number;
    latency?: number;
  }> {
    try {
      if (!redisClient) {
        return { status: 'disabled', stats: this.stats };
      }

      // Check if Redis is connected
      try {
        await redisClient.ping();
      } catch {
        return { status: 'unhealthy', stats: this.stats };
      }

      // Get additional Redis info
      const info = await redisClient.info();

      const keyCount = await executeRedisCommand(async client => {
        return client.dbSize();
      });

      return {
        status: 'healthy',
        stats: this.stats,
        memoryUsage: info ? info.slice(0, 100) : 'unknown', // Show first 100 chars of info
        keyCount: keyCount || 0,
        latency: 0, // We don't measure latency in this implementation
      };
    } catch (error) {
      logger.error('Cache health check failed:', error as Error, 'Cache');
      return { status: 'unhealthy', stats: this.stats };
    }
  }

  /**
   * Build full cache key with namespace
   */
  private buildKey(key: string, namespace?: string): string {
    const prefix = 'cache:';
    return namespace ? `${prefix}${namespace}:${key}` : `${prefix}${key}`;
  }

  /**
   * Update hit rate calculation
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate =
      total > 0 ? Math.round((this.stats.hits / total) * 100) : 0;
  }
}

// Export singleton instance
export const cacheService = new CacheService();

// Export the class for use in other modules
export { CacheService };

// Utility functions for common cache patterns
export const CachePatterns = {
  /**
   * Database query caching pattern
   */
  dbQuery: <T>(queryKey: string, queryFn: () => Promise<T>): Promise<T> =>
    cacheService.getOrSet(queryKey, queryFn, {
      ttl: CacheService.TTL_PRESETS.DATABASE_QUERY,
      namespace: 'db',
    }),

  /**
   * API response caching pattern
   */
  apiResponse: <T>(
    endpoint: string,
    params: Record<string, unknown>,
    responseFn: () => Promise<T>
  ): Promise<T> => {
    const key = `${endpoint}:${JSON.stringify(params)}`;
    return cacheService.getOrSet(key, responseFn, {
      ttl: CacheService.TTL_PRESETS.API_RESPONSE,
      namespace: 'api',
    });
  },

  /**
   * User data caching pattern
   */
  userData: <T>(
    userId: string,
    dataType: string,
    dataFn: () => Promise<T>
  ): Promise<T> =>
    cacheService.getOrSet(`${userId}:${dataType}`, dataFn, {
      ttl: CacheService.TTL_PRESETS.MEDIUM,
      namespace: 'user',
    }),

  /**
   * File metadata caching pattern
   */
  fileMetadata: <T>(fileId: string, metadataFn: () => Promise<T>): Promise<T> =>
    cacheService.getOrSet(fileId, metadataFn, {
      ttl: CacheService.TTL_PRESETS.FILE_METADATA,
      namespace: 'file',
    }),

  /**
   * Statistics caching pattern
   */
  statistics: <T>(statType: string, statFn: () => Promise<T>): Promise<T> =>
    cacheService.getOrSet(statType, statFn, {
      ttl: CacheService.TTL_PRESETS.STATISTICS,
      namespace: 'stats',
    }),
};
