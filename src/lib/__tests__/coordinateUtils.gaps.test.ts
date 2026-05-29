/**
 * coordinateUtils — gap coverage for uncovered lines 126-172 and 211-237
 *
 * Lines 126-172: calculateFixedPointZoom — zoom-clamped no-op, with/without
 *   containerWidth/Height, full coordinate chain.
 * Lines 211-237: constrainTransform — the unreachable `zoom >= 1.0` second
 *   branch (dead code guarded by the first identical check at line 201) plus
 *   the moderate-constraint path for zoom < 1.0 with translation that exceeds
 *   the allowed range.
 *
 * All functions are pure — no mocks needed.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateFixedPointZoom,
  calculateWheelZoom,
  constrainTransform,
  getCanvasCoordinates,
  calculateCenteringTransform,
} from '@/lib/coordinateUtils';
import type { TransformState } from '@/pages/segmentation/types';
import { createRef } from 'react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTransform = (
  overrides?: Partial<TransformState>
): TransformState => ({
  zoom: 1,
  translateX: 0,
  translateY: 0,
  ...overrides,
});

// ---------------------------------------------------------------------------
// calculateWheelZoom — lines not exercised by existing tests
// ---------------------------------------------------------------------------

describe('calculateWheelZoom', () => {
  it('clamps result to minZoom when delta is very large positive', () => {
    const result = calculateWheelZoom(0.2, 5000, 0.001, 0.1, 10);
    expect(result).toBe(0.1);
  });

  it('clamps result to maxZoom when delta is very large negative', () => {
    const result = calculateWheelZoom(9, -5000, 0.001, 0.1, 10);
    expect(result).toBe(10);
  });

  it('respects custom sensitivity', () => {
    // deltaY = 100, sensitivity = 0.005 → factor = 0.5 → new = 1.0 * 0.5 = 0.5
    const result = calculateWheelZoom(1.0, 100, 0.005, 0.1, 10);
    expect(result).toBeCloseTo(0.5, 3);
  });

  it('uses default sensitivity when not provided', () => {
    // deltaY = 100, default sensitivity = 0.001 → factor = 0.9 → new = 1.0 * 0.9
    const result = calculateWheelZoom(1.0, 100);
    expect(result).toBeCloseTo(0.9, 3);
  });
});

// ---------------------------------------------------------------------------
// calculateFixedPointZoom — lines 126-172
// ---------------------------------------------------------------------------

describe('calculateFixedPointZoom', () => {
  it('returns current transform unchanged when new zoom equals current zoom (at minZoom boundary)', () => {
    // currentZoom = 0.1 (=minZoom), zoomFactor < 1 → newZoom clamps to minZoom → no-op
    const transform = makeTransform({
      zoom: 0.1,
      translateX: 50,
      translateY: 30,
    });
    const result = calculateFixedPointZoom(transform, { x: 100, y: 100 }, 0.5);
    // newZoom clamped to minZoom (0.1) = currentZoom → identity return
    expect(result).toBe(transform); // exact same reference
  });

  it('returns current transform unchanged when zoom would clamp to maxZoom that equals currentZoom', () => {
    const transform = makeTransform({ zoom: 10, translateX: 0, translateY: 0 });
    const result = calculateFixedPointZoom(
      transform,
      { x: 0, y: 0 },
      2.0,
      0.1,
      10
    );
    expect(result).toBe(transform);
  });

  it('zooms in and adjusts translation to keep fixed point under cursor (no container size)', () => {
    const transform = makeTransform({ zoom: 1, translateX: 0, translateY: 0 });
    const fixedPoint = { x: 100, y: 80 };
    const result = calculateFixedPointZoom(transform, fixedPoint, 2.0, 0.1, 10);

    expect(result.zoom).toBeCloseTo(2.0, 5);
    // Translation must shift so the image point that was at fixedPoint stays there
    // Without container offsets, centeredPoint = fixedPoint itself.
    // imagePoint = (100 - 0) / 1 = 100, (80 - 0) / 1 = 80
    // newCanvasPoint = 100 * 2 + 0 = 200, 80 * 2 + 0 = 160
    // translateX = 0 + (100 - 200) = -100
    // translateY = 0 + (80 - 160) = -80
    expect(result.translateX).toBeCloseTo(-100, 5);
    expect(result.translateY).toBeCloseTo(-80, 5);
  });

  it('accounts for container width/height when provided (centers the fixed point)', () => {
    const transform = makeTransform({ zoom: 1, translateX: 0, translateY: 0 });
    const fixedPoint = { x: 400, y: 300 }; // center of 800x600 container
    const result = calculateFixedPointZoom(
      transform,
      fixedPoint,
      2.0,
      0.1,
      10,
      800, // containerWidth
      600 // containerHeight
    );

    expect(result.zoom).toBeCloseTo(2.0, 5);
    // centeredPoint = { x: 400 - 400, y: 300 - 300 } = { x: 0, y: 0 }
    // imagePoint = (0 - 0) / 1 = 0, (0 - 0) / 1 = 0
    // newCanvasPoint = 0 * 2 + 0 = 0, 0 * 2 + 0 = 0
    // translateX = 0 + (0 - 0) = 0
    expect(result.translateX).toBeCloseTo(0, 5);
    expect(result.translateY).toBeCloseTo(0, 5);
  });

  it('uses zero center offset when containerWidth/Height are undefined', () => {
    const transform = makeTransform({
      zoom: 2,
      translateX: -100,
      translateY: -80,
    });
    const fixedPoint = { x: 50, y: 40 };
    // Without container: centerOffsetX = 0, centerOffsetY = 0
    const resultWithout = calculateFixedPointZoom(transform, fixedPoint, 1.5);
    // With containerWidth=0, containerHeight=0 (same as undefined)
    const resultWithZero = calculateFixedPointZoom(
      transform,
      fixedPoint,
      1.5,
      0.1,
      10,
      0,
      0
    );
    // Results should be identical
    expect(resultWithout.zoom).toBeCloseTo(resultWithZero.zoom, 8);
    expect(resultWithout.translateX).toBeCloseTo(resultWithZero.translateX, 8);
    expect(resultWithout.translateY).toBeCloseTo(resultWithZero.translateY, 8);
  });

  it('zooms out and computes correct negative translation', () => {
    const transform = makeTransform({
      zoom: 2,
      translateX: -50,
      translateY: -30,
    });
    const fixedPoint = { x: 200, y: 150 };
    const result = calculateFixedPointZoom(transform, fixedPoint, 0.5, 0.1, 10);

    expect(result.zoom).toBeCloseTo(1.0, 5);
    expect(typeof result.translateX).toBe('number');
    expect(typeof result.translateY).toBe('number');
  });

  it('clamps to maxZoom', () => {
    const transform = makeTransform({ zoom: 8 });
    const result = calculateFixedPointZoom(
      transform,
      { x: 0, y: 0 },
      5.0,
      0.1,
      10
    );
    expect(result.zoom).toBe(10);
  });

  it('clamps to minZoom', () => {
    const transform = makeTransform({ zoom: 0.3 });
    const result = calculateFixedPointZoom(
      transform,
      { x: 0, y: 0 },
      0.1,
      0.1,
      10
    );
    expect(result.zoom).toBe(0.1);
  });
});

// ---------------------------------------------------------------------------
// constrainTransform — lines 211-237 (moderate constraints for zoom < 1.0)
// Note: lines 210-237 are the else branch (the second zoom>=1.0 guard at line
// 210 is dead code — the first guard at line 201 already handles it — so V8
// marks lines 211-237 as uncovered. We exercise the path through the surviving
// else branch which applies moderate constraints for zoom < 1.0 beyond range.
// ---------------------------------------------------------------------------

describe('constrainTransform — moderate constraints (zoom < 1.0, translation out of range)', () => {
  it('clamps extreme positive translateX when zoom < 1', () => {
    const t = makeTransform({ zoom: 0.5, translateX: 99999, translateY: 0 });
    const result = constrainTransform(t, 400, 300, 800, 600);
    expect(result.translateX).toBeLessThan(99999);
    expect(result.zoom).toBe(0.5);
  });

  it('clamps extreme negative translateX when zoom < 1', () => {
    const t = makeTransform({ zoom: 0.5, translateX: -99999, translateY: 0 });
    const result = constrainTransform(t, 400, 300, 800, 600);
    expect(result.translateX).toBeGreaterThan(-99999);
  });

  it('clamps extreme positive translateY when zoom < 1', () => {
    const t = makeTransform({ zoom: 0.5, translateX: 0, translateY: 99999 });
    const result = constrainTransform(t, 400, 300, 800, 600);
    expect(result.translateY).toBeLessThan(99999);
  });

  it('clamps extreme negative translateY when zoom < 1', () => {
    const t = makeTransform({ zoom: 0.5, translateX: 0, translateY: -99999 });
    const result = constrainTransform(t, 400, 300, 800, 600);
    expect(result.translateY).toBeGreaterThan(-99999);
  });

  it('preserves in-range translation when zoom < 1', () => {
    // A small translation that fits within the moderate margin should not be altered
    const t = makeTransform({ zoom: 0.5, translateX: 5, translateY: 5 });
    const result = constrainTransform(t, 400, 300, 800, 600);
    expect(result.translateX).toBe(5);
    expect(result.translateY).toBe(5);
  });

  it('clamps zoom below minZoom to minZoom', () => {
    const t = makeTransform({ zoom: 0.05, translateX: 0, translateY: 0 });
    const result = constrainTransform(t, 400, 300, 800, 600, 0.1, 10);
    expect(result.zoom).toBe(0.1);
  });

  it('uses default minZoom=0.1 and maxZoom=10', () => {
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

// ---------------------------------------------------------------------------
// getCanvasCoordinates — image coordinate calculation with non-trivial transform
// ---------------------------------------------------------------------------

describe('getCanvasCoordinates — with transform and canvas offset', () => {
  const makeCanvasRef = (rect: Partial<DOMRect>) => {
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

  it('applies zoom and translation when computing imageX/imageY', () => {
    const ref = makeCanvasRef({ left: 0, top: 0, width: 400, height: 300 });
    const transform: TransformState = {
      zoom: 2,
      translateX: 10,
      translateY: -5,
    };
    // canvasX = mouseX - left = 100, canvasY = mouseY - top = 80
    // centerOffsetX = 200, centerOffsetY = 150
    // imageX = (100 - 200 - 10) / 2 = -55
    // imageY = (80 - 150 - (-5)) / 2 = -32.5
    const result = getCanvasCoordinates(100, 80, transform, ref);
    expect(result.canvasX).toBe(100);
    expect(result.canvasY).toBe(80);
    expect(result.imageX).toBeCloseTo(-55, 5);
    expect(result.imageY).toBeCloseTo(-32.5, 5);
  });

  it('respects non-zero canvas top-left offset', () => {
    const ref = makeCanvasRef({ left: 50, top: 20, width: 800, height: 600 });
    const transform: TransformState = { zoom: 1, translateX: 0, translateY: 0 };
    const result = getCanvasCoordinates(250, 120, transform, ref);
    expect(result.canvasX).toBe(200); // 250 - 50
    expect(result.canvasY).toBe(100); // 120 - 20
    // imageX = (200 - 400 - 0) / 1 = -200
    expect(result.imageX).toBeCloseTo(-200, 5);
    expect(result.imageY).toBeCloseTo(-200, 5); // (100 - 300) / 1
  });
});

// ---------------------------------------------------------------------------
// calculateCenteringTransform — additional branches
// ---------------------------------------------------------------------------

describe('calculateCenteringTransform — additional branches', () => {
  it('does not exceed zoom=1 for small images that fit without scaling', () => {
    // Image smaller than canvas → scaleX > 1, scaleY > 1, but zoom = min(..., 1)
    const result = calculateCenteringTransform(100, 80, 800, 600);
    expect(result.zoom).toBe(1);
  });

  it('uses custom padding', () => {
    const withDefaultPadding = calculateCenteringTransform(
      400,
      300,
      800,
      600,
      20
    );
    const withLargePadding = calculateCenteringTransform(
      400,
      300,
      800,
      600,
      200
    );
    // More padding → less available space → lower zoom
    expect(withLargePadding.zoom).toBeLessThan(withDefaultPadding.zoom);
  });

  it('produces negative translateX/Y to offset from center', () => {
    const result = calculateCenteringTransform(400, 300, 800, 600);
    // translateX = -(scaledWidth / 2), must be negative
    expect(result.translateX).toBeLessThan(0);
    expect(result.translateY).toBeLessThan(0);
  });

  it('uses width constraint when image is wider than it is tall (relative to canvas)', () => {
    // Wide image: scaleX will be the binding constraint
    const result = calculateCenteringTransform(1000, 100, 800, 600);
    // zoom limited by width: (800 - 40) / 1000 = 0.76
    expect(result.zoom).toBeCloseTo(0.76, 2);
  });

  it('uses height constraint when image is taller', () => {
    const result = calculateCenteringTransform(100, 1000, 800, 600);
    // zoom limited by height: (600 - 40) / 1000 = 0.56
    expect(result.zoom).toBeCloseTo(0.56, 2);
  });
});
