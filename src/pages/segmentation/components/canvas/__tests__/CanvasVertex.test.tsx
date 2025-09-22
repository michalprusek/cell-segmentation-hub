/**
 * Tests for CanvasVertex component
 * Tests vertex rendering, event handling, scaling, and performance
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import CanvasVertex, {
  calculateVertexRadius,
  calculateStrokeWidth,
  defaultConfig,
  type VertexScalingConfig,
} from '../CanvasVertex';
import { Point } from '@/lib/segmentation';

describe('CanvasVertex', () => {
  const mockPoint: Point = { x: 100, y: 150 };
  const defaultProps = {
    point: mockPoint,
    polygonId: 'polygon-123',
    vertexIndex: 2,
    isSelected: true,
    isHovered: false,
    isDragging: false,
    zoom: 1,
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

      // Debug output
      console.log('Container HTML:', container.innerHTML);

      const vertex = container.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeTruthy();
      expect(vertex.tagName).toBe('circle');
      expect(vertex).toHaveAttribute('cx', '100');
      expect(vertex).toHaveAttribute('cy', '150');
    });

    it('applies correct data attributes for event handling', () => {
      render(
        <svg>
          <CanvasVertex {...defaultProps} />
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      expect(vertex).toHaveAttribute('data-polygon-id', 'polygon-123');
      expect(vertex).toHaveAttribute('data-vertex-index', '2');
    });

    it('renders with correct default radius and styling', () => {
      render(
        <svg>
          <CanvasVertex {...defaultProps} />
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      expect(vertex).toHaveAttribute('r', '5'); // Default base radius
      expect(vertex).toHaveAttribute('fill', '#ea384c'); // External vertex color
      expect(vertex).toHaveAttribute('stroke', '#ffffff');
      expect(vertex).toHaveAttribute('opacity', '1'); // Selected vertex
    });

    it('renders internal vertex with different colors', () => {
      render(
        <svg>
          <CanvasVertex {...defaultProps} type="internal" />
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      expect(vertex).toHaveAttribute('fill', '#0EA5E9'); // Internal vertex color
    });

    it('handles different opacity for non-selected vertices', () => {
      render(
        <svg>
          <CanvasVertex {...defaultProps} isSelected={false} />
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      expect(vertex).toHaveAttribute('opacity', '0.8');
    });
  });

  describe('Event Handling', () => {
    it('calls onMouseDown and stops propagation', () => {
      const parentMouseDown = vi.fn();

      render(
        <svg onMouseDown={parentMouseDown}>
          <CanvasVertex {...defaultProps} />
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      fireEvent.mouseDown(vertex, { clientX: 100, clientY: 150 });

      // Parent handler should not be called due to stopPropagation
      expect(parentMouseDown).not.toHaveBeenCalled();
    });

    it('prevents event bubbling to polygon selection handlers', () => {
      const polygonClickHandler = vi.fn();

      render(
        <svg>
          <g onClick={polygonClickHandler}>
            <CanvasVertex {...defaultProps} />
          </g>
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      fireEvent.mouseDown(vertex);

      // Polygon click handler should not be triggered
      expect(polygonClickHandler).not.toHaveBeenCalled();
    });

    it('handles rapid mouse events without issues', () => {
      render(
        <svg>
          <CanvasVertex {...defaultProps} />
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
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
      render(
        <svg>
          <CanvasVertex {...defaultProps} />
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();

      fireEvent.mouseDown(vertex);

      // Data attributes should still be present after event
      expect(vertex).toHaveAttribute('data-polygon-id', 'polygon-123');
      expect(vertex).toHaveAttribute('data-vertex-index', '2');
    });
  });

  describe('Interaction States', () => {
    it('applies hover scaling correctly', () => {
      render(
        <svg>
          <CanvasVertex {...defaultProps} isHovered={true} />
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      const radius = parseFloat(vertex.getAttribute('r') || '0');

      // Should be larger than base radius due to hover scaling
      expect(radius).toBeGreaterThan(5);
      expect(vertex).toHaveAttribute('fill', '#e74c3c'); // Hover color
    });

    it('applies drag scaling and position offset', () => {
      const dragOffset = { x: 10, y: -5 };

      render(
        <svg>
          <CanvasVertex
            {...defaultProps}
            isDragging={true}
            dragOffset={dragOffset}
          />
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();

      // Position should be offset by drag amount
      expect(vertex).toHaveAttribute('cx', '110'); // 100 + 10
      expect(vertex).toHaveAttribute('cy', '145'); // 150 - 5

      // Should have dragging color
      expect(vertex).toHaveAttribute('fill', '#c0392b');
    });

    it('applies start point scaling', () => {
      render(
        <svg>
          <CanvasVertex {...defaultProps} isStartPoint={true} />
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      const radius = parseFloat(vertex.getAttribute('r') || '0');

      // Should be larger than base radius due to start point scaling
      expect(radius).toBeGreaterThan(5);
    });

    it('combines multiple interaction states correctly', () => {
      render(
        <svg>
          <CanvasVertex
            {...defaultProps}
            isHovered={true}
            isDragging={true}
            isStartPoint={true}
          />
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      const radius = parseFloat(vertex.getAttribute('r') || '0');

      // Should apply all scaling factors
      expect(radius).toBeGreaterThan(6); // Significantly larger
      expect(vertex).toHaveAttribute('fill', '#c0392b'); // Dragging takes precedence
    });
  });

  describe('Zoom Scaling', () => {
    it('scales vertex size correctly with zoom level', () => {
      const { rerender } = render(
        <svg>
          <CanvasVertex {...defaultProps} zoom={1} />
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      const radius1x = parseFloat(vertex.getAttribute('r') || '0');

      rerender(
        <svg>
          <CanvasVertex {...defaultProps} zoom={2} />
        </svg>
      );

      const radius2x = parseFloat(vertex.getAttribute('r') || '0');

      // Higher zoom should result in smaller apparent vertex size
      expect(radius2x).toBeLessThan(radius1x);
    });

    it('respects minimum and maximum radius bounds', () => {
      render(
        <svg>
          <CanvasVertex {...defaultProps} zoom={100} />
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
      const radius = parseFloat(vertex.getAttribute('r') || '0');

      // Should not go below minimum radius
      expect(radius).toBeGreaterThanOrEqual(defaultConfig.minRadius);
    });

    it('handles extreme zoom levels gracefully', () => {
      const extremeZooms = [0.001, 0.1, 50, 1000];

      extremeZooms.forEach((zoom) => {
        const { unmount } = render(
          <svg>
            <CanvasVertex {...defaultProps} zoom={zoom} />
          </svg>
        );

        const vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
        const radius = parseFloat(vertex.getAttribute('r') || '0');

        // Should always be within valid bounds
        expect(radius).toBeGreaterThan(0);
        expect(radius).toBeLessThanOrEqual(defaultConfig.maxRadius);

        unmount();
      });
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

    it('applies transitions correctly based on state', () => {
      const { rerender } = render(
        <svg>
          <CanvasVertex {...defaultProps} isDragging={false} isUndoRedoInProgress={false} />
        </svg>
      );

      let vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toHaveStyle({ transition: 'all 0.15s ease-out' });

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
      render(
        <svg>
          <CanvasVertex {...defaultProps} />
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
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

    it('handles rapid prop changes efficiently', () => {
      const { rerender } = render(
        <svg>
          <CanvasVertex {...defaultProps} />
        </svg>
      );

      const startTime = performance.now();

      // Simulate rapid position updates (e.g., during dragging)
      for (let i = 0; i < 50; i++) {
        rerender(
          <svg>
            <CanvasVertex
              {...defaultProps}
              point={{ x: 100 + i, y: 150 + i }}
              dragOffset={{ x: i, y: i }}
            />
          </svg>
        );
      }

      const totalTime = performance.now() - startTime;
      expect(totalTime).toBeLessThan(100); // Should be fast
    });

    it('optimizes drag offset comparisons', () => {
      const { rerender } = render(
        <svg>
          <CanvasVertex {...defaultProps} dragOffset={{ x: 5, y: 10 }} />
        </svg>
      );

      const vertex = document.querySelector('circle') as SVGCircleElement;
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

      invalidPoints.forEach((point) => {
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

      invalidOffsets.forEach((dragOffset) => {
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

      extremeIndices.forEach((vertexIndex) => {
        const { unmount } = render(
          <svg>
            <CanvasVertex {...defaultProps} vertexIndex={vertexIndex} />
          </svg>
        );

        const vertex = document.querySelector('circle') as SVGCircleElement;
      expect(vertex).toBeInTheDocument();
        expect(vertex).toHaveAttribute('data-vertex-index', String(vertexIndex));

        unmount();
      });
    });
  });
});

describe('Vertex Scaling Utility Functions', () => {
  describe('calculateVertexRadius', () => {
    it('calculates radius with adaptive scaling mode', () => {
      const radius = calculateVertexRadius(2, defaultConfig);
      expect(radius).toBeLessThan(defaultConfig.baseRadius);
      expect(radius).toBeGreaterThan(0);
    });

    it('applies interaction state multipliers correctly', () => {
      const baseRadius = calculateVertexRadius(1, defaultConfig);
      const hoveredRadius = calculateVertexRadius(1, defaultConfig, true);
      const draggingRadius = calculateVertexRadius(1, defaultConfig, false, true);
      const startPointRadius = calculateVertexRadius(1, defaultConfig, false, false, true);

      expect(hoveredRadius).toBeGreaterThan(baseRadius);
      expect(draggingRadius).toBeGreaterThan(baseRadius);
      expect(startPointRadius).toBeGreaterThan(baseRadius);
    });

    it('enforces minimum and maximum bounds', () => {
      const config: VertexScalingConfig = {
        ...defaultConfig,
        minRadius: 2,
        maxRadius: 10,
      };

      const smallRadius = calculateVertexRadius(1000, config);
      const largeRadius = calculateVertexRadius(0.001, config);

      expect(smallRadius).toBeGreaterThanOrEqual(config.minRadius);
      expect(largeRadius).toBeLessThanOrEqual(config.maxRadius);
    });

    it('handles different scaling modes', () => {
      const modes: VertexScalingConfig['scalingMode'][] = [
        'adaptive',
        'constant',
        'linear',
        'logarithmic',
      ];

      modes.forEach((mode) => {
        const config: VertexScalingConfig = { ...defaultConfig, scalingMode: mode };
        const radius = calculateVertexRadius(2, config);
        expect(radius).toBeGreaterThan(0);
      });
    });
  });

  describe('calculateStrokeWidth', () => {
    it('calculates stroke width proportional to zoom', () => {
      const width1x = calculateStrokeWidth(1, defaultConfig);
      const width2x = calculateStrokeWidth(2, defaultConfig);

      expect(width2x).toBeLessThan(width1x);
      expect(width2x).toBeGreaterThan(0);
    });

    it('maintains minimum stroke width', () => {
      const width = calculateStrokeWidth(1000, defaultConfig);
      expect(width).toBeGreaterThanOrEqual(0.5);
    });

    it('handles constant scaling mode differently', () => {
      const adaptiveConfig: VertexScalingConfig = {
        ...defaultConfig,
        scalingMode: 'adaptive',
      };
      const constantConfig: VertexScalingConfig = {
        ...defaultConfig,
        scalingMode: 'constant',
      };

      const adaptiveWidth = calculateStrokeWidth(4, adaptiveConfig);
      const constantWidth = calculateStrokeWidth(4, constantConfig);

      // Different scaling modes should produce different results
      expect(adaptiveWidth).not.toBe(constantWidth);
    });
  });
});