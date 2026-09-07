/**
 * Vertex drag: what the user grabbed is what moves, and leaving the canvas
 * does not commit.
 *
 * Reported by Institut Curie, 2026-09-04:
 *
 *   "When moving vertices, the vertex often jumps to a completely different
 *    place compared to where I drop it. Today it is even so bad that the
 *    vertex jumped out of the field of view so I cannot grab it to move it
 *    or remove it anymore. I now need to delete the segmentation line and
 *    re-draw it."
 *
 * Two independent defects were behind that, both measured on production
 * before being fixed here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAdvancedInteractions } from '../useAdvancedInteractions';
import { EditMode, InteractionState, TransformState } from '../../types';
import { Polygon } from '@/lib/segmentation';

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
  createPolygon: vi.fn(points => ({ id: 'new', points })),
}));

const polygon: Polygon = {
  id: 'poly-1',
  points: [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 200 },
  ],
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

/** A mousedown on the vertex element, as the canvas handler sees it. */
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

describe('vertex drag', () => {
  let state: InteractionState;
  let polygons: Polygon[];
  let updatePolygons: ReturnType<typeof vi.fn>;

  const setup = () => {
    state = { ...baseState };
    polygons = [polygon];
    updatePolygons = vi.fn((next: Polygon[]) => {
      polygons = next;
    });
    const { result, rerender } = renderHook(() =>
      useAdvancedInteractions({
        editMode: EditMode.EditVertices,
        interactionState: state,
        transform,
        canvasRef: { current: document.createElement('div') },
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
        setVertexDragState: vi.fn(),
        updatePolygons,
        getPolygons: () => polygons,
      })
    );
    return { result, rerender };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves the vertex BY the drag, not TO the cursor', () => {
    // Grab vertex 0 (at 100,100) four pixels off centre — inside the 8 px
    // grab radius — and drag by (+120, +60). Committing the raw cursor
    // position instead of the delta lands it at (224, 160): measured on
    // production as a 3.35 px error, and enough on a dense microtubule
    // polyline to snatch a neighbouring vertex and snap it under the pointer.
    const { result, rerender } = setup();

    act(() => result.current.handleMouseDown(downOnVertex(104, 100, 0)));
    rerender();
    act(() => result.current.handleMouseUp(at('mouseup', 224, 160)));

    const moved = polygons[0].points[0];
    expect(moved.x).toBeCloseTo(220, 5);
    expect(moved.y).toBeCloseTo(160, 5);
  });

  it('leaves the other vertices alone', () => {
    const { result, rerender } = setup();
    act(() => result.current.handleMouseDown(downOnVertex(100, 100, 0)));
    rerender();
    act(() => result.current.handleMouseUp(at('mouseup', 150, 150)));

    expect(polygons[0].points[1]).toEqual({ x: 200, y: 100 });
    expect(polygons[0].points[2]).toEqual({ x: 200, y: 200 });
  });

  it('does not commit when the pointer merely leaves the canvas', () => {
    // `CanvasContainer` routes onMouseLeave into this same handler. It used to
    // commit the vertex wherever the pointer crossed the canvas edge, and
    // nothing clamps that back into the image — which is how a vertex ends up
    // outside the field of view, impossible to grab or delete. The drag has to
    // survive leaving the canvas; the real release is caught at the window.
    const { result, rerender } = setup();

    act(() => result.current.handleMouseDown(downOnVertex(100, 100, 0)));
    rerender();
    act(() => result.current.handleMouseUp(at('mouseleave', -400, -400)));

    expect(updatePolygons).not.toHaveBeenCalled();
    expect(polygons[0].points[0]).toEqual({ x: 100, y: 100 });
    expect(state.isDraggingVertex).toBe(true);
  });

  it('still ends a PAN when the pointer leaves the canvas', () => {
    // Only the vertex drag is exempt: a pan that runs off the canvas should
    // still stop, or the canvas keeps following the pointer afterwards.
    state = { ...baseState, isPanning: true, panStart: { x: 10, y: 10 } };
    polygons = [polygon];
    const setInteractionState = vi.fn((s: InteractionState) => {
      state = s;
    });
    const { result } = renderHook(() =>
      useAdvancedInteractions({
        editMode: EditMode.EditVertices,
        interactionState: state,
        transform,
        canvasRef: { current: document.createElement('div') },
        selectedPolygonId: 'poly-1',
        tempPoints: [],
        cursorPosition: null,
        onPolygonSelection: vi.fn(),
        setEditMode: vi.fn(),
        setInteractionState,
        setTempPoints: vi.fn(),
        setHoveredVertex: vi.fn(),
        setHoveredJoinTarget: vi.fn(),
        setVertexDragState: vi.fn(),
        updatePolygons: vi.fn(),
        getPolygons: () => polygons,
      })
    );

    act(() => result.current.handleMouseUp(at('mouseleave', -400, -400)));
    expect(setInteractionState).toHaveBeenCalled();
    expect(state.isPanning).toBe(false);
  });
});
/** A mousedown on the shape's CONTOUR — the outline, not a vertex. */
const contourEvent = (
  clientX: number,
  clientY: number,
  shiftKey: boolean,
  polygonId = 'poly-1'
) =>
  ({
    button: 0,
    clientX,
    clientY,
    shiftKey,
    altKey: false,
    target: { dataset: { polygonId, polygonContour: 'true' } },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }) as unknown as React.MouseEvent<HTMLDivElement>;

