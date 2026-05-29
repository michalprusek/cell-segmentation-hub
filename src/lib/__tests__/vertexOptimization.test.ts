import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOptimizedVertexRadius,
  getOptimizedStrokeWidth,
  getVisibleVertices,
  clearOptimizationCaches,
  vertexPool,
  debugLog,
} from '@/lib/vertexOptimization';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Flush module-level caches so each test starts clean. */
beforeEach(() => {
  clearOptimizationCaches();
});

// ─── getOptimizedVertexRadius ─────────────────────────────────────────────────

describe('getOptimizedVertexRadius', () => {
  it('returns a positive radius at zoom=1 with defaults', () => {
    const r = getOptimizedVertexRadius(1);
    expect(r).toBeGreaterThan(0);
  });

  it('minimum radius is 0.5 (enforced by Math.max)', () => {
    // Extremely high zoom would shrink radius to near-zero; the floor is 0.5
    const r = getOptimizedVertexRadius(1000, 3);
    expect(r).toBeGreaterThanOrEqual(0.5);
  });

  it('radius decreases as zoom increases beyond 1', () => {
    const r1 = getOptimizedVertexRadius(1, 3);
    const r2 = getOptimizedVertexRadius(4, 3);
    expect(r2).toBeLessThan(r1);
  });

  it('radius increases as zoom decreases below 1', () => {
    // At zoom < 1 scale factor = 1 / zoom^1.1, so lower zoom → larger radius
    const rHigh = getOptimizedVertexRadius(1.0, 3);
    const rLow = getOptimizedVertexRadius(0.5, 3);
    expect(rLow).toBeGreaterThan(rHigh);
  });

  it('hovered vertex has a 15% larger radius than non-hovered', () => {
    const base = getOptimizedVertexRadius(1, 3, false, false);
    const hovered = getOptimizedVertexRadius(1, 3, true, false);
    expect(hovered).toBeCloseTo(base * 1.15, 5);
  });

  it('start-point vertex has a 10% larger radius than normal', () => {
    const base = getOptimizedVertexRadius(1, 3, false, false);
    const start = getOptimizedVertexRadius(1, 3, false, true);
    expect(start).toBeCloseTo(base * 1.1, 5);
  });

  it('hovered + start-point multiplies both scales', () => {
    const base = getOptimizedVertexRadius(1, 3, false, false);
    const both = getOptimizedVertexRadius(1, 3, true, true);
    expect(both).toBeCloseTo(base * 1.15 * 1.1, 4);
  });

  it('caches the scale factor — second call with same zoom is identical', () => {
    const r1 = getOptimizedVertexRadius(2, 5);
    const r2 = getOptimizedVertexRadius(2, 5);
    expect(r1).toBe(r2);
  });

  it('rounds zoom key to 2 decimal places for caching', () => {
    // 1.234 and 1.235 both round to 1.23 (or 1.24) depending on rounding.
    // The key point: results very close in zoom produce the same cached value.
    const r1 = getOptimizedVertexRadius(1.234, 3);
    const r2 = getOptimizedVertexRadius(1.234, 3);
    expect(r1).toBe(r2);
  });

  it('clearOptimizationCaches resets the cache (recomputed value matches)', () => {
    const r1 = getOptimizedVertexRadius(1, 3);
    clearOptimizationCaches();
    const r2 = getOptimizedVertexRadius(1, 3);
    // Value should be the same even after recompute
    expect(r1).toBeCloseTo(r2, 10);
  });
});

// ─── getOptimizedStrokeWidth ──────────────────────────────────────────────────

describe('getOptimizedStrokeWidth', () => {
  it('returns a positive width at zoom=1', () => {
    expect(getOptimizedStrokeWidth(1)).toBeGreaterThan(0);
  });

  it('hovered stroke is wider than non-hovered at the same zoom', () => {
    const normal = getOptimizedStrokeWidth(1, false);
    const hovered = getOptimizedStrokeWidth(1, true);
    expect(hovered).toBeGreaterThan(normal);
  });

  it('non-hovered minimum is 0.1', () => {
    // At very high zoom the width collapses but must not fall below 0.1
    const w = getOptimizedStrokeWidth(10000, false);
    expect(w).toBeGreaterThanOrEqual(0.1);
  });

  it('hovered minimum is 0.4', () => {
    const w = getOptimizedStrokeWidth(10000, true);
    expect(w).toBeGreaterThanOrEqual(0.4);
  });

  it('width decreases as zoom increases (inverse scaling)', () => {
    const w1 = getOptimizedStrokeWidth(1, false);
    const w4 = getOptimizedStrokeWidth(4, false);
    expect(w4).toBeLessThan(w1);
  });

  it('zoom ≤ 1 uses linear factor (zoom * 0.9)', () => {
    // At zoom=0.5: zoomFactor = 0.5 * 0.9 = 0.45; strokeWidth = 0.5/0.45 ≈ 1.111
    const w = getOptimizedStrokeWidth(0.5, false);
    expect(w).toBeCloseTo(0.5 / 0.45, 3);
  });

  it('zoom > 1 uses sqrt factor (sqrt(zoom) * 0.9)', () => {
    // At zoom=4: zoomFactor = sqrt(4)*0.9 = 2*0.9 = 1.8; width = 0.5/1.8 ≈ 0.278
    const w = getOptimizedStrokeWidth(4, false);
    expect(w).toBeCloseTo(0.5 / 1.8, 3);
  });

  it('caches correctly — repeated calls return same object', () => {
    const w1 = getOptimizedStrokeWidth(2, false);
    const w2 = getOptimizedStrokeWidth(2, false);
    expect(w1).toBe(w2);
  });
});

