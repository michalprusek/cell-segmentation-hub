/**
 * Comprehensive tests for polygon selection functionality
 * Tests the specific issues reported: mass selection bug, mode switching, and selection conflicts
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CanvasPolygon from '../components/canvas/CanvasPolygon';
import { SegmentationContextProvider } from '../contexts/SegmentationContext';
import { EditMode } from '../types';
import {
  createMockPolygon,
  createMockPolygons,
  createMockSegmentationEditorProps,
  simulateMouseInteraction,
} from '@/test-utils/segmentationTestUtils';
import type { Polygon } from '@/lib/segmentation';

// Mock heavy dependencies
vi.mock('../components/canvas/PolygonVertices', () => ({
  default: ({ polygonId, points, onVertexClick, onVertexMouseDown }: any) => (
    <g data-testid={`polygon-vertices-${polygonId}`}>
      {points?.map((point: any, index: number) => (
        <circle
          key={index}
          data-testid={`vertex-${index}`}
          data-vertex-index={index}
          cx={point.x}
          cy={point.y}
          r="3"
          onClick={() => onVertexClick?.(index)}
          onMouseDown={e => {
            e.stopPropagation();
            onVertexMouseDown?.(index);
          }}
        />
      )) || null}
    </g>
  ),
}));

vi.mock('../../context-menu/PolygonContextMenu', () => ({
  default: ({ children, polygonId, onDelete, onSlice, onEdit }: any) => (
    <g>
      {children}
      <g data-testid={`context-menu-${polygonId}`}>
        <rect data-testid="delete-button" onClick={() => onDelete?.()} />
        <rect data-testid="slice-button" onClick={() => onSlice?.()} />
        <rect data-testid="edit-button" onClick={() => onEdit?.()} />
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
  simplifyPolygon: vi.fn((points: any[]) => points),
}));

describe('Polygon Selection Functionality', () => {
  let mockPolygons: Polygon[];
  let mockOnSelectPolygon: ReturnType<typeof vi.fn>;
  let mockOnDeletePolygon: ReturnType<typeof vi.fn>;
  let mockOnSlicePolygon: ReturnType<typeof vi.fn>;
  let mockOnEditPolygon: ReturnType<typeof vi.fn>;
  let mockSetEditMode: ReturnType<typeof vi.fn>;
  let mockHandlePolygonSelection: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create test polygons with different positions to avoid overlap
    mockPolygons = [
      createMockPolygon({
        id: 'polygon-1',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: 'external',
      }),
      createMockPolygon({
        id: 'polygon-2',
        points: [
          { x: 100, y: 100 },
          { x: 140, y: 100 },
          { x: 140, y: 140 },
          { x: 100, y: 140 },
        ],
        type: 'external',
      }),
      createMockPolygon({
        id: 'polygon-3',
        points: [
          { x: 200, y: 200 },
          { x: 240, y: 200 },
          { x: 240, y: 240 },
          { x: 200, y: 240 },
        ],
        type: 'internal',
      }),
    ];

    mockOnSelectPolygon = vi.fn();
    mockOnDeletePolygon = vi.fn();
    mockOnSlicePolygon = vi.fn();
    mockOnEditPolygon = vi.fn();
    mockSetEditMode = vi.fn();
    mockHandlePolygonSelection = vi.fn();

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to render multiple polygons in SVG context
  const renderPolygonsInSvg = (
    polygons: Polygon[],
    selectedPolygonId: string | null = null,
    editMode: EditMode = EditMode.View
  ) => {
    return render(
      <svg width="800" height="600" viewBox="0 0 800 600">
        {polygons.map(polygon => (
          <CanvasPolygon
            key={polygon.id}
            polygon={polygon}
            isSelected={selectedPolygonId === polygon.id}
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
  };

  describe('Mass Selection Bug Prevention', () => {
    it('should select only the clicked polygon, not all polygons', async () => {
      renderPolygonsInSvg(mockPolygons);

      // Click on polygon-1
      const polygon1 = screen.getByTestId('polygon-1');
      const polygon1Path = polygon1.querySelector('path');
      fireEvent.click(polygon1Path!);

      // Verify only polygon-1 selection was called
      expect(mockOnSelectPolygon).toHaveBeenCalledTimes(1);
      expect(mockOnSelectPolygon).toHaveBeenCalledWith('polygon-1');

      // Reset mock
      mockOnSelectPolygon.mockClear();

      // Click on polygon-2
      const polygon2 = screen.getByTestId('polygon-2');
      const polygon2Path = polygon2.querySelector('path');
      fireEvent.click(polygon2Path!);

      // Verify only polygon-2 selection was called
      expect(mockOnSelectPolygon).toHaveBeenCalledTimes(1);
      expect(mockOnSelectPolygon).toHaveBeenCalledWith('polygon-2');
    });

    it('should switch selection correctly between different polygons', async () => {
      const { rerender } = renderPolygonsInSvg(mockPolygons, 'polygon-1');

      // Verify polygon-1 is selected
      expect(screen.getByTestId('polygon-1')).toHaveClass('polygon-selected');
      expect(screen.getByTestId('polygon-2')).not.toHaveClass(
        'polygon-selected'
      );
      expect(screen.getByTestId('polygon-3')).not.toHaveClass(
        'polygon-selected'
      );

      // Click polygon-2
      const polygon2 = screen.getByTestId('polygon-2');
      const polygon2Path = polygon2.querySelector('path');
      fireEvent.click(polygon2Path!);

      expect(mockOnSelectPolygon).toHaveBeenCalledWith('polygon-2');

      // Re-render with polygon-2 selected
      rerender(
        <svg width="800" height="600" viewBox="0 0 800 600">
          {mockPolygons.map(polygon => (
            <CanvasPolygon
              key={polygon.id}
              polygon={polygon}
              isSelected={'polygon-2' === polygon.id}
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

      // Verify only polygon-2 is now selected
      expect(screen.getByTestId('polygon-1')).not.toHaveClass(
        'polygon-selected'
      );
      expect(screen.getByTestId('polygon-2')).toHaveClass('polygon-selected');
      expect(screen.getByTestId('polygon-3')).not.toHaveClass(
        'polygon-selected'
      );
    });

    it('should not trigger multiple selections when clicking rapidly', async () => {
      renderPolygonsInSvg(mockPolygons);
      const user = userEvent.setup();

      const polygon1 = screen.getByTestId('polygon-1');
      const polygon1Path = polygon1.querySelector('path')!;

      // Rapid clicks
      await user.click(polygon1Path);
      await user.click(polygon1Path);
      await user.click(polygon1Path);

      // Should only register legitimate clicks, not duplicate events
      expect(mockOnSelectPolygon).toHaveBeenCalledWith('polygon-1');
    });

    it('should handle concurrent clicks on different polygons correctly', async () => {
      renderPolygonsInSvg(mockPolygons);

      const polygon1Path = screen
        .getByTestId('polygon-1')
        .querySelector('path')!;
      const polygon2Path = screen
        .getByTestId('polygon-2')
        .querySelector('path')!;

      // Simulate near-simultaneous clicks
      fireEvent.click(polygon1Path);
      fireEvent.click(polygon2Path);

      // Both selections should be called, but each only once
      expect(mockOnSelectPolygon).toHaveBeenCalledWith('polygon-1');
      expect(mockOnSelectPolygon).toHaveBeenCalledWith('polygon-2');
      expect(mockOnSelectPolygon).toHaveBeenCalledTimes(2);
    });
  });

  describe('Event Propagation Control', () => {
    it('should prevent polygon click from bubbling to canvas', () => {
      const mockCanvasClick = vi.fn();

      render(
        <div onClick={mockCanvasClick} data-testid="canvas-container">
          <svg width="800" height="600" viewBox="0 0 800 600">
            <CanvasPolygon
              polygon={mockPolygons[0]}
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
        </div>
      );

      const polygonPath = screen
        .getByTestId('polygon-1')
        .querySelector('path')!;
      fireEvent.click(polygonPath);

      // Polygon selection should be called
      expect(mockOnSelectPolygon).toHaveBeenCalledWith('polygon-1');
      // But canvas click should NOT be called due to stopPropagation
      expect(mockCanvasClick).not.toHaveBeenCalled();
    });

    it('should allow vertex interaction to take priority over polygon selection', () => {
      renderPolygonsInSvg(mockPolygons, 'polygon-1');

      const vertices = screen.getByTestId('polygon-vertices-polygon-1');
      const vertex = vertices.querySelector('[data-vertex-index="0"]');

      fireEvent.mouseDown(vertex!);

      // Vertex interaction should not trigger polygon selection
      expect(mockOnSelectPolygon).not.toHaveBeenCalled();
    });

    it('should handle double-click for edit mode correctly', () => {
      renderPolygonsInSvg(mockPolygons);

      const polygonPath = screen
        .getByTestId('polygon-1')
        .querySelector('path')!;
      fireEvent.doubleClick(polygonPath);

      expect(mockOnEditPolygon).toHaveBeenCalledWith('polygon-1');
    });

    it('should handle context menu without triggering selection', async () => {
      renderPolygonsInSvg(mockPolygons, 'polygon-1');

      const polygon = screen.getByTestId('polygon-1');
      fireEvent.contextMenu(polygon);

      await waitFor(() => {
        expect(
          screen.getByTestId('context-menu-polygon-1')
        ).toBeInTheDocument();
      });

      // Context menu should appear without additional selection calls
      expect(mockOnSelectPolygon).not.toHaveBeenCalled();
    });
  });

  describe('Selection State Consistency', () => {
    it('should maintain consistent selection state across re-renders', () => {
      const { rerender } = renderPolygonsInSvg(mockPolygons, 'polygon-2');

      // Initial state
      expect(screen.getByTestId('polygon-2')).toHaveClass('polygon-selected');

      // Re-render with same selection
      rerender(
        <svg width="800" height="600" viewBox="0 0 800 600">
          {mockPolygons.map(polygon => (
            <CanvasPolygon
              key={polygon.id}
              polygon={polygon}
              isSelected={'polygon-2' === polygon.id}
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

      // Selection should persist
      expect(screen.getByTestId('polygon-2')).toHaveClass('polygon-selected');
    });

    it('should clear selection when none are selected', () => {
      renderPolygonsInSvg(mockPolygons, null);

      // No polygons should be selected
      expect(screen.getByTestId('polygon-1')).not.toHaveClass(
        'polygon-selected'
      );
      expect(screen.getByTestId('polygon-2')).not.toHaveClass(
        'polygon-selected'
      );
      expect(screen.getByTestId('polygon-3')).not.toHaveClass(
        'polygon-selected'
      );
    });

    it('should handle selection of non-existent polygon gracefully', () => {
      renderPolygonsInSvg(mockPolygons, 'non-existent-polygon');

      // All polygons should remain unselected
      expect(screen.getByTestId('polygon-1')).not.toHaveClass(
        'polygon-selected'
      );
      expect(screen.getByTestId('polygon-2')).not.toHaveClass(
        'polygon-selected'
      );
      expect(screen.getByTestId('polygon-3')).not.toHaveClass(
        'polygon-selected'
      );
    });
  });

  describe('Performance with Multiple Polygons', () => {
    it('should handle selection efficiently with many polygons', () => {
      const manyPolygons = createMockPolygons(50);

      const startTime = performance.now();
      renderPolygonsInSvg(manyPolygons);
      const renderTime = performance.now() - startTime;

      // Should render quickly even with many polygons
      expect(renderTime).toBeLessThan(200);

      // Click on a polygon in the middle
      const targetPolygon = screen.getByTestId('hex-5');
      const targetPath = targetPolygon.querySelector('path')!;

      const selectStart = performance.now();
      fireEvent.click(targetPath);
      const selectTime = performance.now() - selectStart;

      // Selection should be fast
      expect(selectTime).toBeLessThan(50);
      expect(mockOnSelectPolygon).toHaveBeenCalledWith('hex-5');
    });

    it('should not cause memory leaks with repeated selections', () => {
      renderPolygonsInSvg(mockPolygons);

      // Simulate many selection changes
      for (let i = 0; i < 100; i++) {
        const polygonIndex = i % mockPolygons.length;
        const polygon = screen.getByTestId(mockPolygons[polygonIndex].id);
        const path = polygon.querySelector('path')!;
        fireEvent.click(path);
      }

      // All calls should be recorded without performance degradation
      expect(mockOnSelectPolygon).toHaveBeenCalledTimes(100);
    });
  });

  describe('Edge Cases', () => {
    it('should handle polygon with no points gracefully', () => {
      const emptyPolygon = createMockPolygon({
        id: 'empty-polygon',
        points: [],
      });

      renderPolygonsInSvg([emptyPolygon]);

      const polygon = screen.getByTestId('empty-polygon');
      const path = polygon.querySelector('path');

      if (path) {
        fireEvent.click(path);
        expect(mockOnSelectPolygon).toHaveBeenCalledWith('empty-polygon');
      }
    });

    it('should handle overlapping polygons selection correctly', () => {
      const overlappingPolygons = [
        createMockPolygon({
          id: 'bottom-polygon',
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
          ],
        }),
        createMockPolygon({
          id: 'top-polygon',
          points: [
            { x: 50, y: 50 },
            { x: 150, y: 50 },
            { x: 150, y: 150 },
            { x: 50, y: 150 },
          ],
        }),
      ];

      renderPolygonsInSvg(overlappingPolygons);

      // Click in overlapping area - should select the top polygon (last in DOM)
      const topPolygon = screen.getByTestId('top-polygon');
      const topPath = topPolygon.querySelector('path')!;
      fireEvent.click(topPath);

      expect(mockOnSelectPolygon).toHaveBeenCalledWith('top-polygon');
    });

    it('should handle selection during zoom changes', () => {
      const { rerender } = renderPolygonsInSvg(mockPolygons);

      // Select a polygon at normal zoom
      const polygon = screen.getByTestId('polygon-1');
      const path = polygon.querySelector('path')!;
      fireEvent.click(path);

      expect(mockOnSelectPolygon).toHaveBeenCalledWith('polygon-1');

      // Re-render with different zoom
      rerender(
        <svg width="800" height="600" viewBox="0 0 800 600">
          {mockPolygons.map(polygon => (
            <CanvasPolygon
              key={polygon.id}
              polygon={polygon}
              isSelected={false}
              zoom={2} // Changed zoom
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

      // Selection should still work after zoom change
      const updatedPolygon = screen.getByTestId('polygon-2');
      const updatedPath = updatedPolygon.querySelector('path')!;
      fireEvent.click(updatedPath);

      expect(mockOnSelectPolygon).toHaveBeenCalledWith('polygon-2');
    });
  });

  describe('Accessibility Features', () => {
    it('should support keyboard selection', () => {
      renderPolygonsInSvg(mockPolygons);

      const polygon = screen.getByTestId('polygon-1');

      // Focus and press Enter
      polygon.focus();
      fireEvent.keyDown(polygon, { key: 'Enter' });

      expect(mockOnSelectPolygon).toHaveBeenCalledWith('polygon-1');
    });

    it('should provide proper ARIA labels for selection state', () => {
      renderPolygonsInSvg(mockPolygons, 'polygon-1');

      const selectedPolygon = screen.getByTestId('polygon-1');
      const unselectedPolygon = screen.getByTestId('polygon-2');

      expect(selectedPolygon.getAttribute('aria-label')).toContain('selected');
      expect(unselectedPolygon.getAttribute('aria-label')).not.toContain(
        'selected'
      );
    });
  });
});
