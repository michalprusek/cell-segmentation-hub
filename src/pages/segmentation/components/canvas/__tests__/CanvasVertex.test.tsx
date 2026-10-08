/**
 * Tests for CanvasVertex component
 * Tests vertex rendering, event handling, scaling, and performance
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import CanvasVertex from '../CanvasVertex';
import { Point } from '@/lib/segmentation';
import { overlayScaleStyle, vertexRadiusPx } from '../../../utils/overlayScale';

// `vertexRadiusPx` is called once per render of CanvasVertex and nowhere
// else, which makes it a render counter that needs no stub of the component.
vi.mock('../../../utils/overlayScale', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../utils/overlayScale')>();
  return { ...actual, vertexRadiusPx: vi.fn(actual.vertexRadiusPx) };
});

/** Radius of a vertex handle in SCREEN pixels. It is a CSS custom property on
 *  the circle (class `overlay-dot` turns it into `r`), not an `r` attribute:
 *  the size has to follow the zoom without this component re-rendering. */
const radiusPx = (el: Element) =>
  parseFloat((el as SVGElement).style.getPropertyValue('--overlay-r'));

describe('CanvasVertex', () => {
  const mockPoint: Point = { x: 100, y: 150 };
  const defaultProps = {
    point: mockPoint,
    polygonId: 'polygon-123',
    vertexIndex: 2,
    isSelected: true,
    isHovered: false,
    isDragging: false,
    type: 'external' as const,
    isStartPoint: false,
    isUndoRedoInProgress: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Basic Rendering', () => {
    it('renders vertex circle with correct attributes', () => {
      const { container } = render(
        <svg>
          <CanvasVertex {...defaultProps} />
        </svg>
      );

      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeTruthy();
      expect(vertex.tagName).toBe('circle');
      expect(vertex).toHaveAttribute('cx', '100');
      expect(vertex).toHaveAttribute('cy', '150');
    });

    it('applies correct data attributes for event handling', () => {
      const { container } = render(
        <svg>
          <CanvasVertex {...defaultProps} />
        </svg>
      );
      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      expect(vertex).toHaveAttribute('data-polygon-id', 'polygon-123');
      expect(vertex).toHaveAttribute('data-vertex-index', '2');
    });

    it('renders with correct default radius and styling', () => {
      const { container } = render(
        <svg>
          <CanvasVertex {...defaultProps} />
        </svg>
      );
      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      // 5 screen px, through the class — and deliberately no `r` attribute,
      // which would be in user units and grow with the zoom.
      expect(radiusPx(vertex)).toBe(5);
      expect(vertex).toHaveClass('overlay-dot');
      expect(vertex).not.toHaveAttribute('r');
      expect(vertex).not.toHaveAttribute('stroke-width');
      expect(vertex.style.strokeWidth).toBe(
        'calc(var(--overlay-px, 1px) * 1.2)'
      );
      expect(vertex).toHaveAttribute('fill', '#ea384c'); // External vertex color
      expect(vertex).toHaveAttribute('stroke', '#ffffff');
      expect(vertex).toHaveAttribute('opacity', '1'); // Selected vertex
    });

    it('renders internal vertex with different colors', () => {
      const { container } = render(
        <svg>
          <CanvasVertex {...defaultProps} type="internal" />
        </svg>
      );
      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      expect(vertex).toHaveAttribute('fill', '#0EA5E9'); // Internal vertex color
    });

    it('handles different opacity for non-selected vertices', () => {
      const { container } = render(
        <svg>
          <CanvasVertex {...defaultProps} isSelected={false} />
        </svg>
      );
      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      expect(vertex).toHaveAttribute('opacity', '0.8');
    });
  });

  describe('Event Handling', () => {
    it('does not stop propagation on mouseDown (event delegation pattern)', () => {
      const parentMouseDown = vi.fn();

      const { container } = render(
        <svg onMouseDown={parentMouseDown}>
          <CanvasVertex {...defaultProps} />
        </svg>
      );
      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      fireEvent.mouseDown(vertex, { clientX: 100, clientY: 150 });

      // The component uses event delegation — it does NOT call stopPropagation,
      // so the parent canvas receives the mouseDown with data attributes intact.
      expect(parentMouseDown).toHaveBeenCalled();
    });

    it('prevents event bubbling to polygon selection handlers', () => {
      const polygonClickHandler = vi.fn();

      const { container } = render(
        <svg>
          <g onClick={polygonClickHandler}>
            <CanvasVertex {...defaultProps} />
          </g>
        </svg>
      );
      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      fireEvent.mouseDown(vertex);

      // Polygon click handler should not be triggered
      expect(polygonClickHandler).not.toHaveBeenCalled();
    });

    it('handles rapid mouse events without issues', () => {
      const { container } = render(
        <svg>
          <CanvasVertex {...defaultProps} />
        </svg>
      );
      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();

      // Rapid mouse events
      for (let i = 0; i < 10; i++) {
        fireEvent.mouseDown(vertex);
        fireEvent.mouseUp(vertex);
      }

      // Should not crash or cause issues
      expect(vertex).toBeInTheDocument();
    });

    it('maintains data attributes during event handling', () => {
      const { container } = render(
        <svg>
          <CanvasVertex {...defaultProps} />
        </svg>
      );
      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();

      fireEvent.mouseDown(vertex);

      // Data attributes should still be present after event
      expect(vertex).toHaveAttribute('data-polygon-id', 'polygon-123');
      expect(vertex).toHaveAttribute('data-vertex-index', '2');
    });
  });

  describe('Interaction States', () => {
    it('applies hover scaling correctly', () => {
      const { container } = render(
        <svg>
          <CanvasVertex {...defaultProps} isHovered={true} />
        </svg>
      );
      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      const radius = radiusPx(vertex);

      // 5 px x 1.3 hover scale
      expect(radius).toBe(6.5);
      expect(vertex).toHaveAttribute('fill', '#e74c3c'); // Hover color
    });

    it('applies drag scaling and position offset', () => {
      const dragOffset = { x: 10, y: -5 };

      const { container } = render(
        <svg>
          <CanvasVertex
            {...defaultProps}
            isDragging={true}
            dragOffset={dragOffset}
          />
        </svg>
      );
      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();

      // Position should be offset by drag amount
      expect(vertex).toHaveAttribute('cx', '110'); // 100 + 10
      expect(vertex).toHaveAttribute('cy', '145'); // 150 - 5

      // Should have dragging color
      expect(vertex).toHaveAttribute('fill', '#c0392b');
    });

    it('applies start point scaling', () => {
      const { container } = render(
        <svg>
          <CanvasVertex {...defaultProps} isStartPoint={true} />
        </svg>
      );
      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      const radius = radiusPx(vertex);

      // 5 px x 1.2 start-point scale
      expect(radius).toBe(6);
    });

    it('combines multiple interaction states correctly', () => {
      const { container } = render(
        <svg>
          <CanvasVertex
            {...defaultProps}
            isHovered={true}
            isDragging={true}
            isStartPoint={true}
          />
        </svg>
      );
      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      const radius = radiusPx(vertex);

      // 5 x 1.3 x 1.1 x 1.2
      expect(radius).toBe(8.58);
      expect(vertex).toHaveAttribute('fill', '#c0392b'); // Dragging takes precedence
    });
  });

  describe('Zoom Scaling', () => {
    // The handle takes no zoom prop. Its size is `--overlay-r` screen pixels
    // times the overlay's `--overlay-px` (1 / zoom), resolved by CSS — so the
    // markup of a vertex is IDENTICAL at every zoom and a zoom step re-renders
    // none of them. (jsdom does not resolve `calc()`; that the product is a
    // constant on screen is measured in a real browser, not here.)
    it('emits the same markup at every zoom', () => {
      const at = (zoom: number) => {
        const { container, unmount } = render(
          <svg style={overlayScaleStyle(zoom)}>
            <CanvasVertex {...defaultProps} />
          </svg>
        );
        const html = container.querySelector('circle')!.outerHTML;
        unmount();
        return html;
      };
      const reference = at(1);
      for (const zoom of [0.1, 2.35, 4.06, 10]) {
        expect(at(zoom)).toBe(reference);
      }
    });

    it('does not re-render when only the overlay zoom changes', () => {
      const renders = () => vi.mocked(vertexRadiusPx).mock.calls.length;
      const ui = (zoom: number, extra: Record<string, unknown> = {}) => (
        <svg style={overlayScaleStyle(zoom)}>
          <CanvasVertex {...defaultProps} {...extra} />
        </svg>
      );
      const { container, rerender } = render(ui(1));
      expect(renders()).toBe(1);
      rerender(ui(4));
      rerender(ui(10));
      expect(renders()).toBe(1);
      // The control: the counter does move for a prop that changes.
      rerender(ui(10, { isHovered: true }));
      expect(renders()).toBe(2);
      // ...while the one write that does happen landed on the <svg>.
      expect(
        container.querySelector('svg')!.style.getPropertyValue('--overlay-px')
      ).toBe('0.1px');
    });
  });

  describe('Cursor and Styling', () => {
    it('applies correct cursor styles', () => {
      const { rerender } = render(
        <svg>
          <CanvasVertex {...defaultProps} isDragging={false} />
        </svg>
      );

      let vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toHaveStyle({ cursor: 'grab' });

      rerender(
        <svg>
          <CanvasVertex {...defaultProps} isDragging={true} />
        </svg>
      );

      vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toHaveStyle({ cursor: 'grabbing' });
    });

    it('shows the MOVE cursor in MoveShape, dragging or not', () => {
      // In MoveShape a press on a vertex translates the whole shape — the
      // vertex branch of `handleMouseDown` is gated to EditVertices — so
      // `grab`/`grabbing` would advertise a per-point drag the mode does not
      // have. Both states are asserted: the mode wins over `isDragging`.
      const { rerender } = render(
        <svg>
          <CanvasVertex
            {...defaultProps}
            isInMoveShapeMode
            isDragging={false}
          />
        </svg>
      );
      expect(document.querySelector('circle')).toHaveStyle({ cursor: 'move' });

      rerender(
        <svg>
          <CanvasVertex {...defaultProps} isInMoveShapeMode isDragging />
        </svg>
      );
      expect(document.querySelector('circle')).toHaveStyle({ cursor: 'move' });
    });

    it('applies transitions correctly based on state', () => {
      const { rerender } = render(
        <svg>
          <CanvasVertex
            {...defaultProps}
            isDragging={false}
            isUndoRedoInProgress={false}
          />
        </svg>
      );

      let vertex = document.querySelector('circle') as SVGCircleElement;
      // Paint only — never `all`. `cx`/`cy` are SVG2 geometry properties and
      // animate under `all`, so a dropped vertex glided into place instead of
      // being there; see `vertexDragRendering.test.tsx`.
      // `r` is not eased either: it changes with every zoom step now, and a
      // transition would lag each handle 150 ms behind the wheel.
      expect(vertex).toHaveStyle({
        transition: 'fill 0.15s ease-out, opacity 0.15s ease-out',
      });

      rerender(
        <svg>
          <CanvasVertex {...defaultProps} isDragging={true} />
        </svg>
      );

      vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toHaveStyle({ transition: 'none' });

      rerender(
        <svg>
          <CanvasVertex {...defaultProps} isUndoRedoInProgress={true} />
        </svg>
      );

      vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toHaveStyle({ transition: 'none' });
    });

    it('enables pointer events', () => {
      const { container } = render(
        <svg>
          <CanvasVertex {...defaultProps} />
        </svg>
      );
      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      expect(vertex).toHaveStyle({ pointerEvents: 'all' });
    });
  });

  describe('Performance and Memoization', () => {
    it('prevents unnecessary re-renders with React.memo', () => {
      let renderCount = 0;
      const TestComponent = React.memo((props: any) => {
        renderCount++;
        return <CanvasVertex {...props} />;
      });

      const { rerender } = render(
        <svg>
          <TestComponent {...defaultProps} />
        </svg>
      );

      expect(renderCount).toBe(1);

      // Re-render with same props should not trigger re-render
      rerender(
        <svg>
          <TestComponent {...defaultProps} />
        </svg>
      );

      expect(renderCount).toBe(1);

      // Re-render with different props should trigger re-render
      rerender(
        <svg>
          <TestComponent {...defaultProps} isHovered={true} />
        </svg>
      );

      expect(renderCount).toBe(2);
    });

    // Was `expect(totalTime).toBeLessThan(2000)` and nothing else — a ceiling
    // ~400x the real cost, which cannot fail short of a hang (and a hang trips
    // the test timeout instead). The claim worth making about 50 rapid prop
    // changes is not that they were fast but that the LAST one won: this is a
    // React.memo component with a hand-written comparator, and a comparator
    // that misses a prop leaves the vertex rendered at a stale position for the
    // rest of the drag. That is failure pattern #5 in CLAUDE.md.
    it('renders the final position after 50 rapid prop changes', () => {
      const { container, rerender } = render(
        <svg>
          <CanvasVertex {...defaultProps} />
        </svg>
      );

      // ONLY `point` varies. The first version of this test also swept
      // dragOffset, and a mutation that made the comparator ignore `point`
      // survived it — the changing offset re-rendered the component anyway.
      for (let i = 0; i < 50; i++) {
        rerender(
          <svg>
            <CanvasVertex
              {...defaultProps}
              point={{ x: 100 + i, y: 150 + i }}
            />
          </svg>
        );
      }

      // i ends at 49, and defaultProps has isDragging=false / no dragOffset,
      // so the vertex sits at the raw point.
      const circle = container.querySelector('circle');
      expect(circle).not.toBeNull();
      expect(circle).toHaveAttribute('cx', '149');
      expect(circle).toHaveAttribute('cy', '199');
    });

    it('applies the final dragOffset when ONLY dragOffset changes', () => {
      // `point` is held FIXED here on purpose. The first version of this test
      // varied point and dragOffset together, and a mutation that made the memo
      // comparator ignore dragOffset entirely (`const sameDragOffset = true`)
      // survived it — the changing `point` re-rendered the component anyway, so
      // the offset was never the reason anything updated. Varying exactly one
      // thing is what makes the fixture discriminate.
      const FIXED_POINT = { x: 100, y: 150 };

      const { container, rerender } = render(
        <svg>
          <CanvasVertex
            {...defaultProps}
            point={FIXED_POINT}
            isDragging
            dragOffset={{ x: 0, y: 0 }}
          />
        </svg>
      );

      for (let i = 1; i <= 50; i++) {
        rerender(
          <svg>
            <CanvasVertex
              {...defaultProps}
              point={FIXED_POINT}
              isDragging
              dragOffset={{ x: i, y: 2 * i }}
            />
          </svg>
        );
      }

      const circle = container.querySelector('circle');
      expect(circle).not.toBeNull();
      // point (100, 150) + final offset (50, 100)
      expect(circle).toHaveAttribute('cx', '150');
      expect(circle).toHaveAttribute('cy', '250');
    });

    it('optimizes drag offset comparisons', () => {
      const { container, rerender } = render(
        <svg>
          <CanvasVertex {...defaultProps} dragOffset={{ x: 5, y: 10 }} />
        </svg>
      );
      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      const initialPosition = {
        cx: vertex.getAttribute('cx'),
        cy: vertex.getAttribute('cy'),
      };

      // Re-render with same drag offset should not cause changes
      rerender(
        <svg>
          <CanvasVertex {...defaultProps} dragOffset={{ x: 5, y: 10 }} />
        </svg>
      );

      expect(vertex.getAttribute('cx')).toBe(initialPosition.cx);
      expect(vertex.getAttribute('cy')).toBe(initialPosition.cy);
    });
  });

  describe('Edge Cases', () => {
    it('handles invalid point coordinates', () => {
      const invalidPoints = [
        { x: NaN, y: 100 },
        { x: 100, y: NaN },
        { x: Infinity, y: 100 },
        { x: -Infinity, y: 100 },
      ];

      invalidPoints.forEach(point => {
        expect(() => {
          render(
            <svg>
              <CanvasVertex {...defaultProps} point={point} />
            </svg>
          );
        }).not.toThrow();
      });
    });

    it('handles invalid drag offsets gracefully', () => {
      const invalidOffsets = [
        { x: NaN, y: 5 },
        { x: 5, y: NaN },
        { x: Infinity, y: 5 },
        undefined,
      ];

      invalidOffsets.forEach(dragOffset => {
        expect(() => {
          render(
            <svg>
              <CanvasVertex {...defaultProps} dragOffset={dragOffset} />
            </svg>
          );
        }).not.toThrow();
      });
    });

    it('handles extreme vertex indices', () => {
      const extremeIndices = [-1, 0, 999999, NaN];

      extremeIndices.forEach(vertexIndex => {
        const { container, unmount } = render(
          <svg>
            <CanvasVertex {...defaultProps} vertexIndex={vertexIndex} />
          </svg>
        );
        const vertex = container.querySelector('circle') as SVGCircleElement;
        expect(vertex).toBeInTheDocument();
        expect(vertex).toHaveAttribute(
          'data-vertex-index',
          String(vertexIndex)
        );

        unmount();
      });
    });
  });
});
