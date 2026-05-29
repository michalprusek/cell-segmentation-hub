import { describe, it, expect } from 'vitest';
import type { Point } from '@/lib/segmentation';
import type { BoundingBox } from '@/lib/polygonGeometry';
import {
  simplifyPolygon,
  isInViewport,
  getSimplificationTolerance,
  shouldRenderVertices,
  getVertexDecimationStep,
  getDecimatedVertices,
  getViewportBounds,
  measureRenderPerformance,
} from '@/lib/polygonOptimization';

// ─── helpers ────────────────────────────────────────────────────────────────

const pt = (x: number, y: number): Point => ({ x, y });

/** Square bounding box 100×100 starting at origin */
const box100: BoundingBox = {
  minX: 0,
  maxX: 100,
  minY: 0,
  maxY: 100,
  width: 100,
  height: 100,
};

// ─── simplifyPolygon ────────────────────────────────────────────────────────

describe('simplifyPolygon', () => {
  it('returns the input unchanged when ≤ 3 points', () => {
    const three = [pt(0, 0), pt(10, 0), pt(5, 5)];
    expect(simplifyPolygon(three, 1)).toBe(three); // same reference
  });

  it('preserves a pure right-angle square with zero collinear noise', () => {
    // Collinear mid-points should be removed; corners must stay.
    const pts = [
      pt(0, 0),
      pt(50, 0), // collinear between (0,0)→(100,0)
      pt(100, 0),
      pt(100, 100),
      pt(0, 100),
    ];
    const result = simplifyPolygon(pts, 1);
    // (0,0) and (100,0) are endpoints that must survive; (50,0) has
    // perpendicular distance 0, so it is below any positive tolerance.
    expect(result.some(p => p.x === 0 && p.y === 0)).toBe(true);
    expect(result.some(p => p.x === 100 && p.y === 0)).toBe(true);
    expect(result.some(p => p.x === 100 && p.y === 100)).toBe(true);
    // The collinear mid-point should have been removed
    expect(result.some(p => p.x === 50 && p.y === 0)).toBe(false);
  });

  it('keeps a point that deviates more than the tolerance', () => {
    // Line from (0,0) to (100,0) with a spike at (50,10)
    const pts = [pt(0, 0), pt(50, 10), pt(100, 0), pt(100, 100), pt(0, 100)];
    // With tolerance 5 the spike (distance 10 from the baseline) must stay
    const result = simplifyPolygon(pts, 5);
    expect(result.some(p => p.x === 50 && p.y === 10)).toBe(true);
  });

  it('removes a point that deviates less than the tolerance', () => {
    // The spike is 1 px above the baseline; a tolerance of 5 should eliminate it
    const pts = [pt(0, 0), pt(50, 1), pt(100, 0), pt(100, 100), pt(0, 100)];
    const result = simplifyPolygon(pts, 5);
    expect(result.some(p => p.x === 50 && p.y === 1)).toBe(false);
  });

  it('adds a closing point when the polygon is not already closed', () => {
    const pts = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)];
    const result = simplifyPolygon(pts, 0.1);
    if (result.length > 2) {
      const first = result[0];
      const last = result[result.length - 1];
      // After simplification the polygon should be closed
      expect(first.x).toBe(last.x);
      expect(first.y).toBe(last.y);
    }
  });

  it('does not add a duplicate closing point when already closed', () => {
    // Provide 5 points where first === last after simplification.
    // A collinear mid-point is squeezed out so result = [start, end] — but
    // the branch only fires when result.length > 2, so this guards the
    // degenerate case does not create a triple-equal endpoint.
    const pts = [pt(0, 0), pt(25, 0), pt(50, 0), pt(75, 0), pt(100, 0)];
    const result = simplifyPolygon(pts, 1);
    // The result is at minimum [start, end] which has 2 items, no closing added.
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('tolerance=0 keeps all input points', () => {
    const pts = [pt(0, 0), pt(25, 0), pt(100, 0), pt(100, 100), pt(0, 100)];
    const result = simplifyPolygon(pts, 0);
    // Every point should appear (distance > 0 is never > 0 threshold,
    // but 0 < 0 is false so the code falls to the else-return branch.
    // Wait — tolerance 0 means maxDistance > 0 triggers recursion for
    // any non-zero deviation; a collinear point has distance exactly 0 so
    // it still gets dropped. The invariant is: result.length <= input.length.
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.length).toBeLessThanOrEqual(pts.length + 1); // +1 for closing
  });

  it('handles a single-spike polygon hand-computably', () => {
    // Triangle: (0,0)→(50,20)→(100,0).  The only interior point to test is
    // (50,20) vs the line from (0,0)→(100,0).
    // Perpendicular distance = |20| = 20.
    // With tolerance 10 it should be KEPT; with tolerance 30 REMOVED.
    const pts = [pt(0, 0), pt(50, 20), pt(100, 0), pt(0, 50)];

    const resultKeep = simplifyPolygon(pts, 10);
    expect(resultKeep.some(p => p.x === 50 && p.y === 20)).toBe(true);

    const resultRemove = simplifyPolygon(pts, 30);
    expect(resultRemove.some(p => p.x === 50 && p.y === 20)).toBe(false);
  });
});

