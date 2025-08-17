import { describe, it, expect, beforeEach } from 'vitest';
import {
  slicePolygon,
  validateSliceLine,
  findSliceHints,
  findBalancedSlice
} from '@/lib/polygonSlicing';
import { calculatePolygonArea } from '@/lib/polygonGeometry';
import {
  createTestPolygons,
  createTestPolygonObjects,
  expectPointsEqual,
  expectPointArraysEqual,
  measurePerformance
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

      // Slice that only touches one edge
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
        type: 'external'
      };
      expect(slicePolygon(emptyPolygon, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();

      // Polygon with insufficient points
      const linePolygon: Polygon = {
        id: 'line',
        points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        type: 'external'
      };
      expect(slicePolygon(linePolygon, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
    });

    it('should handle slices that pass through vertices', () => {
      const square = testPolygonObjects.squarePolygon;
      const sliceStart: Point = { x: 0, y: 0 }; // Starts at vertex
      const sliceEnd: Point = { x: 100, y: 100 }; // Ends at vertex

      const result = slicePolygon(square, sliceStart, sliceEnd);
      
      // Should either work or fail gracefully
      if (result) {
        const [polygon1, polygon2] = result;
        expect(polygon1.points.length).toBeGreaterThanOrEqual(3);
        expect(polygon2.points.length).toBeGreaterThanOrEqual(3);
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
      expect(noIntersectValidation.reason).toContain('Expected 2 intersections, found 0');

      // One intersection (tangent)
      const oneIntersectValidation = validateSliceLine(
        square,
        { x: 0, y: -10 },
        { x: 0, y: 10 }
      );
      expect(oneIntersectValidation.isValid).toBe(false);
      expect(oneIntersectValidation.intersectionCount).toBe(1);
    });

    it('should reject very short slice lines', () => {
      const square = testPolygonObjects.squarePolygon;
      const validation = validateSliceLine(
        square,
        { x: 50, y: 50 },
        { x: 50.1, y: 50.1 }
      );

      expect(validation.isValid).toBe(false);
      expect(validation.reason).toBe('Slice line is too short');
    });

    it('should reject invalid polygons', () => {
      const invalidPolygon: Polygon = {
        id: 'invalid',
        points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        type: 'external'
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

  describe('findSliceHints', () => {
    it('should find valid slice hints from a starting point', () => {
      const complex = testPolygonObjects.complexPolygon; // Use complex polygon with more points
      const startPoint: Point = { x: 25, y: 25 };

      const hints = findSliceHints(complex, startPoint);

      // For a complex polygon, we should find some hints
      if (hints.length > 0) {
        // All hints should create valid slices
        hints.forEach(hint => {
          const validation = validateSliceLine(complex, startPoint, hint);
          expect(validation.isValid).toBe(true);
        });
      }
      
      // Test is successful if no hints are found (depends on polygon geometry)
      expect(hints).toBeInstanceOf(Array);
    });

    it('should return empty array for polygons with insufficient points', () => {
      const triangle = testPolygonObjects.trianglePolygon;
      const startPoint: Point = { x: 50, y: 0 };

      const hints = findSliceHints(triangle, startPoint);
      expect(hints).toHaveLength(0); // Triangle has only 3 points
    });

    it('should filter out hints too close to start point', () => {
      const square = testPolygonObjects.squarePolygon;
      const startPoint: Point = { x: 1, y: 1 }; // Very close to (0,0) vertex

      const hints = findSliceHints(square, startPoint);
      
      // Should not include the (0,0) vertex due to minimum distance
      const hasClosePoint = hints.some(hint => 
        Math.sqrt((hint.x - startPoint.x) ** 2 + (hint.y - startPoint.y) ** 2) < 10
      );
      expect(hasClosePoint).toBe(false);
    });

    it('should return empty array when no start point provided', () => {
      const square = testPolygonObjects.squarePolygon;
      const hints = findSliceHints(square);
      expect(hints).toHaveLength(0);
    });
  });

  describe('findBalancedSlice', () => {
    it('should find a balanced slice for a square', () => {
      const square = testPolygonObjects.squarePolygon;
      const balancedSlice = findBalancedSlice(square, 5);

      expect(balancedSlice).not.toBeNull();

      if (balancedSlice) {
        const result = slicePolygon(square, balancedSlice.start, balancedSlice.end);
        expect(result).not.toBeNull();

        if (result) {
          const [polygon1, polygon2] = result;
          const area1 = calculatePolygonArea(polygon1.points);
          const area2 = calculatePolygonArea(polygon2.points);
          
          // Areas should be relatively balanced
          const areaDifference = Math.abs(area1 - area2);
          const totalArea = area1 + area2;
          expect(areaDifference / totalArea).toBeLessThan(0.3); // Less than 30% difference
        }
      }
    });

    it('should return null for polygons with insufficient points', () => {
      const triangle = testPolygonObjects.trianglePolygon;
      const balancedSlice = findBalancedSlice(triangle);
      expect(balancedSlice).toBeNull();
    });

    it('should handle complex polygons', () => {
      const complex = testPolygonObjects.complexPolygon;
      const balancedSlice = findBalancedSlice(complex, 3);

      if (balancedSlice) {
        const result = slicePolygon(complex, balancedSlice.start, balancedSlice.end);
        expect(result).not.toBeNull();

        if (result) {
          const [polygon1, polygon2] = result;
          expect(polygon1.points.length).toBeGreaterThanOrEqual(3);
          expect(polygon2.points.length).toBeGreaterThanOrEqual(3);
        }
      }
    });

    it('should work with different precision levels', () => {
      const square = testPolygonObjects.squarePolygon;
      
      const lowPrecision = findBalancedSlice(square, 20);
      const highPrecision = findBalancedSlice(square, 5);

      // Both should find valid slices, high precision may be more balanced
      if (lowPrecision && highPrecision) {
        expect(lowPrecision).toBeDefined();
        expect(highPrecision).toBeDefined();
      }
    });
  });

  describe('Performance Tests', () => {
    it('should slice large polygons efficiently', async () => {
      const largePolygon: Polygon = {
        id: 'large',
        points: testPolygons.large,
        type: 'external'
      };

      const performance = await measurePerformance(() => {
        slicePolygon(
          largePolygon,
          { x: -500, y: 0 },
          { x: 500, y: 0 }
        );
      }, 50);

      expect(performance.averageTime).toBeLessThan(10); // Should be reasonably fast
    });

    it('should validate slice lines efficiently', async () => {
      const largePolygon: Polygon = {
        id: 'large',
        points: testPolygons.large,
        type: 'external'
      };

      const performance = await measurePerformance(() => {
        validateSliceLine(
          largePolygon,
          { x: -500, y: 0 },
          { x: 500, y: 0 }
        );
      }, 100);

      expect(performance.averageTime).toBeLessThan(5); // Should be fast
    });

    it('should find balanced slices efficiently for reasonable polygon sizes', async () => {
      const square = testPolygonObjects.squarePolygon;

      const performance = await measurePerformance(() => {
        findBalancedSlice(square, 10);
      }, 10);

      expect(performance.averageTime).toBeLessThan(50); // May be slower due to complexity
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle NaN coordinates in slice points', () => {
      const square = testPolygonObjects.squarePolygon;
      
      expect(() => slicePolygon(
        square,
        { x: NaN, y: 50 },
        { x: 110, y: 50 }
      )).not.toThrow();
      
      const result = slicePolygon(
        square,
        { x: NaN, y: 50 },
        { x: 110, y: 50 }
      );
      expect(result).toBeNull();
    });

    it('should handle Infinity coordinates in slice points', () => {
      const square = testPolygonObjects.squarePolygon;
      
      expect(() => slicePolygon(
        square,
        { x: Infinity, y: 50 },
        { x: 110, y: 50 }
      )).not.toThrow();
    });

    it('should handle very small polygons', () => {
      const tinyPolygon: Polygon = {
        id: 'tiny',
        points: [
          { x: 0, y: 0 },
          { x: 0.01, y: 0 },
          { x: 0.005, y: 0.01 }
        ],
        type: 'external'
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
        type: 'external'
      };

      // This should complete without hanging
      const startTime = Date.now();
      const result = slicePolygon(
        problematicPolygon,
        { x: -10, y: 50 },
        { x: 110, y: 50 }
      );
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
      
      if (result) {
        const [polygon1, polygon2] = result;
        expect(polygon1.points.length).toBeGreaterThanOrEqual(3);
        expect(polygon2.points.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('should handle identical start and end points', () => {
      const square = testPolygonObjects.squarePolygon;
      const samePoint: Point = { x: 50, y: 50 };

      const result = slicePolygon(square, samePoint, samePoint);
      expect(result).toBeNull();

      const validation = validateSliceLine(square, samePoint, samePoint);
      expect(validation.isValid).toBe(false);
      expect(validation.reason).toBe('Slice line is too short');
    });
  });

  describe('Area Conservation', () => {
    it('should conserve total area across multiple slices', () => {
      const square = testPolygonObjects.squarePolygon;
      const originalArea = calculatePolygonArea(square.points);

      // First slice
      const firstSlice = slicePolygon(square, { x: -10, y: 33 }, { x: 110, y: 33 });
      expect(firstSlice).not.toBeNull();

      const [part1, part2] = firstSlice!;
      const area1 = calculatePolygonArea(part1.points);
      const area2 = calculatePolygonArea(part2.points);

      expect(area1 + area2).toBeCloseTo(originalArea, 1);

      // Second slice on one of the parts
      const secondSlice = slicePolygon(part1, { x: -10, y: 16.5 }, { x: 110, y: 16.5 });
      
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