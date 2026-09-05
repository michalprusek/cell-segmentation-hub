/**
 * useEnhancedSegmentationEditor — consolidated test suite.
 *
 * Organised by concern (one `describe` per area):
 *  • Initialization
 *  • Polygon state & selection
 *  • Polygon deletion (handleDeletePolygon)
 *  • History (undo / redo, savedHistoryIndex, onPolygonsChange, drag-state reset,
 *    isUndoRedoInProgress)
 *  • Vertex deletion (handleDeleteVertex, min-vertex guards)
 *  • Transforms (zoom / pan / reset / min-zoom clamp / gallery auto-reset)
 *  • Save / autosave / beforeunload
 *  • Edit modes & escape
 *  • Polygon sync / reloadNonce
 *
 * Previously split across .test / .extra / .gaps / .gaps3 / .save files;
 * merged here with shared mocks + fixtures. Duplicate and shallow smoke tests
 * were dropped; every distinct behaviour/branch is retained.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEnhancedSegmentationEditor } from '../useEnhancedSegmentationEditor';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import { useAdvancedInteractions } from '../useAdvancedInteractions';
import { EditMode } from '../../types';
import { Polygon } from '@/lib/segmentation';
import type { ProjectType } from '@/types';
import { toast } from 'sonner';

// ── MOCKS ─────────────────────────────────────────────────────────────────────

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

vi.mock('@/lib/errorUtils', () => ({
  handleCancelledError: vi.fn(() => false),
}));

// ── FIXTURES ──────────────────────────────────────────────────────────────────

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

const makePolyline = (id: string, pts?: Polygon['points']): Polygon => ({
  id,
  points: pts ?? [
    { x: 0, y: 0 },
    { x: 5, y: 5 },
    { x: 10, y: 10 },
  ],
  confidence: 0.8,
  type: 'external',
  geometry: 'polyline',
});

const baseProps = {
  initialPolygons: [makePolygon('p1')],
  imageWidth: 100,
  imageHeight: 100,
  canvasWidth: 100,
  canvasHeight: 100,
};

// ── SUITE ─────────────────────────────────────────────────────────────────────

describe('useEnhancedSegmentationEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('Initialization', () => {
    it('initializes with correct default state', () => {
      const p1 = makePolygon('p1');
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [p1] })
      );

      expect(result.current.polygons).toEqual([p1]);
      expect(result.current.selectedPolygonId).toBeNull();
      expect(result.current.editMode).toBe(EditMode.View);
      expect(result.current.tempPoints).toEqual([]);
      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(false);
      expect(result.current.isSaving).toBe(false);
      expect(result.current.isUndoRedoInProgress).toBe(false);
      // calculateCenteringTransform mock returns { zoom: 1, translateX: 0, translateY: 0 }
      expect(result.current.transform).toEqual({
        zoom: 1,
        translateX: 0,
        translateY: 0,
      });
    });

    it('initializes with empty polygons when not provided', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [] })
      );

      expect(result.current.polygons).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('Polygon state & selection', () => {
    it('updates polygons, tracks history, and notifies onPolygonsChange', () => {
      const onPolygonsChange = vi.fn();
      const p1 = makePolygon('p1');
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({
          ...baseProps,
          initialPolygons: [p1],
          onPolygonsChange,
        })
      );

      const p2 = makePolygon('p2');

      act(() => {
        result.current.updatePolygons([p1, p2]);
      });

      expect(result.current.polygons).toEqual([p1, p2]);
      expect(result.current.hasUnsavedChanges).toBe(true);
      expect(result.current.canUndo).toBe(true);
      expect(onPolygonsChange).toHaveBeenCalledWith([p1, p2]);
    });

    it('does not push a history entry when addToHistory=false', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      const p2 = makePolygon('p2');

      act(() => {
        result.current.updatePolygons([p2], false);
      });

      // polygons updated + marked unsaved, but no new undo entry pushed
      expect(result.current.polygons).toEqual([p2]);
      expect(result.current.canUndo).toBe(false);
      expect(result.current.hasUnsavedChanges).toBe(true);
    });

    it('getPolygons() always returns the latest polygons', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      const p2 = makePolygon('p2');
      act(() => result.current.updatePolygons([p2]));

      expect(result.current.getPolygons()).toEqual([p2]);
    });

    it('selects a polygon and exposes it via selectedPolygon', () => {
      const p1 = makePolygon('p1');
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [p1] })
      );

      act(() => {
        result.current.setSelectedPolygonId('p1');
      });

      expect(result.current.selectedPolygonId).toBe('p1');
      expect(result.current.selectedPolygon).toEqual(p1);
    });

    it('deselects a polygon', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      act(() => result.current.setSelectedPolygonId('p1'));
      act(() => result.current.setSelectedPolygonId(null));

      expect(result.current.selectedPolygonId).toBeNull();
      expect(result.current.selectedPolygon).toBeNull();
    });

    it('replaces polygons and clears unsaved flag when initialPolygons prop changes', () => {
      const p1 = makePolygon('p1');
      const p2 = makePolygon('p2');

      const { result, rerender } = renderHook(
        props => useEnhancedSegmentationEditor(props),
        { initialProps: { ...baseProps, initialPolygons: [p1] } }
      );

      expect(result.current.polygons).toEqual([p1]);

      rerender({ ...baseProps, initialPolygons: [p1, p2] });

      expect(result.current.polygons).toEqual([p1, p2]);
      expect(result.current.hasUnsavedChanges).toBe(false);
    });

    // ── The editor painted the PREVIOUS frame (2026-09-03) ─────────────────
    // Scrubbing between two frames with the SAME polygon count left the canvas
    // showing the frame you came from, permanently — a reload was the only
    // way out. Measured in production on a 3-frame container: 10 of 24 scrubs
    // wrong, and still wrong 3 s later, always exactly the previous frame's
    // polygons. The two 6-polygon frames stuck; the 1-polygon frame never did,
    // which is the whole tell.
    //
    // The mechanism is that `imageId` changes one render BEFORE the loader has
    // replaced `initialPolygons`, so the effect saw (new imageId, OLD
    // polygons), consumed the `imageChanged` signal on them, and by the time
    // the right polygons arrived only `lengthChanged` was left to notice — and
    // 6 === 6 notices nothing.
    //
    // `polygonsImageId` stamps the polygons with the frame they were loaded
    // for, so the effect can tell the two apart instead of inferring.
    it('does not adopt polygons belonging to the frame we just left', () => {
      const a1 = makePolygon('a1');
      const a2 = makePolygon('a2');

      const { result, rerender } = renderHook(
        props => useEnhancedSegmentationEditor(props),
        {
          initialProps: {
            ...baseProps,
            imageId: 'frameA',
            polygonsImageId: 'frameA',
            initialPolygons: [a1, a2],
          },
        }
      );
      expect(result.current.polygons).toEqual([a1, a2]);

      // The scrub: imageId is already frameB, the polygons are still frameA's.
      rerender({
        ...baseProps,
        imageId: 'frameB',
        polygonsImageId: 'frameA',
        initialPolygons: [a1, a2],
      });

      expect(result.current.polygons).toEqual([]);
    });

    it('adopts the new frame even when its polygon count is unchanged', () => {
      const a1 = makePolygon('a1');
      const a2 = makePolygon('a2');
      const b1 = makePolygon('b1');
      const b2 = makePolygon('b2');

      const { result, rerender } = renderHook(
        props => useEnhancedSegmentationEditor(props),
        {
          initialProps: {
            ...baseProps,
            imageId: 'frameA',
            polygonsImageId: 'frameA',
            initialPolygons: [a1, a2],
          },
        }
      );

      // One render with the stale polygons — this is what used to burn the
      // `imageChanged` signal...
      rerender({
        ...baseProps,
        imageId: 'frameB',
        polygonsImageId: 'frameA',
        initialPolygons: [a1, a2],
      });
      // ...and then frameB lands with the SAME count, which `lengthChanged`
      // cannot see.
      rerender({
        ...baseProps,
        imageId: 'frameB',
        polygonsImageId: 'frameB',
        initialPolygons: [b1, b2],
      });

      expect(result.current.polygons).toEqual([b1, b2]);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('Polygon deletion (handleDeletePolygon)', () => {
    it('deletes a specific polygon by explicit id', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({
          ...baseProps,
          initialPolygons: [makePolygon('a'), makePolygon('b')],
        })
      );

      act(() => result.current.handleDeletePolygon('a'));

      expect(result.current.polygons).toHaveLength(1);
      expect(result.current.polygons[0].id).toBe('b');
    });

    it('deletes the selected polygon (no arg), clears selection, marks unsaved', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({
          ...baseProps,
          initialPolygons: [makePolygon('x'), makePolygon('y')],
        })
      );

      act(() => result.current.setSelectedPolygonId('x'));
      act(() => result.current.handleDeletePolygon());

      expect(result.current.polygons.map(p => p.id)).toEqual(['y']);
      expect(result.current.selectedPolygonId).toBeNull();
      expect(result.current.hasUnsavedChanges).toBe(true);
    });

    it('clears selection when deleting by explicit id that is currently selected', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({
          ...baseProps,
          initialPolygons: [makePolygon('del-me'), makePolygon('keep')],
        })
      );

      act(() => result.current.setSelectedPolygonId('del-me'));
      expect(result.current.selectedPolygonId).toBe('del-me');

      act(() => result.current.handleDeletePolygon('del-me'));

      expect(result.current.selectedPolygonId).toBeNull();
    });

    it('is a no-op when nothing is selected and no id is given', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({
          ...baseProps,
          initialPolygons: [makePolygon('z')],
        })
      );

      act(() => result.current.handleDeletePolygon());

      expect(result.current.polygons).toHaveLength(1);
    });

    it('suppresses the generic toast when the caller reports the delete itself', () => {
      // The microtubule scope handlers raise a toast naming the frames touched;
      // two success toasts for one gesture is noise.
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({
          ...baseProps,
          initialPolygons: [makePolygon('a'), makePolygon('b')],
        })
      );

      act(() => result.current.handleDeletePolygon('a', { silent: true }));

      expect(result.current.polygons.map(p => p.id)).toEqual(['b']);
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });

    it('does not claim success or dirty the editor for an id that is gone', () => {
      // A reload can replace the polygons behind an open confirmation dialog.
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({
          ...baseProps,
          initialPolygons: [makePolygon('a')],
        })
      );

      act(() => result.current.handleDeletePolygon('vanished'));

      expect(result.current.polygons.map(p => p.id)).toEqual(['a']);
      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // The Delete key and a click in delete mode carry no scope of their own. For
  // a tracked microtubule the parent needs to ask "this frame or the whole
  // track?" FIRST — deleting locally and letting the save propagate is exactly
  // the silent whole-track delete this exists to stop.
  describe('onRequestDeletePolygon (scope-less delete gestures)', () => {
    /** The delete handler the keyboard layer was actually handed. */
    const keyboardDelete = () =>
      vi.mocked(useKeyboardShortcuts).mock.calls.at(-1)![0]
        .handleDeletePolygon as (id?: string) => void;

    it('lets the parent intercept the Delete key and keeps the polygon', () => {
      const onRequestDeletePolygon = vi.fn(() => true); // "I opened a dialog"
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({
          ...baseProps,
          initialPolygons: [makePolygon('mt-1'), makePolygon('mt-2')],
          onRequestDeletePolygon,
        })
      );

      act(() => result.current.setSelectedPolygonId('mt-1'));
      act(() => keyboardDelete()());

      expect(onRequestDeletePolygon).toHaveBeenCalledWith('mt-1');
      expect(result.current.polygons.map(p => p.id)).toEqual(['mt-1', 'mt-2']);
      expect(result.current.hasUnsavedChanges).toBe(false);
    });

    it('deletes normally when the parent declines', () => {
      const onRequestDeletePolygon = vi.fn(() => false);
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({
          ...baseProps,
          initialPolygons: [makePolygon('a'), makePolygon('b')],
          onRequestDeletePolygon,
        })
      );

      act(() => result.current.setSelectedPolygonId('a'));
      act(() => keyboardDelete()());

      expect(result.current.polygons.map(p => p.id)).toEqual(['b']);
    });

    it('intercepts a click in DeletePolygon mode too', () => {
      const onRequestDeletePolygon = vi.fn(() => true);
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({
          ...baseProps,
          initialPolygons: [makePolygon('a'), makePolygon('b')],
          onRequestDeletePolygon,
        })
      );

      act(() => result.current.setEditMode(EditMode.DeletePolygon));
      act(() => result.current.handlePolygonSelection('a'));

      expect(onRequestDeletePolygon).toHaveBeenCalledWith('a');
      expect(result.current.polygons.map(p => p.id)).toEqual(['a', 'b']);
    });

    it('leaves handleDeletePolygon itself un-intercepted (applies a chosen scope)', () => {
      // The sidebar / context-menu helpers call this one AFTER the user picked
      // a scope; re-prompting there would loop.
      const onRequestDeletePolygon = vi.fn(() => true);
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({
          ...baseProps,
          initialPolygons: [makePolygon('a'), makePolygon('b')],
          onRequestDeletePolygon,
        })
      );

      act(() => result.current.handleDeletePolygon('a'));

      expect(onRequestDeletePolygon).not.toHaveBeenCalled();
      expect(result.current.polygons.map(p => p.id)).toEqual(['b']);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('History (undo / redo)', () => {
    it('undoes an addition and toggles canUndo/canRedo', () => {
      const p1 = makePolygon('p1');
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [p1] })
      );

      const p2 = makePolygon('p2');
      act(() => result.current.updatePolygons([p1, p2]));

      expect(result.current.polygons).toEqual([p1, p2]);
      expect(result.current.canUndo).toBe(true);

      act(() => result.current.handleUndo());

      expect(result.current.polygons).toEqual([p1]);
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(true);
    });

    it('redoes an undone addition', () => {
      const p1 = makePolygon('p1');
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [p1] })
      );

      const p2 = makePolygon('p2');
      act(() => result.current.updatePolygons([p1, p2]));
      act(() => result.current.handleUndo());

      expect(result.current.canRedo).toBe(true);

      act(() => result.current.handleRedo());

      expect(result.current.polygons).toEqual([p1, p2]);
      expect(result.current.canRedo).toBe(false);
    });

    it('handleUndo is a no-op when canUndo=false', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      const initial = result.current.polygons;
      expect(result.current.canUndo).toBe(false);

      act(() => result.current.handleUndo());

      expect(result.current.polygons).toEqual(initial);
      expect(result.current.canUndo).toBe(false);
    });

    it('handleRedo is a no-op when canRedo=false (at head of history)', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      expect(result.current.canRedo).toBe(false);

      act(() => result.current.handleRedo());

      expect(result.current.polygons).toEqual(baseProps.initialPolygons);
    });

    it('leaves hasUnsavedChanges=true when undo does not land on the saved state', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      const p2 = makePolygon('p2');
      const p3 = makePolygon('p3');

      act(() => result.current.updatePolygons([makePolygon('p1'), p2]));
      act(() => result.current.updatePolygons([makePolygon('p1'), p2, p3]));

      act(() => result.current.handleUndo());

      await act(async () => {
        vi.runAllTimers();
      });
      vi.useRealTimers();

      expect(result.current.hasUnsavedChanges).toBe(true);
    });

    it('sets hasUnsavedChanges=false when undo lands exactly on the saved state', async () => {
      vi.useFakeTimers();
      const mockSave = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, onSave: mockSave })
      );

      const p2 = makePolygon('p2');
      act(() => result.current.updatePolygons([makePolygon('p1'), p2]));

      await act(async () => {
        const savePromise = result.current.handleSave();
        vi.runAllTimers();
        await savePromise;
      });
      expect(result.current.hasUnsavedChanges).toBe(false);

      act(() =>
        result.current.updatePolygons([
          makePolygon('p1'),
          p2,
          makePolygon('p3'),
        ])
      );
      expect(result.current.hasUnsavedChanges).toBe(true);

      act(() => result.current.handleUndo());

      await act(async () => {
        vi.runAllTimers();
      });
      vi.useRealTimers();

      expect(result.current.hasUnsavedChanges).toBe(false);
    });

    it('leaves hasUnsavedChanges=true when redo does not land on the saved state', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      const p2 = makePolygon('p2');
      act(() => result.current.updatePolygons([makePolygon('p1'), p2]));
      act(() => result.current.handleUndo());

      await act(async () => {
        vi.runAllTimers();
      });

      act(() => result.current.handleRedo());

      await act(async () => {
        vi.runAllTimers();
      });
      vi.useRealTimers();

      expect(result.current.hasUnsavedChanges).toBe(true);
    });

    it('calls onPolygonsChange with updated polygons on undo', async () => {
      vi.useFakeTimers();
      const onChange = vi.fn();
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({
          ...baseProps,
          onPolygonsChange: onChange,
        })
      );

      act(() => result.current.updatePolygons([makePolygon('p2')]));
      onChange.mockClear();

      act(() => result.current.handleUndo());

      await act(async () => {
        vi.runAllTimers();
      });
      vi.useRealTimers();

      expect(onChange).toHaveBeenCalledWith(expect.any(Array));
    });

    it('calls onPolygonsChange with updated polygons on redo', async () => {
      vi.useFakeTimers();
      const onChange = vi.fn();
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({
          ...baseProps,
          onPolygonsChange: onChange,
        })
      );

      act(() => result.current.updatePolygons([makePolygon('p2')]));
      act(() => result.current.handleUndo());

      await act(async () => {
        vi.runAllTimers();
      });
      onChange.mockClear();

      act(() => result.current.handleRedo());

      await act(async () => {
        vi.runAllTimers();
      });
      vi.useRealTimers();

      expect(onChange).toHaveBeenCalledWith(expect.any(Array));
    });

    it('clears isDraggingVertex and draggedVertexInfo on undo', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      act(() => result.current.updatePolygons([makePolygon('p2')]));

      act(() => {
        result.current.setInteractionState({
          isDraggingVertex: true,
          isPanning: false,
          panStart: null,
          draggedVertexInfo: { polygonId: 'p1', vertexIndex: 0 },
          originalVertexPosition: { x: 0, y: 0 },
          sliceStartPoint: null,
          addPointStartVertex: null,
          addPointEndVertex: null,
          isAddingPoints: false,
        });
      });

      act(() => result.current.handleUndo());

      await act(async () => {
        vi.runAllTimers();
      });
      vi.useRealTimers();

      expect(result.current.interactionState.isDraggingVertex).toBe(false);
      expect(result.current.interactionState.draggedVertexInfo).toBeNull();
    });

    it('clears isDraggingVertex on redo', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      act(() => result.current.updatePolygons([makePolygon('p2')]));
      act(() => result.current.handleUndo());

      await act(async () => {
        vi.runAllTimers();
      });

      act(() => {
        result.current.setInteractionState({
          isDraggingVertex: true,
          isPanning: false,
          panStart: null,
          draggedVertexInfo: { polygonId: 'p2', vertexIndex: 1 },
          originalVertexPosition: null,
          sliceStartPoint: null,
          addPointStartVertex: null,
          addPointEndVertex: null,
          isAddingPoints: false,
        });
      });

      act(() => result.current.handleRedo());

      await act(async () => {
        vi.runAllTimers();
      });
      vi.useRealTimers();

      expect(result.current.interactionState.isDraggingVertex).toBe(false);
    });

    it('resets isUndoRedoInProgress to false after the debounce following undo', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      act(() => result.current.updatePolygons([makePolygon('p2')]));
      act(() => result.current.handleUndo());

      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      vi.useRealTimers();

      expect(result.current.isUndoRedoInProgress).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('Vertex deletion (handleDeleteVertex)', () => {
    it('removes the vertex and updates history', () => {
      const poly = makePolygon('p1', {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      });

      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [poly] })
      );

      act(() => result.current.handleDeleteVertex('p1', 1));

      expect(result.current.polygons[0].points).toHaveLength(3);
      expect(result.current.polygons[0].points).not.toContainEqual({
        x: 10,
        y: 0,
      });
    });

    it('refuses to delete when a polygon has only 3 points (minimum)', () => {
      const poly = makePolygon('p1', {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 5, y: 10 },
        ],
      });

      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [poly] })
      );

      act(() => result.current.handleDeleteVertex('p1', 0));

      expect(result.current.polygons[0].points).toHaveLength(3);
    });

    it('refuses to delete when a polyline has only 2 points (minimum)', () => {
      const poly = makePolyline('pl1', [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]);

      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [poly] })
      );

      act(() => result.current.handleDeleteVertex('pl1', 0));

      expect(result.current.polygons[0].points).toHaveLength(2);
    });

    it('allows deleting down to 2 points on a 3-point polyline', () => {
      const poly = makePolyline('pl1'); // 3 points

      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [poly] })
      );

      act(() => result.current.handleDeleteVertex('pl1', 1));

      expect(result.current.polygons[0].points).toHaveLength(2);
    });

    it('is a no-op for an unknown polygon id', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      act(() => result.current.handleDeleteVertex('nonexistent', 0));

      expect(result.current.polygons).toHaveLength(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('Transforms', () => {
    it('handleZoomIn increases the zoom level', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      const initialZoom = result.current.transform.zoom;
      act(() => result.current.handleZoomIn());

      expect(result.current.transform.zoom).toBeGreaterThan(initialZoom);
    });

    it('handleZoomOut decreases the zoom level', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      act(() => result.current.handleZoomIn());
      const zoomedIn = result.current.transform.zoom;
      act(() => result.current.handleZoomOut());

      expect(result.current.transform.zoom).toBeLessThan(zoomedIn);
    });

    it('handlePan updates translateX/Y by the given delta', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      const before = result.current.transform;

      act(() => result.current.handlePan(15, -5));

      // constrainTransform is a passthrough in the mock, so deltas apply directly
      expect(result.current.transform.translateX).toBe(before.translateX + 15);
      expect(result.current.transform.translateY).toBe(before.translateY - 5);
    });

    it('handleResetView resets the transform to the centering values', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      act(() => {
        result.current.handleZoomIn();
        result.current.handlePan(50, 30);
      });

      act(() => result.current.handleResetView());

      // calculateCenteringTransform mock returns { zoom: 1, translateX: 0, translateY: 0 }
      expect(result.current.transform).toEqual({
        zoom: 1,
        translateX: 0,
        translateY: 0,
      });
    });

    it('keeps zoom positive under the min-zoom clamp after repeated zoom-out', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      for (let i = 0; i < 20; i++) {
        act(() => result.current.handleZoomOut());
      }

      expect(result.current.transform.zoom).toBeGreaterThan(0);
    });

    it('schedules a transform reset when isFromGallery flips true with an imageId', async () => {
      vi.useFakeTimers();

      const { result, rerender } = renderHook(
        props => useEnhancedSegmentationEditor(props),
        {
          initialProps: {
            ...baseProps,
            imageId: 'img-1',
            isFromGallery: false,
          },
        }
      );

      act(() => result.current.handleZoomIn());
      expect(result.current.transform.zoom).toBeGreaterThan(1);

      rerender({ ...baseProps, imageId: 'img-1', isFromGallery: true });

      await act(async () => {
        vi.runAllTimers();
      });
      vi.useRealTimers();

      // Reset back to the fit-to-view value (1 from the centering mock)
      expect(result.current.transform.zoom).toBe(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('Save / autosave / beforeunload', () => {
    it('is a no-op when there are no unsaved changes', async () => {
      const mockSave = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, onSave: mockSave })
      );

      expect(result.current.hasUnsavedChanges).toBe(false);

      await act(async () => {
        await result.current.handleSave();
      });

      expect(mockSave).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('is a no-op when onSave is undefined even with unsaved changes', async () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, onSave: undefined })
      );

      act(() => result.current.updatePolygons([makePolygon('p2')]));
      expect(result.current.hasUnsavedChanges).toBe(true);

      await act(async () => {
        await result.current.handleSave();
      });

      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(result.current.isSaving).toBe(false);
    });

    it('saves successfully: onSave signature, clears unsaved flag, success toast', async () => {
      const mockOnSave = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, onSave: mockOnSave })
      );

      act(() => result.current.updatePolygons([]));
      expect(result.current.hasUnsavedChanges).toBe(true);

      await act(async () => {
        await result.current.handleSave();
      });

      // onSave is called with (polygons, imageId, dimensions, signal); no imageId here
      expect(mockOnSave).toHaveBeenCalledWith(
        [],
        undefined,
        undefined,
        expect.any(AbortSignal)
      );
      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(result.current.isSaving).toBe(false);
      expect(toast.success).toHaveBeenCalled();
    });

    it('updates savedHistoryIndex so undo after save clears the unsaved flag', async () => {
      vi.useFakeTimers();
      const mockSave = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, onSave: mockSave })
      );

      const p2 = makePolygon('p2');
      act(() => result.current.updatePolygons([p2]));

      await act(async () => {
        const p = result.current.handleSave();
        vi.runAllTimers();
        await p;
      });
      expect(result.current.hasUnsavedChanges).toBe(false);

      act(() => result.current.updatePolygons([p2, makePolygon('p3')]));
      expect(result.current.hasUnsavedChanges).toBe(true);

      act(() => result.current.handleUndo());

      await act(async () => {
        vi.runAllTimers();
      });
      vi.useRealTimers();

      expect(result.current.hasUnsavedChanges).toBe(false);
    });

    it('handles a save error: error toast, isSaving false, unsaved flag stays true', async () => {
      const mockOnSave = vi.fn().mockRejectedValue(new Error('save failed'));
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, onSave: mockOnSave })
      );

      act(() => result.current.updatePolygons([makePolygon('p2')]));

      await act(async () => {
        await result.current.handleSave();
      });

      expect(toast.error).toHaveBeenCalled();
      expect(result.current.isSaving).toBe(false);
      expect(result.current.hasUnsavedChanges).toBe(true);
    });

    it('beforeunload sets event.returnValue when there are unsaved changes', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      act(() => result.current.updatePolygons([makePolygon('p2')]));
      expect(result.current.hasUnsavedChanges).toBe(true);

      const event = new Event('beforeunload') as BeforeUnloadEvent;
      Object.defineProperty(event, 'returnValue', {
        writable: true,
        value: '',
      });

      window.dispatchEvent(event);

      expect(event.returnValue).toBeTruthy();
    });

    it('beforeunload does not set returnValue when there are no unsaved changes', () => {
      renderHook(() => useEnhancedSegmentationEditor(baseProps));

      const event = new Event('beforeunload') as BeforeUnloadEvent;
      Object.defineProperty(event, 'returnValue', {
        writable: true,
        value: '',
      });

      window.dispatchEvent(event);

      expect(event.returnValue).toBe('');
    });

    it('autosaves the previous image when imageId changes with unsaved changes', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { result, rerender } = renderHook(
        (props: any) => useEnhancedSegmentationEditor(props),
        { initialProps: { ...baseProps, imageId: 'img-a', onSave } }
      );

      act(() => result.current.updatePolygons([makePolygon('p2')]));
      expect(result.current.hasUnsavedChanges).toBe(true);

      await act(async () => {
        rerender({
          ...baseProps,
          imageId: 'img-b',
          initialPolygons: [],
          onSave,
        });
      });

      expect(onSave).toHaveBeenCalled();
      // The autosave call references the previous imageId
      expect(onSave.mock.calls[0][1]).toBe('img-a');
    });

    it('resets history and unsaved flag when imageId changes', async () => {
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

      act(() => result.current.updatePolygons([polyA, makePolygon('pA2')]));
      expect(result.current.hasUnsavedChanges).toBe(true);
      expect(result.current.canUndo).toBe(true);

      await act(async () => {
        rerender({
          ...baseProps,
          initialPolygons: [polyB],
          imageId: 'img-B',
          onSave: mockSave,
        });
        vi.runAllTimers();
        await Promise.resolve();
      });
      vi.useRealTimers();

      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(result.current.canUndo).toBe(false);
      expect(result.current.polygons).toEqual([polyB]);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('Edit modes & escape', () => {
    // The project type is undefined on every mount (`useProjectData` fills it
    // when the fetch resolves) and can change under a live component, since
    // the editor route carries no `key`. Both windows offer BOTH create tools,
    // so a mode the project does not annotate can be selected and then become
    // forbidden. These cover the drop back to View.
    it('drops CreatePolyline when the project resolves as a polygon type', () => {
      const { result, rerender } = renderHook(
        (props: { projectType?: ProjectType }) =>
          useEnhancedSegmentationEditor({ ...baseProps, ...props }),
        { initialProps: {} }
      );

      act(() => result.current.setEditMode(EditMode.CreatePolyline));
      expect(result.current.editMode).toBe(EditMode.CreatePolyline);

      rerender({ projectType: 'spheroid' });
      expect(result.current.editMode).toBe(EditMode.View);
    });

    it('drops CreatePolygon when the project resolves as a polyline type', () => {
      const { result, rerender } = renderHook(
        (props: { projectType?: ProjectType }) =>
          useEnhancedSegmentationEditor({ ...baseProps, ...props }),
        { initialProps: {} }
      );

      act(() => result.current.setEditMode(EditMode.CreatePolygon));
      rerender({ projectType: 'microtubules' });
      expect(result.current.editMode).toBe(EditMode.View);
    });

    it('leaves the ALLOWED create mode and every other mode alone', () => {
      // The reset must be surgical: resetting to View on any project-type
      // change would throw away a mode the user legitimately selected.
      const { result, rerender } = renderHook(
        (props: { projectType?: ProjectType }) =>
          useEnhancedSegmentationEditor({ ...baseProps, ...props }),
        { initialProps: {} }
      );

      act(() => result.current.setEditMode(EditMode.CreatePolygon));
      rerender({ projectType: 'spheroid' });
      expect(result.current.editMode).toBe(EditMode.CreatePolygon);

      act(() => result.current.setEditMode(EditMode.Slice));
      rerender({ projectType: 'wound' });
      expect(result.current.editMode).toBe(EditMode.Slice);
    });

    it('keeps a legal create mode when the project type is LOST', () => {
      // Failing open in the other direction. The naive shape of this reset —
      // deriving the forbidden mode without first checking for null — reads
      // `null !== 'polyline'` as "polygon project" and evicts the user from
      // CreatePolyline. Losing the type is not evidence that the mode is
      // wrong, and yanking someone out mid-draw would be worse.
      //
      // Note this direction is the ONLY one that exercises the null branch:
      // going undefined -> undefined never changes the effect's dependency,
      // so the effect does not re-run and the assertion would be vacuous.
      const { result, rerender } = renderHook(
        (props: { projectType?: ProjectType }) =>
          useEnhancedSegmentationEditor({ ...baseProps, ...props }),
        {
          initialProps: { projectType: 'microtubules' } as {
            projectType?: ProjectType;
          },
        }
      );

      act(() => result.current.setEditMode(EditMode.CreatePolyline));
      expect(result.current.editMode).toBe(EditMode.CreatePolyline);

      rerender({});
      expect(result.current.editMode).toBe(EditMode.CreatePolyline);
    });

    it('hands the project type to the keyboard layer, so N/P are gated there too', () => {
      // The gate lives in useKeyboardShortcuts; dropping `projectType` from
      // this call site silently disables it, and was measured to pass all
      // 5 025 frontend tests. This asserts the seam.
      renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, projectType: 'sperm' })
      );

      expect(
        vi.mocked(useKeyboardShortcuts).mock.calls.at(-1)![0].projectType
      ).toBe('sperm');
    });

    it('enters EditVertices mode only after a polygon is selected', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      // EditVertices requires a selected polygon (coupling in usePolygonSelection)
      act(() => result.current.setSelectedPolygonId('p1'));
      act(() => result.current.setEditMode(EditMode.EditVertices));

      expect(result.current.editMode).toBe(EditMode.EditVertices);
    });

    it('switches to a non-Edit mode without a polygon selection', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      act(() => result.current.setEditMode(EditMode.Slice));

      expect(result.current.editMode).toBe(EditMode.Slice);
    });

    it('setEditMode accepts a functional updater', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      expect(result.current.editMode).toBe(EditMode.View);

      act(() => {
        result.current.setEditMode((prev: EditMode) =>
          prev === EditMode.View ? EditMode.Slice : EditMode.View
        );
      });

      expect(result.current.editMode).toBe(EditMode.Slice);
    });

    it('handleEscape returns to View mode, clears temp points, deselects', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      act(() => {
        result.current.setEditMode(EditMode.Slice);
        result.current.setSelectedPolygonId('p1');
        result.current.setTempPoints([{ x: 5, y: 5 }]);
      });

      act(() => result.current.handleEscape());

      expect(result.current.editMode).toBe(EditMode.View);
      expect(result.current.tempPoints).toHaveLength(0);
      expect(result.current.selectedPolygonId).toBeNull();
    });

    it('handleEscape fully resets interactionState', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      act(() => {
        result.current.setInteractionState({
          isDraggingVertex: true,
          isPanning: true,
          panStart: { x: 1, y: 1 },
          draggedVertexInfo: { polygonId: 'p1', vertexIndex: 0 },
          originalVertexPosition: { x: 0, y: 0 },
          sliceStartPoint: { x: 5, y: 5 },
          addPointStartVertex: { polygonId: 'p1', vertexIndex: 1 },
          addPointEndVertex: null,
          isAddingPoints: true,
        });
      });

      act(() => result.current.handleEscape());

      const s = result.current.interactionState;
      expect(s.isDraggingVertex).toBe(false);
      expect(s.isPanning).toBe(false);
      expect(s.panStart).toBeNull();
      expect(s.sliceStartPoint).toBeNull();
      expect(s.isAddingPoints).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('Polygon sync / reloadNonce', () => {
    it('replaces canvas polygons when reloadNonce increments even with an identical count', () => {
      const oldPoly = makePolygon('p1', {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 5, y: 10 },
        ],
      });
      const newPoly = makePolygon('p1', {
        points: [
          { x: 1, y: 1 },
          { x: 11, y: 1 },
          { x: 6, y: 11 },
        ],
      });

      const { result, rerender } = renderHook(
        props => useEnhancedSegmentationEditor(props),
        {
          initialProps: {
            ...baseProps,
            initialPolygons: [oldPoly],
            reloadNonce: 0,
          },
        }
      );

      expect(result.current.polygons[0].points[0]).toEqual({ x: 0, y: 0 });

      rerender({ ...baseProps, initialPolygons: [newPoly], reloadNonce: 1 });

      expect(result.current.polygons[0].points[0]).toEqual({ x: 1, y: 1 });
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Canvas double-click. Reported 2026-09-04: a double-click in AddPoints
  // created a stray polygon while Enter did the elongation, because the canvas
  // bound the CreatePolyline finaliser directly with no mode check. Enter and
  // double-click are now the SAME function, so these assertions also pin
  // `onEnter`.
  describe('handleCanvasDoubleClick', () => {
    const finaliser = vi.fn();
    const defaultInteractions = () => ({
      handleMouseDown: vi.fn(),
      handleMouseMove: vi.fn(),
      handleMouseUp: vi.fn(),
      handleCreatePolylineDoubleClick: finaliser,
    });

    beforeEach(() => {
      finaliser.mockClear();
      vi.mocked(useAdvancedInteractions).mockImplementation(
        defaultInteractions
      );
    });

    /** Put the editor into "extending pl1 from its tail" with one drawn point. */
    const armAddPoints = (
      result: { current: ReturnType<typeof useEnhancedSegmentationEditor> },
      polylineId: string,
      pivot: number
    ) => {
      act(() => {
        result.current.setSelectedPolygonId(polylineId);
        result.current.setEditMode(EditMode.AddPoints);
        result.current.setTempPoints([{ x: 20, y: 20 }]);
        result.current.setInteractionState({
          isDraggingVertex: false,
          isPanning: false,
          panStart: null,
          draggedVertexInfo: null,
          originalVertexPosition: null,
          sliceStartPoint: null,
          addPointStartVertex: { polygonId: polylineId, vertexIndex: pivot },
          addPointEndVertex: null,
          isAddingPoints: true,
        });
      });
    };

    it('AddPoints: extends the selected polyline IN PLACE instead of creating one', () => {
      const poly = makePolyline('pl1'); // (0,0) (5,5) (10,10)
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [poly] })
      );
      armAddPoints(result, 'pl1', 2);

      act(() => result.current.handleCanvasDoubleClick());

      // The stray-polyline bug showed up here as a second polygon.
      expect(result.current.polygons).toHaveLength(1);
      expect(result.current.polygons[0].id).toBe('pl1');
      expect(result.current.polygons[0].points).toEqual([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ]);
      expect(result.current.editMode).toBe(EditMode.EditVertices);
      expect(result.current.tempPoints).toEqual([]);
      // The old dblclick path left this stale while flipping to View.
      expect(result.current.interactionState.isAddingPoints).toBe(false);
      expect(result.current.interactionState.addPointStartVertex).toBeNull();
      expect(finaliser).not.toHaveBeenCalled();
    });

    it('AddPoints: a double-click commits exactly what Enter commits', () => {
      const poly = makePolyline('pl1');
      const viaEnter = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [poly] })
      );
      armAddPoints(viaEnter.result, 'pl1', 2);
      act(() => viaEnter.result.current.handleCanvasDoubleClick());

      const viaKey = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [poly] })
      );
      armAddPoints(viaKey.result, 'pl1', 2);
      // onEnter is what the Enter key runs — see useKeyboardShortcuts wiring.
      const onEnter = vi.mocked(useKeyboardShortcuts).mock.calls.at(-1)?.[0]
        .onEnter as () => void;
      act(() => onEnter());

      expect(viaKey.result.current.polygons).toEqual(
        viaEnter.result.current.polygons
      );
    });

    it('CreatePolyline: forwards to the interactions finaliser', () => {
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor(baseProps)
      );

      act(() => result.current.setEditMode(EditMode.CreatePolyline));
      act(() => result.current.handleCanvasDoubleClick());

      expect(finaliser).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['View', EditMode.View],
      ['CreatePolygon', EditMode.CreatePolygon],
      ['Slice', EditMode.Slice],
      ['DeletePolygon', EditMode.DeletePolygon],
    ])('%s: is a no-op — no new polygon, no finaliser', (_name, mode) => {
      const poly = makePolyline('pl1');
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [poly] })
      );

      act(() => {
        result.current.setEditMode(mode);
        result.current.setTempPoints([
          { x: 0, y: 0 },
          { x: 5, y: 5 },
          { x: 9, y: 9 },
        ]);
      });
      act(() => result.current.handleCanvasDoubleClick());

      expect(result.current.polygons).toHaveLength(1);
      expect(result.current.polygons[0].id).toBe('pl1');
      expect(finaliser).not.toHaveBeenCalled();
      expect(result.current.editMode).toBe(mode);
    });

    // The auto-anchor picks the endpoint nearest the FIRST click; the
    // direction used to be decided by the LAST drawn point. When those
    // disagree, `pts.slice(0, pivot + 1)` keeps a single vertex and the rest
    // of the filament is deleted. An ENDPOINT pivot must decide the direction
    // itself — pivoting on an end means "extend from that end".
    it('an endpoint anchor extends from that end even when the drawn points aim the other way', () => {
      const pl1 = makePolyline('pl1'); // (0,0) (5,5) (10,10)
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [pl1] })
      );

      act(() => {
        result.current.setSelectedPolygonId('pl1');
        result.current.setEditMode(EditMode.AddPoints);
        // Anchored at the HEAD, but the drawn run ends past the TAIL.
        result.current.setTempPoints([
          { x: 12, y: 12 },
          { x: 14, y: 14 },
        ]);
        result.current.setInteractionState({
          isDraggingVertex: false,
          isPanning: false,
          panStart: null,
          draggedVertexInfo: null,
          originalVertexPosition: null,
          sliceStartPoint: null,
          addPointStartVertex: { polygonId: 'pl1', vertexIndex: 0 },
          addPointEndVertex: null,
          isAddingPoints: true,
        });
      });
      act(() => result.current.handleCanvasDoubleClick());

      // Head extension, whole filament intact. Deciding the direction from
      // the drawn points instead gave [(0,0),(12,12),(14,14)] — (5,5) and
      // (10,10) silently deleted.
      expect(result.current.polygons[0].points).toEqual([
        { x: 14, y: 14 },
        { x: 12, y: 12 },
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
      ]);
    });

    it('a MIDDLE anchor still replaces the arm the drawn points aim at', () => {
      const pl1 = makePolyline('pl1', [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
        { x: 15, y: 15 },
      ]);
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [pl1] })
      );

      act(() => {
        result.current.setSelectedPolygonId('pl1');
        result.current.setEditMode(EditMode.AddPoints);
        result.current.setTempPoints([{ x: 20, y: 20 }]); // aims past the tail
        result.current.setInteractionState({
          isDraggingVertex: false,
          isPanning: false,
          panStart: null,
          draggedVertexInfo: null,
          originalVertexPosition: null,
          sliceStartPoint: null,
          addPointStartVertex: { polygonId: 'pl1', vertexIndex: 1 },
          addPointEndVertex: null,
          isAddingPoints: true,
        });
      });
      act(() => result.current.handleCanvasDoubleClick());

      // The arm from the pivot toward the tail is replaced; head side kept.
      expect(result.current.polygons[0].points).toEqual([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 20, y: 20 },
      ]);
    });

    // `pts.slice(0, pivot + 1)` / `pts.slice(pivot)` with an anchor that is
    // not an index into THIS polyline truncates it to an arbitrary prefix,
    // or — past the end — to nothing.
    it('ignores an anchor that belongs to a DIFFERENT polyline', () => {
      const pl1 = makePolyline('pl1'); // (0,0) (5,5) (10,10)
      const pl2 = makePolyline('pl2', [
        { x: 90, y: 90 },
        { x: 99, y: 99 },
      ]);
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({
          ...baseProps,
          initialPolygons: [pl1, pl2],
        })
      );

      act(() => {
        result.current.setSelectedPolygonId('pl1');
        result.current.setEditMode(EditMode.AddPoints);
        result.current.setTempPoints([{ x: 20, y: 20 }]);
        result.current.setInteractionState({
          isDraggingVertex: false,
          isPanning: false,
          panStart: null,
          draggedVertexInfo: null,
          originalVertexPosition: null,
          sliceStartPoint: null,
          // pl2's index 0 — meaningless as a pivot into pl1.
          addPointStartVertex: { polygonId: 'pl2', vertexIndex: 0 },
          addPointEndVertex: null,
          isAddingPoints: true,
        });
      });
      act(() => result.current.handleCanvasDoubleClick());

      // Falls back to a plain tail extension; pl1 keeps all three of its
      // points. With the stale index applied it collapses to [(0,0),(20,20)].
      expect(result.current.polygons[0].points).toEqual([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ]);
      expect(result.current.polygons[1].points).toEqual(pl2.points);
    });

    it('ignores an anchor index this polyline no longer has', () => {
      const pl1 = makePolyline('pl1'); // 3 points, last index 2
      const { result } = renderHook(() =>
        useEnhancedSegmentationEditor({ ...baseProps, initialPolygons: [pl1] })
      );

      act(() => {
        result.current.setSelectedPolygonId('pl1');
        result.current.setEditMode(EditMode.AddPoints);
        // Drawn point beyond the HEAD, so the head branch (`pts.slice(pivot)`)
        // runs — that is the one an out-of-range pivot empties completely.
        result.current.setTempPoints([{ x: -5, y: -5 }]);
        result.current.setInteractionState({
          isDraggingVertex: false,
          isPanning: false,
          panStart: null,
          draggedVertexInfo: null,
          originalVertexPosition: null,
          sliceStartPoint: null,
          addPointStartVertex: { polygonId: 'pl1', vertexIndex: 99 },
          addPointEndVertex: null,
          isAddingPoints: true,
        });
      });
      act(() => result.current.handleCanvasDoubleClick());

      // Plain head extension. With `pts.slice(99)` the polyline would be
      // reduced to the single drawn point.
      expect(result.current.polygons[0].points).toEqual([
        { x: -5, y: -5 },
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
      ]);
    });

    it('AddPoints on a CLOSED polygon: no-op (the splice flow owns that)', () => {
      const { result } = renderHook(
        () => useEnhancedSegmentationEditor(baseProps) // p1 is a closed polygon
      );
      armAddPoints(result, 'p1', 1);

      act(() => result.current.handleCanvasDoubleClick());

      expect(result.current.polygons).toHaveLength(1);
      expect(result.current.polygons[0].points).toHaveLength(4);
      expect(result.current.editMode).toBe(EditMode.AddPoints);
    });

    it('wires a refused join to a toast', () => {
      renderHook(() => useEnhancedSegmentationEditor(baseProps));

      const onJoinBlockedByClass = vi
        .mocked(useAdvancedInteractions)
        .mock.calls.at(-1)?.[0].onJoinBlockedByClass as () => void;
      expect(onJoinBlockedByClass).toBeTypeOf('function');

      act(() => onJoinBlockedByClass());

      // A fixed sonner id, so a run of clicks inside the same hit radius
      // replaces the toast instead of stacking one per click.
      expect(toast.error).toHaveBeenCalledWith(
        'toast.segmentation.joinClassMismatch',
        { id: 'polyline-join-class-mismatch' }
      );
    });
  });
});
