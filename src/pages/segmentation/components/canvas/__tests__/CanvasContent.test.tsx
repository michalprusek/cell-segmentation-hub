/**
 * Tests for CanvasContent component
 * Covers the plain 2D transform, the device-pixel snap of the rendered
 * translate (and that it follows a change of device pixel ratio), the layer
 * hints that must stay absent, and child rendering.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import CanvasContent from '../CanvasContent';
import type { TransformState } from '@/pages/segmentation/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTransform = (
  overrides: Partial<TransformState> = {}
): TransformState => ({
  zoom: 1,
  translateX: 0,
  translateY: 0,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CanvasContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------

  describe('Rendering', () => {
    it('renders the transform container with the correct data-testid', () => {
      render(
        <CanvasContent transform={makeTransform()}>
          <div />
        </CanvasContent>
      );

      expect(
        screen.getByTestId('canvas-transform-container')
      ).toBeInTheDocument();
    });

    it('renders children inside the transform container', () => {
      render(
        <CanvasContent transform={makeTransform()}>
          <span data-testid="child-node">hello</span>
        </CanvasContent>
      );

      expect(screen.getByTestId('child-node')).toBeInTheDocument();
    });

    it('renders multiple children', () => {
      render(
        <CanvasContent transform={makeTransform()}>
          <span data-testid="child-a">A</span>
          <span data-testid="child-b">B</span>
        </CanvasContent>
      );

      expect(screen.getByTestId('child-a')).toBeInTheDocument();
      expect(screen.getByTestId('child-b')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // CSS transform
  // -------------------------------------------------------------------------

  describe('Transform application', () => {
    it('applies a plain 2D translate and scale from the transform prop', () => {
      const transform = makeTransform({
        zoom: 2,
        translateX: 50,
        translateY: 30,
      });

      render(
        <CanvasContent transform={transform}>
          <div />
        </CanvasContent>
      );

      const container = screen.getByTestId('canvas-transform-container');
      expect(container.style.transform).toBe('translate(50px, 30px) scale(2)');
    });

    it('applies identity transform when zoom=1 and offsets are 0', () => {
      render(
        <CanvasContent transform={makeTransform()}>
          <div />
        </CanvasContent>
      );

      const container = screen.getByTestId('canvas-transform-container');
      expect(container.style.transform).toBe('translate(0px, 0px) scale(1)');
    });

    it('uses transformOrigin 0 0', () => {
      render(
        <CanvasContent transform={makeTransform({ zoom: 3 })}>
          <div />
        </CanvasContent>
      );

      const container = screen.getByTestId('canvas-transform-container');
      expect(container).toHaveStyle({ transformOrigin: '0 0' });
    });
  });

  // -------------------------------------------------------------------------
  // Layer hints
  // -------------------------------------------------------------------------

  // Each of these was measured to blur or bleed (see the component's
  // docstring). The test exists so that a well-meant "GPU acceleration"
  // patch has to delete an assertion to land.
  describe('Compositor hints that must stay absent', () => {
    it('emits no 3D transform, perspective, backface or will-change', () => {
      render(
        <CanvasContent transform={makeTransform({ zoom: 10, translateX: 5 })}>
          <div />
        </CanvasContent>
      );

      const style = screen.getByTestId('canvas-transform-container').style;
      expect(style.transform).not.toMatch(/translate3d|translateZ|matrix3d/);
      expect(style.perspective).toBe('');
      expect(style.backfaceVisibility).toBe('');
      expect(style.willChange).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Device-pixel snap
  // -------------------------------------------------------------------------

  describe('Device-pixel snap of the rendered translate', () => {
    type Rect = { left: number; top: number; width: number; height: number };
    let rect: Rect;
    let dprListeners: Array<() => void>;
    let mediaQueries: string[];
    const originalDpr = window.devicePixelRatio;
    const originalMatchMedia = window.matchMedia;
    const originalGBCR = HTMLElement.prototype.getBoundingClientRect;

    const setDpr = (value: number) =>
      Object.defineProperty(window, 'devicePixelRatio', {
        value,
        configurable: true,
      });

    beforeEach(() => {
      rect = { left: 64, top: 109, width: 1236, height: 834 };
      dprListeners = [];
      mediaQueries = [];
      setDpr(1);
      HTMLElement.prototype.getBoundingClientRect = function () {
        return {
          ...rect,
          x: rect.left,
          y: rect.top,
          right: rect.left + rect.width,
          bottom: rect.top + rect.height,
          toJSON: () => ({}),
        } as DOMRect;
      };
      window.matchMedia = ((query: string) => {
        mediaQueries.push(query);
        return {
          matches: true,
          media: query,
          addEventListener: (_: string, cb: () => void) =>
            dprListeners.push(cb),
          removeEventListener: (_: string, cb: () => void) => {
            dprListeners = dprListeners.filter(l => l !== cb);
          },
        };
      }) as unknown as typeof window.matchMedia;
    });

    afterEach(() => {
      setDpr(originalDpr);
      window.matchMedia = originalMatchMedia;
      HTMLElement.prototype.getBoundingClientRect = originalGBCR;
    });

    const transformOf = () =>
      screen.getByTestId('canvas-transform-container').style.transform;

    // A real production transform: translate3d(-7263.43px, -2665.43px, 0px).
    const fractional = makeTransform({
      zoom: 10,
      translateX: -7263.43,
      translateY: -2665.43,
    });
    const ui = (transform = fractional) => (
      <CanvasContent transform={transform}>
        <div />
      </CanvasContent>
    );

    it('rounds a fractional translate to whole pixels at DPR 1', () => {
      render(ui());
      expect(transformOf()).toBe('translate(-7263px, -2665px) scale(10)');
    });

    it('snaps to half CSS pixels at DPR 2', () => {
      setDpr(2);
      render(ui());
      expect(transformOf()).toBe('translate(-7263.5px, -2665.5px) scale(10)');
    });

    it('snaps to thirds of a CSS pixel at DPR 1.5', () => {
      setDpr(1.5);
      render(ui());
      const [, x, y] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(
        transformOf()
      )!;
      expect(Number(x) * 1.5).toBeCloseTo(-10895, 6);
      expect(Number(y) * 1.5).toBeCloseTo(-3998, 6);
    });

    // The first version rounded "container centre + translate". Chrome rounds
    // the box position itself, so on an odd-sized container (centre on a half
    // pixel) that put every stroke exactly between two pixels: measured edge
    // 1.50 device px, against 0.79 for the whole translate.
    it('does NOT compensate a half-pixel container centre', () => {
      rect = { left: 64, top: 109, width: 1237, height: 835 };
      render(ui());
      expect(transformOf()).toBe('translate(-7263px, -2665px) scale(10)');
    });

    it('does not measure the container at all', () => {
      const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
      const { rerender } = render(ui());
      for (let i = 1; i <= 5; i++) {
        rerender(ui({ ...fractional, translateX: -7263.43 + i * 0.3 }));
      }
      // A pan is dozens of these per second; a layout read in each would be
      // a forced reflow per frame.
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('never modifies the transform it was given', () => {
      const frozen = Object.freeze({ ...fractional });
      render(ui(frozen));
      expect(frozen.translateX).toBe(-7263.43);
      expect(frozen.translateY).toBe(-2665.43);
    });

    it('keeps sub-pixel pan deltas: three 0.4 px steps cross a pixel', () => {
      // Why the snap is at render and not in the state: rounding each step
      // would leave the image where it was for ever.
      const { rerender } = render(ui(makeTransform({ translateX: 0 })));
      const seen: string[] = [];
      let x = 0;
      for (let i = 0; i < 3; i++) {
        x += 0.4;
        rerender(ui(makeTransform({ translateX: x })));
        seen.push(transformOf());
      }
      expect(seen).toEqual([
        'translate(0px, 0px) scale(1)',
        'translate(1px, 0px) scale(1)',
        'translate(1px, 0px) scale(1)',
      ]);
    });

    it('re-snaps when the device pixel ratio changes, and re-arms the query', () => {
      render(ui());
      expect(transformOf()).toBe('translate(-7263px, -2665px) scale(10)');
      expect(mediaQueries).toEqual(['(resolution: 1dppx)']);

      // The window moves to a 2x monitor.
      setDpr(2);
      act(() => dprListeners.forEach(cb => cb()));
      expect(transformOf()).toBe('translate(-7263.5px, -2665.5px) scale(10)');
      // A `resolution` query fires for one ratio only, so it must be re-armed
      // for the new one or the NEXT change goes unseen.
      expect(mediaQueries).toEqual([
        '(resolution: 1dppx)',
        '(resolution: 2dppx)',
      ]);
      expect(dprListeners).toHaveLength(1);
    });

    it('stops listening when it unmounts', () => {
      const { unmount } = render(ui());
      expect(dprListeners).toHaveLength(1);
      unmount();
      expect(dprListeners).toHaveLength(0);
    });
  });
});
