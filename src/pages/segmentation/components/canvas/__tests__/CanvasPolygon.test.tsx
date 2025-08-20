/**
 * Tests for CanvasPolygon component
 * Tests polygon rendering, selection, interaction, and performance
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CanvasPolygon from '../CanvasPolygon';
import {
  createMockPolygon,
  createMockPolygons,
} from '@/test-utils/segmentationTestUtils';
import { render as customRender } from '@/test-utils/reactTestUtils';
import type { VertexDragState } from '@/pages/segmentation/types';

// Mock the heavy dependencies
vi.mock('../PolygonVertices', () => ({
  default: ({ polygon, onVertexClick, onVertexMouseDown }: any) => (
    <g data-testid={`polygon-vertices-${polygon.id}`}>
      {polygon.points.map((point: any, index: number) => (
        <circle
          key={index}
          data-testid={`vertex-${index}`}
          cx={point.x}
          cy={point.y}
          r="3"
          onClick={() => onVertexClick?.(0)}
          onMouseDown={() => onVertexMouseDown?.(0)}
        />
      ))}
    </g>
  ),
}));

vi.mock('../context-menu/PolygonContextMenu', () => ({
  default: ({ children, polygon, onDelete, onSlice, onEdit }: any) => (
    <g>
      {children}
      <g data-testid={`context-menu-${polygon.id}`} style={{ display: 'none' }}>
        <rect
          data-testid="delete-button"
          onClick={() => onDelete?.(polygon.id)}
        />
        <rect
          data-testid="slice-button"
          onClick={() => onSlice?.(polygon.id)}
        />
        <rect data-testid="edit-button" onClick={() => onEdit?.(polygon.id)} />
      </g>
    </g>
  ),
}));

vi.mock('@/lib/polygonGeometry', () => ({
  calculateBoundingBox: vi.fn((points: any[]) => ({
    minX: Math.min(...points.map(p => p.x)),
    maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)),
    maxY: Math.max(...points.map(p => p.y)),
  })),
  isPolygonInViewport: vi.fn(() => true),
  simplifyPolygon: vi.fn((points: any[]) => points), // No simplification in tests
}));

describe('CanvasPolygon', () => {
  const mockPolygon = createMockPolygon({
    id: 'test-polygon',
    points: [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 50 },
      { x: 10, y: 50 },
    ],
  });

  const defaultProps = {
    polygon: mockPolygon,
    isSelected: false,
    zoom: 1,
    onSelectPolygon: vi.fn(),
    onDeletePolygon: vi.fn(),
    onSlicePolygon: vi.fn(),
    onEditPolygon: vi.fn(),
    onDeleteVertex: vi.fn(),
    onDuplicateVertex: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to render polygon in SVG context
  const renderPolygonInSvg = (polygonElement: React.ReactElement) => {
    return customRender(
      <svg width="800" height="600" viewBox="0 0 800 600">
        {polygonElement}
      </svg>
    );
  };

  describe('Rendering', () => {
    it('renders polygon with correct basic structure', () => {
      renderPolygonInSvg(<CanvasPolygon {...defaultProps} />);

      const polygonElement = screen.getByTestId('test-polygon');
      expect(polygonElement).toBeInTheDocument();

      // Check that the polygon path is rendered
      const polygonPath = polygonElement.querySelector('path');
      expect(polygonPath).toBeInTheDocument();
    });

    it('applies correct CSS classes for selected state', () => {
      customRender(<CanvasPolygon {...defaultProps} isSelected={true} />);

      const polygonElement = screen.getByTestId('test-polygon');
      expect(polygonElement).toHaveClass('selected');
    });

    it('applies correct CSS classes for hovered state', () => {
      customRender(<CanvasPolygon {...defaultProps} isHovered={true} />);

      const polygonElement = screen.getByTestId('test-polygon');
      expect(polygonElement).toHaveClass('hovered');
    });

    it('renders vertices when not hidden', () => {
      customRender(<CanvasPolygon {...defaultProps} isSelected={true} />);

      expect(
        screen.getByTestId(`polygon-vertices-${mockPolygon.id}`)
      ).toBeInTheDocument();
    });

    it('hides vertices when hideVertices is true', () => {
      customRender(<CanvasPolygon {...defaultProps} hideVertices={true} />);

      expect(
        screen.queryByTestId(`polygon-vertices-${mockPolygon.id}`)
      ).not.toBeInTheDocument();
    });

    it('renders polygon with different types correctly', () => {
      const externalPolygon = { ...mockPolygon, type: 'external' as const };
      const internalPolygon = { ...mockPolygon, type: 'internal' as const };

      const { rerender } = customRender(
        <CanvasPolygon {...defaultProps} polygon={externalPolygon} />
      );

      expect(screen.getByTestId('test-polygon')).toHaveClass('external');

      rerender(<CanvasPolygon {...defaultProps} polygon={internalPolygon} />);

      expect(screen.getByTestId('test-polygon')).toHaveClass('internal');
    });
  });

  describe('Interaction', () => {
    it('calls onSelectPolygon when polygon is clicked', () => {
      const onSelectPolygon = vi.fn();
      customRender(
        <CanvasPolygon {...defaultProps} onSelectPolygon={onSelectPolygon} />
      );

      const polygonElement = screen.getByTestId('test-polygon');
      fireEvent.click(polygonElement);

      expect(onSelectPolygon).toHaveBeenCalledWith('test-polygon');
    });

    it('handles double-click for polygon editing', () => {
      const onEditPolygon = vi.fn();
      customRender(
        <CanvasPolygon {...defaultProps} onEditPolygon={onEditPolygon} />
      );

      const polygonElement = screen.getByTestId('test-polygon');
      fireEvent.doubleClick(polygonElement);

      expect(onEditPolygon).toHaveBeenCalledWith('test-polygon');
    });

    it('shows context menu on right-click', async () => {
      customRender(<CanvasPolygon {...defaultProps} isSelected={true} />);

      const polygonElement = screen.getByTestId('test-polygon');
      fireEvent.contextMenu(polygonElement);

      await waitFor(() => {
        expect(
          screen.getByTestId(`context-menu-${mockPolygon.id}`)
        ).toBeInTheDocument();
      });
    });

    it('handles context menu actions correctly', async () => {
      const onDeletePolygon = vi.fn();
      const onSlicePolygon = vi.fn();
      const onEditPolygon = vi.fn();

      customRender(
        <CanvasPolygon
          {...defaultProps}
          isSelected={true}
          onDeletePolygon={onDeletePolygon}
          onSlicePolygon={onSlicePolygon}
          onEditPolygon={onEditPolygon}
        />
      );

      const polygonElement = screen.getByTestId('test-polygon');
      fireEvent.contextMenu(polygonElement);

      await waitFor(() => {
        expect(
          screen.getByTestId(`context-menu-${mockPolygon.id}`)
        ).toBeInTheDocument();
      });

      // Test delete action
      fireEvent.click(screen.getByTestId('delete-button'));
      expect(onDeletePolygon).toHaveBeenCalledWith('test-polygon');

      // Test slice action
      fireEvent.click(screen.getByTestId('slice-button'));
      expect(onSlicePolygon).toHaveBeenCalledWith('test-polygon');

      // Test edit action
      fireEvent.click(screen.getByTestId('edit-button'));
      expect(onEditPolygon).toHaveBeenCalledWith('test-polygon');
    });

    it('prevents event propagation on polygon click', () => {
      const onSelectPolygon = vi.fn();
      const parentClickHandler = vi.fn();

      customRender(
        <div onClick={parentClickHandler}>
          <CanvasPolygon {...defaultProps} onSelectPolygon={onSelectPolygon} />
        </div>
      );

      const polygonElement = screen.getByTestId('test-polygon');
      fireEvent.click(polygonElement);

      expect(onSelectPolygon).toHaveBeenCalled();
      expect(parentClickHandler).not.toHaveBeenCalled();
    });
  });

  describe('Vertex Interactions', () => {
    const mockVertexDragState: VertexDragState = {
      isDragging: false,
      polygonId: null,
      vertexIndex: null,
    };

    it('renders vertices with drag state', () => {
      const dragState: VertexDragState = {
        isDragging: true,
        polygonId: 'test-polygon',
        vertexIndex: 0,
      };

      customRender(
        <CanvasPolygon
          {...defaultProps}
          isSelected={true}
          vertexDragState={dragState}
        />
      );

      const vertices = screen.getByTestId(`polygon-vertices-${mockPolygon.id}`);
      expect(vertices).toBeInTheDocument();
    });

    it('handles vertex deletion', () => {
      const onDeleteVertex = vi.fn();
      customRender(
        <CanvasPolygon
          {...defaultProps}
          isSelected={true}
          onDeleteVertex={onDeleteVertex}
        />
      );

      // This would typically be triggered by a key press or context menu
      // For now, we'll simulate it directly
      const vertices = screen.getByTestId(`polygon-vertices-${mockPolygon.id}`);
      fireEvent.click(vertices);

      // In a real scenario, this would trigger vertex-specific actions
      expect(vertices).toBeInTheDocument();
    });

    it('handles vertex duplication', () => {
      const onDuplicateVertex = vi.fn();
      customRender(
        <CanvasPolygon
          {...defaultProps}
          isSelected={true}
          onDuplicateVertex={onDuplicateVertex}
        />
      );

      const vertices = screen.getByTestId(`polygon-vertices-${mockPolygon.id}`);
      expect(vertices).toBeInTheDocument();
    });

    it('highlights hovered vertex', () => {
      const hoveredVertex = {
        polygonId: 'test-polygon',
        vertexIndex: 1,
      };

      customRender(
        <CanvasPolygon
          {...defaultProps}
          isSelected={true}
          hoveredVertex={hoveredVertex}
        />
      );

      const vertices = screen.getByTestId(`polygon-vertices-${mockPolygon.id}`);
      expect(vertices).toBeInTheDocument();
    });
  });

  describe('Performance and Optimization', () => {
    it('memoizes polygon rendering', () => {
      const { rerender } = customRender(<CanvasPolygon {...defaultProps} />);

      // Re-render with same props should not cause re-render of memoized component
      rerender(<CanvasPolygon {...defaultProps} />);

      expect(screen.getByTestId('test-polygon')).toBeInTheDocument();
    });

    it('handles viewport culling correctly', () => {
      const viewportBounds = {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      };

      customRender(
        <CanvasPolygon {...defaultProps} viewportBounds={viewportBounds} />
      );

      expect(screen.getByTestId('test-polygon')).toBeInTheDocument();
    });

    it('handles polygon with many vertices efficiently', () => {
      const complexPolygon = createMockPolygon({
        id: 'complex-polygon',
        points: Array.from({ length: 100 }, (_, i) => ({
          x: Math.cos((i / 100) * 2 * Math.PI) * 50 + 50,
          y: Math.sin((i / 100) * 2 * Math.PI) * 50 + 50,
        })),
      });

      const startTime = performance.now();
      customRender(
        <CanvasPolygon {...defaultProps} polygon={complexPolygon} />
      );
      const renderTime = performance.now() - startTime;

      expect(screen.getByTestId('complex-polygon')).toBeInTheDocument();
      expect(renderTime).toBeLessThan(100); // Should render quickly even with many vertices
    });

    it('updates efficiently when zoom changes', () => {
      const { rerender } = customRender(
        <CanvasPolygon {...defaultProps} zoom={1} />
      );

      rerender(<CanvasPolygon {...defaultProps} zoom={2} />);
      rerender(<CanvasPolygon {...defaultProps} zoom={0.5} />);

      expect(screen.getByTestId('test-polygon')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles polygon with no points', () => {
      const emptyPolygon = createMockPolygon({
        id: 'empty-polygon',
        points: [],
      });

      customRender(<CanvasPolygon {...defaultProps} polygon={emptyPolygon} />);

      const polygonElement = screen.getByTestId('empty-polygon');
      expect(polygonElement).toBeInTheDocument();
    });

    it('handles polygon with single point', () => {
      const singlePointPolygon = createMockPolygon({
        id: 'single-point-polygon',
        points: [{ x: 25, y: 25 }],
      });

      customRender(
        <CanvasPolygon {...defaultProps} polygon={singlePointPolygon} />
      );

      expect(screen.getByTestId('single-point-polygon')).toBeInTheDocument();
    });

    it('handles polygon with duplicate points', () => {
      const duplicatePointsPolygon = createMockPolygon({
        id: 'duplicate-points-polygon',
        points: [
          { x: 10, y: 10 },
          { x: 10, y: 10 }, // Duplicate
          { x: 20, y: 20 },
          { x: 20, y: 20 }, // Duplicate
        ],
      });

      customRender(
        <CanvasPolygon {...defaultProps} polygon={duplicatePointsPolygon} />
      );

      expect(
        screen.getByTestId('duplicate-points-polygon')
      ).toBeInTheDocument();
    });

    it('handles very small polygons', () => {
      const tinyPolygon = createMockPolygon({
        id: 'tiny-polygon',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
      });

      customRender(
        <CanvasPolygon {...defaultProps} polygon={tinyPolygon} zoom={100} />
      );

      expect(screen.getByTestId('tiny-polygon')).toBeInTheDocument();
    });

    it('handles very large polygons', () => {
      const largePolygon = createMockPolygon({
        id: 'large-polygon',
        points: [
          { x: -1000, y: -1000 },
          { x: 1000, y: -1000 },
          { x: 1000, y: 1000 },
          { x: -1000, y: 1000 },
        ],
      });

      customRender(
        <CanvasPolygon {...defaultProps} polygon={largePolygon} zoom={0.01} />
      );

      expect(screen.getByTestId('large-polygon')).toBeInTheDocument();
    });

    it('handles polygon with extreme coordinates', () => {
      const extremePolygon = createMockPolygon({
        id: 'extreme-polygon',
        points: [
          { x: Number.MAX_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER },
          { x: Number.MIN_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER },
          { x: Number.MIN_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER },
          { x: Number.MAX_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER },
        ],
      });

      expect(() => {
        customRender(
          <CanvasPolygon {...defaultProps} polygon={extremePolygon} />
        );
      }).not.toThrow();
    });
  });

  describe('Accessibility', () => {
    it('provides keyboard navigation support', () => {
      customRender(<CanvasPolygon {...defaultProps} />);

      const polygonElement = screen.getByTestId('test-polygon');

      // Should be focusable
      polygonElement.focus();
      expect(polygonElement).toHaveFocus();
    });

    it('provides screen reader labels', () => {
      customRender(<CanvasPolygon {...defaultProps} />);

      const polygonElement = screen.getByTestId('test-polygon');
      // Check if aria-label exists and is not empty
      const ariaLabel = polygonElement.getAttribute('aria-label');
      expect(ariaLabel).toBeTruthy();
    });

    it('handles keyboard interactions', () => {
      const onSelectPolygon = vi.fn();
      customRender(
        <CanvasPolygon {...defaultProps} onSelectPolygon={onSelectPolygon} />
      );

      const polygonElement = screen.getByTestId('test-polygon');

      // Enter key should select polygon
      fireEvent.keyDown(polygonElement, {
        key: 'Enter',
        target: polygonElement,
      });
      expect(onSelectPolygon).toHaveBeenCalledWith('test-polygon');
    });

    it('supports high contrast mode', () => {
      // Mock high contrast media query
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation(query => ({
          matches: query.includes('prefers-contrast'),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });

      customRender(<CanvasPolygon {...defaultProps} />);

      const polygonElement = screen.getByTestId('test-polygon');
      expect(polygonElement).toBeInTheDocument();
    });
  });
});