const downOnContour = (clientX: number, clientY: number, polygonId?: string) =>
  contourEvent(clientX, clientY, false, polygonId);

/**
 * A bent polyline — the shape the bug was actually reported on.
 *
 * It BENDS on purpose: a straight fixture is carried by a sign-flipped or
 * axis-swapped delta just as convincingly as by the right one, and a rigid
 * fixture that is symmetric under the transform proves nothing at all. Every
 * segment here has a different direction, so only a true translation
 * reproduces it.
 */
const polyline: Polygon = {
  id: 'mt-1',
  points: [
    { x: 40, y: 300 },
    { x: 120, y: 260 },
    { x: 150, y: 330 },
    { x: 260, y: 290 },
  ],
  confidence: 0.8,
  type: 'external',
  geometry: 'polyline',
};

/**
 * Whole-shape translation lives in its OWN mode.
 *
 * The gesture shipped gated to EditVertices (2026-09-04), which was not a gate
 * in practice: `usePolygonSelection` auto-switches View -> EditVertices on the
 * first click on any shape, so one click on a microtubule armed a mode the
 * user never asked for and the next press-and-drag moved it. Reported as
 * "polylines and polygons shift by themselves".
 *
 * The pair of assertions this whole file turns on is therefore:
 * dragging a shape does NOTHING in EditVertices, and translates it in
 * MoveShape.
 */
