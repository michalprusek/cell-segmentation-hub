import { describe, it, expect } from 'vitest';
import {
  getCanvasCoordinates,
  imageToCanvasCoordinates,
  canvasToImageCoordinates,
  calculateCenteringTransform,
  calculateWheelZoom,
  calculateFixedPointZoom,
  constrainTransform,
  isPointVisible,
  isPolygonVisible,
  getViewportBounds,
} from '@/lib/coordinateUtils';
import type { TransformState } from '@/pages/segmentation/types';
import { createRef } from 'react';

// ---------------------------------------------------------------------------
// Shared fixtures / helpers
// ---------------------------------------------------------------------------

const IDENTITY: TransformState = { zoom: 1, translateX: 0, translateY: 0 };

const makeTransform = (
  overrides?: Partial<TransformState>
): TransformState => ({
  zoom: 1,
  translateX: 0,
  translateY: 0,
  ...overrides,
});

/** Builds a canvasRef whose getBoundingClientRect returns the given rect
 *  (defaults to an 800x600 canvas anchored at the origin). */
const makeCanvasRef = (rect: Partial<DOMRect> = {}) => {
  const ref = createRef<HTMLDivElement>();
  Object.defineProperty(ref, 'current', {
    value: {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
        ...rect,
      }),
    },
    writable: true,
  });
  return ref;
};

// ---------------------------------------------------------------------------

