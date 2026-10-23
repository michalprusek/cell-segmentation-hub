import { describe, it, expect } from 'vitest';
import {
  getCanvasCoordinates,
  imageToCanvasCoordinates,
  canvasToImageCoordinates,
  calculateCenteringTransform,
  calculateFixedPointZoom,
  constrainTransform,
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
    // A real sperm frame (4104 x 2174, 1 033 of them in the reporter's
    // projects) in a 1300 x 800 canvas. Image left edge on screen is
    // canvasWidth / 2 + translateX.
    const IMG_W = 4104;
    const IMG_H = 2174;
    const VIEW_W = 1300;
    const VIEW_H = 800;
    const constrain = (t: TransformState) =>
      constrainTransform(t, IMG_W, IMG_H, VIEW_W, VIEW_H);

    /** Translation that puts image point (x, y) at the viewport's centre. */
    const centreOn = (x: number, y: number, zoom: number): TransformState => ({
      zoom,
      translateX: -x * zoom,
      translateY: -y * zoom,
    });

    // The reported bug: zooming toward a sperm at the border, just below
    // zoom 1, it could not be panned back into view.
    it.each([0.5, 0.99, 1, 3, 10])(
      'lets every corner of a large image reach the viewport centre at zoom %s',
      zoom => {
        for (const [x, y] of [
          [0, 0],
          [IMG_W, 0],
          [0, IMG_H],
          [IMG_W, IMG_H],
        ]) {
          const t = centreOn(x, y, zoom);
          expect(constrain(t)).toEqual(t);
        }
      }
    );

    it.each([0.99, 3])(
      'stops at half the viewport covered when panned past an edge at zoom %s',
      zoom => {
        const scaledW = IMG_W * zoom;
        const scaledH = IMG_H * zoom;
        const right = constrain({ zoom, translateX: -1e6, translateY: 0 });
        // Image's right edge sits exactly at the viewport's centre.
        expect(VIEW_W / 2 + right.translateX + scaledW).toBeCloseTo(VIEW_W / 2);
        const left = constrain({ zoom, translateX: 1e6, translateY: 0 });
        expect(VIEW_W / 2 + left.translateX).toBeCloseTo(VIEW_W / 2);
        const bottom = constrain({ zoom, translateX: 0, translateY: -1e6 });
        expect(VIEW_H / 2 + bottom.translateY + scaledH).toBeCloseTo(
          VIEW_H / 2
        );
        const top = constrain({ zoom, translateX: 0, translateY: 1e6 });
        expect(VIEW_H / 2 + top.translateY).toBeCloseTo(VIEW_H / 2);
      }
    );

    it('keeps half of an image smaller than the viewport in view', () => {
      // 400 x 300 at zoom 0.5 = 200 x 150 on screen in 800 x 600.
      const out = constrainTransform(
        makeTransform({ zoom: 0.5, translateX: 1e6, translateY: -1e6 }),
        400,
        300,
        800,
        600
      );
      // Left edge at 800 - 100, bottom edge at 75.
      expect(400 + out.translateX).toBeCloseTo(700);
      expect(300 + out.translateY + 150).toBeCloseTo(75);
    });

    it('preserves an in-range translation', () => {
      const t = makeTransform({ zoom: 0.5, translateX: 5, translateY: 5 });
      expect(constrainTransform(t, 400, 300, 800, 600)).toEqual(t);
    });

    it('leaves the translation alone before the canvas is measured', () => {
      const t = makeTransform({ zoom: 2, translateX: -1e6, translateY: 1e6 });
      expect(constrainTransform(t, 400, 300, 0, 0)).toEqual(t);
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
});
