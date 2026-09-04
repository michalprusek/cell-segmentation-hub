import { describe, it, expect, beforeEach } from 'vitest';
import { slicePolygon, validateSliceLine } from '@/lib/polygonSlicing';
import { calculatePolygonArea } from '@/lib/polygonGeometry';
import {
  createTestPolygons,
  createTestPolygonObjects,
} from '@/test-utils/polygonTestUtils';
import type { Point, Polygon } from '@/lib/segmentation';

describe('Polygon Slicing', () => {
  let testPolygons: ReturnType<typeof createTestPolygons>;
  let testPolygonObjects: ReturnType<typeof createTestPolygonObjects>;

  beforeEach(() => {
    testPolygons = createTestPolygons();
    testPolygonObjects = createTestPolygonObjects();
  });

  describe('slicePolygon', () => {
    it('should slice a square horizontally', () => {
      const square = testPolygonObjects.squarePolygon;
      const sliceStart: Point = { x: -10, y: 50 };
      const sliceEnd: Point = { x: 110, y: 50 };

      const result = slicePolygon(square, sliceStart, sliceEnd);

      expect(result).not.toBeNull();
      const [polygon1, polygon2] = result!;

      // Both polygons should have valid IDs and points
      expect(polygon1.id).toBeDefined();
      expect(polygon2.id).toBeDefined();
      expect(polygon1.points.length).toBeGreaterThanOrEqual(3);
      expect(polygon2.points.length).toBeGreaterThanOrEqual(3);

      // Total area should be preserved
      const originalArea = calculatePolygonArea(square.points);
      const area1 = calculatePolygonArea(polygon1.points);
      const area2 = calculatePolygonArea(polygon2.points);
      expect(area1 + area2).toBeCloseTo(originalArea, 1);

      // Areas should be roughly equal for horizontal cut
      expect(Math.abs(area1 - area2)).toBeLessThan(originalArea * 0.1);
    });

    it('should slice a square vertically', () => {
      const square = testPolygonObjects.squarePolygon;
      const sliceStart: Point = { x: 50, y: -10 };
      const sliceEnd: Point = { x: 50, y: 110 };

      const result = slicePolygon(square, sliceStart, sliceEnd);

      expect(result).not.toBeNull();
      const [polygon1, polygon2] = result!;

      expect(polygon1.points.length).toBeGreaterThanOrEqual(3);
      expect(polygon2.points.length).toBeGreaterThanOrEqual(3);

      // Total area should be preserved
      const originalArea = calculatePolygonArea(square.points);
      const area1 = calculatePolygonArea(polygon1.points);
      const area2 = calculatePolygonArea(polygon2.points);
      expect(area1 + area2).toBeCloseTo(originalArea, 1);
    });

    it('should slice a triangle creating two valid polygons', () => {
      const triangle = testPolygonObjects.trianglePolygon;
      const sliceStart: Point = { x: 25, y: -10 };
      const sliceEnd: Point = { x: 75, y: 110 };

      const result = slicePolygon(triangle, sliceStart, sliceEnd);

      expect(result).not.toBeNull();
      const [polygon1, polygon2] = result!;

      expect(polygon1.points.length).toBeGreaterThanOrEqual(3);
      expect(polygon2.points.length).toBeGreaterThanOrEqual(3);

      // Total area should be preserved
      const originalArea = calculatePolygonArea(triangle.points);
      const area1 = calculatePolygonArea(polygon1.points);
      const area2 = calculatePolygonArea(polygon2.points);
      expect(area1 + area2).toBeCloseTo(originalArea, 1);
    });

    it('should handle complex polygon slicing', () => {
      const complex = testPolygonObjects.complexPolygon;
      const sliceStart: Point = { x: 25, y: -10 };
      const sliceEnd: Point = { x: 25, y: 110 };

      const result = slicePolygon(complex, sliceStart, sliceEnd);

      expect(result).not.toBeNull();
      const [polygon1, polygon2] = result!;

      expect(polygon1.points.length).toBeGreaterThanOrEqual(3);
      expect(polygon2.points.length).toBeGreaterThanOrEqual(3);

      // Both polygons should have positive area
      const area1 = calculatePolygonArea(polygon1.points);
      const area2 = calculatePolygonArea(polygon2.points);
      expect(area1).toBeGreaterThan(0);
      expect(area2).toBeGreaterThan(0);
    });

    it('should preserve polygon properties', () => {
      const square = testPolygonObjects.squarePolygon;
      const sliceStart: Point = { x: -10, y: 50 };
      const sliceEnd: Point = { x: 110, y: 50 };

      const result = slicePolygon(square, sliceStart, sliceEnd);

      expect(result).not.toBeNull();
      const [polygon1, polygon2] = result!;

      // Should preserve color and confidence
      expect(polygon1.confidence).toBe(square.confidence);
      expect(polygon2.confidence).toBe(square.confidence);
      // Note: createPolygon doesn't copy the type property, this is expected behavior
    });

    it('should return null for invalid slices', () => {
      const square = testPolygonObjects.squarePolygon;

      // Slice that doesn't intersect the polygon
      const noIntersectionResult = slicePolygon(
        square,
        { x: 200, y: 0 },
        { x: 200, y: 100 }
      );
      expect(noIntersectionResult).toBeNull();

      // Slice that only touches one edge with segment - should return null
      // because the segment only touches the vertex and doesn't cross two edges
      const oneIntersectionResult = slicePolygon(
        square,
        { x: 0, y: -10 },
        { x: 0, y: 0 }
      );
      expect(oneIntersectionResult).toBeNull();

      // Very short slice line
      const shortLineResult = slicePolygon(
        square,
        { x: 50, y: 50 },
        { x: 50.1, y: 50.1 }
      );
      expect(shortLineResult).toBeNull();
    });

    it('should handle edge cases gracefully', () => {
      // Empty polygon
      const emptyPolygon: Polygon = {
        id: 'empty',
        points: [],
        type: 'external',
      };
      expect(
        slicePolygon(emptyPolygon, { x: 0, y: 0 }, { x: 1, y: 1 })
      ).toBeNull();

      // Polygon with insufficient points
      const linePolygon: Polygon = {
        id: 'line',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        type: 'external',
      };
      expect(
        slicePolygon(linePolygon, { x: 0, y: 0 }, { x: 1, y: 1 })
      ).toBeNull();
    });

    it('should handle slices that pass through vertices', () => {
      const square = testPolygonObjects.squarePolygon;
      const sliceStart: Point = { x: 0, y: 0 }; // Starts at vertex
      const sliceEnd: Point = { x: 100, y: 100 }; // Ends at vertex

      const result = slicePolygon(square, sliceStart, sliceEnd);

      // Should either succeed with valid polygons or fail explicitly
      if (result !== null) {
        const [polygon1, polygon2] = result;
        expect(polygon1.points.length).toBeGreaterThanOrEqual(3);
        expect(polygon2.points.length).toBeGreaterThanOrEqual(3);
        // Verify both polygons have positive area
        const area1 = calculatePolygonArea(polygon1.points);
        const area2 = calculatePolygonArea(polygon2.points);
        expect(area1).toBeGreaterThan(0);
        expect(area2).toBeGreaterThan(0);
      } else {
        // If it fails, that's also acceptable for vertex edge cases
        expect(result).toBeNull();
      }
    });
  });

  describe('validateSliceLine', () => {
    it('should validate correct slice lines', () => {
      const square = testPolygonObjects.squarePolygon;
      const sliceStart: Point = { x: -10, y: 50 };
      const sliceEnd: Point = { x: 110, y: 50 };

      const validation = validateSliceLine(square, sliceStart, sliceEnd);

      expect(validation.isValid).toBe(true);
      expect(validation.intersectionCount).toBe(2);
      expect(validation.reason).toBeUndefined();
    });

    it('should reject slice lines with wrong intersection count', () => {
      const square = testPolygonObjects.squarePolygon;

      // No intersections
      const noIntersectValidation = validateSliceLine(
        square,
        { x: 200, y: 0 },
        { x: 200, y: 100 }
      );
      expect(noIntersectValidation.isValid).toBe(false);
      expect(noIntersectValidation.intersectionCount).toBe(0);
      expect(noIntersectValidation.reason).toContain(
        'Slice line does not intersect the polygon'
      );

      // One intersection with segment, but infinite line has two intersections
      // This should now be valid with the infinite line extension
      const oneIntersectValidation = validateSliceLine(
        square,
        { x: 0, y: -10 },
        { x: 0, y: 10 }
      );
      expect(oneIntersectValidation.isValid).toBe(true);
      expect(oneIntersectValidation.intersectionCount).toBe(2);
      expect(oneIntersectValidation.extendedToInfiniteLine).toBe(true);
    });

    it('should reject very short slice lines', () => {
      const square = testPolygonObjects.squarePolygon;
      const validation = validateSliceLine(
        square,
        { x: 50, y: 50 },
        { x: 50.1, y: 50.1 }
      );

      expect(validation.isValid).toBe(false);
      expect(validation.reason).toContain('Slice line is too short');
    });

    it('should reject invalid polygons', () => {
      const invalidPolygon: Polygon = {
        id: 'invalid',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        type: 'external',
      };

      const validation = validateSliceLine(
        invalidPolygon,
        { x: 0, y: 0 },
        { x: 10, y: 10 }
      );

      expect(validation.isValid).toBe(false);
      expect(validation.reason).toBe('Polygon must have at least 3 points');
    });
  });

  describe('large polygon (analytic ground truth)', () => {
    it('splits a regular 20-gon into two exactly equal halves', () => {
      const largePolygon: Polygon = {
        id: 'large',
        points: testPolygons.large,
        type: 'external',
      };

      // Was `expect(performance.averageTime).toBeLessThan(10)` over 50
      // iterations. testPolygons.large is a 20-point polygon and jsdom's
      // performance.now() resolves to a whole millisecond, so averageTime was 0
      // and the ceiling could not fail. Assert the RESULT instead.
      //
      // The fixture is a regular 20-gon of circumradius 1000 with vertices at
      // angles k*18deg, so k=0 and k=10 sit exactly on the y=0 axis: slicing
      // along it splits the polygon through two opposite vertices into two
      // halves of exactly equal area.
      const result = slicePolygon(
        largePolygon,
        { x: -500, y: 0 },
        { x: 500, y: 0 }
      );

      expect(result).not.toBeNull();
      const [top, bottom] = result!;
      const totalArea = 0.5 * 20 * 1000 * 1000 * Math.sin((2 * Math.PI) / 20);

      expect(calculatePolygonArea(top.points)).toBeCloseTo(totalArea / 2, 6);
      expect(calculatePolygonArea(bottom.points)).toBeCloseTo(totalArea / 2, 6);
      // The two halves must account for the whole original — no area created
      // or destroyed by the cut.
      expect(
        calculatePolygonArea(top.points) + calculatePolygonArea(bottom.points)
      ).toBeCloseTo(totalArea, 6);
    });

    it('accepts a spanning slice line and rejects one that misses', () => {
      const largePolygon: Polygon = {
        id: 'large',
        points: testPolygons.large,
        type: 'external',
      };

      // Same story as above: assert the verdict, not the clock.
      // y=200 deliberately, NOT y=0: the 20-gon has vertices at angles k*18deg,
      // so k=0 and k=10 lie exactly ON y=0 and a cut there is the degenerate
      // through-a-vertex case this file already documents as either-outcome.
      // y=200 crosses two edges cleanly.
      const spanning = validateSliceLine(
        largePolygon,
        { x: -2000, y: 200 },
        { x: 2000, y: 200 }
      );
      expect(spanning.isValid).toBe(true);
      expect(spanning.intersectionCount).toBe(2);

      // And the discriminating counter-case: a line that misses the polygon
      // entirely must be rejected. Without this the test passes against a
      // `validateSliceLine` that returns `{ isValid: true }` unconditionally.
      const missing = validateSliceLine(
        largePolygon,
        { x: -5000, y: 4000 },
        { x: 5000, y: 4000 }
      );
      expect(missing.isValid).toBe(false);
    });
  });

  describe('Infinite Line Extension Tests', () => {
    it('should handle slices where segment partially intersects but infinite line fully intersects', () => {
      const square = testPolygonObjects.squarePolygon;

      // Case 1: Line that crosses through the polygon with sufficient segment length
      const edgeCase1 = slicePolygon(
        square,
        { x: -50, y: 50 }, // Outside polygon left
        { x: 150, y: 50 } // Outside polygon right
      );
      expect(edgeCase1).not.toBeNull();
      if (edgeCase1) {
        const [poly1, poly2] = edgeCase1;
        expect(poly1.points.length).toBeGreaterThanOrEqual(3);
        expect(poly2.points.length).toBeGreaterThanOrEqual(3);

        // Verify area conservation
        const originalArea = calculatePolygonArea(square.points);
        const area1 = calculatePolygonArea(poly1.points);
        const area2 = calculatePolygonArea(poly2.points);
        expect(area1 + area2).toBeCloseTo(originalArea, 1);
      }

      // Case 2: Diagonal slice that crosses the polygon
      const edgeCase2 = slicePolygon(
        square,
        { x: -25, y: -25 }, // Outside polygon
        { x: 125, y: 125 } // Outside polygon
      );
      expect(edgeCase2).not.toBeNull();

      // Case 3: Vertical slice that crosses the polygon
      const edgeCase3 = slicePolygon(
        square,
        { x: 50, y: -50 }, // Outside polygon top
        { x: 50, y: 150 } // Outside polygon bottom
      );
      expect(edgeCase3).not.toBeNull();
    });

    it('should validate infinite line extension properly', () => {
      const square = testPolygonObjects.squarePolygon;

      // Should report when infinite line was used
      const validation = validateSliceLine(
        square,
        { x: 0, y: -10 },
        { x: 0, y: 10 }
      );
      expect(validation.isValid).toBe(true);
      expect(validation.extendedToInfiniteLine).toBe(true);
      expect(validation.intersectionCount).toBe(2);

      // Regular segment intersection should not report extension
      const regularValidation = validateSliceLine(
        square,
        { x: -10, y: 50 },
        { x: 110, y: 50 }
      );
      expect(regularValidation.isValid).toBe(true);
      expect(regularValidation.extendedToInfiniteLine).toBeUndefined();
    });

    it('should handle edge-aligned slices with infinite line extension', () => {
      const square = testPolygonObjects.squarePolygon;

      // Slice near but not on the left edge
      const nearLeftSlice = slicePolygon(
        square,
        { x: 1, y: -50 },
        { x: 1, y: 150 }
      );
      expect(nearLeftSlice).not.toBeNull();

      // Slice near but not on the top edge
      const nearTopSlice = slicePolygon(
        square,
        { x: -50, y: 1 },
        { x: 150, y: 1 }
      );
      expect(nearTopSlice).not.toBeNull();
    });

    it('should handle diagonal slices with partial segment intersection', () => {
      const square = testPolygonObjects.squarePolygon;

      // Diagonal that properly crosses the polygon
      const diagonalSlice = slicePolygon(
        square,
        { x: -25, y: -25 }, // Outside
        { x: 125, y: 125 } // Outside on opposite side
      );
      expect(diagonalSlice).not.toBeNull();
      if (diagonalSlice) {
        const [poly1, poly2] = diagonalSlice;
        const area1 = calculatePolygonArea(poly1.points);
        const area2 = calculatePolygonArea(poly2.points);
        expect(area1).toBeGreaterThan(0);
        expect(area2).toBeGreaterThan(0);
      }
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle NaN coordinates in slice points', () => {
      const square = testPolygonObjects.squarePolygon;

      expect(() =>
        slicePolygon(square, { x: NaN, y: 50 }, { x: 110, y: 50 })
      ).not.toThrow();

      const result = slicePolygon(square, { x: NaN, y: 50 }, { x: 110, y: 50 });
      expect(result).toBeNull();
    });

    it('should handle Infinity coordinates in slice points', () => {
      const square = testPolygonObjects.squarePolygon;

      expect(() =>
        slicePolygon(square, { x: Infinity, y: 50 }, { x: 110, y: 50 })
      ).not.toThrow();
    });

    it('should handle very small polygons', () => {
      const tinyPolygon: Polygon = {
        id: 'tiny',
        points: [
          { x: 0, y: 0 },
          { x: 0.01, y: 0 },
          { x: 0.005, y: 0.01 },
        ],
        type: 'external',
      };

      const result = slicePolygon(
        tinyPolygon,
        { x: -0.01, y: 0.005 },
        { x: 0.02, y: 0.005 }
      );

      // Should either work or fail gracefully
      if (result) {
        const [polygon1, polygon2] = result;
        expect(polygon1.points.length).toBeGreaterThanOrEqual(3);
        expect(polygon2.points.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('should prevent infinite loops in polygon traversal', () => {
      // Create a polygon that might cause issues
      const problematicPolygon: Polygon = {
        id: 'problematic',
        points: testPolygons.square,
        type: 'external',
      };

      // The old assertion here was `expect(endTime - startTime)
      // .toBeLessThan(1000)`. A genuine infinite loop does not take 1001 ms, it
      // never returns — the test times out and the ceiling is never evaluated.
      // So the wall clock proved nothing that reaching the next line does not
      // already prove. The real claim is that it TERMINATES with a correct
      // split, so assert that.
      const result = slicePolygon(
        problematicPolygon,
        { x: -10, y: 50 },
        { x: 110, y: 50 }
      );

      // Unconditional: the old `if (result)` meant a regression to null made
      // the test pass with zero assertions. A horizontal cut across the middle
      // of a square must always succeed.
      expect(result).not.toBeNull();
      const [polygon1, polygon2] = result!;
      expect(polygon1.points.length).toBeGreaterThanOrEqual(3);
      expect(polygon2.points.length).toBeGreaterThanOrEqual(3);
      // testPolygons.square is 100x100, cut at y=50 → two 100x50 halves.
      expect(calculatePolygonArea(polygon1.points)).toBeCloseTo(5000, 6);
      expect(calculatePolygonArea(polygon2.points)).toBeCloseTo(5000, 6);
    });

    it('should handle identical start and end points', () => {
      const square = testPolygonObjects.squarePolygon;
      const samePoint: Point = { x: 50, y: 50 };

      const result = slicePolygon(square, samePoint, samePoint);
      expect(result).toBeNull();

      const validation = validateSliceLine(square, samePoint, samePoint);
      expect(validation.isValid).toBe(false);
      expect(validation.reason).toContain('Slice line is too short');
    });
  });

  describe('Area Conservation', () => {
    it('should conserve total area across multiple slices', () => {
      const square = testPolygonObjects.squarePolygon;
      const originalArea = calculatePolygonArea(square.points);

      // First slice
      const firstSlice = slicePolygon(
        square,
        { x: -10, y: 33 },
        { x: 110, y: 33 }
      );
      expect(firstSlice).not.toBeNull();

      const [part1, part2] = firstSlice!;
      const area1 = calculatePolygonArea(part1.points);
      const area2 = calculatePolygonArea(part2.points);

      expect(area1 + area2).toBeCloseTo(originalArea, 1);

      // Second slice on one of the parts
      const secondSlice = slicePolygon(
        part1,
        { x: -10, y: 16.5 },
        { x: 110, y: 16.5 }
      );

      if (secondSlice) {
        const [subpart1, subpart2] = secondSlice;
        const subarea1 = calculatePolygonArea(subpart1.points);
        const subarea2 = calculatePolygonArea(subpart2.points);

        expect(subarea1 + subarea2).toBeCloseTo(area1, 1);
        expect(subarea1 + subarea2 + area2).toBeCloseTo(originalArea, 1);
      }
    });
  });
});
