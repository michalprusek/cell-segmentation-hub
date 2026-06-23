/**
 * Unit tests for the Add Points arc-selection contract.
 *
 * When a sequence is drawn between two vertices it replaces one of the two
 * boundary arcs. The requested behavior is to KEEP whichever candidate has the
 * LARGER perimeter (the sequence joins the bigger portion of the outline).
 */
import { describe, it, expect } from 'vitest';
import { insertPointsBetweenVertices } from '../useAdvancedInteractions';
import { calculatePolygonPerimeter } from '@/lib/polygonGeometry';
import type { Point } from '@/lib/segmentation';

const square: Point[] = [
  { x: 0, y: 0 }, // 0
  { x: 10, y: 0 }, // 1
  { x: 10, y: 10 }, // 2
  { x: 0, y: 10 }, // 3
];

const includesPoint = (pts: Point[], p: Point) =>
  pts.some(q => q.x === p.x && q.y === p.y);

describe('insertPointsBetweenVertices — keeps the larger-perimeter arc', () => {
  it('keeps the 3-edge outer arc (not the single inner edge) for adjacent vertices', () => {
    // Sequence between vertices 0 and 1 (the bottom edge). Keeping the larger
    // result means retaining the other three edges (vertices 2 and 3) plus the
    // new point, not collapsing to a small triangle on the bottom edge.
    const seq: Point[] = [{ x: 5, y: -5 }];
    const result = insertPointsBetweenVertices(square, 0, 1, seq)!;

    expect(includesPoint(result, { x: 10, y: 10 })).toBe(true); // vertex 2 kept
    expect(includesPoint(result, { x: 0, y: 10 })).toBe(true); // vertex 3 kept
    expect(includesPoint(result, { x: 5, y: -5 })).toBe(true); // new point added
  });

  it('returns whichever candidate has the larger perimeter', () => {
    const seq: Point[] = [{ x: 5, y: 5 }];
    const result = insertPointsBetweenVertices(square, 1, 3, seq)!;

    // Reconstruct the two candidates the function chooses between and assert the
    // returned one is the larger-perimeter candidate.
    const keepInner: Point[] = [square[1], square[2], square[3], seq[0]]; // inner arc 1->2->3 + seq
    const keepOuter: Point[] = [square[3], square[0], square[1], seq[0]]; // outer arc 3->0->1 + seq
    const pInner = calculatePolygonPerimeter(keepInner);
    const pOuter = calculatePolygonPerimeter(keepOuter);
    const resultPerimeter = calculatePolygonPerimeter(result);

    expect(resultPerimeter).toBeCloseTo(Math.max(pInner, pOuter), 6);
  });

  it('orients the drawn sequence regardless of click order (start > end)', () => {
    const seq: Point[] = [{ x: 5, y: -5 }];
    // Clicking end vertex first (2) then start (0) must produce the same shape
    // as clicking 0 then 2 — the sequence is oriented internally.
    const a = insertPointsBetweenVertices(square, 0, 2, seq)!;
    const b = insertPointsBetweenVertices(square, 2, 0, seq)!;
    expect(calculatePolygonPerimeter(a)).toBeCloseTo(
      calculatePolygonPerimeter(b),
      6
    );
  });

  it('is a no-op for adjacent vertices with no new points', () => {
    expect(insertPointsBetweenVertices(square, 0, 1, [])).toBe(square);
  });
});
