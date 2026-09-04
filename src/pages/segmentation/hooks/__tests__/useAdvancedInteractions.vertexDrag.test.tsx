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
