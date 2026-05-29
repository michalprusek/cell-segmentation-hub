/**
 * useEnhancedSegmentationEditor – gaps3: autosave, beforeunload,
 * handleSave cancel/no-op, handlePan, transform, handleDeletePolygon variants.
 *
 * Targets branches NOT covered by .test.tsx / .extra.test.tsx / .gaps.test.tsx:
 *  1. handleSave: skips when !hasUnsavedChanges
 *  2. handleSave: skips when !onSave
 *  3. handleSave: success path → toast.success + hasUnsavedChanges=false
 *  4. handleSave: onSave throws → toast.error
 *  5. handleDeletePolygon(id): deletes by explicit id regardless of selection
 *  6. handleDeletePolygon(): deletes selected polygon when no arg given
 *  7. handleDeletePolygon(): no-op when neither id nor selection
 *  8. handlePan: applies delta to transform
 *  9. handleZoomIn / handleZoomOut / handleResetView: callable without crash
 * 10. beforeunload event: sets returnValue when hasUnsavedChanges=true
 * 11. beforeunload event: no returnValue when hasUnsavedChanges=false
 * 12. setEditMode functional-form overload calls inner setter
 * 13. autosaveBeforeReset: calls onSave when switching images
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEnhancedSegmentationEditor } from '../useEnhancedSegmentationEditor';
import { EditMode } from '../../types';
import { Polygon } from '@/lib/segmentation';
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
  })),
}));

vi.mock('@/lib/coordinateUtils', () => ({
  calculateCenteringTransform: vi.fn(() => ({
    zoom: 1,
    translateX: 0,
    translateY: 0,
  })),
  calculateFixedPointZoom: vi.fn(
    (transform: any, _pt: any, factor: number) => ({
      ...transform,
      zoom: transform.zoom * factor,
    })
  ),
  constrainTransform: vi.fn((t: any) => t),
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

const baseProps = {
  initialPolygons: [makePolygon('p1')],
  imageWidth: 100,
  imageHeight: 100,
  canvasWidth: 100,
  canvasHeight: 100,
  imageId: 'img-1',
};

// ── TESTS ─────────────────────────────────────────────────────────────────────

describe('useEnhancedSegmentationEditor – gaps3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // 1. handleSave: skips when !hasUnsavedChanges
  // --------------------------------------------------------------------------

  it('handleSave is a no-op when hasUnsavedChanges=false', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor({ ...baseProps, onSave })
    );

    // hasUnsavedChanges starts false
    await act(async () => {
      await result.current.handleSave();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 2. handleSave: skips when !onSave
  // --------------------------------------------------------------------------

  it('handleSave is a no-op when onSave is undefined', async () => {
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor({
        ...baseProps,
        onSave: undefined,
      })
    );

    // Force unsaved changes
    act(() => {
      result.current.updatePolygons([makePolygon('p2')]);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    // toast never fired because onSave is absent
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 3. handleSave: success → toast.success + clears hasUnsavedChanges
  // --------------------------------------------------------------------------

  it('handleSave calls onSave and shows success toast', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor({ ...baseProps, onSave })
    );

    act(() => {
      result.current.updatePolygons([makePolygon('p2')]);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 4. handleSave: onSave throws → toast.error
  // --------------------------------------------------------------------------

  it('handleSave shows error toast when onSave rejects', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('save failed'));
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor({ ...baseProps, onSave })
    );

    act(() => {
      result.current.updatePolygons([makePolygon('p2')]);
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    // hasUnsavedChanges remains true (save failed)
    expect(result.current.hasUnsavedChanges).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 5. handleDeletePolygon(id): explicit id
  // --------------------------------------------------------------------------

  it('handleDeletePolygon(id) deletes the specified polygon', () => {
    const p1 = makePolygon('p1');
    const p2 = makePolygon('p2');

    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor({
        ...baseProps,
        initialPolygons: [p1, p2],
      })
    );

    act(() => {
      result.current.handleDeletePolygon('p1');
    });

    expect(result.current.polygons).toHaveLength(1);
    expect(result.current.polygons[0].id).toBe('p2');
  });

  // --------------------------------------------------------------------------
  // 6. handleDeletePolygon(): deletes selected polygon
  // --------------------------------------------------------------------------

  it('handleDeletePolygon() deletes the currently selected polygon', () => {
    const p1 = makePolygon('p1');
    const p2 = makePolygon('p2');

    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor({
        ...baseProps,
        initialPolygons: [p1, p2],
      })
    );

    act(() => {
      result.current.setSelectedPolygonId('p1');
    });

    act(() => {
      result.current.handleDeletePolygon();
    });

    expect(result.current.polygons.map(p => p.id)).not.toContain('p1');
  });

  // --------------------------------------------------------------------------
  // 7. handleDeletePolygon(): no-op when nothing is selected and no id
  // --------------------------------------------------------------------------

  it('handleDeletePolygon() is a no-op when nothing is selected', () => {
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor(baseProps)
    );

    act(() => {
      result.current.handleDeletePolygon();
    });

    // polygons unchanged
    expect(result.current.polygons).toHaveLength(1);
  });

  // --------------------------------------------------------------------------
  // 8. handlePan: applies delta to transform
  // --------------------------------------------------------------------------

  it('handlePan updates translateX/Y by the given delta', () => {
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor(baseProps)
    );

    const before = result.current.transform;

    act(() => {
      result.current.handlePan(15, -5);
    });

    // constrainTransform is a passthrough in our mock, so deltas apply directly
    expect(result.current.transform.translateX).toBe(before.translateX + 15);
    expect(result.current.transform.translateY).toBe(before.translateY - 5);
  });

  // --------------------------------------------------------------------------
  // 9. handleZoomIn / handleZoomOut / handleResetView
  // --------------------------------------------------------------------------

  it('handleZoomIn and handleZoomOut are callable without throwing', () => {
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor(baseProps)
    );

    expect(() => {
      act(() => result.current.handleZoomIn());
      act(() => result.current.handleZoomOut());
    }).not.toThrow();
  });

  it('handleResetView resets transform to centering values', () => {
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor(baseProps)
    );

    // Pan away first
    act(() => result.current.handlePan(200, 200));
    expect(result.current.transform.translateX).toBe(200);

    act(() => result.current.handleResetView());

    // After reset, calculateCenteringTransform mock returns {zoom:1, tx:0, ty:0}
    expect(result.current.transform.translateX).toBe(0);
    expect(result.current.transform.translateY).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 10. beforeunload event: sets returnValue when hasUnsavedChanges=true
  // --------------------------------------------------------------------------

  it('beforeunload sets event.returnValue when there are unsaved changes', () => {
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor(baseProps)
    );

    // Mark unsaved
    act(() => {
      result.current.updatePolygons([makePolygon('p2')]);
    });
    expect(result.current.hasUnsavedChanges).toBe(true);

    const event = new Event('beforeunload') as BeforeUnloadEvent;
    Object.defineProperty(event, 'returnValue', {
      writable: true,
      value: '',
    });

    window.dispatchEvent(event);

    expect(event.returnValue).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // 11. beforeunload: no returnValue when clean
  // --------------------------------------------------------------------------

  it('beforeunload does not set returnValue when no unsaved changes', () => {
    const { result: _result } = renderHook(() =>
      useEnhancedSegmentationEditor(baseProps)
    );

    // No changes made — hasUnsavedChanges = false
    const event = new Event('beforeunload') as BeforeUnloadEvent;
    Object.defineProperty(event, 'returnValue', {
      writable: true,
      value: '',
    });

    window.dispatchEvent(event);

    expect(event.returnValue).toBe('');
  });

  // --------------------------------------------------------------------------
  // 12. setEditMode: functional-form overload
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // 13. autosaveBeforeReset: calls onSave when imageId changes with unsaved changes
  // --------------------------------------------------------------------------

  it('autosaves when switching to a new imageId with unsaved changes', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      (props: any) => useEnhancedSegmentationEditor(props),
      {
        initialProps: { ...baseProps, imageId: 'img-a', onSave },
      }
    );

    // Make an unsaved change on img-a
    act(() => {
      result.current.updatePolygons([makePolygon('p2')]);
    });

    expect(result.current.hasUnsavedChanges).toBe(true);

    // Switch to img-b — should trigger autosave for img-a
    await act(async () => {
      rerender({
        ...baseProps,
        imageId: 'img-b',
        initialPolygons: [],
        onSave,
      });
    });

    // onSave should have been called with the old image's data
    expect(onSave).toHaveBeenCalled();
    // The call should reference the previous imageId
    const firstCall = onSave.mock.calls[0];
    expect(firstCall[1]).toBe('img-a');
  });
});
