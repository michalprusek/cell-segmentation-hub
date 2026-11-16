/**
 * useAdvancedInteractions — the delete tool's scribble, wired end to end
 * through the mouse handlers.
 *
 * From a 2026-11-16 request: "chci aby se daly kreslit scribbles a mazaly se
 * všechny polygony, které budou mít se scribble průnik — při přejetí
 * scribblem ať polygony vyblednou a po puštění levého tlačítka ať se smažou.
 * Kreslení scribble ať se dá ukončit pomocí esc."
 *
 * The geometry is NOT mocked here (unlike the sibling suites): the point is
 * that the handlers feed the real hit test the right segments.
 * `getCanvasCoordinates` is identity, so client coordinates ARE image ones.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAdvancedInteractions } from '../useAdvancedInteractions';
import { useScribbleErase } from '../useScribbleErase';
import { EditMode, InteractionState, TransformState } from '../../types';
import type { Point, Polygon } from '@/lib/segmentation';

vi.mock('@/lib/coordinateUtils', () => ({
  getCanvasCoordinates: vi.fn((clientX: number, clientY: number) => ({
    imageX: clientX,
    imageY: clientY,
  })),
}));

const CANVAS_REF = { current: document.createElement('div') };
const TRANSFORM: TransformState = { zoom: 1, translateX: 0, translateY: 0 };
const IDLE: InteractionState = {
  isPanning: false,
  panStart: null,
  isDraggingVertex: false,
  draggedVertexInfo: null,
  originalVertexPosition: null,
  isAddingPoints: false,
  addPointStartVertex: null,
  addPointEndVertex: null,
  sliceStartPoint: null,
};

const p = (x: number, y: number): Point => ({ x, y });
const line = (id: string, y: number): Polygon =>
  ({
    id,
    points: [p(0, y), p(100, y)],
    type: 'external',
    geometry: 'polyline',
  }) as Polygon;
const square = (id: string, min: number, max: number): Polygon =>
  ({
    id,
    points: [p(min, min), p(max, min), p(max, max), p(min, max)],
    type: 'external',
    geometry: 'polygon',
  }) as Polygon;

const mouse = (
  x: number,
  y: number,
  extra: Record<string, unknown> = {}
): React.MouseEvent<HTMLDivElement> =>
  ({
    button: 0,
    detail: 1,
    clientX: x,
    clientY: y,
    altKey: false,
    shiftKey: false,
    type: 'mousedown',
    target: document.createElement('div'),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...extra,
  }) as unknown as React.MouseEvent<HTMLDivElement>;

let onCommit: ReturnType<typeof vi.fn>;
let setEditMode: ReturnType<typeof vi.fn>;

function setup(polygons: Polygon[], candidates: Polygon[] = polygons) {
  return renderHook(() => {
    const eraser = useScribbleErase({
      getCandidates: () => candidates,
      getZoom: () => 1,
      onCommit,
    });
    const interactions = useAdvancedInteractions({
      editMode: EditMode.DeletePolygon,
      interactionState: IDLE,
      transform: TRANSFORM,
      canvasRef: CANVAS_REF,
      selectedPolygonId: null,
      tempPoints: [],
      cursorPosition: null,
      isShiftPressed: () => false,
      isSpacePressed: () => false,
      onPolygonSelection: vi.fn(),
      setEditMode,
      setInteractionState: vi.fn(),
      setTempPoints: vi.fn(),
      setHoveredVertex: vi.fn(),
      setHoveredJoinTarget: vi.fn(),
      setVertexDragState: vi.fn(),
      updatePolygons: vi.fn(),
      getPolygons: () => polygons,
      handlePan: vi.fn(),
      scribbleEraser: eraser,
    });
    return { eraser, interactions };
  });
}

beforeEach(() => {
  onCommit = vi.fn();
  setEditMode = vi.fn();
});

describe('useAdvancedInteractions — scribble delete', () => {
  it('drag across two polylines marks both pending and commits both', () => {
    const { result } = setup([line('a', 50), line('b', 70), line('c', 200)]);

    act(() => result.current.interactions.handleMouseDown(mouse(50, 0)));
    act(() => result.current.interactions.handleMouseMove(mouse(50, 100)));

    expect([...(result.current.eraser.scribble?.pendingIds ?? [])]).toEqual([
      'a',
      'b',
    ]);
    expect(onCommit).not.toHaveBeenCalled();

    act(() =>
      result.current.interactions.handleMouseUp(
        mouse(50, 100, { type: 'mouseup' })
      )
    );
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(['a', 'b']);
    expect(result.current.eraser.scribble).toBeNull();
  });

  it('click commits every shape under the point', () => {
    const { result } = setup([square('lo', 0, 100), square('hi', 50, 150)]);
    act(() => result.current.interactions.handleMouseDown(mouse(75, 75)));
    act(() =>
      result.current.interactions.handleMouseUp(
        mouse(75, 75, { type: 'mouseup' })
      )
    );
    expect(onCommit).toHaveBeenCalledWith(['lo', 'hi']);
  });

  it('release point extends the stroke before committing', () => {
    // No mousemove at all: the canvas's moves are rAF-deferred, so a quick
    // flick can be released before its last move is processed.
    const { result } = setup([line('a', 50)]);
    act(() => result.current.interactions.handleMouseDown(mouse(50, 0)));
    act(() =>
      result.current.interactions.handleMouseUp(
        mouse(50, 100, { type: 'mouseup' })
      )
    );
    expect(onCommit).toHaveBeenCalledWith(['a']);
  });

  it('never hits a polygon missing from the candidates', () => {
    // 'hidden' is in the editor's polygons but not rendered (eye toggle).
    const hidden = line('hidden', 60);
    const { result } = setup([line('a', 50), hidden], [line('a', 50)]);
    act(() => result.current.interactions.handleMouseDown(mouse(50, 0)));
    act(() => result.current.interactions.handleMouseMove(mouse(50, 100)));
    act(() =>
      result.current.interactions.handleMouseUp(
        mouse(50, 100, { type: 'mouseup' })
      )
    );
    expect(onCommit).toHaveBeenCalledWith(['a']);
  });

  it('mouseleave keeps the scribble', () => {
    const { result } = setup([line('a', 50)]);
    act(() => result.current.interactions.handleMouseDown(mouse(50, 0)));
    act(() => result.current.interactions.handleMouseMove(mouse(50, 100)));
    act(() =>
      result.current.interactions.handleMouseUp(
        mouse(50, 100, { type: 'mouseleave' })
      )
    );
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.eraser.scribble).not.toBeNull();
  });

  it('window mouseup commits a stroke released outside the canvas', () => {
    const { result } = setup([line('a', 50), line('b', 300)]);
    act(() => result.current.interactions.handleMouseDown(mouse(50, 0)));
    act(() =>
      result.current.interactions.handleMouseUp(
        mouse(50, 10, { type: 'mouseleave' })
      )
    );
    // Outside the canvas the only listener is the window one: moves...
    act(() => {
      window.dispatchEvent(
        new MouseEvent('mousemove', { clientX: 50, clientY: 400 })
      );
    });
    expect(result.current.eraser.scribble?.pendingIds.has('b')).toBe(true);
    // ...and the release.
    act(() => {
      window.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 50, clientY: 400 })
      );
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(['a', 'b']);
  });

  it('right-click mid-scribble cancels without changing mode', () => {
    const { result } = setup([line('a', 50)]);
    act(() => result.current.interactions.handleMouseDown(mouse(50, 0)));
    act(() => result.current.interactions.handleMouseMove(mouse(50, 100)));
    act(() =>
      result.current.interactions.handleMouseDown(mouse(50, 100, { button: 2 }))
    );
    expect(result.current.eraser.scribble).toBeNull();
    expect(setEditMode).not.toHaveBeenCalled();

    act(() =>
      result.current.interactions.handleMouseUp(
        mouse(50, 100, { type: 'mouseup' })
      )
    );
    expect(onCommit).not.toHaveBeenCalled();
  });

  // The right press cancels on mousedown, but `contextmenu` is a separate
  // event — before the mouseup on Linux, after it on Windows — and over a
  // shape it would open that shape's Radix menu.
  it('right-click cancel swallows the context menu it raises', () => {
    const { result } = setup([line('a', 50)]);
    act(() => result.current.interactions.handleMouseDown(mouse(50, 0)));
    act(() =>
      result.current.interactions.handleMouseDown(mouse(50, 10, { button: 2 }))
    );
    const menu = mouse(50, 10, { type: 'contextmenu', button: 2 });
    result.current.interactions.handleContextMenuCapture(menu);
    expect(menu.preventDefault).toHaveBeenCalled();
    expect(menu.stopPropagation).toHaveBeenCalled();

    // One-shot: the next right-click opens its menu normally.
    const next = mouse(50, 10, { type: 'contextmenu', button: 2 });
    result.current.interactions.handleContextMenuCapture(next);
    expect(next.preventDefault).not.toHaveBeenCalled();
    expect(next.stopPropagation).not.toHaveBeenCalled();
  });

  it('a later press clears a suppression no contextmenu consumed', () => {
    const { result } = setup([line('a', 50)]);
    act(() => result.current.interactions.handleMouseDown(mouse(50, 0)));
    act(() =>
      result.current.interactions.handleMouseDown(mouse(50, 10, { button: 2 }))
    );
    // No contextmenu arrived; the user simply goes on with a new stroke.
    act(() => result.current.interactions.handleMouseDown(mouse(60, 0)));
    act(() =>
      result.current.interactions.handleMouseUp(
        mouse(60, 0, { type: 'mouseup' })
      )
    );
    const later = mouse(50, 10, { type: 'contextmenu', button: 2 });
    result.current.interactions.handleContextMenuCapture(later);
    expect(later.preventDefault).not.toHaveBeenCalled();
  });

  it('alt+drag pans instead of scribbling', () => {
    const { result } = setup([line('a', 50)]);
    act(() =>
      result.current.interactions.handleMouseDown(
        mouse(50, 0, { altKey: true })
      )
    );
    expect(result.current.eraser.scribble).toBeNull();
  });
});
