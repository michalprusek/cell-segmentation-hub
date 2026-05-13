import { describe, it, expect } from 'vitest';
import { slicePolyline, validateSlicePolyline } from '../polygonSlicing';
import type { Polygon } from '../segmentation';

const mkPolyline = (
  points: Array<[number, number]>,
  overrides: Partial<Polygon> = {}
): Polygon => ({
  id: 'p1',
  points: points.map(([x, y]) => ({ x, y })),
  type: 'external',
  geometry: 'polyline',
  area: 0,
  confidence: 1,
  instanceId: overrides.instanceId ?? 'mt_abc',
  ...overrides,
});

describe('slicePolyline', () => {
  it('splits a straight 3-point polyline at the middle edge', () => {
    // (0,0) → (10,0) → (20,0); slice line is vertical at x=5.
    const poly = mkPolyline([
      [0, 0],
      [10, 0],
      [20, 0],
    ]);
    const out = slicePolyline(poly, { x: 5, y: -5 }, { x: 5, y: 5 });
    expect(out).not.toBeNull();
    const [a, b] = out!;
    expect(a.points).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
    expect(b.points).toEqual([
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
  });

  it('assigns fresh instanceIds with the original prefix', () => {
    const poly = mkPolyline(
      [
        [0, 0],
        [10, 0],
      ],
      { instanceId: 'mt_abcd1234' }
    );
    const out = slicePolyline(poly, { x: 5, y: -1 }, { x: 5, y: 1 });
    expect(out).not.toBeNull();
    const [a, b] = out!;
    expect(a.instanceId).toMatch(/^mt_[0-9a-f]{8}$/);
    expect(b.instanceId).toMatch(/^mt_[0-9a-f]{8}$/);
    expect(a.instanceId).not.toEqual(b.instanceId);
  });

  it('drops trackId so each half is a fresh tracker object', () => {
    const poly = mkPolyline(
      [
        [0, 0],
        [10, 0],
      ],
      { trackId: 'track_keep_or_drop' }
    );
    const out = slicePolyline(poly, { x: 5, y: -1 }, { x: 5, y: 1 });
    expect(out).not.toBeNull();
    const [a, b] = out!;
    expect(a.trackId).toBeUndefined();
    expect(b.trackId).toBeUndefined();
  });

  it('preserves class / partClass on both halves', () => {
    const poly = mkPolyline(
      [
        [0, 0],
        [10, 0],
      ],
      { class: 'microtubule' as Polygon['class'] }
    );
    const out = slicePolyline(poly, { x: 5, y: -1 }, { x: 5, y: 1 });
    expect(out!.every(p => p.class === 'microtubule')).toBe(true);
  });

  it('returns null when slice line never crosses the polyline', () => {
    const poly = mkPolyline([
      [0, 0],
      [10, 0],
    ]);
    expect(
      slicePolyline(poly, { x: 100, y: 100 }, { x: 200, y: 100 })
    ).toBeNull();
  });

  it('returns null on too-short / single-point polyline', () => {
    const poly = mkPolyline([[0, 0]]);
    expect(slicePolyline(poly, { x: -1, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });

  it('only honours the first crossing for ambiguous N-shaped paths', () => {
    // Z-shape that crosses x=5 twice — we keep the first one.
    const poly = mkPolyline([
      [0, 0],
      [10, 0],
      [0, 10],
      [10, 10],
    ]);
    const out = slicePolyline(poly, { x: 5, y: -5 }, { x: 5, y: 15 });
    expect(out).not.toBeNull();
    const [a] = out!;
    // First crossing is the first segment (0,0)→(10,0) at (5,0)
    expect(a.points.at(-1)).toEqual({ x: 5, y: 0 });
  });
});

describe('validateSlicePolyline', () => {
  it('rejects too-short slice lines', () => {
    const poly = mkPolyline([
      [0, 0],
      [10, 0],
    ]);
    const v = validateSlicePolyline(poly, { x: 5, y: 0 }, { x: 5.5, y: 0 });
    expect(v.isValid).toBe(false);
    expect(v.reason).toMatch(/too short/i);
  });

  it('accepts a valid 1-crossing slice', () => {
    const poly = mkPolyline([
      [0, 0],
      [10, 0],
    ]);
    expect(
      validateSlicePolyline(poly, { x: 5, y: -5 }, { x: 5, y: 5 }).isValid
    ).toBe(true);
  });

  it('rejects when no edge intersects the slice line', () => {
    const poly = mkPolyline([
      [0, 0],
      [10, 0],
    ]);
    const v = validateSlicePolyline(
      poly,
      { x: 100, y: 100 },
      { x: 200, y: 100 }
    );
    expect(v.isValid).toBe(false);
    expect(v.reason).toMatch(/does not cross/i);
  });
});
