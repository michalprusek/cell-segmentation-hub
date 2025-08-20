import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useEnhancedSegmentationEditor } from '../useEnhancedSegmentationEditor';
import { EditMode } from '../../types';
import { Polygon } from '@/lib/segmentation';

// Mock dependencies
vi.mock('../useAdvancedInteractions', () => ({
  useAdvancedInteractions: vi.fn(() => ({
    handleMouseDown: vi.fn(),
    handleMouseMove: vi.fn(),
    handleMouseUp: vi.fn(),
  })),
}));

vi.mock('../usePolygonSlicing', () => ({
  usePolygonSlicing: vi.fn(() => ({
    startSlicing: vi.fn(),
    completeSlicing: vi.fn(),
  })),
}));

vi.mock('../useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(() => ({
    isShiftPressed: false,
    isCtrlPressed: false,
    isAltPressed: false,
  })),
}));

vi.mock('@/lib/coordinateUtils', () => ({
  calculateCenteringTransform: vi.fn(() => ({
    zoom: 1,
    translateX: 0,
    translateY: 0,
  })),
  calculateFixedPointZoom: vi.fn((transform, point, factor) => ({
    ...transform,
    zoom: transform.zoom * factor,
  })),
  constrainTransform: vi.fn(transform => transform),
}));

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useEnhancedSegmentationEditor', () => {
  const mockPolygon: Polygon = {
    id: 'polygon-1',
    points: [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 50 },
      { x: 10, y: 50 },
    ],
    confidence: 0.9,
    type: 'external',
  };

  const defaultProps = {
    initialPolygons: [mockPolygon],
    imageWidth: 1000,
    imageHeight: 800,
    canvasWidth: 800,
    canvasHeight: 600,
    onSave: vi.fn(),
    onPolygonsChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('initializes with correct default state', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(defaultProps)
      );

      expect(result.current.polygons).toEqual([mockPolygon]);
      expect(result.current.selectedPolygonId).toBeNull();
      expect(result.current.editMode).toBe(EditMode.View);
      expect(result.current.tempPoints).toEqual([]);
      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(false);
      expect(result.current.isSaving).toBe(false);
    });

    it('initializes with empty polygons when not provided', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...defaultProps, initialPolygons: [] })
      );

      expect(result.current.polygons).toEqual([]);
    });

    it('sets up correct transform state', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(defaultProps)
      );

      expect(result.current.transform).toEqual({
        zoom: 1,
        translateX: 0,
        translateY: 0,
      });
    });
  });

  describe('Polygon Management', () => {
    it('updates polygons and tracks history', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(defaultProps)
      );

      const newPolygon: Polygon = {
        id: 'polygon-2',
        points: [
          { x: 60, y: 60 },
          { x: 100, y: 60 },
          { x: 100, y: 100 },
          { x: 60, y: 100 },
        ],
        confidence: 0.8,
        type: 'external',
      };

      act(() => {
        result.current.updatePolygons([mockPolygon, newPolygon]);
      });

      expect(result.current.polygons).toEqual([mockPolygon, newPolygon]);
      expect(result.current.hasUnsavedChanges).toBe(true);
      expect(result.current.canUndo).toBe(true);
      expect(defaultProps.onPolygonsChange).toHaveBeenCalledWith([
        mockPolygon,
        newPolygon,
      ]);
    });

    it('deletes polygon correctly', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(defaultProps)
      );

      act(() => {
        result.current.setSelectedPolygonId('polygon-1');
      });

      act(() => {
        result.current.handleDeletePolygon();
      });

      expect(result.current.polygons).toEqual([]);
      expect(result.current.selectedPolygonId).toBeNull();
      expect(result.current.hasUnsavedChanges).toBe(true);
    });

    it('deletes specific polygon by ID', () => {
      const polygon2: Polygon = {
        id: 'polygon-2',
        points: [
          { x: 60, y: 60 },
          { x: 100, y: 60 },
        ],
        confidence: 0.7,
        type: 'external',
      };

      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({
          ...defaultProps,
          initialPolygons: [mockPolygon, polygon2],
        })
      );

      act(() => {
        result.current.handleDeletePolygon('polygon-2');
      });

      expect(result.current.polygons).toEqual([mockPolygon]);
    });
  });

  describe('History Management', () => {
    it('handles undo correctly', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(defaultProps)
      );

      const newPolygon: Polygon = {
        id: 'polygon-2',
        points: [
          { x: 60, y: 60 },
          { x: 100, y: 60 },
        ],
        confidence: 0.8,
        type: 'external',
      };

      // Add a polygon to create history
      act(() => {
        result.current.updatePolygons([mockPolygon, newPolygon]);
      });

      expect(result.current.polygons).toEqual([mockPolygon, newPolygon]);
      expect(result.current.canUndo).toBe(true);

      // Undo the addition
      act(() => {
        result.current.handleUndo();
      });

      expect(result.current.polygons).toEqual([mockPolygon]);
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(true);
    });

    it('handles redo correctly', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(defaultProps)
      );

      const newPolygon: Polygon = {
        id: 'polygon-2',
        points: [
          { x: 60, y: 60 },
          { x: 100, y: 60 },
        ],
        confidence: 0.8,
        type: 'external',
      };

      // Add polygon and undo
      act(() => {
        result.current.updatePolygons([mockPolygon, newPolygon]);
      });

      act(() => {
        result.current.handleUndo();
      });

      expect(result.current.canRedo).toBe(true);

      // Redo the addition
      act(() => {
        result.current.handleRedo();
      });

      expect(result.current.polygons).toEqual([mockPolygon, newPolygon]);
      expect(result.current.canRedo).toBe(false);
    });

    it('does not undo when no history available', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(defaultProps)
      );

      const initialPolygons = result.current.polygons;

      act(() => {
        result.current.handleUndo();
      });

      expect(result.current.polygons).toEqual(initialPolygons);
      expect(result.current.canUndo).toBe(false);
    });
  });

  describe('Edit Mode Management', () => {
    it('changes edit mode correctly', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(defaultProps)
      );

      act(() => {
        result.current.setEditMode(EditMode.EditVertices);
      });

      expect(result.current.editMode).toBe(EditMode.EditVertices);
    });

    it('handles escape to reset state', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(defaultProps)
      );

      // Set up some state
      act(() => {
        result.current.setEditMode(EditMode.AddPoints);
        result.current.setTempPoints([{ x: 10, y: 10 }]);
      });

      // Call escape
      act(() => {
        result.current.handleEscape();
      });

      expect(result.current.editMode).toBe(EditMode.View);
      expect(result.current.tempPoints).toEqual([]);
    });
  });

  describe('Transform Operations', () => {
    it('handles zoom in correctly', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(defaultProps)
      );

      const initialZoom = result.current.transform.zoom;

      act(() => {
        result.current.handleZoomIn();
      });

      expect(result.current.transform.zoom).toBeGreaterThan(initialZoom);
    });

    it('handles zoom out correctly', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(defaultProps)
      );

      // First zoom in to have something to zoom out from
      act(() => {
        result.current.handleZoomIn();
      });

      const zoomedInValue = result.current.transform.zoom;

      act(() => {
        result.current.handleZoomOut();
      });

      expect(result.current.transform.zoom).toBeLessThan(zoomedInValue);
    });

    it('resets view to initial transform', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(defaultProps)
      );

      // Modify transform
      act(() => {
        result.current.handleZoomIn();
        result.current.handlePan(50, 30);
      });

      // Reset view
      act(() => {
        result.current.handleResetView();
      });

      expect(result.current.transform).toEqual({
        zoom: 1,
        translateX: 0,
        translateY: 0,
      });
    });
  });

  describe('Save Operations', () => {
    it('saves successfully when changes exist', async () => {
      const mockOnSave = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...defaultProps, onSave: mockOnSave })
      );

      // Make a change to trigger unsaved state
      act(() => {
        result.current.updatePolygons([]);
      });

      expect(result.current.hasUnsavedChanges).toBe(true);

      // Save
      await act(async () => {
        await result.current.handleSave();
      });

      expect(mockOnSave).toHaveBeenCalledWith([]);
      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(result.current.isSaving).toBe(false);
    });

    it('handles save errors correctly', async () => {
      const mockOnSave = vi.fn().mockRejectedValue(new Error('Save failed'));
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...defaultProps, onSave: mockOnSave })
      );

      // Make a change
      act(() => {
        result.current.updatePolygons([]);
      });

      // Attempt save
      await act(async () => {
        await result.current.handleSave();
      });

      expect(result.current.hasUnsavedChanges).toBe(true); // Should remain true on error
      expect(result.current.isSaving).toBe(false);
    });

    it('does not save when no changes exist', async () => {
      const mockOnSave = vi.fn();
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...defaultProps, onSave: mockOnSave })
      );

      await act(async () => {
        await result.current.handleSave();
      });

      expect(mockOnSave).not.toHaveBeenCalled();
    });
  });

  describe('Polygon Selection', () => {
    it('selects polygon correctly', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(defaultProps)
      );

      act(() => {
        result.current.setSelectedPolygonId('polygon-1');
      });

      expect(result.current.selectedPolygonId).toBe('polygon-1');
      expect(result.current.selectedPolygon).toEqual(mockPolygon);
    });

    it('deselects polygon', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(defaultProps)
      );

      act(() => {
        result.current.setSelectedPolygonId('polygon-1');
      });

      act(() => {
        result.current.setSelectedPolygonId(null);
      });

      expect(result.current.selectedPolygonId).toBeNull();
      expect(result.current.selectedPolygon).toBeNull();
    });
  });

  describe('Initial Polygons Update', () => {
    it('updates when initialPolygons prop changes', () => {
      const newPolygon: Polygon = {
        id: 'polygon-2',
        points: [
          { x: 60, y: 60 },
          { x: 100, y: 60 },
        ],
        confidence: 0.8,
        type: 'external',
      };

      const { result, rerender } = renderHook(
        props => useEnhancedSegmentationEditor(props),
        { initialProps: defaultProps }
      );

      expect(result.current.polygons).toEqual([mockPolygon]);

      // Update props with new polygons
      rerender({ ...defaultProps, initialPolygons: [mockPolygon, newPolygon] });

      expect(result.current.polygons).toEqual([mockPolygon, newPolygon]);
      expect(result.current.hasUnsavedChanges).toBe(false); // Should reset on new initial data
    });
  });

  describe('Mouse Interaction Handling', () => {
    it('tracks cursor position correctly', async () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(defaultProps)
      );

      // Mock getBoundingClientRect
      const mockGetBoundingClientRect = vi.fn(() => ({
        left: 100,
        top: 50,
        width: 800,
        height: 600,
      }));

      // Mock canvasRef
      Object.defineProperty(result.current.canvasRef, 'current', {
        value: {
          getBoundingClientRect: mockGetBoundingClientRect,
        },
        writable: true,
      });

      const mockEvent = {
        clientX: 150,
        clientY: 100,
      } as React.MouseEvent<HTMLDivElement>;

      act(() => {
        result.current.handleMouseMove(mockEvent);
      });

      // Wait for throttled cursor position update
      await waitFor(() => {
        expect(result.current.cursorPosition).not.toBeNull();
      });

      expect(result.current.cursorPosition).toEqual({
        x: -350, // (150 - 100) - 800/2 - 0 = 50 - 400 = -350
        y: -250, // (100 - 50) - 600/2 - 0 = 50 - 300 = -250
      });
    });
  });

  describe('Error Handling', () => {
    it('handles missing onSave gracefully', async () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...defaultProps, onSave: undefined })
      );

      // Make a change
      act(() => {
        result.current.updatePolygons([]);
      });

      // Should not throw when saving without onSave
      await act(async () => {
        await result.current.handleSave();
      });

      expect(result.current.isSaving).toBe(false);
    });
  });
});