describe('MoveShape mode translates a whole shape', () => {
  let state: InteractionState;
  let polygons: Polygon[];
  let updatePolygons: ReturnType<typeof vi.fn>;
  let onPolygonSelection: ReturnType<typeof vi.fn>;

  const setup = (
    mode: EditMode = EditMode.MoveShape,
    selected: string | null = 'poly-1',
    shapes: Polygon[] = [polygon]
  ) => {
    state = { ...baseState };
    polygons = shapes;
    updatePolygons = vi.fn((next: Polygon[]) => {
      polygons = next;
    });
    onPolygonSelection = vi.fn();
    const { result, rerender } = renderHook(() =>
      useAdvancedInteractions({
        editMode: mode,
        interactionState: state,
        transform,
        canvasRef: { current: document.createElement('div') },
        selectedPolygonId: selected,
        tempPoints: [],
        cursorPosition: null,
        onPolygonSelection,
        setEditMode: vi.fn(),
        setInteractionState: vi.fn((s: InteractionState) => {
          state = s;
        }),
        setTempPoints: vi.fn(),
        setHoveredVertex: vi.fn(),
        setHoveredJoinTarget: vi.fn(),
        setVertexDragState: vi.fn(),
        updatePolygons,
        getPolygons: () => polygons,
      })
    );
    return { result, rerender };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves every point by the same delta', () => {
    const { result, rerender } = setup();
    act(() => result.current.handleMouseDown(downOnContour(150, 120)));
    rerender();
    act(() => result.current.handleMouseUp(at('mouseup', 190, 145)));

    // grabbed at (150,120), released at (190,145) -> +40, +25 on every point
    expect(polygons[0].points).toEqual([
      { x: 140, y: 125 },
      { x: 240, y: 125 },
      { x: 240, y: 225 },
    ]);
  });

  it('keeps a BENT polyline rigid — every segment survives the move', () => {
    // Asserting the exact translated points, not just "each point moved by the
    // same delta as point 0": the weaker form is satisfied by a drag that
    // moved nothing at all, which is exactly what a broken gate produces.
    const { result, rerender } = setup(EditMode.MoveShape, 'mt-1', [polyline]);
    act(() => result.current.handleMouseDown(downOnContour(120, 260, 'mt-1')));
    rerender();
    act(() => result.current.handleMouseUp(at('mouseup', 83, 401)));

    // -37, +141 on every point.
    expect(polygons[0].points).toEqual([
      { x: 3, y: 441 },
      { x: 83, y: 401 },
      { x: 113, y: 471 },
      { x: 223, y: 431 },
    ]);
  });

  it('selects a shape that was not selected, so the first drag works', () => {
    const { result } = setup(EditMode.MoveShape, null);
    act(() => result.current.handleMouseDown(downOnContour(150, 120)));
    expect(onPolygonSelection).toHaveBeenCalledWith('poly-1');
  });

  it('does NOT translate in EditVertices — this is the whole point of the mode', () => {
    // The regression this mode exists to fix. In EditVertices a drag on the
    // outline used to move the shape, and the editor auto-enters EditVertices
    // on the first click, so users moved microtubules without arming anything.
    //
    // The drag must not even START: asserting only on the committed points
    // hides the case where the mousedown happens to bail out later for an
    // unrelated reason, which is what an earlier version of this test did —
    // the mode guard could be deleted and it still passed.
    const { result, rerender } = setup(EditMode.EditVertices);
    act(() => result.current.handleMouseDown(downOnContour(150, 120)));
    rerender();
    expect(state.isDraggingVertex).toBe(false);
    act(() => result.current.handleMouseUp(at('mouseup', 190, 145)));
    expect(updatePolygons).not.toHaveBeenCalled();
    expect(polygons[0].points).toEqual(polygon.points);
  });

  it('does NOT translate in View, where a drag means pan', () => {
    const { result, rerender } = setup(EditMode.View);
    act(() => result.current.handleMouseDown(downOnContour(150, 120)));
    rerender();
    expect(state.isDraggingVertex).toBe(false);
    act(() => result.current.handleMouseUp(at('mouseup', 190, 145)));
    expect(polygons[0].points).toEqual(polygon.points);
  });

  it('a VERTEX grab moves the whole shape too, not just that point', () => {
    // The vertex branch of `handleMouseDown` is gated to EditVertices, so in
    // MoveShape it never runs. Without letting a vertex target through the
    // translate branch, every vertex dot of the selected shape would be a
    // dead spot in the one mode whose only gesture is "drag the shape".
    const { result, rerender } = setup();
    act(() => result.current.handleMouseDown(downOnVertex(100, 100, 0)));
    rerender();
    act(() => result.current.handleMouseUp(at('mouseup', 150, 150)));

    expect(polygons[0].points).toEqual([
      { x: 150, y: 150 },
      { x: 250, y: 150 },
      { x: 250, y: 250 },
    ]);
  });

  it('a vertex still wins over the outline in EditVertices', () => {
    // The two modes divide the same target between them: EditVertices moves
    // the one point, MoveShape moves all of them.
    const { result, rerender } = setup(EditMode.EditVertices);
    act(() => result.current.handleMouseDown(downOnVertex(100, 100, 0)));
    rerender();
    act(() => result.current.handleMouseUp(at('mouseup', 150, 150)));
    expect(polygons[0].points[0]).toEqual({ x: 150, y: 150 });
    expect(polygons[0].points[1]).toEqual({ x: 200, y: 100 });
    expect(polygons[0].points[2]).toEqual({ x: 200, y: 200 });
  });

  it('a click on EMPTY canvas still deselects, as it does in View', () => {
    // Move is one press-drag-release with nothing in flight, so there is no
    // reason to suppress deselection — and suppressing it would leave no way
    // to clear a selection without leaving the tool. `at()` builds an event
    // whose target carries no polygonId, i.e. a miss.
    const { result } = setup();
    act(() => result.current.handleMouseDown(at('mousedown', 400, 400)));
    expect(onPolygonSelection).toHaveBeenCalledWith(null);
    expect(state.isPanning).toBe(false);
  });

  it('drags the CANVAS when nothing is selected, so the view still pans', () => {
    const { result } = setup(EditMode.MoveShape, null);
    act(() => result.current.handleMouseDown(at('mousedown', 400, 400)));
    expect(state.isPanning).toBe(true);
    expect(state.panStart).toEqual({ x: 400, y: 400 });
  });

  it('a press that never moved commits nothing — no dirty flag, no undo step', () => {
    // Clicking a shape IS how you select one in this mode, so a zero-delta
    // commit would mark the frame unsaved and push an undo entry that undoes
    // nothing, every time a user merely looks at a microtubule.
    const { result, rerender } = setup();
    act(() => result.current.handleMouseDown(downOnContour(150, 120)));
    rerender();
    act(() => result.current.handleMouseUp(at('mouseup', 150, 120)));
    expect(updatePolygons).not.toHaveBeenCalled();
    expect(polygons[0].points).toEqual(polygon.points);
    // The drag state must still be torn down, or the next press is ignored.
    expect(state.isDraggingVertex).toBe(false);
  });

  it('leaving the canvas does not commit a translation either', () => {
    const { result, rerender } = setup();
    act(() => result.current.handleMouseDown(downOnContour(150, 120)));
    rerender();
    act(() => result.current.handleMouseUp(at('mouseleave', -900, -900)));
    expect(updatePolygons).not.toHaveBeenCalled();
    expect(polygons[0].points).toEqual(polygon.points);
  });

  // Reported as "Shift does not select several microtubules", and irreproducible
  // for a second user — because the editor auto-switches to EditVertices as soon
  // as anything is selected. Measured in production before the fix: click MT1 ->
  // [MT1], Shift+click MT3 -> [MT3], Shift+click MT5 -> [MT5]. Each shift-click
  // REPLACED the selection. The exclusion moved here with the gesture.
  describe('Shift+click is a selection gesture, not a translate', () => {
    it('does not single-select, which is what dropped the multi-selection', () => {
      const { result } = setup(EditMode.MoveShape, null);
      act(() => result.current.handleMouseDown(contourEvent(150, 120, true)));
      // A single select here is the whole bug: it replaces the bulk set that
      // every "…for N selected" action reads.
      expect(onPolygonSelection).not.toHaveBeenCalled();
    });

    it('leaves the shape where it is — Shift+drag must not move geometry', () => {
      const { result, rerender } = setup();
      act(() => result.current.handleMouseDown(contourEvent(150, 120, true)));
      rerender();
      act(() => result.current.handleMouseUp(at('mouseup', 190, 145)));
      // Without the guard this is the +40/+25 translation the plain-drag test
      // above asserts, so the two tests cannot both pass by accident.
      expect(polygons[0].points).toEqual(polygon.points);
      expect(updatePolygons).not.toHaveBeenCalled();
    });

    it('does not DESELECT either, with a shape already selected', () => {
      // The subtler half of the same bug, and the one the mode's own
      // empty-canvas handling re-opened: the Shift press falls past the
      // translate branch into the mode switch, and Move borrows View's
      // "click on nothing deselects" there. `CanvasPolygon` binds no
      // mousedown, so a press ON a shape reaches that switch too — and
      // `applyAdditiveToggle` reads `selectedPolygonId` to absorb the
      // previous single selection into the bulk set, so clearing it here
      // makes Shift+click REPLACE the selection instead of adding to it.
      const { result } = setup(EditMode.MoveShape, 'poly-1');
      act(() => result.current.handleMouseDown(contourEvent(150, 120, true)));
      expect(onPolygonSelection).not.toHaveBeenCalled();
    });

    it('does not arm a drag, so the additive handler downstream still runs', () => {
      const { result } = setup();
      act(() => result.current.handleMouseDown(contourEvent(150, 120, true)));
      // `isDraggingVertex` is what the branch sets on its way to `return`;
      // the `return` is what stops CanvasPolygon's onClick from ever firing.
      expect(state.isDraggingVertex).toBe(false);
    });

    it('still translates WITHOUT Shift, so the gesture is not lost', () => {
      const { result, rerender } = setup();
      act(() => result.current.handleMouseDown(contourEvent(150, 120, false)));
      rerender();
      act(() => result.current.handleMouseUp(at('mouseup', 190, 145)));
      expect(polygons[0].points).toEqual([
        { x: 140, y: 125 },
        { x: 240, y: 125 },
        { x: 240, y: 225 },
      ]);
    });
  });
});
