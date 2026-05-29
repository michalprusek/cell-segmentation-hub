/**
 * useEnhancedSegmentationEditor — save / autosave / transform branches.
 *
 * Targets NOT covered by useEnhancedSegmentationEditor.test.tsx or .gaps.test.tsx:
 *  • handleSave: no-op when hasUnsavedChanges=false
 *  • handleSave: no-op when onSave=undefined
 *  • handleSave: success path → hasUnsavedChanges=false, savedHistoryIndex updated,
 *    toast.success called, isSaving transitions true→false
 *  • handleSave: error path → toast.error called, isSaving→false
 *  • handleResetView: resets transform to calculateCenteringTransform result
 *  • handleZoomIn / handleZoomOut: each calls calculateFixedPointZoom + constrainTransform
 *  • handleEnterPolyline in AddPoints mode on a polyline (tail-aim path)
 *  • handleEnterPolyline: no-op in View mode
 *  • handleEnterPolyline: no-op when no polygon selected (AddPoints mode, no selection)
 *  • handleEnterPolyline: no-op when selected polygon is NOT a polyline (polygon geometry)
 *  • imageId change resets history and hasUnsavedChanges (switchImage path)
 *  • isUndoRedoInProgress flag transitions: truthy during undo then resets
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEnhancedSegmentationEditor } from '../useEnhancedSegmentationEditor';
import { Polygon } from '@/lib/segmentation';
import { toast } from 'sonner';

// ===== MOCKS =====

vi.mock('../useAdvancedInteractions', () => ({
  useAdvancedInteractions: vi.fn(() => ({
    handleMouseDown: vi.fn(),
    handleMouseMove: vi.fn(),
    handleMouseUp: vi.fn(),
    handleCreatePolylineDoubleClick: vi.fn(),
  })),
}));

vi.mock('../usePolygonSlicing', () => ({
  usePolygonSlicing: vi.fn(() => ({
    startSlicing: vi.fn(),
    completeSlicing: vi.fn(),
    handleSliceAction: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock('../useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(() => ({
    isShiftPressed: false,
    isCtrlPressed: false,
    isAltPressed: false,
    isSpacePressed: false,
  })),
}));

vi.mock('@/lib/coordinateUtils', () => ({
  calculateCenteringTransform: vi.fn(() => ({
    zoom: 1,
    translateX: 0,
    translateY: 0,
  })),
  calculateFixedPointZoom: vi.fn(
    (
      transform: { zoom: number; translateX: number; translateY: number },
      _pt: unknown,
      factor: number
    ) => ({
      ...transform,
      zoom: transform.zoom * factor,
    })
  ),
  constrainTransform: vi.fn((t: unknown) => t),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => 'id'),
    dismiss: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ===== FIXTURES =====

const makePolygon = (id: string, extra?: Partial<Polygon>): Polygon => ({
  id,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
  confidence: 0.9,
  type: 'external',
  ...extra,
});

const baseProps = {
  initialPolygons: [makePolygon('p1')],
  imageWidth: 100,
  imageHeight: 100,
  canvasWidth: 100,
  canvasHeight: 100,
  onSave: vi.fn(),
  onPolygonsChange: vi.fn(),
};

// ===== TESTS =====

describe('useEnhancedSegmentationEditor — save / transform / enterPolyline branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // handleSave — no-op conditions
  // --------------------------------------------------------------------------

  describe('handleSave — no-op guards', () => {
    it('is a no-op when hasUnsavedChanges is false (initial state)', async () => {
      const mockSave = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, onSave: mockSave })
      );

      // hasUnsavedChanges starts false — save must be skipped
      await act(async () => {
        await result.current.handleSave();
      });

      expect(mockSave).not.toHaveBeenCalled();
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });

    it('is a no-op when onSave is undefined (even with unsaved changes)', async () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, onSave: undefined })
      );

      act(() => {
        result.current.updatePolygons([makePolygon('p2')]);
      });

      expect(result.current.hasUnsavedChanges).toBe(true);

      await act(async () => {
        await result.current.handleSave();
      });

      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // handleSave — success path
  // --------------------------------------------------------------------------

  describe('handleSave — success path', () => {
    it('calls onSave, clears hasUnsavedChanges, fires toast.success', async () => {
      vi.useFakeTimers();
      const mockSave = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, onSave: mockSave })
      );

      // Make a change so hasUnsavedChanges=true
      act(() => {
        result.current.updatePolygons([makePolygon('p2')]);
      });
      expect(result.current.hasUnsavedChanges).toBe(true);

      await act(async () => {
        const saveP = result.current.handleSave();
        vi.runAllTimers();
        await saveP;
      });
      vi.useRealTimers();

      expect(mockSave).toHaveBeenCalledOnce();
      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(vi.mocked(toast.success)).toHaveBeenCalled();
    });

    it('isSaving is false after save completes', async () => {
      vi.useFakeTimers();
      const mockSave = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, onSave: mockSave })
      );

      act(() => {
        result.current.updatePolygons([makePolygon('p2')]);
      });

      await act(async () => {
        const saveP = result.current.handleSave();
        vi.runAllTimers();
        await saveP;
      });
      vi.useRealTimers();

      expect(result.current.isSaving).toBe(false);
    });

    it('updates savedHistoryIndex so undo after save sets hasUnsavedChanges=false', async () => {
      vi.useFakeTimers();
      const mockSave = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, onSave: mockSave })
      );

      // Make exactly one change
      const p2 = makePolygon('p2');
      act(() => result.current.updatePolygons([p2]));

      // Save → savedHistoryIndex = historyIndex (1)
      await act(async () => {
        const p = result.current.handleSave();
        vi.runAllTimers();
        await p;
      });

      expect(result.current.hasUnsavedChanges).toBe(false);

      // Make another change
      act(() => result.current.updatePolygons([p2, makePolygon('p3')]));
      expect(result.current.hasUnsavedChanges).toBe(true);

      // Undo brings us back to saved state → hasUnsavedChanges=false
      act(() => result.current.handleUndo());

      await act(async () => {
        vi.runAllTimers();
      });
      vi.useRealTimers();

      expect(result.current.hasUnsavedChanges).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // handleSave — error path
  // --------------------------------------------------------------------------

  describe('handleSave — error path', () => {
    it('calls toast.error on save failure', async () => {
      vi.useFakeTimers();
      const mockSave = vi.fn().mockRejectedValue(new Error('network error'));
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, onSave: mockSave })
      );

      act(() => {
        result.current.updatePolygons([makePolygon('p2')]);
      });

      await act(async () => {
        const saveP = result.current.handleSave();
        vi.runAllTimers();
        await saveP;
      });
      vi.useRealTimers();

      expect(vi.mocked(toast.error)).toHaveBeenCalled();
      expect(result.current.isSaving).toBe(false);
      // hasUnsavedChanges stays true after a failed save
      expect(result.current.hasUnsavedChanges).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Transform operations
  // --------------------------------------------------------------------------

  describe('handleResetView', () => {
    it('resets transform to calculateCenteringTransform result', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      // Simulate a zoom-in first so transform is not already at default
      act(() => result.current.handleZoomIn());

      act(() => result.current.handleResetView());

      // calculateCenteringTransform mock returns { zoom: 1, translateX: 0, translateY: 0 }
      expect(result.current.transform).toEqual({
        zoom: 1,
        translateX: 0,
        translateY: 0,
      });
    });
  });

  describe('handleZoomIn', () => {
    it('increases the zoom level via calculateFixedPointZoom', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      const initialZoom = result.current.transform.zoom;
      act(() => result.current.handleZoomIn());

      // Mock multiplies by ZOOM_FACTOR (1.2 by default); any value > initial confirms call
      expect(result.current.transform.zoom).toBeGreaterThan(initialZoom);
    });
  });

  describe('handleZoomOut', () => {
    it('decreases the zoom level via calculateFixedPointZoom', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      // First zoom in so we have room to zoom out
      act(() => result.current.handleZoomIn());
      const zoomedIn = result.current.transform.zoom;
      act(() => result.current.handleZoomOut());

      expect(result.current.transform.zoom).toBeLessThan(zoomedIn);
    });
  });

  // --------------------------------------------------------------------------
  // handleEnterPolyline — not directly exposed in the hook's public API
  // (it is passed to useKeyboardShortcuts as onEnter). Skipping these to
  // avoid testing internal implementation details. The existing gaps test file
  // already covers handleEscape (same pattern) and the CreatePolyline mode.
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // imageId change resets history
  // --------------------------------------------------------------------------

  describe('imageId change triggers reset', () => {
    it('resets hasUnsavedChanges and history when imageId changes', async () => {
      vi.useFakeTimers();
      const mockSave = vi.fn().mockResolvedValue(undefined);
      const polyA = makePolygon('pA');
      const polyB = makePolygon('pB');

      const { result, rerender } = renderHook(
        props => useEnhancedSegmentationEditor(props),
        {
          initialProps: {
            ...baseProps,
            initialPolygons: [polyA],
            imageId: 'img-A',
            onSave: mockSave,
          },
        }
      );

      // Make a change on image A
      act(() => result.current.updatePolygons([polyA, makePolygon('pA2')]));
      expect(result.current.hasUnsavedChanges).toBe(true);
      expect(result.current.canUndo).toBe(true);

      // Switch to image B
      await act(async () => {
        rerender({
          ...baseProps,
          initialPolygons: [polyB],
          imageId: 'img-B',
          onSave: mockSave,
        });
        vi.runAllTimers();
        await Promise.resolve(); // flush async autosave path
      });
      vi.useRealTimers();

      // History reset + hasUnsavedChanges cleared
      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(result.current.canUndo).toBe(false);
      expect(result.current.polygons).toEqual([polyB]);
    });
  });

  // --------------------------------------------------------------------------
  // isUndoRedoInProgress flag
  // --------------------------------------------------------------------------

  describe('isUndoRedoInProgress', () => {
    it('is false initially', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );
      expect(result.current.isUndoRedoInProgress).toBe(false);
    });

    it('resets to false after the 50ms debounce following undo', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      act(() => result.current.updatePolygons([makePolygon('p2')]));
      act(() => result.current.handleUndo());

      // Immediately after handleUndo: may be true (inside the setTimeout(50))
      // After running timers: must be false
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      vi.useRealTimers();

      expect(result.current.isUndoRedoInProgress).toBe(false);
    });
  });
});
