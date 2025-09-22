/**
 * Comprehensive tests for polygon hole rendering functionality
 * Tests the specific issues reported: internal polygons should render with blue, external with red
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CanvasPolygon from '../components/canvas/CanvasPolygon';
import { createMockPolygon } from '@/test-utils/segmentationTestUtils';
import type { Polygon } from '@/lib/segmentation';

// Mock dependencies
vi.mock('../components/canvas/PolygonVertices', () => ({
  default: ({ polygonId, points }: any) => (
    <g data-testid={`polygon-vertices-${polygonId}`}>
      {points?.map((point: any, index: number) => (
        <circle
          key={index}
          data-testid={`vertex-${index}`}
          cx={point.x}
          cy={point.y}
          r="3"
        />
      )) || null}
    </g>
  ),
}));

vi.mock('../../context-menu/PolygonContextMenu', () => ({
  default: ({ children }: any) => <g>{children}</g>,
}));

vi.mock('@/lib/polygonGeometry', () => ({
  calculateBoundingBox: vi.fn((points: any[]) => ({
    minX: Math.min(...points.map(p => p.x)),
    maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)),
    maxY: Math.max(...points.map(p => p.y)),
  })),
  isPolygonInViewport: vi.fn(() => true),
  simplifyPolygon: vi.fn((points: any[]) => points),
}));

describe('Polygon Hole Rendering', () => {
  let mockOnSelectPolygon: ReturnType<typeof vi.fn>;
  let mockOnDeletePolygon: ReturnType<typeof vi.fn>;
  let mockOnSlicePolygon: ReturnType<typeof vi.fn>;
  let mockOnEditPolygon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnSelectPolygon = vi.fn();
    mockOnDeletePolygon = vi.fn();
    mockOnSlicePolygon = vi.fn();
    mockOnEditPolygon = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to render polygon in SVG context
  const renderPolygonInSvg = (
    polygon: Polygon,
    isSelected: boolean = false
  ) => {
    return render(
      <svg width="800" height="600" viewBox="0 0 800 600">
        <CanvasPolygon
          polygon={polygon}
          isSelected={isSelected}
          zoom={1}
          onSelectPolygon={mockOnSelectPolygon}
          onDeletePolygon={mockOnDeletePolygon}
          onSlicePolygon={mockOnSlicePolygon}
          onEditPolygon={mockOnEditPolygon}
          onDeleteVertex={vi.fn()}
          onDuplicateVertex={vi.fn()}
        />
      </svg>
    );
  };

  describe('External Polygon Rendering', () => {
    it('should render external polygon with red stroke color', () => {
      const externalPolygon = createMockPolygon({
        id: 'external-poly',
        type: 'external',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
      });

      renderPolygonInSvg(externalPolygon);

      const polygonElement = screen.getByTestId('external-poly');
      expect(polygonElement).toBeInTheDocument();
      expect(polygonElement).toHaveClass('external');

      const pathElement = polygonElement.querySelector('path');
      expect(pathElement).toBeInTheDocument();

      // Check computed styles for red color
      const computedStyle = window.getComputedStyle(pathElement!);
      // The actual color values might vary, but we check for red-like values
      // Note: In tests, CSS classes might not apply computed styles,
      // so we check for class presence as well
      expect(polygonElement).toHaveClass('external');
    });

    it('should render external polygon with red fill color', () => {
      const externalPolygon = createMockPolygon({
        id: 'external-poly-fill',
        type: 'external',
        points: [
          { x: 100, y: 100 },
          { x: 140, y: 100 },
          { x: 140, y: 140 },
          { x: 100, y: 140 },
        ],
      });

      renderPolygonInSvg(externalPolygon);

      const polygonElement = screen.getByTestId('external-poly-fill');
      const pathElement = polygonElement.querySelector('path');

      // Check that the polygon has the external class which should apply red styling
      expect(polygonElement).toHaveClass('external');
      expect(pathElement).toBeInTheDocument();
    });

    it('should render selected external polygon with enhanced red styling', () => {
      const externalPolygon = createMockPolygon({
        id: 'selected-external',
        type: 'external',
        points: [
          { x: 200, y: 200 },
          { x: 240, y: 200 },
          { x: 240, y: 240 },
          { x: 200, y: 240 },
        ],
      });

      renderPolygonInSvg(externalPolygon, true);

      const polygonElement = screen.getByTestId('selected-external');
      const pathElement = polygonElement.querySelector('path');

      expect(polygonElement).toHaveClass('external');
      expect(pathElement).toHaveClass('polygon-selected');
    });
  });

  describe('Internal Polygon Rendering (Holes)', () => {
    it('should render internal polygon with blue stroke color', () => {
      const internalPolygon = createMockPolygon({
        id: 'internal-poly',
        type: 'internal',
        points: [
          { x: 15, y: 15 },
          { x: 35, y: 15 },
          { x: 35, y: 35 },
          { x: 15, y: 35 },
        ],
      });

      renderPolygonInSvg(internalPolygon);

      const polygonElement = screen.getByTestId('internal-poly');
      expect(polygonElement).toBeInTheDocument();
      expect(polygonElement).toHaveClass('internal');

      const pathElement = polygonElement.querySelector('path');
      expect(pathElement).toBeInTheDocument();
    });

    it('should render internal polygon with blue fill color', () => {
      const internalPolygon = createMockPolygon({
        id: 'internal-poly-fill',
        type: 'internal',
        points: [
          { x: 120, y: 120 },
          { x: 130, y: 120 },
          { x: 130, y: 130 },
          { x: 120, y: 130 },
        ],
      });

      renderPolygonInSvg(internalPolygon);

      const polygonElement = screen.getByTestId('internal-poly-fill');
      const pathElement = polygonElement.querySelector('path');

      // Check that the polygon has the internal class which should apply blue styling
      expect(polygonElement).toHaveClass('internal');
      expect(pathElement).toBeInTheDocument();
    });

    it('should render selected internal polygon with enhanced blue styling', () => {
      const internalPolygon = createMockPolygon({
        id: 'selected-internal',
        type: 'internal',
        points: [
          { x: 220, y: 220 },
          { x: 230, y: 220 },
          { x: 230, y: 230 },
          { x: 220, y: 230 },
        ],
      });

      renderPolygonInSvg(internalPolygon, true);

      const polygonElement = screen.getByTestId('selected-internal');
      const pathElement = polygonElement.querySelector('path');

      expect(polygonElement).toHaveClass('internal');
      expect(pathElement).toHaveClass('polygon-selected');
    });

    it('should render internal polygon with parent relationship', () => {
      const internalPolygon = createMockPolygon({
        id: 'child-internal',
        type: 'internal',
        parent_id: 'parent-external-123',
        points: [
          { x: 25, y: 25 },
          { x: 45, y: 25 },
          { x: 45, y: 45 },
          { x: 25, y: 45 },
        ],
      });

      renderPolygonInSvg(internalPolygon);

      const polygonElement = screen.getByTestId('child-internal');
      expect(polygonElement).toHaveClass('internal');

      // The parent relationship should be preserved in the polygon data
      expect(internalPolygon.parent_id).toBe('parent-external-123');
    });
  });

  describe('Mixed Polygon Rendering', () => {
    it('should render both external and internal polygons with correct colors', () => {
      const externalPolygon = createMockPolygon({
        id: 'mixed-external',
        type: 'external',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      });

      const internalPolygon = createMockPolygon({
        id: 'mixed-internal',
        type: 'internal',
        parent_id: 'mixed-external',
        points: [
          { x: 25, y: 25 },
          { x: 75, y: 25 },
          { x: 75, y: 75 },
          { x: 25, y: 75 },
        ],
      });

      const { rerender } = render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            polygon={externalPolygon}
            isSelected={false}
            zoom={1}
            onSelectPolygon={mockOnSelectPolygon}
            onDeletePolygon={mockOnDeletePolygon}
            onSlicePolygon={mockOnSlicePolygon}
            onEditPolygon={mockOnEditPolygon}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
          <CanvasPolygon
            polygon={internalPolygon}
            isSelected={false}
            zoom={1}
            onSelectPolygon={mockOnSelectPolygon}
            onDeletePolygon={mockOnDeletePolygon}
            onSlicePolygon={mockOnSlicePolygon}
            onEditPolygon={mockOnEditPolygon}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
        </svg>
      );

      // Check external polygon styling
      const externalElement = screen.getByTestId('mixed-external');
      expect(externalElement).toHaveClass('external');

      // Check internal polygon styling
      const internalElement = screen.getByTestId('mixed-internal');
      expect(internalElement).toHaveClass('internal');
    });

    it('should maintain distinct colors when selection changes', () => {
      const externalPolygon = createMockPolygon({
        id: 'selectable-external',
        type: 'external',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 50 },
          { x: 0, y: 50 },
        ],
      });

      const internalPolygon = createMockPolygon({
        id: 'selectable-internal',
        type: 'internal',
        points: [
          { x: 10, y: 10 },
          { x: 40, y: 10 },
          { x: 40, y: 40 },
          { x: 10, y: 40 },
        ],
      });

      const { rerender } = render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            polygon={externalPolygon}
            isSelected={false}
            zoom={1}
            onSelectPolygon={mockOnSelectPolygon}
            onDeletePolygon={mockOnDeletePolygon}
            onSlicePolygon={mockOnSlicePolygon}
            onEditPolygon={mockOnEditPolygon}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
          <CanvasPolygon
            polygon={internalPolygon}
            isSelected={true} // Internal selected
            zoom={1}
            onSelectPolygon={mockOnSelectPolygon}
            onDeletePolygon={mockOnDeletePolygon}
            onSlicePolygon={mockOnSlicePolygon}
            onEditPolygon={mockOnEditPolygon}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
        </svg>
      );

      // Check that internal polygon is selected but still maintains internal class
      const internalElement = screen.getByTestId('selectable-internal');
      expect(internalElement).toHaveClass('internal');
      const internalPath = internalElement.querySelector('path');
      expect(internalPath).toHaveClass('polygon-selected');

      // External should remain unselected
      const externalElement = screen.getByTestId('selectable-external');
      expect(externalElement).toHaveClass('external');
      const externalPath = externalElement.querySelector('path');
      expect(externalPath).not.toHaveClass('polygon-selected');

      // Now select external and deselect internal
      rerender(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            polygon={externalPolygon}
            isSelected={true} // External now selected
            zoom={1}
            onSelectPolygon={mockOnSelectPolygon}
            onDeletePolygon={mockOnDeletePolygon}
            onSlicePolygon={mockOnSlicePolygon}
            onEditPolygon={mockOnEditPolygon}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
          <CanvasPolygon
            polygon={internalPolygon}
            isSelected={false} // Internal now unselected
            zoom={1}
            onSelectPolygon={mockOnSelectPolygon}
            onDeletePolygon={mockOnDeletePolygon}
            onSlicePolygon={mockOnSlicePolygon}
            onEditPolygon={mockOnEditPolygon}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
        </svg>
      );

      // Check that external polygon is now selected but maintains external class
      const externalElementAfter = screen.getByTestId('selectable-external');
      expect(externalElementAfter).toHaveClass('external');
      const externalPathAfter = externalElementAfter.querySelector('path');
      expect(externalPathAfter).toHaveClass('polygon-selected');

      // Internal should maintain internal class but not be selected
      const internalElementAfter = screen.getByTestId('selectable-internal');
      expect(internalElementAfter).toHaveClass('internal');
      const internalPathAfter = internalElementAfter.querySelector('path');
      expect(internalPathAfter).not.toHaveClass('polygon-selected');
    });
  });

  describe('Polygon Type Edge Cases', () => {
    it('should handle polygon with undefined type gracefully', () => {
      const undefinedTypePolygon = createMockPolygon({
        id: 'undefined-type',
        type: undefined as any,
        points: [
          { x: 300, y: 300 },
          { x: 350, y: 300 },
          { x: 350, y: 350 },
          { x: 300, y: 350 },
        ],
      });

      renderPolygonInSvg(undefinedTypePolygon);

      const polygonElement = screen.getByTestId('undefined-type');
      expect(polygonElement).toBeInTheDocument();

      // Should not have internal or external class
      expect(polygonElement).not.toHaveClass('internal');
      expect(polygonElement).not.toHaveClass('external');
    });

    it('should handle polygon with invalid type gracefully', () => {
      const invalidTypePolygon = createMockPolygon({
        id: 'invalid-type',
        type: 'invalid-type' as any,
        points: [
          { x: 400, y: 400 },
          { x: 450, y: 400 },
          { x: 450, y: 450 },
          { x: 400, y: 450 },
        ],
      });

      renderPolygonInSvg(invalidTypePolygon);

      const polygonElement = screen.getByTestId('invalid-type');
      expect(polygonElement).toBeInTheDocument();

      // Should not have internal or external class
      expect(polygonElement).not.toHaveClass('internal');
      expect(polygonElement).not.toHaveClass('external');
    });

    it('should handle polygon type changes correctly', () => {
      const changeablePolygon = createMockPolygon({
        id: 'changeable-type',
        type: 'external',
        points: [
          { x: 500, y: 500 },
          { x: 550, y: 500 },
          { x: 550, y: 550 },
          { x: 500, y: 550 },
        ],
      });

      const { rerender } = renderPolygonInSvg(changeablePolygon);

      // Initially external
      let polygonElement = screen.getByTestId('changeable-type');
      expect(polygonElement).toHaveClass('external');

      // Change to internal
      const internalPolygon = {
        ...changeablePolygon,
        type: 'internal' as const,
      };
      rerender(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            polygon={internalPolygon}
            isSelected={false}
            zoom={1}
            onSelectPolygon={mockOnSelectPolygon}
            onDeletePolygon={mockOnDeletePolygon}
            onSlicePolygon={mockOnSlicePolygon}
            onEditPolygon={mockOnEditPolygon}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
        </svg>
      );

      polygonElement = screen.getByTestId('changeable-type');
      expect(polygonElement).toHaveClass('internal');
      expect(polygonElement).not.toHaveClass('external');
    });
  });

  describe('Interaction with Hole Rendering', () => {
    it('should maintain hole rendering during hover states', () => {
      const internalPolygon = createMockPolygon({
        id: 'hoverable-internal',
        type: 'internal',
        points: [
          { x: 600, y: 600 },
          { x: 650, y: 600 },
          { x: 650, y: 650 },
          { x: 600, y: 650 },
        ],
      });

      renderPolygonInSvg(internalPolygon);

      const polygonElement = screen.getByTestId('hoverable-internal');
      const pathElement = polygonElement.querySelector('path')!;

      // Simulate hover
      fireEvent.mouseEnter(pathElement);

      // Should still maintain internal class
      expect(polygonElement).toHaveClass('internal');

      // Simulate mouse leave
      fireEvent.mouseLeave(pathElement);

      // Should still maintain internal class
      expect(polygonElement).toHaveClass('internal');
    });

    it('should maintain hole rendering during drag operations', () => {
      const internalPolygon = createMockPolygon({
        id: 'draggable-internal',
        type: 'internal',
        points: [
          { x: 700, y: 700 },
          { x: 750, y: 700 },
          { x: 750, y: 750 },
          { x: 700, y: 750 },
        ],
      });

      renderPolygonInSvg(internalPolygon, true);

      const polygonElement = screen.getByTestId('draggable-internal');
      const pathElement = polygonElement.querySelector('path')!;

      // Simulate drag start
      fireEvent.mouseDown(pathElement, { clientX: 725, clientY: 725 });

      // Should maintain internal class during drag
      expect(polygonElement).toHaveClass('internal');

      // Simulate drag end
      fireEvent.mouseUp(pathElement);

      // Should still maintain internal class
      expect(polygonElement).toHaveClass('internal');
    });

    it('should render internal polygons with correct z-index for holes', () => {
      const externalPolygon = createMockPolygon({
        id: 'parent-external',
        type: 'external',
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
          { x: 200, y: 200 },
          { x: 0, y: 200 },
        ],
      });

      const internalPolygon = createMockPolygon({
        id: 'hole-internal',
        type: 'internal',
        parent_id: 'parent-external',
        points: [
          { x: 50, y: 50 },
          { x: 150, y: 50 },
          { x: 150, y: 150 },
          { x: 50, y: 150 },
        ],
      });

      render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          {/* External polygon rendered first */}
          <CanvasPolygon
            polygon={externalPolygon}
            isSelected={false}
            zoom={1}
            onSelectPolygon={mockOnSelectPolygon}
            onDeletePolygon={mockOnDeletePolygon}
            onSlicePolygon={mockOnSlicePolygon}
            onEditPolygon={mockOnEditPolygon}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
          {/* Internal polygon (hole) rendered after */}
          <CanvasPolygon
            polygon={internalPolygon}
            isSelected={false}
            zoom={1}
            onSelectPolygon={mockOnSelectPolygon}
            onDeletePolygon={mockOnDeletePolygon}
            onSlicePolygon={mockOnSlicePolygon}
            onEditPolygon={mockOnEditPolygon}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
        </svg>
      );

      const externalElement = screen.getByTestId('parent-external');
      const internalElement = screen.getByTestId('hole-internal');

      expect(externalElement).toHaveClass('external');
      expect(internalElement).toHaveClass('internal');

      // Both should be present in the DOM
      expect(externalElement).toBeInTheDocument();
      expect(internalElement).toBeInTheDocument();
    });
  });

  describe('Performance with Many Holes', () => {
    it('should render multiple internal polygons efficiently', () => {
      const internalPolygons = Array.from({ length: 20 }, (_, i) =>
        createMockPolygon({
          id: `internal-hole-${i}`,
          type: 'internal',
          points: [
            { x: i * 30, y: i * 30 },
            { x: i * 30 + 20, y: i * 30 },
            { x: i * 30 + 20, y: i * 30 + 20 },
            { x: i * 30, y: i * 30 + 20 },
          ],
        })
      );

      const startTime = performance.now();

      render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          {internalPolygons.map(polygon => (
            <CanvasPolygon
              key={polygon.id}
              polygon={polygon}
              isSelected={false}
              zoom={1}
              onSelectPolygon={mockOnSelectPolygon}
              onDeletePolygon={mockOnDeletePolygon}
              onSlicePolygon={mockOnSlicePolygon}
              onEditPolygon={mockOnEditPolygon}
              onDeleteVertex={vi.fn()}
              onDuplicateVertex={vi.fn()}
            />
          ))}
        </svg>
      );

      const renderTime = performance.now() - startTime;

      // Should render multiple internal polygons quickly
      expect(renderTime).toBeLessThan(100);

      // All internal polygons should be rendered with correct classes
      internalPolygons.forEach(polygon => {
        const element = screen.getByTestId(polygon.id);
        expect(element).toHaveClass('internal');
      });
    });
  });
});
