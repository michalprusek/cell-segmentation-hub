import { describe, it, expect } from 'vitest';
import {
  calculateMetrics,
  calculatePolylineLength,
  formatNumber,
} from '../metricCalculations';

// Hand-computable reference shapes
// Unit square: points (0,0),(1,0),(1,1),(0,1)
//   area = 1, perimeter = 4, bbox = 1×1, extent = 1
//   Feret max = √2 ≈ 1.4142, Feret min = 1.0
//   circularity = 4π × 1 / 4² = π/4 ≈ 0.7854
//   equivalent diameter = √(4/π) ≈ 1.1284
const UNIT_SQUARE = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

// 3-4-5 right triangle: (0,0),(3,0),(0,4)
//   area = 6, perimeter = 3+4+5 = 12
//   Feret max = 5 (hypotenuse), bbox = 3×4
//   extent = 6/(3×4) = 0.5
const TRIANGLE_3_4_5 = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
  { x: 0, y: 4 },
];

// 2×3 rectangle: (0,0),(2,0),(2,3),(0,3)
//   area = 6, perimeter = 10, bbox = 2×3
//   Feret max = √(4+9) = √13, Feret min = 2
//   extent = 1.0
const RECT_2X3 = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 3 },
  { x: 0, y: 3 },
];

describe('calculateMetrics', () => {
  describe('unit square', () => {
    const m = calculateMetrics({ points: UNIT_SQUARE });

    it('computes area = 1', () => {
      expect(m.Area).toBeCloseTo(1.0, 5);
    });

    it('computes perimeter = 4', () => {
      expect(m.Perimeter).toBeCloseTo(4.0, 5);
    });

    it('PerimeterWithHoles equals Perimeter when no holes', () => {
      expect(m.PerimeterWithHoles).toBeCloseTo(m.Perimeter, 10);
    });

    it('bounding box is 1×1', () => {
      expect(m.BoundingBoxWidth).toBeCloseTo(1.0, 5);
      expect(m.BoundingBoxHeight).toBeCloseTo(1.0, 5);
    });

    it('extent = 1 (square fills its bbox completely)', () => {
      expect(m.Extent).toBeCloseTo(1.0, 5);
    });

    it('Feret max = √2 (diagonal)', () => {
      expect(m.FeretDiameterMax).toBeCloseTo(Math.SQRT2, 4);
    });

    it('Feret min = 1 (side length)', () => {
      expect(m.FeretDiameterMin).toBeCloseTo(1.0, 4);
    });

    it('Feret aspect ratio ≈ √2', () => {
      expect(m.FeretAspectRatio).toBeCloseTo(Math.SQRT2, 4);
    });

    it('circularity = π/4 (≈ 0.7854) for a unit square', () => {
      // 4π × 1 / 4² = π/4
      expect(m.Circularity).toBeCloseTo(Math.PI / 4, 4);
    });

    it('compactness = 4/π (reciprocal of circularity)', () => {
      expect(m.Compactness).toBeCloseTo(4 / Math.PI, 4);
    });

    it('equivalent diameter = √(4/π)', () => {
      expect(m.EquivalentDiameter).toBeCloseTo(Math.sqrt(4 / Math.PI), 5);
    });

    it('solidity = 1 (convex shape)', () => {
      // A square is its own convex hull
      expect(m.Solidity).toBeCloseTo(1.0, 4);
    });

    it('convexity = 1 (convex hull perimeter == outer perimeter)', () => {
      expect(m.Convexity).toBeCloseTo(1.0, 4);
    });
  });

  describe('3-4-5 right triangle', () => {
    const m = calculateMetrics({ points: TRIANGLE_3_4_5 });

    it('computes area = 6', () => {
      expect(m.Area).toBeCloseTo(6.0, 5);
    });

    it('computes perimeter = 12', () => {
      expect(m.Perimeter).toBeCloseTo(12.0, 5);
    });

    it('bounding box = 3 × 4', () => {
      expect(m.BoundingBoxWidth).toBeCloseTo(3.0, 5);
      expect(m.BoundingBoxHeight).toBeCloseTo(4.0, 5);
    });

    it('extent = 6/12 = 0.5', () => {
      expect(m.Extent).toBeCloseTo(0.5, 5);
    });

    it('Feret max = 5 (hypotenuse)', () => {
      expect(m.FeretDiameterMax).toBeCloseTo(5.0, 4);
    });

    it('Feret aspect ratio > 1', () => {
      expect(m.FeretAspectRatio).toBeGreaterThan(1.0);
    });

    it('solidity = 1 (triangle is convex)', () => {
      expect(m.Solidity).toBeCloseTo(1.0, 4);
    });
  });

  describe('2×3 rectangle', () => {
    const m = calculateMetrics({ points: RECT_2X3 });

    it('area = 6', () => {
      expect(m.Area).toBeCloseTo(6.0, 5);
    });

    it('perimeter = 10', () => {
      expect(m.Perimeter).toBeCloseTo(10.0, 5);
    });

    it('extent = 1 (rectangle fills its bbox)', () => {
      expect(m.Extent).toBeCloseTo(1.0, 5);
    });

    it('Feret max = √13 (diagonal)', () => {
      expect(m.FeretDiameterMax).toBeCloseTo(Math.sqrt(13), 4);
    });

    it('Feret min = 2 (shorter side)', () => {
      expect(m.FeretDiameterMin).toBeCloseTo(2.0, 4);
    });

    it('Feret aspect ratio = √13 / 2', () => {
      expect(m.FeretAspectRatio).toBeCloseTo(Math.sqrt(13) / 2, 4);
    });
  });

  describe('hole area subtraction', () => {
    // Outer 4×4 square minus inner 2×2 square
    const outer = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const inner = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
    ];
    // outer area = 16, hole area = 4 → net area = 12
    const m = calculateMetrics({ points: outer }, [{ points: inner }]);

    it('subtracts hole area: 16 − 4 = 12', () => {
      expect(m.Area).toBeCloseTo(12.0, 5);
    });

    it('PerimeterWithHoles = outer + hole perimeter = 16 + 8 = 24', () => {
      expect(m.PerimeterWithHoles).toBeCloseTo(24.0, 5);
    });

    it('Perimeter is outer perimeter only = 16', () => {
      expect(m.Perimeter).toBeCloseTo(16.0, 5);
    });
  });

  describe('invalid input guard', () => {
    it('returns all-zero metrics for empty points array', () => {
      const m = calculateMetrics({ points: [] });
      expect(m.Area).toBe(0);
      expect(m.Perimeter).toBe(0);
      expect(m.Circularity).toBe(0);
      expect(m.FeretDiameterMax).toBe(0);
    });

    it('returns all-zero metrics for fewer than 3 points', () => {
      const m = calculateMetrics({
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      });
      expect(m.Area).toBe(0);
    });

    it('returns all-zero metrics for NaN coordinates', () => {
      const m = calculateMetrics({
        points: [
          { x: NaN, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      });
      expect(m.Area).toBe(0);
    });

    it('returns all-zero metrics for Infinity coordinates', () => {
      const m = calculateMetrics({
        points: [
          { x: Infinity, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      });
      expect(m.Area).toBe(0);
    });

    it('ignores holes with invalid points', () => {
      const m = calculateMetrics({ points: UNIT_SQUARE }, [
        {
          points: [
            { x: NaN, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      ]);
      // Invalid hole is skipped; result should match no-hole case
      expect(m.Area).toBeCloseTo(1.0, 5);
    });
  });

  describe('metric relationships', () => {
    it('circularity is always in (0, 1]', () => {
      for (const polygon of [UNIT_SQUARE, TRIANGLE_3_4_5, RECT_2X3]) {
        const m = calculateMetrics({ points: polygon });
        expect(m.Circularity).toBeGreaterThan(0);
        expect(m.Circularity).toBeLessThanOrEqual(1.0);
      }
    });

    it('compactness is the reciprocal of circularity', () => {
      const m = calculateMetrics({ points: UNIT_SQUARE });
      expect(m.Compactness).toBeCloseTo(1 / m.Circularity, 4);
    });

    it('solidity is in (0, 1] for convex shapes', () => {
      for (const polygon of [UNIT_SQUARE, TRIANGLE_3_4_5, RECT_2X3]) {
        const m = calculateMetrics({ points: polygon });
        expect(m.Solidity).toBeGreaterThan(0);
        expect(m.Solidity).toBeLessThanOrEqual(1.0);
      }
    });

    it('FeretAspectRatio = FeretMax / FeretMin', () => {
      const m = calculateMetrics({ points: RECT_2X3 });
      expect(m.FeretAspectRatio).toBeCloseTo(
        m.FeretDiameterMax / m.FeretDiameterMin,
        5
      );
    });

    it('equivalent diameter matches formula √(4A/π)', () => {
      const m = calculateMetrics({ points: TRIANGLE_3_4_5 });
      expect(m.EquivalentDiameter).toBeCloseTo(
        Math.sqrt((4 * m.Area) / Math.PI),
        5
      );
    });
  });
});

describe('calculatePolylineLength', () => {
  it('returns 0 for empty array', () => {
    expect(calculatePolylineLength([])).toBe(0);
  });

  it('returns 0 for single point', () => {
    expect(calculatePolylineLength([{ x: 3, y: 4 }])).toBe(0);
  });

  it('returns correct length for horizontal segment', () => {
    // (0,0) → (5,0): length = 5
    expect(
      calculatePolylineLength([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ])
    ).toBeCloseTo(5, 10);
  });

  it('returns correct length for a 3-4-5 open path', () => {
    // (0,0)→(3,0)→(3,4): segments 3 + 4 = 7
    const points = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ];
    expect(calculatePolylineLength(points)).toBeCloseTo(7, 10);
  });

  it('does NOT close the path (open polyline vs closed polygon)', () => {
    // A unit square as a polyline has 3 segments (not 4)
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    // Open length = 1+1+1 = 3, closed perimeter would be 4
    expect(calculatePolylineLength(pts)).toBeCloseTo(3.0, 10);
  });

  it('handles diagonal segments correctly', () => {
    // (0,0)→(1,1): √2
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(calculatePolylineLength(points)).toBeCloseTo(Math.SQRT2, 10);
  });

  it('handles multi-segment zigzag', () => {
    // (0,0)→(0,3)→(4,3): 3 + 4 = 7
    const points = [
      { x: 0, y: 0 },
      { x: 0, y: 3 },
      { x: 4, y: 3 },
    ];
    expect(calculatePolylineLength(points)).toBeCloseTo(7, 10);
  });
});

describe('formatNumber', () => {
  it('formats integer to 4 decimal places', () => {
    expect(formatNumber(1)).toBe('1.0000');
  });

  it('formats a float to 4 decimal places', () => {
    expect(formatNumber(Math.PI)).toBe('3.1416');
  });

  it('formats zero to 4 decimal places', () => {
    expect(formatNumber(0)).toBe('0.0000');
  });

  it('rounds correctly (half-up)', () => {
    expect(formatNumber(1.00005)).toBe('0.0001'.replace('0.0001', '1.0001'));
    // toFixed rounds: 1.00005 → "1.0001"
    expect(formatNumber(1.00005)).toBe('1.0001');
  });

  it('handles negative values', () => {
    expect(formatNumber(-2.5)).toBe('-2.5000');
  });
});
