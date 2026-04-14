import { describe, expect, it } from 'vitest';
import { VertexSpatialIndex } from '../VertexSpatialIndex';

const triangle = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 5, y: 8 },
];

describe('VertexSpatialIndex', () => {
  it('finds the closest vertex index', () => {
    const idx = new VertexSpatialIndex();
    // Query near vertex 1 (10, 0) — well within maxDistance.
    const result = idx.findNearestVertex('poly-a', triangle, 9.5, 0.3, 2);
    expect(result).toBe(1);
  });

  it('returns null when outside maxDistance', () => {
    const idx = new VertexSpatialIndex();
    const result = idx.findNearestVertex('poly-a', triangle, 1000, 1000, 5);
    expect(result).toBeNull();
  });

  it('reuses the cached tree when points reference is unchanged', () => {
    const idx = new VertexSpatialIndex();
    const first = idx.findNearestVertex('poly-a', triangle, 0, 0, 1);
    const second = idx.findNearestVertex('poly-a', triangle, 0, 0, 1);
    expect(first).toBe(0);
    expect(second).toBe(0);
  });

  it('rebuilds when points reference changes', () => {
    const idx = new VertexSpatialIndex();
    idx.findNearestVertex('poly-a', triangle, 0, 0, 1);

    const shifted = triangle.map(p => ({ x: p.x + 100, y: p.y }));
    const res = idx.findNearestVertex('poly-a', shifted, 100, 0, 1);
    expect(res).toBe(0);
  });

  it('scales to a 4000-point polygon', () => {
    const idx = new VertexSpatialIndex();
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < 4000; i++) {
      const angle = (i / 4000) * Math.PI * 2;
      points.push({ x: Math.cos(angle) * 500, y: Math.sin(angle) * 500 });
    }

    // Query at angle 0 (≈ (500, 0)) -- expect vertex 0.
    const res = idx.findNearestVertex('poly-big', points, 500, 0, 10);
    expect(res).toBe(0);
  });

  it('handles polygons entirely in negative coordinate space', () => {
    // Exercises the bounds + padding math for negative coords — a
    // panned/zoomed image can produce polygon points far into the
    // negative quadrant. A missing sign guard used to mis-pad bounds.
    const idx = new VertexSpatialIndex();
    const negTriangle = [
      { x: -500, y: -500 },
      { x: -490, y: -500 },
      { x: -495, y: -492 },
    ];
    const res = idx.findNearestVertex(
      'poly-neg',
      negTriangle,
      -489.5,
      -500.3,
      2
    );
    expect(res).toBe(1);
  });
});
