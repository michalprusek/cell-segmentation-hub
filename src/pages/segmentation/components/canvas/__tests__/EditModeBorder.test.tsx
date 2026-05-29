/**
 * Tests for EditModeBorder component.
 *
 * Covers: null render when no mode is active, renders a <rect> for each
 * active mode, the correct stroke colour per mode (slicing = red,
 * pointAdding = green, edit = orange), geometry props (x/y/width/height),
 * and strokeWidth scaling by zoom.
 *
 * The component renders an SVG <rect>; we wrap it in an <svg> so jsdom
 * accepts the element.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import EditModeBorder from '../EditModeBorder';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

const IMAGE_SIZE = { width: 800, height: 600 };

function renderBorder(
  overrides: Partial<{
    editMode: boolean;
    slicingMode: boolean;
    pointAddingMode: boolean;
    zoom: number;
  }> = {}
) {
  const props = {
    editMode: false,
    slicingMode: false,
    pointAddingMode: false,
    imageSize: IMAGE_SIZE,
    zoom: 1,
    ...overrides,
  };
  return render(
    <svg>
      <EditModeBorder {...props} />
    </svg>
  );
}

describe('EditModeBorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Null render
  // -----------------------------------------------------------------------

  describe('No active mode', () => {
    it('renders nothing when all modes are false', () => {
      const { container } = renderBorder();
      expect(container.querySelector('rect')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Renders a rect per mode
  // -----------------------------------------------------------------------

  describe('Rect presence', () => {
    it('renders a rect when editMode is true', () => {
      const { container } = renderBorder({ editMode: true });
      expect(container.querySelector('rect')).not.toBeNull();
    });

    it('renders a rect when slicingMode is true', () => {
      const { container } = renderBorder({ slicingMode: true });
      expect(container.querySelector('rect')).not.toBeNull();
    });

    it('renders a rect when pointAddingMode is true', () => {
      const { container } = renderBorder({ pointAddingMode: true });
      expect(container.querySelector('rect')).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Stroke colour per mode
  // -----------------------------------------------------------------------

  describe('Stroke colour', () => {
    it('slicingMode uses red (#FF3B30)', () => {
      const { container } = renderBorder({ slicingMode: true });
      const rect = container.querySelector('rect')!;
      expect(rect.getAttribute('stroke')).toBe('#FF3B30');
    });

    it('pointAddingMode uses green (#4CAF50)', () => {
      const { container } = renderBorder({ pointAddingMode: true });
      const rect = container.querySelector('rect')!;
      expect(rect.getAttribute('stroke')).toBe('#4CAF50');
    });

    it('editMode uses orange (#FF9500)', () => {
      const { container } = renderBorder({ editMode: true });
      const rect = container.querySelector('rect')!;
      expect(rect.getAttribute('stroke')).toBe('#FF9500');
    });

    it('slicingMode wins over pointAddingMode for colour when both true', () => {
      const { container } = renderBorder({
        slicingMode: true,
        pointAddingMode: true,
      });
      const rect = container.querySelector('rect')!;
      expect(rect.getAttribute('stroke')).toBe('#FF3B30');
    });
  });

  // -----------------------------------------------------------------------
  // Geometry
  // -----------------------------------------------------------------------

  describe('Geometry attributes', () => {
    it('rect starts at x=0, y=0', () => {
      const { container } = renderBorder({ editMode: true });
      const rect = container.querySelector('rect')!;
      expect(rect.getAttribute('x')).toBe('0');
      expect(rect.getAttribute('y')).toBe('0');
    });

    it('rect width and height match imageSize', () => {
      const { container } = renderBorder({ editMode: true });
      const rect = container.querySelector('rect')!;
      expect(rect.getAttribute('width')).toBe(String(IMAGE_SIZE.width));
      expect(rect.getAttribute('height')).toBe(String(IMAGE_SIZE.height));
    });

    it('fill is none', () => {
      const { container } = renderBorder({ editMode: true });
      const rect = container.querySelector('rect')!;
      expect(rect.getAttribute('fill')).toBe('none');
    });
  });

  // -----------------------------------------------------------------------
  // strokeWidth scales inversely with zoom
  // -----------------------------------------------------------------------

  // Helper: jsdom serialises camelCase React SVG props to hyphenated
  // attribute names (strokeWidth → stroke-width).
  function getStrokeWidth(rect: Element): number {
    const raw =
      rect.getAttribute('stroke-width') ?? rect.getAttribute('strokeWidth');
    return parseFloat(raw ?? '0');
  }

  describe('strokeWidth and zoom', () => {
    it('strokeWidth = 4 / zoom at zoom=1', () => {
      const { container } = renderBorder({ editMode: true, zoom: 1 });
      const rect = container.querySelector('rect')!;
      expect(getStrokeWidth(rect)).toBeCloseTo(4, 5);
    });

    it('strokeWidth = 2 at zoom=2', () => {
      const { container } = renderBorder({ editMode: true, zoom: 2 });
      const rect = container.querySelector('rect')!;
      expect(getStrokeWidth(rect)).toBeCloseTo(2, 5);
    });

    it('strokeWidth increases when zoom decreases', () => {
      const { container: c05 } = renderBorder({ editMode: true, zoom: 0.5 });
      expect(getStrokeWidth(c05.querySelector('rect')!)).toBeCloseTo(8, 5);
    });
  });

  // -----------------------------------------------------------------------
  // Pointer events none
  // -----------------------------------------------------------------------

  describe('Pointer events', () => {
    it('has pointer-events=none so it does not intercept mouse events', () => {
      const { container } = renderBorder({ editMode: true });
      const rect = container.querySelector('rect')!;
      // jsdom serialises camelCase React SVG props to their hyphenated names
      // (pointerEvents → pointer-events).
      const val =
        rect.getAttribute('pointer-events') ??
        rect.getAttribute('pointerEvents');
      expect(val).toBe('none');
    });
  });
});
