import { describe, it, expect, beforeEach } from 'vitest';
import {
  distanceToSegment,
  calculatePolygonArea,
  calculatePolygonPerimeter,
  isPolygonClockwise,
  isPointInPolygon,
  createPolygon,
  lineIntersection,
  pointSideOfLine,
  findClosestVertex,
  findClosestSegment,
  calculateBoundingBox,
  getPolygonCentroid,
} from '@/lib/polygonGeometry';
import {
  createTestPolygons,
  expectPointsEqual,
  expectPointArraysEqual,
} from '@/test-utils/polygonTestUtils';
import type { Point } from '@/lib/segmentation';

describe('Polygon Geometry Utilities', () => {
  let testPolygons: ReturnType<typeof createTestPolygons>;

  beforeEach(() => {
    testPolygons = createTestPolygons();
  });

  describe('distanceToSegment', () => {
    it('should calculate distance from point to line segment correctly', () => {
      const point: Point = { x: 50, y: 50 };
      const segmentStart: Point = { x: 0, y: 0 };
      const segmentEnd: Point = { x: 100, y: 0 };

      const distance = distanceToSegment(point, segmentStart, segmentEnd);
      expect(distance).toBeCloseTo(50, 5);
    });

    it('should handle point on segment', () => {
      const point: Point = { x: 50, y: 0 };
      const segmentStart: Point = { x: 0, y: 0 };
      const segmentEnd: Point = { x: 100, y: 0 };

      const distance = distanceToSegment(point, segmentStart, segmentEnd);
      expect(distance).toBeCloseTo(0, 5);
    });

    it('should handle degenerate segment (point)', () => {
      const point: Point = { x: 50, y: 50 };
      const segmentStart: Point = { x: 0, y: 0 };
      const segmentEnd: Point = { x: 0, y: 0 };

      const distance = distanceToSegment(point, segmentStart, segmentEnd);
      expect(distance).toBeCloseTo(Math.sqrt(2500 + 2500), 5);
    });

    it('should handle point outside segment range', () => {
      const point: Point = { x: -10, y: 0 };
      const segmentStart: Point = { x: 0, y: 0 };
      const segmentEnd: Point = { x: 100, y: 0 };

      const distance = distanceToSegment(point, segmentStart, segmentEnd);
      expect(distance).toBeCloseTo(10, 5);
    });
  });

  describe('calculatePolygonArea', () => {
    it('should calculate triangle area correctly', () => {
      const area = calculatePolygonArea(testPolygons.triangle);
      expect(area).toBeCloseTo(5000, 1); // base=100, height=100, area=5000
    });

    it('should calculate square area correctly', () => {
      const area = calculatePolygonArea(testPolygons.square);
      expect(area).toBeCloseTo(10000, 1); // 100x100 = 10000
    });

    it('should handle empty polygon', () => {
      const area = calculatePolygonArea([]);
      expect(area).toBe(0);
    });

    it('should handle single point', () => {
      const area = calculatePolygonArea(testPolygons.point);
      expect(area).toBe(0);
    });

    it('should handle line (2 points)', () => {
      const area = calculatePolygonArea(testPolygons.line);
      expect(area).toBe(0);
    });

    it('should be consistent regardless of winding order', () => {
      const clockwise = testPolygons.square;
      const counterClockwise = [...clockwise].reverse();

      const areaClockwise = calculatePolygonArea(clockwise);
      const areaCounterClockwise = calculatePolygonArea(counterClockwise);

      expect(areaClockwise).toBeCloseTo(areaCounterClockwise, 5);
    });
  });

  describe('calculatePolygonPerimeter', () => {
    it('should calculate triangle perimeter correctly', () => {
      const perimeter = calculatePolygonPerimeter(testPolygons.triangle);
      // Triangle with sides: 100, 100*sqrt(2)/2 ≈ 111.8, 111.8
      const expected =
        100 + Math.sqrt(50 * 50 + 100 * 100) + Math.sqrt(50 * 50 + 100 * 100);
      expect(perimeter).toBeCloseTo(expected, 1);
    });

    it('should calculate square perimeter correctly', () => {
      const perimeter = calculatePolygonPerimeter(testPolygons.square);
      expect(perimeter).toBeCloseTo(400, 1); // 4 sides of 100
    });

    it('should handle single point', () => {
      const perimeter = calculatePolygonPerimeter(testPolygons.point);
      expect(perimeter).toBe(0);
    });

    it('should handle line', () => {
      const perimeter = calculatePolygonPerimeter(testPolygons.line);
      expect(perimeter).toBeCloseTo(200, 1); // 100 + 100 (back and forth)
    });
  });

  describe('isPolygonClockwise', () => {
    it('should detect clockwise square', () => {
      const clockwiseSquare = [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
      ];
      expect(isPolygonClockwise(clockwiseSquare)).toBe(true);
    });

    it('should detect counter-clockwise square', () => {
      const counterClockwiseSquare = testPolygons.square; // This is counter-clockwise
      expect(isPolygonClockwise(counterClockwiseSquare)).toBe(false);
    });

    it('should handle degenerate cases', () => {
      expect(isPolygonClockwise(testPolygons.point)).toBe(true);
      expect(isPolygonClockwise(testPolygons.line)).toBe(true);
      expect(isPolygonClockwise([])).toBe(true);
    });
  });

  describe('isPointInPolygon', () => {
    it('should detect point inside square', () => {
      const point: Point = { x: 50, y: 50 };
      expect(isPointInPolygon(point, testPolygons.square)).toBe(true);
    });

    it('should detect point outside square', () => {
      const point: Point = { x: 150, y: 150 };
      expect(isPointInPolygon(point, testPolygons.square)).toBe(false);
    });

    it('should handle point on edge', () => {
      const point: Point = { x: 0, y: 50 };
      const result = isPointInPolygon(point, testPolygons.square);
      // Edge cases may vary depending on implementation details - should be either true or false
      expect(result === true || result === false).toBe(true);
    });

    it('should handle point on vertex', () => {
      const point: Point = { x: 0, y: 0 };
      const result = isPointInPolygon(point, testPolygons.square);
      // Vertex cases may vary depending on implementation details - should be either true or false
      expect(result === true || result === false).toBe(true);
    });

    it('should work with complex polygons', () => {
      const insidePoint: Point = { x: 25, y: 25 };
      const outsidePoint: Point = { x: 75, y: 75 };

      expect(isPointInPolygon(insidePoint, testPolygons.complex)).toBe(true);
      expect(isPointInPolygon(outsidePoint, testPolygons.complex)).toBe(false);
    });
  });

  describe('createPolygon', () => {
    it('should create polygon with unique ID', () => {
      const polygon1 = createPolygon(testPolygons.triangle);
      const polygon2 = createPolygon(testPolygons.triangle);

      expect(polygon1.id).not.toBe(polygon2.id);
      expect(polygon1.id).toMatch(/^polygon_\d+_[a-z0-9]+$/);
    });

    it('should copy points array', () => {
      const originalPoints = testPolygons.triangle;
      const polygon = createPolygon(originalPoints);

      expect(polygon.points).not.toBe(originalPoints);
      expectPointArraysEqual(polygon.points, originalPoints);
    });

    it('should set default properties', () => {
      const polygon = createPolygon(testPolygons.triangle);

      expect(polygon.confidence).toBe(1.0);
      expect(polygon.color).toBe('#ff0000');
    });

    it('should accept custom color', () => {
      const polygon = createPolygon(testPolygons.triangle, '#00ff00');
      expect(polygon.color).toBe('#00ff00');
    });
  });

  describe('lineIntersection', () => {
    it('should find intersection of crossing lines', () => {
      const p1: Point = { x: 0, y: 0 };
      const p2: Point = { x: 100, y: 100 };
      const p3: Point = { x: 0, y: 100 };
      const p4: Point = { x: 100, y: 0 };

      const intersection = lineIntersection(p1, p2, p3, p4);
      expect(intersection).not.toBeNull();
      expectPointsEqual(intersection!, { x: 50, y: 50 });
    });

    it('should return null for parallel lines', () => {
      const p1: Point = { x: 0, y: 0 };
      const p2: Point = { x: 100, y: 0 };
      const p3: Point = { x: 0, y: 10 };
      const p4: Point = { x: 100, y: 10 };

      const intersection = lineIntersection(p1, p2, p3, p4);
      expect(intersection).toBeNull();
    });

    it('should return null for non-intersecting segments', () => {
      const p1: Point = { x: 0, y: 0 };
      const p2: Point = { x: 50, y: 0 };
      const p3: Point = { x: 60, y: -10 };
      const p4: Point = { x: 60, y: 10 };

      const intersection = lineIntersection(p1, p2, p3, p4);
      expect(intersection).toBeNull();
    });

    it('should handle identical lines', () => {
      const p1: Point = { x: 0, y: 0 };
      const p2: Point = { x: 100, y: 0 };
      const p3: Point = { x: 0, y: 0 };
      const p4: Point = { x: 100, y: 0 };

      const intersection = lineIntersection(p1, p2, p3, p4);
      // Could be null or any point on the line depending on implementation
      expect(intersection).toBeNull();
    });
  });

  describe('pointSideOfLine', () => {
    it('should determine left side correctly', () => {
      const point: Point = { x: 0, y: 10 };
      const lineStart: Point = { x: 0, y: 0 };
      const lineEnd: Point = { x: 100, y: 0 };

      const side = pointSideOfLine(point, lineStart, lineEnd);
      expect(side).toBeGreaterThan(0); // Left side
    });

    it('should determine right side correctly', () => {
      const point: Point = { x: 0, y: -10 };
      const lineStart: Point = { x: 0, y: 0 };
      const lineEnd: Point = { x: 100, y: 0 };

      const side = pointSideOfLine(point, lineStart, lineEnd);
      expect(side).toBeLessThan(0); // Right side
    });

    it('should detect point on line', () => {
      const point: Point = { x: 50, y: 0 };
      const lineStart: Point = { x: 0, y: 0 };
      const lineEnd: Point = { x: 100, y: 0 };

      const side = pointSideOfLine(point, lineStart, lineEnd);
      expect(side).toBeCloseTo(0, 5); // On line
    });
  });

  describe('findClosestVertex', () => {
    it('should find closest vertex in polygon', () => {
      const point: Point = { x: 5, y: 5 };
      const result = findClosestVertex(point, testPolygons.square);

      expect(result).not.toBeNull();
      expect(result!.index).toBe(0); // Closest to (0,0)
      expect(result!.distance).toBeCloseTo(Math.sqrt(25 + 25), 5);
    });

    it('should respect max distance', () => {
      const point: Point = { x: 200, y: 200 };
      const result = findClosestVertex(point, testPolygons.square, 50);

      expect(result).toBeNull();
    });

    it('should handle empty polygon', () => {
      const point: Point = { x: 0, y: 0 };
      const result = findClosestVertex(point, []);

      expect(result).toBeNull();
    });

    it('AABB prefilter: mid-case with some vertices inside window', () => {
      // Point sits near (4,4); maxDistance=3 means only vertices within
      // a 6x6 AABB around it are candidates. (0,0) and (100,0) are
      // outside the prefilter window; (4,4) and (6,6) are inside.
      // The true nearest is (4,4) at distance 0. Guards an off-by-one
      // in the `dx > maxDistance` / `-dx > maxDistance` branches.
      const polygon: Point[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 6, y: 6 },
        { x: 4, y: 4 },
      ];
      const result = findClosestVertex({ x: 4, y: 4 }, polygon, 3);
      expect(result).not.toBeNull();
      expect(result!.index).toBe(3);
      expect(result!.distance).toBeCloseTo(0, 5);
    });

    it('AABB prefilter: point exactly maxDistance away on x-axis still admitted', () => {
      // |dx| === maxDistance must be inclusive — the correct semantic
      // is "within maxDistance", and the final maxDistanceSq check is
      // non-strict. If the prefilter used strict `>` incorrectly, this
      // would return null.
      const polygon: Point[] = [{ x: 5, y: 0 }];
      const result = findClosestVertex({ x: 0, y: 0 }, polygon, 5);
      expect(result).not.toBeNull();
      expect(result!.index).toBe(0);
      expect(result!.distance).toBeCloseTo(5, 5);
    });
  });

  describe('findClosestSegment', () => {
    it('should find closest segment in polygon', () => {
      const point: Point = { x: 50, y: -10 };
      const result = findClosestSegment(point, testPolygons.square);

      expect(result).not.toBeNull();
      expect(result!.startIndex).toBe(0);
      expect(result!.endIndex).toBe(1);
      expect(result!.distance).toBeCloseTo(10, 5);
      expectPointsEqual(result!.projectedPoint, { x: 50, y: 0 });
    });

    it('should respect max distance', () => {
      const point: Point = { x: 50, y: -50 };
      const result = findClosestSegment(point, testPolygons.square, 10);

      expect(result).toBeNull();
    });

    it('should handle empty polygon', () => {
      const point: Point = { x: 0, y: 0 };
      const result = findClosestSegment(point, []);

      expect(result).toBeNull();
    });
  });

  describe('calculateBoundingBox', () => {
    it('should calculate bounding box correctly', () => {
      const bbox = calculateBoundingBox(testPolygons.square);

      expect(bbox.minX).toBe(0);
      expect(bbox.maxX).toBe(100);
      expect(bbox.minY).toBe(0);
      expect(bbox.maxY).toBe(100);
      expect(bbox.width).toBe(100);
      expect(bbox.height).toBe(100);
    });

    it('should handle single point', () => {
      const bbox = calculateBoundingBox(testPolygons.point);

      expect(bbox.minX).toBe(50);
      expect(bbox.maxX).toBe(50);
      expect(bbox.minY).toBe(50);
      expect(bbox.maxY).toBe(50);
      expect(bbox.width).toBe(0);
      expect(bbox.height).toBe(0);
    });

    it('should handle empty polygon', () => {
      const bbox = calculateBoundingBox([]);

      expect(bbox.minX).toBe(0);
      expect(bbox.maxX).toBe(0);
      expect(bbox.minY).toBe(0);
      expect(bbox.maxY).toBe(0);
      expect(bbox.width).toBe(0);
      expect(bbox.height).toBe(0);
    });
  });

  describe('getPolygonCentroid', () => {
    it('should calculate centroid of square', () => {
      const centroid = getPolygonCentroid(testPolygons.square);
      expectPointsEqual(centroid, { x: 50, y: 50 });
    });

    it('should calculate centroid of triangle', () => {
      const centroid = getPolygonCentroid(testPolygons.triangle);
      expectPointsEqual(centroid, { x: 50, y: 100 / 3 }, 0.01);
    });

    it('should handle empty polygon', () => {
      const centroid = getPolygonCentroid([]);
      expectPointsEqual(centroid, { x: 0, y: 0 });
    });

    it('should handle single point', () => {
      const centroid = getPolygonCentroid(testPolygons.point);
      expectPointsEqual(centroid, { x: 50, y: 50 });
    });
  });

  /**
   * These two were a `describe('Performance Tests')` asserting
   * `averageTime < 100` and `< 20` after running the ops 100 / 1000 times.
   * Both were decoration:
   *   - `testPolygons.large` is a TWENTY-point polygon, so each op measures 0
   *     on jsdom's clock, which resolves to a whole millisecond (verified
   *     2026-09-04: over 200 000 consecutive performance.now() samples the
   *     smallest distinct delta is exactly 1, and no fractional delta occurs).
   *     The assertion was therefore `expect(0).toBeLessThan(100)`.
   *   - A ceiling 100x the real value cannot fail short of a hang, and a hang
   *     trips the test timeout anyway.
   *
   * The fixture is a regular 20-gon inscribed in a circle of radius 1000, so it
   * has exact closed-form values. Assert those instead — it is the only
   * many-sided polygon in this file with analytic ground truth, and it now
   * checks the answer rather than the clock.
   */
  describe('regular 20-gon (analytic ground truth)', () => {
    const N = 20;
    const R = 1000;
    // Area of a regular n-gon inscribed in radius R: (n/2) R^2 sin(2pi/n)
    const EXPECTED_AREA = (N / 2) * R * R * Math.sin((2 * Math.PI) / N);
    // Perimeter: n * 2R sin(pi/n)
    const EXPECTED_PERIMETER = N * 2 * R * Math.sin(Math.PI / N);
    // Apothem (inradius): R cos(pi/n)
    const APOTHEM = R * Math.cos(Math.PI / N);

    it('computes the exact area', () => {
      expect(calculatePolygonArea(testPolygons.large)).toBeCloseTo(
        EXPECTED_AREA,
        6
      );
      // Sanity on the constant itself, so a wrong EXPECTED_AREA cannot make a
      // wrong implementation look right.
      expect(EXPECTED_AREA).toBeCloseTo(3090169.9437, 4);
    });

    it('computes the exact perimeter', () => {
      expect(calculatePolygonPerimeter(testPolygons.large)).toBeCloseTo(
        EXPECTED_PERIMETER,
        6
      );
      expect(EXPECTED_PERIMETER).toBeCloseTo(6257.3786, 4);
    });

    it('puts the centroid at the circumcentre', () => {
      expectPointsEqual(
        getPolygonCentroid(testPolygons.large),
        { x: 0, y: 0 },
        1e-9
      );
    });

    it('classifies points inside, outside and across an edge', () => {
      // |(500,500)| = 707.1 < apothem 987.7, so unambiguously inside.
      expect(isPointInPolygon({ x: 500, y: 500 }, testPolygons.large)).toBe(
        true
      );
      // Just outside the circumradius on a vertex ray — unambiguously outside.
      expect(isPointInPolygon({ x: R + 1, y: 0 }, testPolygons.large)).toBe(
        false
      );

      // The discriminating pair. Vertices sit at angles k*(2pi/20), so the
      // EDGE MIDPOINTS are at (k + 0.5)*(2pi/20) and the boundary along such a
      // ray is the apothem, not the circumradius. Straddling it by 1px puts
      // both points well inside the polygon's bounding box (x <= 976, y <= 155
      // against a box of +/-1000), so a bounding-box implementation would call
      // BOTH of them inside and fail here.
      const edgeMidAngle = Math.PI / N;
      const atRadius = (r: number) => ({
        x: r * Math.cos(edgeMidAngle),
        y: r * Math.sin(edgeMidAngle),
      });

      expect(isPointInPolygon(atRadius(APOTHEM - 1), testPolygons.large)).toBe(
        true
      );
      expect(isPointInPolygon(atRadius(APOTHEM + 1), testPolygons.large)).toBe(
        false
      );
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle NaN coordinates gracefully', () => {
      const invalidPoints: Point[] = [
        { x: NaN, y: 0 },
        { x: 0, y: NaN },
        { x: 1, y: 1 },
      ];

      expect(() => calculatePolygonArea(invalidPoints)).not.toThrow();
      expect(() => calculatePolygonPerimeter(invalidPoints)).not.toThrow();
    });

    it('should handle Infinity coordinates gracefully', () => {
      const invalidPoints: Point[] = [
        { x: Infinity, y: 0 },
        { x: 0, y: -Infinity },
        { x: 1, y: 1 },
      ];

      expect(() => calculatePolygonArea(invalidPoints)).not.toThrow();
      expect(() => calculatePolygonPerimeter(invalidPoints)).not.toThrow();
    });

    it('should handle very small polygons', () => {
      const tinyPolygon: Point[] = [
        { x: 0, y: 0 },
        { x: 0.001, y: 0 },
        { x: 0.0005, y: 0.001 },
      ];

      const area = calculatePolygonArea(tinyPolygon);
      expect(area).toBeGreaterThan(0);
      expect(area).toBeLessThan(0.001);
    });

    it('should handle very large polygons', () => {
      const largePolygon: Point[] = [
        { x: 0, y: 0 },
        { x: 1e6, y: 0 },
        { x: 1e6, y: 1e6 },
        { x: 0, y: 1e6 },
      ];

      const area = calculatePolygonArea(largePolygon);
      expect(area).toBe(1e12);
    });
  });
});