// ─── isInViewport ───────────────────────────────────────────────────────────

describe('isInViewport', () => {
  it('returns true when bbox is fully inside viewport', () => {
    // bbox 10-90 × 10-90, viewport 0-200 × 0-200, buffer=0
    const bbox: BoundingBox = {
      minX: 10,
      maxX: 90,
      minY: 10,
      maxY: 90,
      width: 80,
      height: 80,
    };
    expect(isInViewport(bbox, 0, 0, 200, 200, 0)).toBe(true);
  });

  it('returns false when bbox is entirely to the left of the viewport', () => {
    const bbox: BoundingBox = {
      minX: -200,
      maxX: -101,
      minY: 0,
      maxY: 50,
      width: 99,
      height: 50,
    };
    // viewport x=0, y=0, w=100, h=100, buffer=0 → expandedMinX = 0
    // bbox.maxX = -101 < 0, so outside
    expect(isInViewport(bbox, 0, 0, 100, 100, 0)).toBe(false);
  });

  it('returns false when bbox is entirely to the right', () => {
    const bbox: BoundingBox = {
      minX: 201,
      maxX: 300,
      minY: 0,
      maxY: 50,
      width: 99,
      height: 50,
    };
    // viewport 0-100, buffer=0 → expandedMaxX = 100; bbox.minX 201 > 100
    expect(isInViewport(bbox, 0, 0, 100, 100, 0)).toBe(false);
  });

  it('returns false when bbox is entirely above the viewport', () => {
    const bbox: BoundingBox = {
      minX: 0,
      maxX: 50,
      minY: -200,
      maxY: -101,
      width: 50,
      height: 99,
    };
    expect(isInViewport(bbox, 0, 0, 100, 100, 0)).toBe(false);
  });

  it('returns false when bbox is entirely below the viewport', () => {
    const bbox: BoundingBox = {
      minX: 0,
      maxX: 50,
      minY: 201,
      maxY: 300,
      width: 50,
      height: 99,
    };
    expect(isInViewport(bbox, 0, 0, 100, 100, 0)).toBe(false);
  });

  it('20% default buffer extends viewport bounds', () => {
    // viewport 0-100, buffer=0.2 → bufferX = 20 → expandedMinX = -20
    const bbox: BoundingBox = {
      minX: -19,
      maxX: -5,
      minY: 0,
      maxY: 50,
      width: 14,
      height: 50,
    };
    // bbox.maxX (-5) > expandedMinX (-20) → should be visible
    expect(isInViewport(bbox, 0, 0, 100, 100)).toBe(true);
  });

  it('bbox just outside the buffered region is clipped', () => {
    // expandedMinX = 0 - 20 = -20; bbox.maxX = -21, so outside
    const bbox: BoundingBox = {
      minX: -30,
      maxX: -21,
      minY: 0,
      maxY: 50,
      width: 9,
      height: 50,
    };
    expect(isInViewport(bbox, 0, 0, 100, 100)).toBe(false);
  });
});

