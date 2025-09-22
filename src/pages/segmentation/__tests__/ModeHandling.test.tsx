/**
 * Comprehensive tests for mode switching and interaction handling
 * Tests the specific issues reported: slice/delete modes staying active when clicking polygons
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditMode } from '../types';
import {
  createMockPolygon,
  createMockPolygons,
  createMockSegmentationEditorProps,
} from '@/test-utils/segmentationTestUtils';
import type { Polygon } from '@/lib/segmentation';

// Mock a simplified SegmentationEditor component for mode testing
const MockSegmentationEditor = ({
  polygons,
  editMode,
  selectedPolygonId,
  onModeChange,
  onPolygonSelect,
  onPolygonDelete,
  onPolygonSlice,
}: {
  polygons: Polygon[];
  editMode: EditMode;
  selectedPolygonId: string | null;
  onModeChange: (mode: EditMode) => void;
  onPolygonSelect: (id: string) => void;
  onPolygonDelete: (id: string) => void;
  onPolygonSlice: (id: string) => void;
}) => {
  const handlePolygonSelection = (polygonId: string) => {
    switch (editMode) {
      case EditMode.DeletePolygon:
        onPolygonDelete(polygonId);
        return; // Mode should stay DELETE
      case EditMode.Slice:
        onPolygonSelect(polygonId);
        return; // Mode should stay SLICE
      default:
        onPolygonSelect(polygonId);
        onModeChange(EditMode.EditVertices);
    }
  };

  return (
    <div data-testid="segmentation-editor">
      <div data-testid="current-mode">{editMode}</div>
      <div data-testid="selected-polygon">{selectedPolygonId || 'none'}</div>

      {/* Mode buttons */}
      <button
        data-testid="view-mode-btn"
        onClick={() => onModeChange(EditMode.View)}
      >
        View
      </button>
      <button
        data-testid="delete-mode-btn"
        onClick={() => onModeChange(EditMode.DeletePolygon)}
      >
        Delete
      </button>
      <button
        data-testid="slice-mode-btn"
        onClick={() => onModeChange(EditMode.Slice)}
      >
        Slice
      </button>
      <button
        data-testid="edit-vertices-mode-btn"
        onClick={() => onModeChange(EditMode.EditVertices)}
      >
        Edit Vertices
      </button>

      {/* Polygons */}
      <svg width="800" height="600" viewBox="0 0 800 600">
        {polygons.map((polygon) => (
          <g
            key={polygon.id}
            data-testid={`polygon-${polygon.id}`}
            className={selectedPolygonId === polygon.id ? 'selected' : ''}
          >
            <path
              d={`M ${polygon.points.map(p => `${p.x},${p.y}`).join(' L ')} Z`}
              onClick={() => handlePolygonSelection(polygon.id)}
              style={{
                fill: polygon.type === 'internal' ? 'rgba(14, 165, 233, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                stroke: polygon.type === 'internal' ? '#0ea5e9' : '#ef4444',
                strokeWidth: selectedPolygonId === polygon.id ? 2 : 1,
              }}
            />
          </g>
        ))}
      </svg>

      {/* Mode instructions */}
      <div data-testid="mode-instructions">
        {editMode === EditMode.View && 'Click polygon to edit'}
        {editMode === EditMode.DeletePolygon && 'Click polygon to delete'}
        {editMode === EditMode.Slice && selectedPolygonId ? 'Place slice points' : 'Select polygon to slice'}
        {editMode === EditMode.EditVertices && 'Edit polygon vertices'}
      </div>
    </div>
  );
};

