/**
 * High-performance bounding box cache system
 * Inspired by SpheroSeg polygon optimization strategies
 */

import { Point } from '@/lib/segmentation';
import { BoundingBox } from '@/lib/polygonOptimization';

interface CachedBoundingBox extends BoundingBox {
  polygonId: string;
  version: number; // For invalidation tracking
  lastAccessed: number; // For LRU cleanup
}

interface PolygonState {
  points: Point[];
  version: number; // Incremented when polygon changes
}

/**
 * LRU cache for polygon bounding boxes with automatic invalidation
 */
export class BoundingBoxCache {
  private cache = new Map<string, CachedBoundingBox>();
  private polygonStates = new Map<string, PolygonState>();
  private maxCacheSize: number;
  private hits = 0;
  private misses = 0;

  constructor(maxCacheSize: number = 1000) {
    this.maxCacheSize = maxCacheSize;
  }

  /**
   * Get or calculate bounding box for a polygon
   */
  getBoundingBox(polygonId: string, points: Point[]): BoundingBox {
    const currentTime = performance.now();

    // Check if polygon has changed
    const storedState = this.polygonStates.get(polygonId);
    const currentVersion = this.calculateVersionHash(points);

    if (storedState && storedState.version === currentVersion) {
      const cached = this.cache.get(polygonId);
      if (cached && cached.version === currentVersion) {
        // Cache hit - update access time
        cached.lastAccessed = currentTime;
        this.hits++;
        return cached;
      }
    }

    // Cache miss or invalidation - recalculate
    this.misses++;
    const boundingBox = this.calculateBoundingBox(points);

    const cachedBox: CachedBoundingBox = {
      ...boundingBox,
      polygonId,
      version: currentVersion,
      lastAccessed: currentTime,
    };

    // Update cache and state
    this.cache.set(polygonId, cachedBox);
    this.polygonStates.set(polygonId, {
      points: [...points], // Shallow copy for change detection
      version: currentVersion,
    });

    // Cleanup if cache is too large
    this.cleanup();

    return boundingBox;
  }

  /**
   * Bulk get bounding boxes for multiple polygons
   * More efficient than individual calls
   */
  getBulkBoundingBoxes(
    polygons: Array<{ id: string; points: Point[] }>
  ): Map<string, BoundingBox> {
    const result = new Map<string, BoundingBox>();
    const toCalculate: Array<{ id: string; points: Point[] }> = [];
    const currentTime = performance.now();

    // First pass: check cache
    for (const polygon of polygons) {
      const storedState = this.polygonStates.get(polygon.id);
      const currentVersion = this.calculateVersionHash(polygon.points);

      if (storedState && storedState.version === currentVersion) {
        const cached = this.cache.get(polygon.id);
        if (cached && cached.version === currentVersion) {
          cached.lastAccessed = currentTime;
          result.set(polygon.id, cached);
          this.hits++;
          continue;
        }
      }

      toCalculate.push(polygon);
    }

    // Second pass: calculate missing bounding boxes
    for (const polygon of toCalculate) {
      const boundingBox = this.calculateBoundingBox(polygon.points);
      const currentVersion = this.calculateVersionHash(polygon.points);

      const cachedBox: CachedBoundingBox = {
        ...boundingBox,
        polygonId: polygon.id,
        version: currentVersion,
        lastAccessed: currentTime,
      };

      this.cache.set(polygon.id, cachedBox);
      this.polygonStates.set(polygon.id, {
        points: [...polygon.points],
        version: currentVersion,
      });

      result.set(polygon.id, boundingBox);
      this.misses++;
    }

    this.cleanup();
    return result;
  }

  /**
   * Invalidate cache entry for a specific polygon
   */
  invalidate(polygonId: string): void {
    this.cache.delete(polygonId);
    this.polygonStates.delete(polygonId);
  }

  /**
   * Invalidate multiple polygon entries
   */
  invalidateBulk(polygonIds: string[]): void {
    for (const id of polygonIds) {
      this.cache.delete(id);
      this.polygonStates.delete(id);
    }
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.polygonStates.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics for performance monitoring
   */
  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total) * 100 : 0,
      memoryUsage: this.estimateMemoryUsage(),
    };
  }

  /**
   * Calculate fast hash for polygon points to detect changes
   */
  private calculateVersionHash(points: Point[]): number {
    let hash = 0;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      // Simple but effective hash for floating point coordinates
      hash = ((hash << 5) - hash + point.x * 1000 + point.y * 1000) | 0;
    }
    return hash;
  }

  /**
   * Fast bounding box calculation optimized for performance
   */
  private calculateBoundingBox(points: Point[]): BoundingBox {
    if (points.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }

    let minX = points[0].x;
    let minY = points[0].y;
    let maxX = points[0].x;
    let maxY = points[0].y;

    // Unrolled loop for better performance with large polygons
    for (let i = 1; i < points.length; i++) {
      const point = points[i];

      if (point.x < minX) minX = point.x;
      else if (point.x > maxX) maxX = point.x;

      if (point.y < minY) minY = point.y;
      else if (point.y > maxY) maxY = point.y;
    }

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  /**
   * LRU cleanup when cache exceeds maximum size
   */
  private cleanup(): void {
    if (this.cache.size <= this.maxCacheSize) return;

    // Sort by last accessed time and remove oldest entries
    const entries = Array.from(this.cache.entries()).sort(
      (a, b) => a[1].lastAccessed - b[1].lastAccessed
    );

    const toRemove = entries.slice(0, Math.floor(this.maxCacheSize * 0.1)); // Remove 10%

    for (const [polygonId] of toRemove) {
      this.cache.delete(polygonId);
      this.polygonStates.delete(polygonId);
    }
  }

  /**
   * Estimate memory usage for monitoring
   */
  private estimateMemoryUsage(): number {
    // Rough estimation: each cache entry is approximately 200 bytes
    // (bounding box + metadata + map overhead)
    return this.cache.size * 200;
  }

  /**
   * Check if a polygon has changed since last cache update
   */
  hasPolygonChanged(polygonId: string, points: Point[]): boolean {
    const storedState = this.polygonStates.get(polygonId);
    if (!storedState) return true;

    const currentVersion = this.calculateVersionHash(points);
    return storedState.version !== currentVersion;
  }

  /**
   * Preload bounding boxes for a list of polygons
   * Useful for predictive caching
   */
  preload(polygons: Array<{ id: string; points: Point[] }>): Promise<void> {
    return new Promise(resolve => {
      // Use requestIdleCallback with fallback for non-blocking preload
      const scheduleWork = (callback: () => void) => {
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(callback);
        } else {
          // Fallback for environments without requestIdleCallback
          setTimeout(callback, 0);
        }
      };

      const processChunk = (startIndex: number) => {
        const endIndex = Math.min(startIndex + 50, polygons.length); // Process 50 at a time

        for (let i = startIndex; i < endIndex; i++) {
          const polygon = polygons[i];
          this.getBoundingBox(polygon.id, polygon.points);
        }

        if (endIndex < polygons.length) {
          scheduleWork(() => processChunk(endIndex));
        } else {
          resolve();
        }
      };

      scheduleWork(() => processChunk(0));
    });
  }
}

// Global singleton instance
export const boundingBoxCache = new BoundingBoxCache();
