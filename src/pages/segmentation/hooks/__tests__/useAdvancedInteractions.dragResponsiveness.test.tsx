/**
 * "Body se posouvaj špatně - přeskakujou" — points move badly, they skip.
 *
 * Two defects behind that, both about WHICH frames the canvas is asked to
 * draw rather than about the arithmetic (the arithmetic was fixed in #451):
 *
 *  J1  On drop, the committed points and the cleared drag offset landed in
 *      DIFFERENT commits: `updatePolygons` was wrapped in `startTransition`
 *      while `setVertexDragState` stayed urgent. React flushes urgent work
 *      first, so at least one frame showed the OLD points with NO offset —
 *      the vertex snapped back to where the drag began, then jumped forward.
 *
 *  J2  The preview froze the moment the pointer left the canvas (the canvas
 *      div carries the only onMouseMove) while the release still committed
 *      the real cursor position. Preview said one thing, commit did another.
 *
 * Neither is a timing claim, so nothing here measures a duration — the
 * evidence is the recorded sequence of rendered states and the recorded set
 * of window listeners.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import { useAdvancedInteractions } from '../useAdvancedInteractions';
import {
  EditMode,
  InteractionState,
  TransformState,
  VertexDragState,
} from '../../types';
import { Polygon, Point } from '@/lib/segmentation';

vi.mock('@/lib/coordinateUtils', () => ({
  getCanvasCoordinates: vi.fn((clientX: number, clientY: number) => ({
    imageX: clientX,
    imageY: clientY,
    canvasX: clientX,
    canvasY: clientY,
  })),
  canvasToImageCoordinates: vi.fn((x: number, y: number) => ({ x, y })),
}));

vi.mock('@/lib/polygonGeometry', () => ({
  isPointInPolygon: vi.fn(() => false),
  findClosestVertex: vi.fn(() => null),
  findClosestSegment: vi.fn(() => null),
  calculatePolygonArea: vi.fn(() => 100),
  calculatePolygonPerimeter: vi.fn(() => 100),
  createPolygon: vi.fn(points => ({ id: 'new', points })),
}));

const ORIGINAL: Point[] = [
  { x: 100, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 200 },
];

const polygon: Polygon = {
  id: 'poly-1',
  points: ORIGINAL,
  confidence: 0.9,
  type: 'external',
};

const transform: TransformState = { zoom: 1, translateX: 0, translateY: 0 };

const baseState: InteractionState = {
  isPanning: false,
  panStart: null,
  isDraggingVertex: false,
  draggedVertexInfo: null,
  originalVertexPosition: null,
  vertexGrabPoint: null,
  isAddingPoints: false,
  addPointStartVertex: null,
  addPointEndVertex: null,
  sliceStartPoint: null,
};

const idleDrag: VertexDragState = {
  isDragging: false,
  polygonId: null,
  vertexIndex: null,
};

const downOnVertex = (clientX: number, clientY: number, index: number) =>
  ({
    button: 0,
    clientX,
    clientY,
    shiftKey: false,
    altKey: false,
    target: { dataset: { polygonId: 'poly-1', vertexIndex: String(index) } },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }) as unknown as React.MouseEvent<HTMLDivElement>;

const at = (type: string, clientX: number, clientY: number) =>
  ({
    type,
    button: 0,
    clientX,
    clientY,
    shiftKey: false,
    altKey: false,
    target: { dataset: {} },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }) as unknown as React.MouseEvent<HTMLDivElement>;

// ── J1: the drop must not pass through a frame that draws neither ──────────
//
// A real component, not a bare hook: the bug is that React committed TWICE
// and the first commit was wrong, which only exists if `polygons` and
// `vertexDragState` are genuine React state driven by the hook's own
// setters. Every render pushes exactly what the canvas would have been asked
// to draw.

type Frame = { points: Point[]; drag: VertexDragState };

interface Handles {
  handleMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleMouseUp: (e: React.MouseEvent<HTMLDivElement>) => void;
}

function DragHarness({
  frames,
  handles,
}: {
  frames: Frame[];
  handles: { current: Handles | null };
}) {
  const [polygons, setPolygons] = React.useState<Polygon[]>([polygon]);
  const [drag, setDrag] = React.useState<VertexDragState>(idleDrag);
  const [istate, setIstate] = React.useState<InteractionState>(baseState);

  const polygonsRef = React.useRef(polygons);
  polygonsRef.current = polygons;
  const canvasRef = React.useRef<HTMLDivElement>(null);

  const interactions = useAdvancedInteractions({
    editMode: EditMode.EditVertices,
    interactionState: istate,
    transform,
    canvasRef,
    selectedPolygonId: 'poly-1',
    tempPoints: [],
    cursorPosition: null,
    onPolygonSelection: () => {},
    setEditMode: () => {},
    setInteractionState: setIstate,
    setTempPoints: () => {},
    setHoveredVertex: () => {},
    setHoveredJoinTarget: () => {},
    setVertexDragState: setDrag,
    updatePolygons: (next: Polygon[]) => setPolygons(next),
    getPolygons: () => polygonsRef.current,
  });

  handles.current = interactions as unknown as Handles;
  frames.push({ points: polygons[0].points, drag });

  return <div ref={canvasRef} />;
}

describe('J1 — dropping a vertex commits in ONE frame', () => {
  beforeEach(() => vi.clearAllMocks());

  const runDrop = () => {
    const frames: Frame[] = [];
    const handles: { current: Handles | null } = { current: null };
    render(<DragHarness frames={frames} handles={handles} />);

    act(() => handles.current!.handleMouseDown(downOnVertex(100, 100, 0)));
    act(() => handles.current!.handleMouseMove(at('mousemove', 150, 150)));

    const beforeDrop = frames.length;
    act(() => handles.current!.handleMouseUp(at('mouseup', 150, 150)));

    return { frames, beforeDrop };
  };

  it('never draws the old points with the drag offset already gone', () => {
    const { frames, beforeDrop } = runDrop();
    const afterDrop = frames.slice(beforeDrop);
    expect(afterDrop.length).toBeGreaterThan(0);

    // The vertex is either still being previewed at an offset, or already
    // committed at its new place. Anything else is the frame the user sees
    // as the point snapping back to where the drag started.
    const snappedBack = afterDrop
      .map((f, i) => ({
        frame: beforeDrop + i,
        point: f.points[0],
        isDragging: f.drag.isDragging,
      }))
      .filter(
        f =>
          !f.isDragging &&
          f.point.x === ORIGINAL[0].x &&
          f.point.y === ORIGINAL[0].y
      );

    expect(snappedBack).toEqual([]);
  });

  it('renders exactly one frame for the drop', () => {
    // The mechanism, stated positively: both updates are urgent, so React 18
    // batches them into a single commit. Two commits here IS the bug, and
    // this fails on the extra one even if the extra frame happened to be
    // harmless.
    const { frames, beforeDrop } = runDrop();
    expect(frames.length - beforeDrop).toBe(1);
  });

  it('that single frame carries the committed geometry and no offset', () => {
    const { frames } = runDrop();
    const last = frames[frames.length - 1];
    expect(last.points[0]).toEqual({ x: 150, y: 150 });
    expect(last.drag.isDragging).toBe(false);
    expect(last.drag.dragOffset).toBeUndefined();
    // The untouched points are still the untouched points.
    expect(last.points[1]).toEqual(ORIGINAL[1]);
    expect(last.points[2]).toEqual(ORIGINAL[2]);
  });

  it('previews the drag before the drop, so the frames are comparable', () => {
    // Guards the test itself: if the preview never ran, "no snap-back frame"
    // would be true for an entirely uninteresting reason.
    const frames: Frame[] = [];
    const handles: { current: Handles | null } = { current: null };
    render(<DragHarness frames={frames} handles={handles} />);

    act(() => handles.current!.handleMouseDown(downOnVertex(100, 100, 0)));
    act(() => handles.current!.handleMouseMove(at('mousemove', 150, 150)));

    const previewed = frames[frames.length - 1];
    expect(previewed.drag.isDragging).toBe(true);
    expect(previewed.drag.dragOffset).toEqual({ x: 50, y: 50 });
    expect(previewed.points[0]).toEqual(ORIGINAL[0]);
  });
});

// ── J2: the preview follows the pointer off the canvas ─────────────────────

describe('J2 — the drag preview survives leaving the canvas', () => {
  let state: InteractionState;
  let polygons: Polygon[];
  let canvas: HTMLDivElement;
  let setVertexDragState: ReturnType<typeof vi.fn>;
  let updatePolygons: ReturnType<typeof vi.fn>;

  const setup = () => {
    state = { ...baseState };
    polygons = [polygon];
    canvas = document.createElement('div');
    document.body.appendChild(canvas);
    setVertexDragState = vi.fn();
    updatePolygons = vi.fn((next: Polygon[]) => {
      polygons = next;
    });

    const { result, rerender, unmount } = renderHook(() =>
      useAdvancedInteractions({
        editMode: EditMode.EditVertices,
        interactionState: state,
        transform,
        canvasRef: { current: canvas },
        selectedPolygonId: 'poly-1',
        tempPoints: [],
        cursorPosition: null,
        onPolygonSelection: vi.fn(),
        setEditMode: vi.fn(),
        setInteractionState: vi.fn((s: InteractionState) => {
          state = s;
        }),
        setTempPoints: vi.fn(),
        setHoveredVertex: vi.fn(),
        setHoveredJoinTarget: vi.fn(),
        setVertexDragState,
        updatePolygons,
        getPolygons: () => polygons,
      })
    );
    return { result, rerender, unmount };
  };

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    canvas?.remove();
  });

  const windowMove = (clientX: number, clientY: number) =>
    act(() => {
      window.dispatchEvent(
        new MouseEvent('mousemove', { clientX, clientY, bubbles: true })
      );
    });

  it('keeps updating the offset for a pointer outside the canvas', () => {
    const { result, rerender } = setup();
    act(() => result.current.handleMouseDown(downOnVertex(100, 100, 0)));
    rerender();

    setVertexDragState.mockClear();
    windowMove(-400, 700);

    expect(setVertexDragState).toHaveBeenCalledTimes(1);
    expect(setVertexDragState.mock.calls[0][0]).toMatchObject({
      isDragging: true,
      polygonId: 'poly-1',
      vertexIndex: 0,
      dragOffset: { x: -500, y: 600 },
    });
  });

  it('previews exactly what the release then commits', () => {
    // The whole point of J2: before the window listener existed, the offset
    // froze at the canvas edge while `handleMouseUp` committed the real
    // release coordinates, so the two disagreed by however far the pointer
    // travelled outside.
    const { result, rerender } = setup();
    act(() => result.current.handleMouseDown(downOnVertex(100, 100, 0)));
    rerender();
    setVertexDragState.mockClear();
    windowMove(-400, 700);

    const preview = setVertexDragState.mock.calls[
      setVertexDragState.mock.calls.length - 1
    ][0] as VertexDragState;
    const previewed = {
      x: ORIGINAL[0].x + preview.dragOffset!.x,
      y: ORIGINAL[0].y + preview.dragOffset!.y,
    };

    act(() => result.current.handleMouseUp(at('mouseup', -400, 700)));
    expect(polygons[0].points[0]).toEqual(previewed);
  });

  it('ignores moves the React tree already handles', () => {
    // A move over the canvas reaches `handleMouseMove` through React's own
    // onMouseMove. Taking it here as well would double the renders per
    // frame — the opposite of what this change is for.
    const { result, rerender } = setup();
    const child = document.createElement('span');
    canvas.appendChild(child);

    act(() => result.current.handleMouseDown(downOnVertex(100, 100, 0)));
    rerender();
    setVertexDragState.mockClear();

    act(() => {
      child.dispatchEvent(
        new MouseEvent('mousemove', {
          clientX: 150,
          clientY: 150,
          bubbles: true,
        })
      );
    });
    expect(setVertexDragState).not.toHaveBeenCalled();

    // ...and the same move from outside IS taken, so the assertion above is
    // about the target and not about the listener being absent entirely.
    windowMove(150, 150);
    expect(setVertexDragState).toHaveBeenCalledTimes(1);
  });

  it('binds the listener only for the duration of the drag', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    const { result, rerender, unmount } = setup();
    expect(add.mock.calls.filter(c => c[0] === 'mousemove')).toHaveLength(0);

    act(() => result.current.handleMouseDown(downOnVertex(100, 100, 0)));
    rerender();
    expect(add.mock.calls.filter(c => c[0] === 'mousemove')).toHaveLength(1);

    unmount();
    expect(remove.mock.calls.filter(c => c[0] === 'mousemove')).toHaveLength(1);

    add.mockRestore();
    remove.mockRestore();
  });

  it('ignores a move that is older than one already drawn', () => {
    // The two paths run on different schedules: the canvas's onMouseMove is
    // deferred into a coalesced rAF by `enhancedHandleMouseMove`, this one is
    // synchronous. Crossing the edge therefore sequences as move-A (rAF
    // scheduled) -> move-B (drawn here) -> rAF fires with the STALE A. Left
    // alone that flicks the vertex backwards for one frame at exactly the
    // moment the pointer leaves — the one-frame-wrong preview this whole
    // change exists to remove.
    const { result, rerender } = setup();
    act(() => result.current.handleMouseDown(downOnVertex(100, 100, 0)));
    rerender();
    setVertexDragState.mockClear();

    // The timestamps are set explicitly. jsdom quantises the clock to a whole
    // millisecond, so two events constructed in the same tick carry the SAME
    // timeStamp and could not express "older" at all — and only a strictly
    // older event is dropped, because two real events sharing a coarsened
    // timestamp must both still be drawn.
    const stamp = (e: MouseEvent, value: number) => {
      Object.defineProperty(e, 'timeStamp', { value, configurable: true });
      return e;
    };
    const older = stamp(
      new MouseEvent('mousemove', { clientX: 120, clientY: 120 }),
      1000
    );
    const newer = stamp(
      new MouseEvent('mousemove', { clientX: 300, clientY: 400 }),
      1016
    );

    act(() => window.dispatchEvent(newer));
    // The rAF-deferred replay of the earlier event.
    act(() =>
      result.current.handleMouseMove(
        older as unknown as React.MouseEvent<HTMLDivElement>
      )
    );

    // Exactly one offset was drawn, and it is the newer one.
    expect(setVertexDragState).toHaveBeenCalledTimes(1);
    expect(setVertexDragState.mock.calls[0][0]).toMatchObject({
      dragOffset: { x: 200, y: 300 },
    });
  });

  it('stops previewing once the drag has ended', () => {
    const { result, rerender } = setup();
    act(() => result.current.handleMouseDown(downOnVertex(100, 100, 0)));
    rerender();
    act(() => result.current.handleMouseUp(at('mouseup', 150, 150)));
    rerender();

    setVertexDragState.mockClear();
    windowMove(999, 999);
    expect(setVertexDragState).not.toHaveBeenCalled();
    // The committed point is the released one, not the stray move.
    expect(polygons[0].points[0]).toEqual({ x: 150, y: 150 });
  });
});
