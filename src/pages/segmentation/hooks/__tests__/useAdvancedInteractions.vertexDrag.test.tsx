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
const downOnContour = (clientX: number, clientY: number) =>
  ({
    button: 0,
    clientX,
    clientY,
    shiftKey: false,
    altKey: false,
    target: { dataset: { polygonId: 'poly-1', polygonContour: 'true' } },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }) as unknown as React.MouseEvent<HTMLDivElement>;

describe('dragging the contour translates the whole shape', () => {
  let state: InteractionState;
  let polygons: Polygon[];
  let updatePolygons: ReturnType<typeof vi.fn>;
  let onPolygonSelection: ReturnType<typeof vi.fn>;

  const setup = (
    mode: EditMode = EditMode.EditVertices,
    selected: string | null = 'poly-1'
  ) => {
    state = { ...baseState };
    polygons = [polygon];
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

  it('keeps the shape rigid — no point moves relative to another', () => {
    const { result, rerender } = setup();
    const before = polygon.points.map(p => ({ ...p }));
    act(() => result.current.handleMouseDown(downOnContour(101, 99)));
    rerender();
    act(() => result.current.handleMouseUp(at('mouseup', 37, 402)));

    const after = polygons[0].points;
    const dx = after[0].x - before[0].x;
    const dy = after[0].y - before[0].y;
    for (let i = 1; i < after.length; i++) {
      expect(after[i].x - before[i].x).toBeCloseTo(dx, 6);
      expect(after[i].y - before[i].y).toBeCloseTo(dy, 6);
    }
  });

  it('selects a shape that was not selected, so the first drag works', () => {
    const { result } = setup(EditMode.EditVertices, null);
    act(() => result.current.handleMouseDown(downOnContour(150, 120)));
    expect(onPolygonSelection).toHaveBeenCalledWith('poly-1');
  });

  it('does nothing outside EditVertices, where a drag means pan', () => {
    // In View mode a drag pans the canvas and a click selects. Silently
    // turning that into a shape move would be a trap.
    const { result, rerender } = setup(EditMode.View);
    act(() => result.current.handleMouseDown(downOnContour(150, 120)));
    rerender();
    // The drag must not even START: asserting only on the committed points
    // hides the case where View-mode mousedown happens to bail out later for
    // an unrelated reason, which is exactly what an early version of this
    // test did — the mode guard could be deleted and it still passed.
    expect(state.isDraggingVertex).toBe(false);
    act(() => result.current.handleMouseUp(at('mouseup', 190, 145)));
    expect(polygons[0].points).toEqual(polygon.points);
  });

  it('a vertex still wins over the outline it sits on', () => {
    // The vertex branch runs first, so grabbing a point moves that point
    // rather than dragging the whole shape out from under it.
    const { result, rerender } = setup();
    act(() => result.current.handleMouseDown(downOnVertex(100, 100, 0)));
    rerender();
    act(() => result.current.handleMouseUp(at('mouseup', 150, 150)));
    expect(polygons[0].points[1]).toEqual({ x: 200, y: 100 });
    expect(polygons[0].points[2]).toEqual({ x: 200, y: 200 });
  });

  it('leaving the canvas does not commit a translation either', () => {
    const { result, rerender } = setup();
    act(() => result.current.handleMouseDown(downOnContour(150, 120)));
    rerender();
    act(() => result.current.handleMouseUp(at('mouseleave', -900, -900)));
    expect(updatePolygons).not.toHaveBeenCalled();
    expect(polygons[0].points).toEqual(polygon.points);
  });
});
