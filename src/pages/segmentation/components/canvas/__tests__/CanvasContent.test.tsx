/**
 * Tests for CanvasContent component
 * Covers transform application, willChange optimisation, legacy prop fallback,
 * and child rendering.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    it('applies translate3d and scale from the transform prop', () => {
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
      expect(container).toHaveStyle({
        transform: 'translate3d(50px, 30px, 0) scale(2)',
      });
    });

    it('applies identity transform when zoom=1 and offsets are 0', () => {
      render(
        <CanvasContent transform={makeTransform()}>
          <div />
        </CanvasContent>
      );

      const container = screen.getByTestId('canvas-transform-container');
      expect(container).toHaveStyle({
        transform: 'translate3d(0px, 0px, 0) scale(1)',
      });
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
  // willChange optimisation
  // -------------------------------------------------------------------------

  describe('willChange optimisation', () => {
    it('sets willChange to transform when isZooming is true', () => {
      render(
        <CanvasContent transform={makeTransform()} isZooming={true}>
          <div />
        </CanvasContent>
      );

      const container = screen.getByTestId('canvas-transform-container');
      expect(container).toHaveStyle({ willChange: 'transform' });
    });

    it('sets willChange to auto when isZooming is false (default)', () => {
      render(
        <CanvasContent transform={makeTransform()} isZooming={false}>
          <div />
        </CanvasContent>
      );

      const container = screen.getByTestId('canvas-transform-container');
      expect(container).toHaveStyle({ willChange: 'auto' });
    });

    it('defaults isZooming to false when the prop is omitted', () => {
      render(
        <CanvasContent transform={makeTransform()}>
          <div />
        </CanvasContent>
      );

      const container = screen.getByTestId('canvas-transform-container');
      expect(container).toHaveStyle({ willChange: 'auto' });
    });
  });

  // -------------------------------------------------------------------------
  // Legacy prop fallback
  // -------------------------------------------------------------------------

  describe('Legacy zoom / offset props', () => {
    it('uses zoom and offset when no transform object is provided', () => {
      // Pass a falsy transform so the component falls back to legacy props
      render(
        <CanvasContent
          transform={null as any}
          zoom={1.5}
          offset={{ x: 20, y: 10 }}
        >
          <div />
        </CanvasContent>
      );

      const container = screen.getByTestId('canvas-transform-container');
      // Fallback: translateX = offset.x = 20, translateY = offset.y = 10, scale = 1.5
      expect(container).toHaveStyle({
        transform: 'translate3d(20px, 10px, 0) scale(1.5)',
      });
    });

    it('defaults to scale(1) with zero offsets when legacy props are also absent', () => {
      render(
        <CanvasContent transform={null as any}>
          <div />
        </CanvasContent>
      );

      const container = screen.getByTestId('canvas-transform-container');
      expect(container).toHaveStyle({
        transform: 'translate3d(0px, 0px, 0) scale(1)',
      });
    });
  });
});