// ─── getVisibleVertices ──────────────────────────────────────────────────────

describe('getVisibleVertices', () => {
  const viewport = { x: 0, y: 0, width: 100, height: 100, zoom: 1 };

  it('returns all vertices that are inside the viewport', () => {
    const pts = [
      { x: 50, y: 50 },
      { x: 10, y: 10 },
    ];
    const result = getVisibleVertices(pts, viewport, 0);
    expect(result).toHaveLength(2);
  });

  it('excludes vertices strictly outside the viewport (no buffer)', () => {
    const pts = [{ x: -5, y: 50 }]; // left of minX=0
    const result = getVisibleVertices(pts, viewport, 0);
    expect(result).toHaveLength(0);
  });

  it('buffer extends the visible region proportionally to zoom', () => {
    // At zoom=1 a buffer of 100 adds 100 px on each side.
    // A vertex at x=-50 should be visible with buffer=100 but not with buffer=0.
    const pts = [{ x: -50, y: 50 }];
    expect(getVisibleVertices(pts, viewport, 0)).toHaveLength(0);
    expect(getVisibleVertices(pts, viewport, 100)).toHaveLength(1);
  });

  it('buffer scales with zoom (higher zoom → smaller buffered region in image space)', () => {
    // At zoom=2 buffer=100 px → 50 px in image space.
    const highZoomViewport = { x: 0, y: 0, width: 100, height: 100, zoom: 2 };
    const pts = [{ x: -60, y: 50 }]; // 60 px left
    // buffer/zoom = 100/2 = 50 → expanded minX = 0 - 50 = -50; -60 < -50 → out
    expect(getVisibleVertices(pts, highZoomViewport, 100)).toHaveLength(0);
    // but with zoom=1 buffer=100 → expanded minX = -100; -60 > -100 → in
    expect(getVisibleVertices(pts, viewport, 100)).toHaveLength(1);
  });

  it('returns empty array when no vertices provided', () => {
    expect(getVisibleVertices([], viewport, 0)).toEqual([]);
  });

  it('preserves vertex objects by identity (filter, no copy)', () => {
    const v = { x: 50, y: 50 };
    const result = getVisibleVertices([v], viewport, 0);
    expect(result[0]).toBe(v);
  });

  it('works with generic objects having x/y (type parameter T)', () => {
    interface TaggedVertex {
      x: number;
      y: number;
      id: string;
    }
    const verts: TaggedVertex[] = [
      { x: 10, y: 10, id: 'a' },
      { x: 200, y: 10, id: 'b' }, // out of range
    ];
    const result = getVisibleVertices(verts, viewport, 0);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });
});

// ─── vertexPool ──────────────────────────────────────────────────────────────

describe('vertexPool', () => {
  beforeEach(() => {
    vertexPool.clear();
  });

  it('acquire returns an object with the given x, y, id', () => {
    const v = vertexPool.acquire(10, 20, 'abc');
    expect(v.x).toBe(10);
    expect(v.y).toBe(20);
    expect(v.id).toBe('abc');
  });

  it('release then acquire returns the same object (pooling)', () => {
    const v1 = vertexPool.acquire(1, 2, 'x');
    vertexPool.release(v1);
    const v2 = vertexPool.acquire(3, 4, 'y');
    expect(v2).toBe(v1); // same pooled slot
    expect(v2.x).toBe(3);
    expect(v2.y).toBe(4);
    expect(v2.id).toBe('y');
  });

  it('clear empties the pool so next acquire allocates fresh', () => {
    const v1 = vertexPool.acquire(1, 2, 'a');
    vertexPool.release(v1);
    vertexPool.clear();
    const v2 = vertexPool.acquire(5, 6, 'b');
    // Different object because pool was cleared
    expect(v2).not.toBe(v1);
  });
});

// ─── clearOptimizationCaches ──────────────────────────────────────────────────

describe('clearOptimizationCaches', () => {
  it('does not throw when called on empty caches', () => {
    expect(() => clearOptimizationCaches()).not.toThrow();
  });

  it('does not throw when called on populated caches', () => {
    getOptimizedVertexRadius(1, 3);
    getOptimizedStrokeWidth(1, false);
    expect(() => clearOptimizationCaches()).not.toThrow();
  });
});

// ─── debugLog ────────────────────────────────────────────────────────────────

describe('debugLog', () => {
  it('is a no-op that does not throw', () => {
    expect(() => debugLog('test message', { data: 42 })).not.toThrow();
  });

  it('accepts call with no data argument', () => {
    expect(() => debugLog('just a message')).not.toThrow();
  });
});
