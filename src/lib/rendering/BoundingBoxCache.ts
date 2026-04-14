/**
 * Identity-keyed bounding box cache.
 *
 * Stores per-polygon AABB, re-using the cached box whenever the polygon's
 * `points` array reference is unchanged. The editor mutates polygons
 * immutably (replaces the points array on every edit), so identity equality
 * on the array reference is a sound correctness signal and also cheap.
 *
 * Backs `PolygonVisibilityManager`'s frustum culling. The culling path
 * would otherwise recompute bboxes for every polygon on every render.
 */

import type { Point } from '@/lib/segmentation';
import { calculateBoundingBox, type BoundingBox } from '@/lib/polygonGeometry';

interface CacheEntry {
  box: BoundingBox;
  pointsRef: Point[];
}

const DEFAULT_MAX_ENTRIES = 5000;

export class BoundingBoxCache {
  private readonly entries = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {
    if (!Number.isFinite(maxEntries) || maxEntries < 1) {
      throw new Error(
        `BoundingBoxCache: maxEntries must be a finite number >= 1 (got ${maxEntries})`
      );
    }
  }

  /**
   * Bulk lookup. Returns a map of polygon id -> BoundingBox. Entries
   * whose `points` reference changed (or were never seen) are recomputed
   * lazily here and inserted into the cache.
   */
  getBulkBoundingBoxes(
    items: readonly { id: string; points: Point[] }[]
  ): Map<string, BoundingBox> {
    const result = new Map<string, BoundingBox>();
    for (const item of items) {
      result.set(item.id, this.get(item.id, item.points));
    }
    return result;
  }

  get(id: string, points: Point[]): BoundingBox {
    const cached = this.entries.get(id);
    if (cached && cached.pointsRef === points) {
      // Promote to most-recently-used by re-inserting.
      this.entries.delete(id);
      this.entries.set(id, cached);
      this.hits++;
      return cached.box;
    }

    this.misses++;
    const box = calculateBoundingBox(points);
    this.entries.set(id, { box, pointsRef: points });
    this.evictIfOverflow();
    return box;
  }

  invalidate(id: string): void {
    this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  private evictIfOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      // Map iteration order is insertion order; oldest entry is first.
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}

export const boundingBoxCache = new BoundingBoxCache();
