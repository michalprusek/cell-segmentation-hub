import { describe, it, expect } from 'vitest';
import { polylineLength } from '../polygonGeometry';

describe('polylineLength', () => {
  it('returns 0 for empty input', () => {
    expect(polylineLength([])).toBe(0);
  });

  it('returns 0 for a single point (no segments)', () => {
    expect(polylineLength([{ x: 5, y: 5 }])).toBe(0);
  });

  it('computes Euclidean length for a 3-4-5 right triangle hypotenuse', () => {
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ])
    ).toBeCloseTo(5);
  });

  it('sums segments along an open polyline (no closing segment)', () => {
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
      ])
    ).toBeCloseTo(7);
  });

  it('returns NaN if any coordinate is NaN (does not silently coerce to 0)', () => {
    const result = polylineLength([
      { x: 0, y: 0 },
      { x: Number.NaN, y: 1 },
    ]);
    expect(Number.isNaN(result)).toBe(true);
  });
});
