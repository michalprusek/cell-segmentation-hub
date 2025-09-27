/**
 * Comprehensive tests for event handling conflict resolution
 * Tests the specific issues reported: event bubbling conflicts, vertex vs polygon interactions
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CanvasPolygon from '../components/canvas/CanvasPolygon';
import CanvasContainer from '../components/canvas/CanvasContainer';
import { EditMode } from '../types';
import {
  createMockPolygon,
  simulateMouseInteraction,
} from '@/test-utils/segmentationTestUtils';
import type { Polygon } from '@/lib/segmentation';

// Mock dependencies
vi.mock('../components/canvas/PolygonVertices', () => ({
  default: ({ polygonId, points, onVertexClick, onVertexMouseDown }: any) => (
    <g data-testid={`polygon-vertices-${polygonId}`}>
      {points?.map((point: any, index: number) => (
        <circle
          key={index}
          data-testid={`vertex-${polygonId}-${index}`}
          data-vertex-index={index}
          data-polygon-id={polygonId}
          cx={point.x}
          cy={point.y}
          r="5"
          onClick={() => onVertexClick?.(index)}
          onMouseDown={e => {
            e.stopPropagation(); // Prevent event bubbling to polygon
            onVertexMouseDown?.(index);
          }}
          style={{ cursor: 'pointer' }}
        />
      )) || null}
    </g>
  ),
}));

vi.mock('../../context-menu/PolygonContextMenu', () => ({
  default: ({ children, polygonId, onDelete, onSlice, onEdit }: any) => (
    <g>
      {children}
      <g data-testid={`context-menu-${polygonId}`} style={{ display: 'none' }}>
        <rect
          data-testid={`delete-menu-${polygonId}`}
          onClick={() => onDelete?.()}
          width="50"
          height="20"
        />
        <rect
          data-testid={`slice-menu-${polygonId}`}
          onClick={() => onSlice?.()}
          width="50"
          height="20"
          y="20"
        />
        <rect
          data-testid={`edit-menu-${polygonId}`}
          onClick={() => onEdit?.()}
          width="50"
          height="20"
          y="40"
        />
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

describe('Event Handling Conflict Resolution', () => {
  let mockOnSelectPolygon: ReturnType<typeof vi.fn>;
  let mockOnDeletePolygon: ReturnType<typeof vi.fn>;
  let mockOnSlicePolygon: ReturnType<typeof vi.fn>;
  let mockOnEditPolygon: ReturnType<typeof vi.fn>;
  let mockOnDeleteVertex: ReturnType<typeof vi.fn>;
  let mockOnDuplicateVertex: ReturnType<typeof vi.fn>;
  let mockCanvasHandlers: {
    onMouseDown: ReturnType<typeof vi.fn>;
    onMouseMove: ReturnType<typeof vi.fn>;
    onMouseUp: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockOnSelectPolygon = vi.fn();
    mockOnDeletePolygon = vi.fn();
    mockOnSlicePolygon = vi.fn();
    mockOnEditPolygon = vi.fn();
    mockOnDeleteVertex = vi.fn();
    mockOnDuplicateVertex = vi.fn();
    mockCanvasHandlers = {
      onMouseDown: vi.fn(),
      onMouseMove: vi.fn(),
      onMouseUp: vi.fn(),
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to create a complex test polygon with vertices
  const createTestPolygon = (): Polygon =>
    createMockPolygon({
      id: 'test-polygon',
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
        { x: 100, y: 200 },
      ],
      type: 'external',
    });

  // Helper to render polygon with canvas container
  const renderPolygonWithCanvas = (
    polygon: Polygon,
    isSelected: boolean = false,
    editMode: EditMode = EditMode.View
  ) => {
    return render(
      <CanvasContainer
        editMode={editMode}
        onMouseDown={mockCanvasHandlers.onMouseDown}
        onMouseMove={mockCanvasHandlers.onMouseMove}
        onMouseUp={mockCanvasHandlers.onMouseUp}
        loading={false}
        slicingMode={editMode === EditMode.Slice}
        pointAddingMode={editMode === EditMode.AddPoints}
        deleteMode={editMode === EditMode.DeletePolygon}
      >
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            polygon={polygon}
            isSelected={isSelected}
            zoom={1}
            onSelectPolygon={mockOnSelectPolygon}
            onDeletePolygon={mockOnDeletePolygon}
            onSlicePolygon={mockOnSlicePolygon}
            onEditPolygon={mockOnEditPolygon}
            onDeleteVertex={mockOnDeleteVertex}
            onDuplicateVertex={mockOnDuplicateVertex}
          />
        </svg>
      </CanvasContainer>
    );
  };

  describe('Polygon vs Vertex Event Priority', () => {
    it('should prioritize vertex interaction over polygon selection', async () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, true);

      // Click on a vertex
      const vertex = screen.getByTestId('vertex-test-polygon-0');
      fireEvent.mouseDown(vertex);

      // Vertex interaction should not trigger polygon selection
      expect(mockOnSelectPolygon).not.toHaveBeenCalled();
      expect(mockOnDeleteVertex).not.toHaveBeenCalled(); // mouseDown doesn't delete, but should prevent polygon selection
    });

    it('should handle vertex click without triggering polygon selection', async () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, true);

      const vertex = screen.getByTestId('vertex-test-polygon-1');
      fireEvent.click(vertex);

      // Only vertex click should be handled, not polygon selection
      expect(mockOnSelectPolygon).not.toHaveBeenCalled();
    });

    it('should allow polygon selection when clicking polygon path (not vertex)', () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, false);

      const polygonElement = screen.getByTestId('test-polygon');
      const pathElement = polygonElement.querySelector('path')!;
      fireEvent.click(pathElement);

      expect(mockOnSelectPolygon).toHaveBeenCalledWith('test-polygon');
    });

    it('should handle vertex drag without polygon interference', async () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, true);

      const vertex = screen.getByTestId('vertex-test-polygon-2');

      // Simulate drag sequence
      fireEvent.mouseDown(vertex, { clientX: 200, clientY: 200 });
      fireEvent.mouseMove(vertex, { clientX: 210, clientY: 210 });
      fireEvent.mouseUp(vertex);

      // Canvas handlers should not be called for vertex drag
      expect(mockCanvasHandlers.onMouseDown).not.toHaveBeenCalled();
    });
  });

  describe('Event Bubbling Prevention', () => {
    it('should prevent polygon click from bubbling to canvas', () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, false);

      const polygonElement = screen.getByTestId('test-polygon');
      const pathElement = polygonElement.querySelector('path')!;
      fireEvent.click(pathElement);

      // Polygon selection should be called
      expect(mockOnSelectPolygon).toHaveBeenCalledWith('test-polygon');
      // Canvas handler should not be called due to stopPropagation
      expect(mockCanvasHandlers.onMouseDown).not.toHaveBeenCalled();
    });

    it('should prevent vertex mouseDown from bubbling to polygon', () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, true);

      const vertex = screen.getByTestId('vertex-test-polygon-0');
      fireEvent.mouseDown(vertex);

      // Neither polygon selection nor canvas handlers should be called
      expect(mockOnSelectPolygon).not.toHaveBeenCalled();
      expect(mockCanvasHandlers.onMouseDown).not.toHaveBeenCalled();
    });

    it('should allow canvas clicks when clicking empty areas', () => {
      const polygon = createTestPolygon();
      const { container } = renderPolygonWithCanvas(polygon, false);

      const canvasContainer =
        container.querySelector('[data-testid="canvas-container"]') ||
        (container.firstChild as HTMLElement);

      fireEvent.mouseDown(canvasContainer, { clientX: 50, clientY: 50 });

      // Canvas handler should be called for empty area clicks
      expect(mockCanvasHandlers.onMouseDown).toHaveBeenCalled();
      expect(mockOnSelectPolygon).not.toHaveBeenCalled();
    });
  });

  describe('Context Menu Event Handling', () => {
    it('should handle context menu without triggering other interactions', async () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, true);

      const polygonElement = screen.getByTestId('test-polygon');
      fireEvent.contextMenu(polygonElement);

      await waitFor(() => {
        expect(
          screen.getByTestId('context-menu-test-polygon')
        ).toBeInTheDocument();
      });

      // Context menu should not trigger selection
      expect(mockOnSelectPolygon).not.toHaveBeenCalled();
    });

    it('should handle context menu actions without event conflicts', async () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, true);

      const polygonElement = screen.getByTestId('test-polygon');
      fireEvent.contextMenu(polygonElement);

      await waitFor(() => {
        expect(
          screen.getByTestId('context-menu-test-polygon')
        ).toBeInTheDocument();
      });

      // Click delete in context menu
      const deleteButton = screen.getByTestId('delete-menu-test-polygon');
      fireEvent.click(deleteButton);

      expect(mockOnDeletePolygon).toHaveBeenCalledWith('test-polygon');
      expect(mockOnSelectPolygon).not.toHaveBeenCalled();
    });

    it('should handle slice action from context menu without conflicts', async () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, true);

      const polygonElement = screen.getByTestId('test-polygon');
      fireEvent.contextMenu(polygonElement);

      await waitFor(() => {
        expect(
          screen.getByTestId('context-menu-test-polygon')
        ).toBeInTheDocument();
      });

      // Click slice in context menu
      const sliceButton = screen.getByTestId('slice-menu-test-polygon');
      fireEvent.click(sliceButton);

      expect(mockOnSlicePolygon).toHaveBeenCalledWith('test-polygon');
      expect(mockOnSelectPolygon).not.toHaveBeenCalled();
    });
  });

  describe('Mode-Specific Event Handling', () => {
    it('should handle delete mode clicks without selection conflicts', () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, false, EditMode.DeletePolygon);

      const polygonElement = screen.getByTestId('test-polygon');
      const pathElement = polygonElement.querySelector('path')!;
      fireEvent.click(pathElement);

      // In delete mode, should call onSelectPolygon (which would trigger delete logic)
      expect(mockOnSelectPolygon).toHaveBeenCalledWith('test-polygon');
    });

    it('should handle slice mode clicks without selection conflicts', () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, false, EditMode.Slice);

      const polygonElement = screen.getByTestId('test-polygon');
      const pathElement = polygonElement.querySelector('path')!;
      fireEvent.click(pathElement);

      // In slice mode, should call onSelectPolygon (which would set up slicing)
      expect(mockOnSelectPolygon).toHaveBeenCalledWith('test-polygon');
    });

    it('should handle vertex interactions in edit mode without conflicts', () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, true, EditMode.EditVertices);

      const vertex = screen.getByTestId('vertex-test-polygon-0');
      fireEvent.mouseDown(vertex);

      // Vertex interaction should not trigger polygon selection
      expect(mockOnSelectPolygon).not.toHaveBeenCalled();
      expect(mockCanvasHandlers.onMouseDown).not.toHaveBeenCalled();
    });
  });

  describe('Complex Interaction Scenarios', () => {
    it('should handle rapid polygon and vertex clicks correctly', async () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, true);

      const polygonPath = screen
        .getByTestId('test-polygon')
        .querySelector('path')!;
      const vertex = screen.getByTestId('vertex-test-polygon-0');

      // Rapid sequence: polygon click, then vertex click
      fireEvent.click(polygonPath);
      fireEvent.click(vertex);

      // Only polygon selection should be called (vertex click prevents further propagation)
      expect(mockOnSelectPolygon).toHaveBeenCalledTimes(1);
      expect(mockOnSelectPolygon).toHaveBeenCalledWith('test-polygon');
    });

    it('should handle overlapping elements correctly', () => {
      const polygon1 = createTestPolygon();
      const polygon2 = createMockPolygon({
        id: 'overlapping-polygon',
        points: [
          { x: 150, y: 150 },
          { x: 250, y: 150 },
          { x: 250, y: 250 },
          { x: 150, y: 250 },
        ],
        type: 'external',
      });

      render(
        <CanvasContainer
          editMode={EditMode.View}
          onMouseDown={mockCanvasHandlers.onMouseDown}
          onMouseMove={mockCanvasHandlers.onMouseMove}
          onMouseUp={mockCanvasHandlers.onMouseUp}
          loading={false}
          slicingMode={false}
          pointAddingMode={false}
          deleteMode={false}
        >
          <svg width="800" height="600" viewBox="0 0 800 600">
            <CanvasPolygon
              polygon={polygon1}
              isSelected={false}
              zoom={1}
              onSelectPolygon={mockOnSelectPolygon}
              onDeletePolygon={mockOnDeletePolygon}
              onSlicePolygon={mockOnSlicePolygon}
              onEditPolygon={mockOnEditPolygon}
              onDeleteVertex={mockOnDeleteVertex}
              onDuplicateVertex={mockOnDuplicateVertex}
            />
            <CanvasPolygon
              polygon={polygon2}
              isSelected={false}
              zoom={1}
              onSelectPolygon={mockOnSelectPolygon}
              onDeletePolygon={mockOnDeletePolygon}
              onSlicePolygon={mockOnSlicePolygon}
              onEditPolygon={mockOnEditPolygon}
              onDeleteVertex={mockOnDeleteVertex}
              onDuplicateVertex={mockOnDuplicateVertex}
            />
          </svg>
        </CanvasContainer>
      );

      // Click on overlapping area - should select the polygon rendered last (top)
      const overlappingPolygon = screen.getByTestId('overlapping-polygon');
      const pathElement = overlappingPolygon.querySelector('path')!;
      fireEvent.click(pathElement);

      expect(mockOnSelectPolygon).toHaveBeenCalledWith('overlapping-polygon');
    });

    it('should handle keyboard events without interfering with mouse events', async () => {
      const polygon = createTestPolygon();
      const { container } = renderPolygonWithCanvas(polygon, true);
      const user = userEvent.setup();

      // Focus on canvas container
      const canvasContainer =
        container.querySelector('[data-testid="canvas-container"]') ||
        (container.firstChild as HTMLElement);
      canvasContainer.focus();

      // Press a key while hovering over polygon
      await user.keyboard('d'); // Delete key

      // Then click polygon
      const polygonPath = screen
        .getByTestId('test-polygon')
        .querySelector('path')!;
      fireEvent.click(polygonPath);

      // Polygon selection should still work normally
      expect(mockOnSelectPolygon).toHaveBeenCalledWith('test-polygon');
    });
  });

  describe('Event Order and Timing', () => {
    it('should handle mousedown -> mousemove -> mouseup sequence correctly', () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, false);

      const polygonPath = screen
        .getByTestId('test-polygon')
        .querySelector('path')!;

      // Simulate drag-like sequence on polygon
      fireEvent.mouseDown(polygonPath, { clientX: 150, clientY: 150 });
      fireEvent.mouseMove(polygonPath, { clientX: 160, clientY: 160 });
      fireEvent.mouseUp(polygonPath, { clientX: 160, clientY: 160 });

      // This should not trigger polygon selection (it's a drag, not a click)
      expect(mockOnSelectPolygon).not.toHaveBeenCalled();
    });

    it('should handle quick click without drag correctly', () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, false);

      const polygonPath = screen
        .getByTestId('test-polygon')
        .querySelector('path')!;

      // Quick click sequence
      fireEvent.mouseDown(polygonPath, { clientX: 150, clientY: 150 });
      fireEvent.mouseUp(polygonPath, { clientX: 150, clientY: 150 });
      fireEvent.click(polygonPath);

      // This should trigger polygon selection
      expect(mockOnSelectPolygon).toHaveBeenCalledWith('test-polygon');
    });

    it('should handle double-click events correctly', () => {
      const polygon = createTestPolygon();
      renderPolygonWithCanvas(polygon, false);

      const polygonPath = screen
        .getByTestId('test-polygon')
        .querySelector('path')!;
      fireEvent.doubleClick(polygonPath);

      // Double-click should trigger edit, not selection
      expect(mockOnEditPolygon).toHaveBeenCalledWith('test-polygon');
      expect(mockOnSelectPolygon).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle events on polygons with invalid data gracefully', () => {
      const invalidPolygon = createMockPolygon({
        id: 'invalid-polygon',
        points: [], // Empty points array
        type: 'external',
      });

      renderPolygonWithCanvas(invalidPolygon, false);

      const polygonElement = screen.getByTestId('invalid-polygon');

      // Should not throw error when clicking invalid polygon
      expect(() => {
        fireEvent.click(polygonElement);
      }).not.toThrow();
    });

    it('should handle events when callbacks are undefined', () => {
      const polygon = createTestPolygon();

      render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            polygon={polygon}
            isSelected={false}
            zoom={1}
            onSelectPolygon={undefined as any}
            onDeletePolygon={undefined as any}
            onSlicePolygon={undefined as any}
            onEditPolygon={undefined as any}
            onDeleteVertex={undefined as any}
            onDuplicateVertex={undefined as any}
          />
        </svg>
      );

      const polygonPath = screen
        .getByTestId('test-polygon')
        .querySelector('path')!;

      // Should not throw error when callbacks are undefined
      expect(() => {
        fireEvent.click(polygonPath);
        fireEvent.doubleClick(polygonPath);
        fireEvent.contextMenu(polygonPath);
      }).not.toThrow();
    });

    it('should handle events during component unmounting', () => {
      const polygon = createTestPolygon();
      const { unmount } = renderPolygonWithCanvas(polygon, false);

      const polygonPath = screen
        .getByTestId('test-polygon')
        .querySelector('path')!;

      // Start an interaction
      fireEvent.mouseDown(polygonPath);

      // Unmount component
      unmount();

      // Should not throw error if events continue after unmount
      expect(() => {
        fireEvent.mouseMove(document.body);
        fireEvent.mouseUp(document.body);
      }).not.toThrow();
    });
  });
});