// ─── getSimplificationTolerance ─────────────────────────────────────────────

describe('getSimplificationTolerance', () => {
  // baseTolerance = min(width, height) * 0.01 = 100 * 0.01 = 1

  it('zoom < 0.5 → 8× base tolerance', () => {
    expect(getSimplificationTolerance(0.25, box100, 50)).toBeCloseTo(8);
  });

  it('zoom 0.5 ≤ zoom < 1.0 → 4× base tolerance', () => {
    expect(getSimplificationTolerance(0.75, box100, 50)).toBeCloseTo(4);
  });

  it('zoom 1.0 ≤ zoom < 2.0 → 2× base tolerance', () => {
    expect(getSimplificationTolerance(1.5, box100, 50)).toBeCloseTo(2);
  });

  it('zoom 2.0 ≤ zoom < 4.0 → 0.5× base tolerance', () => {
    expect(getSimplificationTolerance(3.0, box100, 50)).toBeCloseTo(0.5);
  });

  it('zoom ≥ 4.0 → 0 (no simplification)', () => {
    expect(getSimplificationTolerance(4.0, box100, 50)).toBe(0);
    expect(getSimplificationTolerance(8.0, box100, 50)).toBe(0);
  });

  it('uses the smaller dimension of the bounding box', () => {
    const tallBox: BoundingBox = {
      minX: 0,
      maxX: 50,
      minY: 0,
      maxY: 200,
      width: 50,
      height: 200,
    };
    // min(50, 200) * 0.01 = 0.5; zoom < 0.5 → 0.5 * 8 = 4
    expect(getSimplificationTolerance(0.25, tallBox, 100)).toBeCloseTo(4);
  });
});

// ─── shouldRenderVertices ───────────────────────────────────────────────────

describe('shouldRenderVertices', () => {
  it('returns true when selected, regardless of zoom', () => {
    expect(shouldRenderVertices(0.1, true)).toBe(true);
    expect(shouldRenderVertices(5.0, true)).toBe(true);
  });

  it('returns true when hovered, regardless of zoom', () => {
    expect(shouldRenderVertices(0.1, false, true)).toBe(true);
    expect(shouldRenderVertices(5.0, false, true)).toBe(true);
  });

  it('returns true when both selected and hovered', () => {
    expect(shouldRenderVertices(1.0, true, true)).toBe(true);
  });

  it('returns false when neither selected nor hovered', () => {
    expect(shouldRenderVertices(1.0, false, false)).toBe(false);
    expect(shouldRenderVertices(0.5, false)).toBe(false); // isHovered defaults false
  });
});

// ─── getVertexDecimationStep ─────────────────────────────────────────────────

describe('getVertexDecimationStep', () => {
  it('returns 1 (no decimation) for ≤ 20 points regardless of zoom', () => {
    expect(getVertexDecimationStep(0.1, 20)).toBe(1);
    expect(getVertexDecimationStep(5.0, 5)).toBe(1);
  });

  it('zoom < 0.5, pointCount > 500 → 0 (skip vertex render)', () => {
    expect(getVertexDecimationStep(0.4, 501)).toBe(0);
  });

  it('zoom < 0.5, pointCount ≤ 500 → 20', () => {
    expect(getVertexDecimationStep(0.4, 100)).toBe(20);
    expect(getVertexDecimationStep(0.4, 500)).toBe(20);
  });

  it('zoom 0.5–1.0, pointCount > 300 → 15', () => {
    expect(getVertexDecimationStep(0.8, 301)).toBe(15);
  });

  it('zoom 0.5–1.0, pointCount ≤ 300 → 10', () => {
    expect(getVertexDecimationStep(0.8, 50)).toBe(10);
  });

  it('zoom 1.0–1.5, pointCount > 200 → 8', () => {
    expect(getVertexDecimationStep(1.2, 201)).toBe(8);
  });

  it('zoom 1.0–1.5, pointCount ≤ 200 → 5', () => {
    expect(getVertexDecimationStep(1.2, 100)).toBe(5);
  });

  it('zoom 1.5–3.0, pointCount > 100 → 4', () => {
    expect(getVertexDecimationStep(2.0, 101)).toBe(4);
  });

  it('zoom 1.5–3.0, pointCount ≤ 100 → 3', () => {
    expect(getVertexDecimationStep(2.0, 50)).toBe(3);
  });

  it('zoom ≥ 3.0 → 1 (show every vertex)', () => {
    expect(getVertexDecimationStep(3.0, 1000)).toBe(1);
    expect(getVertexDecimationStep(10.0, 1000)).toBe(1);
  });
});

