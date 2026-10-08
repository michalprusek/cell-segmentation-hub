import { describe, it, expect } from 'vitest';
import { snapToDevicePixel } from '../devicePixelSnap';

describe('snapToDevicePixel', () => {
  // The values are real: production transforms are arbitrary floats, e.g.
  // translate3d(-7263.43px, -2665.43px, 0px) scale(10).
  it.each([1, 1.25, 1.5, 2, 3])(
    'lands on a whole device pixel at a device pixel ratio of %s',
    dpr => {
      for (const value of [-7263.43, -2665.43, -735.375, 0.4, 13.37, 682.5]) {
        const device = snapToDevicePixel(value, dpr) * dpr;
        expect(Math.abs(device - Math.round(device))).toBeLessThan(1e-9);
      }
    }
  );

  it('moves the content by at most half a device pixel', () => {
    for (const dpr of [1, 1.25, 1.5, 2]) {
      for (let t = -3; t <= 3; t += 0.137) {
        expect(Math.abs(snapToDevicePixel(t, dpr) - t)).toBeLessThanOrEqual(
          0.5 / dpr + 1e-9
        );
      }
    }
  });

  it('gives exact values at each device pixel ratio', () => {
    // DPR 1: whole CSS pixels.
    expect(snapToDevicePixel(-7263.43, 1)).toBe(-7263);
    // DPR 2: half CSS pixels are whole device pixels.
    expect(snapToDevicePixel(-7263.43, 2)).toBe(-7263.5);
    expect(snapToDevicePixel(-2665.43, 2)).toBe(-2665.5);
    // DPR 1.5: thirds. -7263.43 * 1.5 = -10895.145 -> -10895 -> / 1.5.
    expect(snapToDevicePixel(-7263.43, 1.5)).toBeCloseTo(-10895 / 1.5, 9);
    // DPR 1.25: multiples of 0.8.
    expect(snapToDevicePixel(-7263.43, 1.25)).toBeCloseTo(-7263.2, 9);
  });

  it('leaves an already-aligned value untouched', () => {
    expect(snapToDevicePixel(-280, 1)).toBe(-280);
    expect(snapToDevicePixel(-280.5, 2)).toBe(-280.5);
  });

  // The regression this signature exists to prevent. The first version took
  // the container's origin as a second argument and rounded origin +
  // translate, so on an odd-sized container (centre on a half pixel) it
  // returned x.5 at DPR 1 — and Chrome, which rounds the box position
  // itself, drew every stroke exactly between two pixels: edge 1.50 device
  // px against 0.79 for the whole translate. A whole-pixel input must come
  // back whole whatever the container looks like, which is only guaranteed
  // by there being no origin to pass.
  it('takes no origin: the result depends on the value and the ratio alone', () => {
    expect(snapToDevicePixel.length).toBe(2);
    expect(snapToDevicePixel(-7235.5 + 0.2, 1)).toBe(-7235);
    expect(Number.isInteger(snapToDevicePixel(10.3, 1))).toBe(true);
  });

  it('never returns negative zero', () => {
    expect(Object.is(snapToDevicePixel(-0.2, 1), 0)).toBe(true);
    expect(Object.is(snapToDevicePixel(-0, 2), 0)).toBe(true);
  });

  it('falls back to a ratio of 1 for a nonsensical devicePixelRatio', () => {
    for (const dpr of [0, -2, NaN, Infinity]) {
      expect(snapToDevicePixel(10.4, dpr)).toBe(10);
    }
  });

  it('passes a non-finite value through rather than inventing a position', () => {
    expect(snapToDevicePixel(Infinity, 1)).toBe(Infinity);
    expect(Number.isNaN(snapToDevicePixel(NaN, 1))).toBe(true);
  });
});