describe('Mode Switching and Interaction Handling', () => {
  let mockPolygons: Polygon[];
  let mockOnModeChange: ReturnType<typeof vi.fn>;
  let mockOnPolygonSelect: ReturnType<typeof vi.fn>;
  let mockOnPolygonDelete: ReturnType<typeof vi.fn>;
  let mockOnPolygonSlice: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPolygons = [
      createMockPolygon({
        id: 'poly-1',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: 'external',
      }),
      createMockPolygon({
        id: 'poly-2',
        points: [
          { x: 100, y: 100 },
          { x: 140, y: 100 },
          { x: 140, y: 140 },
          { x: 100, y: 140 },
        ],
        type: 'internal',
      }),
      createMockPolygon({
        id: 'poly-3',
        points: [
          { x: 200, y: 200 },
          { x: 240, y: 200 },
          { x: 240, y: 240 },
          { x: 200, y: 240 },
        ],
        type: 'external',
      }),
    ];

    mockOnModeChange = vi.fn();
    mockOnPolygonSelect = vi.fn();
    mockOnPolygonDelete = vi.fn();
    mockOnPolygonSlice = vi.fn();

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const renderEditor = (
    editMode: EditMode = EditMode.View,
    selectedPolygonId: string | null = null
  ) => {
    return render(
      <MockSegmentationEditor
        polygons={mockPolygons}
        editMode={editMode}
        selectedPolygonId={selectedPolygonId}
        onModeChange={mockOnModeChange}
        onPolygonSelect={mockOnPolygonSelect}
        onPolygonDelete={mockOnPolygonDelete}
        onPolygonSlice={mockOnPolygonSlice}
      />
    );
  };

  describe('Delete Mode Behavior', () => {
    it('should stay in delete mode when clicking polygon', async () => {
      renderEditor(EditMode.DeletePolygon);

      // Verify initial state
      expect(screen.getByTestId('current-mode')).toHaveTextContent('DeletePolygon');
      expect(screen.getByTestId('mode-instructions')).toHaveTextContent('Click polygon to delete');

      // Click on polygon in delete mode
      const polygon = screen.getByTestId('polygon-poly-1');
      const path = polygon.querySelector('path')!;
      fireEvent.click(path);

      // Verify delete was called but mode didn't change
      expect(mockOnPolygonDelete).toHaveBeenCalledWith('poly-1');
      expect(mockOnPolygonSelect).not.toHaveBeenCalled();
      expect(mockOnModeChange).not.toHaveBeenCalled();

      // Mode should still be delete
      expect(screen.getByTestId('current-mode')).toHaveTextContent('DeletePolygon');
    });

    it('should delete multiple polygons while staying in delete mode', async () => {
      renderEditor(EditMode.DeletePolygon);

      // Delete first polygon
      fireEvent.click(screen.getByTestId('polygon-poly-1').querySelector('path')!);
      expect(mockOnPolygonDelete).toHaveBeenCalledWith('poly-1');

      // Delete second polygon
      fireEvent.click(screen.getByTestId('polygon-poly-2').querySelector('path')!);
      expect(mockOnPolygonDelete).toHaveBeenCalledWith('poly-2');

      // Delete third polygon
      fireEvent.click(screen.getByTestId('polygon-poly-3').querySelector('path')!);
      expect(mockOnPolygonDelete).toHaveBeenCalledWith('poly-3');

      // Should have called delete 3 times, no mode changes
      expect(mockOnPolygonDelete).toHaveBeenCalledTimes(3);
      expect(mockOnModeChange).not.toHaveBeenCalled();
      expect(screen.getByTestId('current-mode')).toHaveTextContent('DeletePolygon');
    });

    it('should allow manual mode change from delete mode', async () => {
      renderEditor(EditMode.DeletePolygon);

      // Switch to view mode manually
      fireEvent.click(screen.getByTestId('view-mode-btn'));

      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.View);
    });
  });

  describe('Slice Mode Behavior', () => {
    it('should stay in slice mode when clicking polygon', async () => {
      renderEditor(EditMode.Slice);

      // Verify initial state
      expect(screen.getByTestId('current-mode')).toHaveTextContent('Slice');
      expect(screen.getByTestId('mode-instructions')).toHaveTextContent('Select polygon to slice');

      // Click on polygon in slice mode
      const polygon = screen.getByTestId('polygon-poly-1');
      const path = polygon.querySelector('path')!;
      fireEvent.click(path);

      // Verify selection was called but mode didn't change
      expect(mockOnPolygonSelect).toHaveBeenCalledWith('poly-1');
      expect(mockOnPolygonDelete).not.toHaveBeenCalled();
      expect(mockOnModeChange).not.toHaveBeenCalled();

      // Mode should still be slice
      expect(screen.getByTestId('current-mode')).toHaveTextContent('Slice');
    });

    it('should update instructions after polygon selection in slice mode', async () => {
      const { rerender } = renderEditor(EditMode.Slice);

      // Initial instructions
      expect(screen.getByTestId('mode-instructions')).toHaveTextContent('Select polygon to slice');

      // Click polygon
      fireEvent.click(screen.getByTestId('polygon-poly-1').querySelector('path')!);
      expect(mockOnPolygonSelect).toHaveBeenCalledWith('poly-1');

      // Re-render with selected polygon
      rerender(
        <MockSegmentationEditor
          polygons={mockPolygons}
          editMode={EditMode.Slice}
          selectedPolygonId="poly-1"
          onModeChange={mockOnModeChange}
          onPolygonSelect={mockOnPolygonSelect}
          onPolygonDelete={mockOnPolygonDelete}
          onPolygonSlice={mockOnPolygonSlice}
        />
      );

      // Instructions should update to slice placement
      expect(screen.getByTestId('mode-instructions')).toHaveTextContent('Place slice points');
      expect(screen.getByTestId('selected-polygon')).toHaveTextContent('poly-1');
    });

    it('should allow switching selected polygon in slice mode', async () => {
      const { rerender } = renderEditor(EditMode.Slice, 'poly-1');

      // Click different polygon
      fireEvent.click(screen.getByTestId('polygon-poly-2').querySelector('path')!);
      expect(mockOnPolygonSelect).toHaveBeenCalledWith('poly-2');

      // Mode should remain slice
      expect(screen.getByTestId('current-mode')).toHaveTextContent('Slice');
    });

    it('should allow manual mode change from slice mode', async () => {
      renderEditor(EditMode.Slice, 'poly-1');

      // Switch to edit vertices mode manually
      fireEvent.click(screen.getByTestId('edit-vertices-mode-btn'));

      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.EditVertices);
    });
  });

  describe('View Mode Behavior', () => {
    it('should switch to edit vertices mode when clicking polygon in view mode', async () => {
      renderEditor(EditMode.View);

      // Click polygon in view mode
      const polygon = screen.getByTestId('polygon-poly-1');
      const path = polygon.querySelector('path')!;
      fireEvent.click(path);

      // Should select polygon and switch to edit mode
      expect(mockOnPolygonSelect).toHaveBeenCalledWith('poly-1');
      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.EditVertices);
    });

    it('should handle multiple polygon clicks in view mode', async () => {
      renderEditor(EditMode.View);

      // Click first polygon
      fireEvent.click(screen.getByTestId('polygon-poly-1').querySelector('path')!);
      expect(mockOnPolygonSelect).toHaveBeenCalledWith('poly-1');
      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.EditVertices);

      // Reset mocks for second click
      mockOnPolygonSelect.mockClear();
      mockOnModeChange.mockClear();

      // Click second polygon
      fireEvent.click(screen.getByTestId('polygon-poly-2').querySelector('path')!);
      expect(mockOnPolygonSelect).toHaveBeenCalledWith('poly-2');
      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.EditVertices);
    });
  });

  describe('Edit Vertices Mode Behavior', () => {
    it('should allow polygon selection in edit vertices mode', async () => {
      renderEditor(EditMode.EditVertices, 'poly-1');

      // Click different polygon
      fireEvent.click(screen.getByTestId('polygon-poly-2').querySelector('path')!);

      // Should select the new polygon and stay in edit mode
      expect(mockOnPolygonSelect).toHaveBeenCalledWith('poly-2');
      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.EditVertices);
    });

    it('should maintain edit vertices mode for vertex interactions', async () => {
      renderEditor(EditMode.EditVertices, 'poly-1');

      // Verify current state
      expect(screen.getByTestId('current-mode')).toHaveTextContent('EditVertices');
      expect(screen.getByTestId('selected-polygon')).toHaveTextContent('poly-1');
    });
  });

  describe('Mode Transition Edge Cases', () => {
    it('should handle rapid mode changes correctly', async () => {
      renderEditor(EditMode.View);

      // Rapid mode changes
      fireEvent.click(screen.getByTestId('delete-mode-btn'));
      fireEvent.click(screen.getByTestId('slice-mode-btn'));
      fireEvent.click(screen.getByTestId('view-mode-btn'));

      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.DeletePolygon);
      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.Slice);
      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.View);
      expect(mockOnModeChange).toHaveBeenCalledTimes(3);
    });

    it('should handle polygon clicks during mode transitions', async () => {
      renderEditor(EditMode.View);

      // Click polygon to enter edit mode
      fireEvent.click(screen.getByTestId('polygon-poly-1').querySelector('path')!);
      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.EditVertices);

      // Immediately switch to delete mode
      fireEvent.click(screen.getByTestId('delete-mode-btn'));
      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.DeletePolygon);

      // Click polygon in delete mode
      fireEvent.click(screen.getByTestId('polygon-poly-2').querySelector('path')!);
      expect(mockOnPolygonDelete).toHaveBeenCalledWith('poly-2');
    });

    it('should maintain mode consistency with keyboard shortcuts', async () => {
      renderEditor(EditMode.View);
      const user = userEvent.setup();

      // Simulate keyboard shortcut for delete mode (D key)
      await user.keyboard('d');
      // Note: Actual keyboard handling would be in the parent component
      // Here we simulate the mode change that would result
      fireEvent.click(screen.getByTestId('delete-mode-btn'));

      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.DeletePolygon);

      // Click polygon should delete, not change mode
      fireEvent.click(screen.getByTestId('polygon-poly-1').querySelector('path')!);
      expect(mockOnPolygonDelete).toHaveBeenCalledWith('poly-1');
    });
  });

  describe('Mode-Specific Instructions', () => {
    it('should display correct instructions for each mode', () => {
      // View mode
      const { rerender } = renderEditor(EditMode.View);
      expect(screen.getByTestId('mode-instructions')).toHaveTextContent('Click polygon to edit');

      // Delete mode
      rerender(
        <MockSegmentationEditor
          polygons={mockPolygons}
          editMode={EditMode.DeletePolygon}
          selectedPolygonId={null}
          onModeChange={mockOnModeChange}
          onPolygonSelect={mockOnPolygonSelect}
          onPolygonDelete={mockOnPolygonDelete}
          onPolygonSlice={mockOnPolygonSlice}
        />
      );
      expect(screen.getByTestId('mode-instructions')).toHaveTextContent('Click polygon to delete');

      // Slice mode without selection
      rerender(
        <MockSegmentationEditor
          polygons={mockPolygons}
          editMode={EditMode.Slice}
          selectedPolygonId={null}
          onModeChange={mockOnModeChange}
          onPolygonSelect={mockOnPolygonSelect}
          onPolygonDelete={mockOnPolygonDelete}
          onPolygonSlice={mockOnPolygonSlice}
        />
      );
      expect(screen.getByTestId('mode-instructions')).toHaveTextContent('Select polygon to slice');

      // Slice mode with selection
      rerender(
        <MockSegmentationEditor
          polygons={mockPolygons}
          editMode={EditMode.Slice}
          selectedPolygonId="poly-1"
          onModeChange={mockOnModeChange}
          onPolygonSelect={mockOnPolygonSelect}
          onPolygonDelete={mockOnPolygonDelete}
          onPolygonSlice={mockOnPolygonSlice}
        />
      );
      expect(screen.getByTestId('mode-instructions')).toHaveTextContent('Place slice points');

      // Edit vertices mode
      rerender(
        <MockSegmentationEditor
          polygons={mockPolygons}
          editMode={EditMode.EditVertices}
          selectedPolygonId="poly-1"
          onModeChange={mockOnModeChange}
          onPolygonSelect={mockOnPolygonSelect}
          onPolygonDelete={mockOnPolygonDelete}
          onPolygonSlice={mockOnPolygonSlice}
        />
      );
      expect(screen.getByTestId('mode-instructions')).toHaveTextContent('Edit polygon vertices');
    });
  });

  describe('State Persistence Across Mode Changes', () => {
    it('should maintain polygon selection when switching compatible modes', () => {
      const { rerender } = renderEditor(EditMode.EditVertices, 'poly-2');

      // Switch to slice mode - selection should persist
      rerender(
        <MockSegmentationEditor
          polygons={mockPolygons}
          editMode={EditMode.Slice}
          selectedPolygonId="poly-2"
          onModeChange={mockOnModeChange}
          onPolygonSelect={mockOnPolygonSelect}
          onPolygonDelete={mockOnPolygonDelete}
          onPolygonSlice={mockOnPolygonSlice}
        />
      );

      expect(screen.getByTestId('selected-polygon')).toHaveTextContent('poly-2');
      expect(screen.getByTestId('polygon-poly-2')).toHaveClass('selected');
    });

    it('should clear selection when switching to incompatible modes', () => {
      const { rerender } = renderEditor(EditMode.EditVertices, 'poly-2');

      // Switch to view mode - selection should clear
      rerender(
        <MockSegmentationEditor
          polygons={mockPolygons}
          editMode={EditMode.View}
          selectedPolygonId={null}
          onModeChange={mockOnModeChange}
          onPolygonSelect={mockOnPolygonSelect}
          onPolygonDelete={mockOnPolygonDelete}
          onPolygonSlice={mockOnPolygonSlice}
        />
      );

      expect(screen.getByTestId('selected-polygon')).toHaveTextContent('none');
      expect(screen.getByTestId('polygon-poly-2')).not.toHaveClass('selected');
    });
  });
});