describe('coordinateUtils', () => {
  describe('getCanvasCoordinates (screen -> canvas/image)', () => {
    it('returns identity coordinates when the canvas ref is null', () => {
      const ref = createRef<HTMLDivElement>();
      const result = getCanvasCoordinates(100, 100, IDENTITY, ref);

      expect(result).toEqual({
        imageX: 100,
        imageY: 100,
        canvasX: 100,
        canvasY: 100,
      });
    });

    it('applies zoom and translation when computing imageX/imageY', () => {
      const ref = makeCanvasRef({ left: 0, top: 0, width: 400, height: 300 });
      const transform: TransformState = {
        zoom: 2,
        translateX: 10,
        translateY: -5,
      };
      // canvasX = 100, canvasY = 80; centerOffset = (200, 150)
      // imageX = (100 - 200 - 10) / 2 = -55
      // imageY = (80 - 150 + 5) / 2 = -32.5
      const result = getCanvasCoordinates(100, 80, transform, ref);
      expect(result.canvasX).toBe(100);
      expect(result.canvasY).toBe(80);
      expect(result.imageX).toBeCloseTo(-55, 5);
      expect(result.imageY).toBeCloseTo(-32.5, 5);
    });

    it('subtracts a non-zero canvas top-left offset', () => {
      const ref = makeCanvasRef({ left: 50, top: 20, width: 800, height: 600 });
      const result = getCanvasCoordinates(250, 120, IDENTITY, ref);
      expect(result.canvasX).toBe(200); // 250 - 50
      expect(result.canvasY).toBe(100); // 120 - 20
      // imageX = (200 - 400 - 0) / 1 = -200; imageY = (100 - 300) / 1 = -200
      expect(result.imageX).toBeCloseTo(-200, 5);
      expect(result.imageY).toBeCloseTo(-200, 5);
    });
  });

  describe('imageToCanvasCoordinates <-> canvasToImageCoordinates', () => {
    it('imageToCanvas applies zoom then translate', () => {
      const transform = makeTransform({
        zoom: 2,
        translateX: 30,
        translateY: -15,
      });
      const result = imageToCanvasCoordinates({ x: 12, y: 40 }, transform);
      expect(result.x).toBe(12 * 2 + 30); // 54
      expect(result.y).toBe(40 * 2 - 15); // 65
    });

    it('canvasToImage reverses zoom and translate', () => {
      const transform = makeTransform({
        zoom: 2,
        translateX: 30,
        translateY: -15,
      });
      const result = canvasToImageCoordinates({ x: 54, y: 65 }, transform);
      expect(result.x).toBeCloseTo(12, 6);
      expect(result.y).toBeCloseTo(40, 6);
    });

    it('round-trips a point through both transforms', () => {
      const transform = makeTransform({
        zoom: 2.5,
        translateX: 30,
        translateY: -15,
      });
      const point = { x: 12, y: 40 };
      const back = canvasToImageCoordinates(
        imageToCanvasCoordinates(point, transform),
        transform
      );
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    });
  });

  describe('calculateCenteringTransform (fit + center)', () => {
    it('never zooms above 1 for small images that already fit', () => {
      const result = calculateCenteringTransform(100, 80, 800, 600);
      expect(result.zoom).toBe(1);
    });

    it('binds zoom on width for wide images', () => {
      // zoom = (800 - 40) / 1000 = 0.76
      const result = calculateCenteringTransform(1000, 100, 800, 600);
      expect(result.zoom).toBeCloseTo(0.76, 2);
    });

    it('binds zoom on height for tall images', () => {
      // zoom = (600 - 40) / 1000 = 0.56
      const result = calculateCenteringTransform(100, 1000, 800, 600);
      expect(result.zoom).toBeCloseTo(0.56, 2);
    });

    it('lowers zoom as padding grows', () => {
      const small = calculateCenteringTransform(400, 300, 800, 600, 20);
      const large = calculateCenteringTransform(400, 300, 800, 600, 200);
      expect(large.zoom).toBeLessThan(small.zoom);
    });

    it('offsets translate negatively from the container center', () => {
      const result = calculateCenteringTransform(400, 300, 800, 600);
      // translateX = -(scaledWidth / 2), translateY = -(scaledHeight / 2)
      expect(result.translateX).toBeLessThan(0);
      expect(result.translateY).toBeLessThan(0);
    });
  });

  describe('calculateWheelZoom', () => {
    it('clamps to minZoom on a large positive delta', () => {
      expect(calculateWheelZoom(0.2, 5000, 0.001, 0.1, 10)).toBe(0.1);
    });

    it('clamps to maxZoom on a large negative delta', () => {
      expect(calculateWheelZoom(9, -5000, 0.001, 0.1, 10)).toBe(10);
    });

    it('applies a custom sensitivity', () => {
      // deltaY 100, sensitivity 0.005 -> factor 0.5 -> 1.0 * 0.5 = 0.5
      expect(calculateWheelZoom(1.0, 100, 0.005, 0.1, 10)).toBeCloseTo(0.5, 3);
    });

    it('uses the default sensitivity (0.001) when omitted', () => {
      // deltaY 100 -> factor 0.9 -> 1.0 * 0.9
      expect(calculateWheelZoom(1.0, 100)).toBeCloseTo(0.9, 3);
    });
  });

  describe('calculateFixedPointZoom', () => {
    it('returns the same reference when the clamped zoom equals current (no-op)', () => {
      // currentZoom 0.1 (=minZoom), zoomFactor 0.5 -> newZoom clamps back to 0.1
      const transform = makeTransform({
        zoom: 0.1,
        translateX: 50,
        translateY: 30,
      });
      const result = calculateFixedPointZoom(
        transform,
        { x: 100, y: 100 },
        0.5
      );
      expect(result).toBe(transform);
    });

    it('zooms in and shifts translation to keep the point fixed (no container)', () => {
      const transform = makeTransform();
      const result = calculateFixedPointZoom(
        transform,
        { x: 100, y: 80 },
        2.0,
        0.1,
        10
      );
      expect(result.zoom).toBeCloseTo(2.0, 5);
      // imagePoint = (100, 80); newCanvasPoint = (200, 160)
      // translateX = 0 + (100 - 200) = -100; translateY = 0 + (80 - 160) = -80
      expect(result.translateX).toBeCloseTo(-100, 5);
      expect(result.translateY).toBeCloseTo(-80, 5);
    });

    it('centers the fixed point using container width/height', () => {
      const transform = makeTransform();
      // fixed point at the exact center of the 800x600 container
      const result = calculateFixedPointZoom(
        transform,
        { x: 400, y: 300 },
        2.0,
        0.1,
        10,
        800,
        600
      );
      expect(result.zoom).toBeCloseTo(2.0, 5);
      // centeredPoint = (0, 0) -> translation stays put
      expect(result.translateX).toBeCloseTo(0, 5);
      expect(result.translateY).toBeCloseTo(0, 5);
    });

    it('treats undefined container size the same as a zero offset', () => {
      const transform = makeTransform({
        zoom: 2,
        translateX: -100,
        translateY: -80,
      });
      const fixedPoint = { x: 50, y: 40 };
      const withoutContainer = calculateFixedPointZoom(
        transform,
        fixedPoint,
        1.5
      );
      const withZeroContainer = calculateFixedPointZoom(
        transform,
        fixedPoint,
        1.5,
        0.1,
        10,
        0,
        0
      );
      expect(withoutContainer.zoom).toBeCloseTo(withZeroContainer.zoom, 8);
      expect(withoutContainer.translateX).toBeCloseTo(
        withZeroContainer.translateX,
        8
      );
      expect(withoutContainer.translateY).toBeCloseTo(
        withZeroContainer.translateY,
        8
      );
    });

    it('zooms out with the correct negative-direction translation', () => {
      const transform = makeTransform({
        zoom: 2,
        translateX: -50,
        translateY: -30,
      });
      const result = calculateFixedPointZoom(
        transform,
        { x: 200, y: 150 },
        0.5,
        0.1,
        10
      );
      expect(result.zoom).toBeCloseTo(1.0, 5);
      // imagePoint = (125, 90); newCanvasPoint = (75, 60)
      // translateX = -50 + (200 - 75) = 75; translateY = -30 + (150 - 60) = 60
      expect(result.translateX).toBeCloseTo(75, 5);
      expect(result.translateY).toBeCloseTo(60, 5);
    });

    it('clamps the resulting zoom to maxZoom', () => {
      const result = calculateFixedPointZoom(
        makeTransform({ zoom: 8 }),
        { x: 0, y: 0 },
        5.0,
        0.1,
        10
      );
      expect(result.zoom).toBe(10);
    });

    it('clamps the resulting zoom to minZoom', () => {
      const result = calculateFixedPointZoom(
        makeTransform({ zoom: 0.3 }),
        { x: 0, y: 0 },
        0.1,
        0.1,
        10
      );
      expect(result.zoom).toBe(0.1);
    });
  });

  describe('constrainTransform (panning limits)', () => {
    it('allows unlimited panning when zoomed in (>= 1.0)', () => {
      const t = makeTransform({
        zoom: 1.5,
        translateX: -2000,
        translateY: -2000,
      });
      const result = constrainTransform(t, 800, 600, 400, 300);
      expect(result.translateX).toBe(-2000);
      expect(result.translateY).toBe(-2000);
    });

    it('clamps extreme positive translateX when zoomed out (< 1.0)', () => {
      const t = makeTransform({ zoom: 0.5, translateX: 99999 });
      const result = constrainTransform(t, 400, 300, 800, 600);
      expect(result.translateX).toBeLessThan(99999);
      expect(result.zoom).toBe(0.5);
    });

    it('clamps extreme negative translateX when zoomed out', () => {
      const t = makeTransform({ zoom: 0.5, translateX: -99999 });
      const result = constrainTransform(t, 400, 300, 800, 600);
      expect(result.translateX).toBeGreaterThan(-99999);
    });

    it('clamps extreme positive translateY when zoomed out', () => {
      const t = makeTransform({ zoom: 0.5, translateY: 99999 });
      const result = constrainTransform(t, 400, 300, 800, 600);
      expect(result.translateY).toBeLessThan(99999);
    });

    it('clamps extreme negative translateY when zoomed out', () => {
      const t = makeTransform({ zoom: 0.5, translateY: -99999 });
      const result = constrainTransform(t, 400, 300, 800, 600);
      expect(result.translateY).toBeGreaterThan(-99999);
    });

    it('preserves in-range translation when zoomed out', () => {
      const t = makeTransform({ zoom: 0.5, translateX: 5, translateY: 5 });
      const result = constrainTransform(t, 400, 300, 800, 600);
      expect(result.translateX).toBe(5);
      expect(result.translateY).toBe(5);
    });

    it('clamps zoom to the default [0.1, 10] range in both directions', () => {
      const below = constrainTransform(
        makeTransform({ zoom: 0.001 }),
        400,
        300,
        800,
        600
      );
      expect(below.zoom).toBe(0.1);

      const above = constrainTransform(
        makeTransform({ zoom: 50 }),
        400,
        300,
        800,
        600
      );
      expect(above.zoom).toBe(10);
    });
  });

  describe('visibility + viewport bounds', () => {
    it('isPointVisible: true for a point inside the viewport', () => {
      expect(isPointVisible({ x: 50, y: 50 }, IDENTITY, 800, 600)).toBe(true);
    });

    it('isPointVisible: false for a point far outside the viewport', () => {
      expect(isPointVisible({ x: 10000, y: 10000 }, IDENTITY, 800, 600)).toBe(
        false
      );
    });

    it('isPolygonVisible: true when at least one vertex is visible', () => {
      const polygon = [
        { x: 50, y: 50 },
        { x: 100, y: 50 },
        { x: 100, y: 100 },
        { x: 50, y: 100 },
      ];
      expect(isPolygonVisible(polygon, IDENTITY, 800, 600)).toBe(true);
    });

    it('isPolygonVisible: false when every vertex is off-screen', () => {
      const polygon = [
        { x: 10000, y: 10000 },
        { x: 10100, y: 10000 },
        { x: 10100, y: 10100 },
        { x: 10000, y: 10100 },
      ];
      expect(isPolygonVisible(polygon, IDENTITY, 800, 600)).toBe(false);
    });

    it('getViewportBounds: maps the canvas corners to image bounds', () => {
      const result = getViewportBounds(IDENTITY, 800, 600);
      // identity transform, margin 0 -> corners map straight through
      // (min corner is -0 from `-margin`, so compare with toBeCloseTo)
      expect(result.minX).toBeCloseTo(0, 6);
      expect(result.minY).toBeCloseTo(0, 6);
      expect(result.maxX).toBe(800);
      expect(result.maxY).toBe(600);
    });
  });
});
