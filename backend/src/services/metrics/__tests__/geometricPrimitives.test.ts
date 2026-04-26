import { describe, it, expect } from 'vitest';
import {
  calculatePolygonArea,
  calculatePerimeter,
  calculateBoundingBox,
  calculateConvexHull,
  cross,
  distance,
  pointToLineDistance,
  rotatingCalipers,
  isPointInPolygon,
  isPolygonInside,
  calculateCentroid,
  type Point,
} from '../geometricPrimitives';

const square = (size: number, offset = 0): Point[] => [
  { x: offset, y: offset },
  { x: offset + size, y: offset },
  { x: offset + size, y: offset + size },
  { x: offset, y: offset + size },
];

describe('calculatePolygonArea', () => {
  it('returns 0 for empty / fewer than 3 points', () => {
    expect(calculatePolygonArea([])).toBe(0);
    expect(calculatePolygonArea([{ x: 0, y: 0 }])).toBe(0);
    expect(
      calculatePolygonArea([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ])
    ).toBe(0);
  });

  it('computes area of a unit square = 1', () => {
    expect(calculatePolygonArea(square(1))).toBe(1);
  });

  it('returns absolute value (orientation independent)', () => {
    const ccw = square(10);
    const cw = [...ccw].reverse();
    expect(calculatePolygonArea(ccw)).toBe(100);
    expect(calculatePolygonArea(cw)).toBe(100);
  });

  it('handles arrays containing entries that fail typeof check at runtime', () => {
    // The runtime guard `typeof x !== 'number'` skips malformed entries;
    // assert tolerance via a cast to bypass static type-checking.
    const points = [
      { x: 0, y: 0 },
      { x: 'bad', y: 0 } as unknown as Point,
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ];
    expect(() => calculatePolygonArea(points)).not.toThrow();
  });
});

describe('calculatePerimeter', () => {
  it('returns 0 for fewer than 2 points', () => {
    expect(calculatePerimeter([])).toBe(0);
    expect(calculatePerimeter([{ x: 0, y: 0 }])).toBe(0);
  });

  it('computes perimeter of a unit square = 4', () => {
    expect(calculatePerimeter(square(1))).toBe(4);
  });

  it('uses Pythagorean distance — diagonal triangle 3-4-5', () => {
    // Triangle with sides 3, 4, 5 → perimeter 12
    const triangle = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ];
    expect(calculatePerimeter(triangle)).toBe(12);
  });
});

describe('calculateBoundingBox', () => {
  it('returns zero dims for empty input', () => {
    expect(calculateBoundingBox([])).toEqual({ width: 0, height: 0 });
  });

  it('returns extents for an axis-aligned square', () => {
    expect(calculateBoundingBox(square(7, 3))).toEqual({
      width: 7,
      height: 7,
    });
  });
});

describe('cross', () => {
  it('positive for CCW turn, negative for CW, zero for collinear', () => {
    const o = { x: 0, y: 0 };
    const a = { x: 1, y: 0 };
    const ccw = { x: 1, y: 1 };
    const cw = { x: 1, y: -1 };
    const collinear = { x: 2, y: 0 };

    expect(cross(o, a, ccw)).toBeGreaterThan(0);
    expect(cross(o, a, cw)).toBeLessThan(0);
    expect(cross(o, a, collinear)).toBe(0);
  });
});

describe('distance', () => {
  it('Euclidean — 3-4-5', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('calculateConvexHull', () => {
  it('returns input unchanged for fewer than 3 points', () => {
    const two = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(calculateConvexHull(two)).toEqual(two);
  });

  it('strips interior points from a square + interior', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }, // interior
    ];
    const hull = calculateConvexHull(points);
    expect(hull.length).toBe(4);
    // Interior point is gone
    expect(hull).not.toContainEqual({ x: 5, y: 5 });
  });
});

describe('pointToLineDistance', () => {
  it('clamps to endpoint when projection is outside segment (param < 0)', () => {
    const point = { x: -5, y: 0 };
    const lineStart = { x: 0, y: 0 };
    const lineEnd = { x: 10, y: 0 };
    // Projection lands at -5 (left of start) → distance to start = 5
    expect(pointToLineDistance(point, lineStart, lineEnd)).toBe(5);
  });

  it('clamps to endpoint when projection is outside segment (param > 1)', () => {
    const point = { x: 15, y: 0 };
    const lineStart = { x: 0, y: 0 };
    const lineEnd = { x: 10, y: 0 };
    expect(pointToLineDistance(point, lineStart, lineEnd)).toBe(5);
  });

  it('handles zero-length segment (lenSq === 0) gracefully', () => {
    expect(
      pointToLineDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })
    ).toBe(5);
  });

  it('perpendicular distance for point above midpoint', () => {
    expect(
      pointToLineDistance({ x: 5, y: 7 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    ).toBe(7);
  });
});

describe('rotatingCalipers', () => {
  it('returns zero for hull with fewer than 3 points', () => {
    expect(
      rotatingCalipers([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ])
    ).toEqual({ max: 0, min: 0, orthogonal: 0 });
  });

  it('square hull max Feret = diagonal length √2 * side', () => {
    const hull = square(10);
    const result = rotatingCalipers(hull);
    expect(result.max).toBeCloseTo(Math.sqrt(200), 5); // ≈ 14.142
  });
});

describe('isPointInPolygon', () => {
  it('returns false for polygons with fewer than 3 points', () => {
    expect(isPointInPolygon({ x: 0, y: 0 }, { points: [] })).toBe(false);
  });

  it('detects point inside a square', () => {
    expect(isPointInPolygon({ x: 5, y: 5 }, { points: square(10) })).toBe(true);
  });

  it('detects point outside a square', () => {
    expect(isPointInPolygon({ x: 15, y: 5 }, { points: square(10) })).toBe(false);
  });
});

describe('calculateCentroid', () => {
  it('returns origin for empty input', () => {
    expect(calculateCentroid([])).toEqual({ x: 0, y: 0 });
  });

  it('finds the geometric center of a unit square', () => {
    const c = calculateCentroid(square(10));
    expect(c.x).toBeCloseTo(5, 5);
    expect(c.y).toBeCloseTo(5, 5);
  });

  it('falls back to vertex average for degenerate (zero-area) input', () => {
    // Three collinear points — area === 0 triggers fallback
    const collinear = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ];
    const c = calculateCentroid(collinear);
    expect(c.x).toBeCloseTo(5, 5);
    expect(c.y).toBe(0);
  });
});

describe('isPolygonInside', () => {
  it('returns true when inner centroid lies inside outer polygon', () => {
    const inner = { points: square(2, 4) }; // small square at (4,4)-(6,6)
    const outer = { points: square(10) };
    expect(isPolygonInside(inner, outer)).toBe(true);
  });

  it('returns false when inner centroid lies outside outer polygon', () => {
    const inner = { points: square(2, 20) }; // small square far away
    const outer = { points: square(10) };
    expect(isPolygonInside(inner, outer)).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(isPolygonInside({ points: [] }, { points: square(10) })).toBe(
      false
    );
    expect(isPolygonInside({ points: square(10) }, { points: [] })).toBe(
      false
    );
  });
});
