/**
 * useEnhancedSegmentationEditor — what the editor does with a scribble:
 * Esc cancels it without leaving the mode, a release deletes every touched
 * shape in ONE history step, tracked microtubules are handed to the parent's
 * scope question, and only the shapes the canvas renders can be touched.
 *
 * The mouse handlers are mocked (their wiring has its own suite,
 * `useAdvancedInteractions.scribble.test.tsx`); the scribble is driven through
 * the eraser object the editor hands to them, which is exactly the object the
 * real handlers call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEnhancedSegmentationEditor } from '../useEnhancedSegmentationEditor';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import { useAdvancedInteractions } from '../useAdvancedInteractions';
import { EditMode } from '../../types';
import type { Polygon } from '@/lib/segmentation';
import { toast } from 'sonner';

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
  calculateFixedPointZoom: vi.fn((t: unknown) => t),
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
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/errorUtils', () => ({
  handleCancelledError: vi.fn(() => false),
}));

const square = (id: string, min: number, max: number): Polygon => ({
  id,
  points: [
    { x: min, y: min },
    { x: max, y: min },
    { x: max, y: max },
    { x: min, y: max },
  ],
  type: 'external',
});

const A = square('a', 0, 10);
const B = square('b', 20, 30);
const C = square('c', 40, 50);

const baseProps = {
  initialPolygons: [A, B, C],
  imageWidth: 100,
  imageHeight: 100,
  canvasWidth: 100,
  canvasHeight: 100,
};

/** The eraser the editor last handed to the mouse handlers. */
const eraser = () => {
  const props = vi.mocked(useAdvancedInteractions).mock.calls.at(-1)![0];
  if (!props.scribbleEraser) throw new Error('no scribbleEraser prop');
  return props.scribbleEraser;
};
const pressEscape = () =>
  vi.mocked(useKeyboardShortcuts).mock.calls.at(-1)![0].onEscape!();

/** A stroke from the middle of A to the middle of B. */
const scribbleAB = () => {
  act(() => eraser().start({ x: 5, y: 5 }));
  act(() => eraser().extend({ x: 25, y: 25 }));
};

const ids = (polys: Polygon[]) => polys.map(p => p.id);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useEnhancedSegmentationEditor — scribble delete', () => {
  it('Esc mid-scribble cancels and keeps the mode', () => {
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor(baseProps)
    );
    act(() => result.current.setEditMode(EditMode.DeletePolygon));
    scribbleAB();
    expect(result.current.scribble?.pendingIds.has('a')).toBe(true);

    act(() => pressEscape());
    expect(result.current.scribble).toBeNull();
    expect(result.current.editMode).toBe(EditMode.DeletePolygon);

    // Released after Esc: nothing left to commit.
    act(() => eraser().commit());
    expect(ids(result.current.polygons)).toEqual(['a', 'b', 'c']);

    // Second Esc, no scribble: today's behaviour — back to View.
    act(() => pressEscape());
    expect(result.current.editMode).toBe(EditMode.View);
  });

  it('one scribble is one undo step', () => {
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor(baseProps)
    );
    act(() => result.current.setEditMode(EditMode.DeletePolygon));
    scribbleAB();
    act(() => eraser().commit());

    expect(ids(result.current.polygons)).toEqual(['c']);
    expect(toast.success).toHaveBeenCalledTimes(1);

    act(() => result.current.handleUndo());
    expect(ids(result.current.polygons)).toEqual(['a', 'b', 'c']);
    expect(result.current.canUndo).toBe(false);
  });

  it('ids claimed by onRequestDeletePolygons are not deleted locally', () => {
    const onRequestDeletePolygons = vi.fn((list: string[]) =>
      list.filter(id => id !== 'a')
    );
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor({ ...baseProps, onRequestDeletePolygons })
    );
    act(() => result.current.setEditMode(EditMode.DeletePolygon));
    scribbleAB();
    act(() => eraser().commit());

    expect(onRequestDeletePolygons).toHaveBeenCalledWith(['a', 'b']);
    expect(ids(result.current.polygons)).toEqual(['a', 'c']);
  });

  it('nothing deleted means no history entry and no toast', () => {
    const onRequestDeletePolygons = vi.fn(() => []);
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor({ ...baseProps, onRequestDeletePolygons })
    );
    act(() => result.current.setEditMode(EditMode.DeletePolygon));
    scribbleAB();
    act(() => eraser().commit());

    expect(ids(result.current.polygons)).toEqual(['a', 'b', 'c']);
    expect(result.current.canUndo).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('only the shapes getScribbleCandidates returns can be hit', () => {
    // A is in the editor but not rendered (hidden): the stroke crosses it
    // and must leave it alone.
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor({
        ...baseProps,
        getScribbleCandidates: () => [B, C],
      })
    );
    act(() => result.current.setEditMode(EditMode.DeletePolygon));
    scribbleAB();
    act(() => eraser().commit());

    expect(ids(result.current.polygons)).toEqual(['a', 'c']);
  });

  it('a mode change cancels the scribble', () => {
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor(baseProps)
    );
    act(() => result.current.setEditMode(EditMode.DeletePolygon));
    scribbleAB();
    act(() => result.current.setEditMode(EditMode.View));

    expect(result.current.scribble).toBeNull();
    act(() => eraser().commit());
    expect(ids(result.current.polygons)).toEqual(['a', 'b', 'c']);
  });

  it('deleting the selected polygon clears the selection', () => {
    const { result } = renderHook(() =>
      useEnhancedSegmentationEditor(baseProps)
    );
    act(() => result.current.setSelectedPolygonId('a'));
    act(() => result.current.setEditMode(EditMode.DeletePolygon));
    scribbleAB();
    act(() => eraser().commit());
    expect(result.current.selectedPolygonId).toBeNull();
  });
});