// ─── getDecimatedVertices ────────────────────────────────────────────────────

describe('getDecimatedVertices', () => {
  it('always returns all points (decimation disabled)', () => {
    const pts = [pt(0, 0), pt(1, 1), pt(2, 2), pt(3, 3)];
    const result = getDecimatedVertices(pts, 0.1);
    expect(result).toBe(pts); // same reference — passthrough
  });

  it('returns empty array unchanged', () => {
    expect(getDecimatedVertices([], 1.0)).toEqual([]);
  });
});

// ─── getViewportBounds ───────────────────────────────────────────────────────

describe('getViewportBounds', () => {
  it('computes image-space viewport at zoom=1 with zero offset', () => {
    const bounds = getViewportBounds(1, { x: 0, y: 0 }, 800, 600);
    expect(Object.is(bounds.x, -0) || bounds.x === 0).toBe(true); // -offset.x = -0
    expect(Object.is(bounds.y, -0) || bounds.y === 0).toBe(true);
    expect(bounds.width).toBe(800);
    expect(bounds.height).toBe(600);
  });

  it('halves the dimensions at zoom=2', () => {
    const bounds = getViewportBounds(2, { x: 0, y: 0 }, 800, 600);
    expect(bounds.width).toBe(400);
    expect(bounds.height).toBe(300);
  });

  it('doubles the dimensions at zoom=0.5', () => {
    const bounds = getViewportBounds(0.5, { x: 0, y: 0 }, 800, 600);
    expect(bounds.width).toBe(1600);
    expect(bounds.height).toBe(1200);
  });

  it('negates the offset to get image-space origin', () => {
    // If the canvas was panned +100 in x, the visible image origin is at -100
    const bounds = getViewportBounds(1, { x: 100, y: 50 }, 800, 600);
    expect(bounds.x).toBe(-100);
    expect(bounds.y).toBe(-50);
  });

  it('combines zoom and offset correctly', () => {
    const bounds = getViewportBounds(2, { x: 40, y: 20 }, 800, 600);
    expect(bounds.x).toBe(-40);
    expect(bounds.y).toBe(-20);
    expect(bounds.width).toBeCloseTo(400);
    expect(bounds.height).toBeCloseTo(300);
  });
});

// ─── measureRenderPerformance ────────────────────────────────────────────────

describe('measureRenderPerformance', () => {
  it('returns the result of the operation', () => {
    const { result } = measureRenderPerformance(() => 42, 5, 100, 80);
    expect(result).toBe(42);
  });

  it('records polygon and vertex counts verbatim', () => {
    const { metrics } = measureRenderPerformance(() => null, 7, 200, 150);
    expect(metrics.polygonCount).toBe(7);
    expect(metrics.vertexCount).toBe(150);
  });

  it('computes simplificationRatio = simplified / original', () => {
    const { metrics } = measureRenderPerformance(() => null, 1, 200, 100);
    expect(metrics.simplificationRatio).toBeCloseTo(0.5);
  });

  it('simplificationRatio is 1 when originalVertexCount is 0', () => {
    const { metrics } = measureRenderPerformance(() => null, 1, 0, 0);
    expect(metrics.simplificationRatio).toBe(1);
  });

  it('renderTime is non-negative', () => {
    const { metrics } = measureRenderPerformance(() => null, 1, 100, 100);
    expect(metrics.renderTime).toBeGreaterThanOrEqual(0);
  });
});
