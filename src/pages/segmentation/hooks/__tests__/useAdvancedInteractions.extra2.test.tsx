/**
 * useAdvancedInteractions – extra2: branches not covered by gaps.test.tsx or vertex.test.tsx.
 *
 * Targets:
 *  1. Right-click in Slice mode: polygon selected but no temp points → deselects polygon
 *  2. Right-click in Slice mode: nothing selected + no temp points → exits to View mode
 *  3. Right-click in non-View, non-Slice mode → sets View mode + clears tempPoints
 *  4. Alt key held on left-click → forces panning in any mode
 *  5. Middle mouse button → starts panning
 *  6. CreatePolyline double-click with ≥ 2 temp points → calls updatePolygons + resets
 *  7. CreatePolyline double-click with < 2 points → no-op
 *  8. handleMouseMove – panning: calls handlePan with delta when isPanning=true
 *  9. handleMouseMove – vertex drag: calls setVertexDragState with offset
 * 10. handleMouseMove – shift NOT pressed: resets lastAutoAddedPoint (no setTempPoints)
 * 11. Right-click CreatePolyline with 0 temp points → exits to View mode
 * 12. Right-click Slice with selected polygon + 1 temp point → clears temp point
 * 13. handleMouseUp – no pan, no drag → no state changes
 * 14. AddPoints on open polyline (geometry=polyline): anchors at head when closer
 * 15. DeletePolygon click → is a no-op (returns immediately)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAdvancedInteractions } from '../useAdvancedInteractions';
import { EditMode, InteractionState, TransformState } from '../../types';
import { Polygon } from '@/lib/segmentation';

// ── mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@/lib/coordinateUtils', () => ({
  getCanvasCoordinates: vi.fn((clientX: number, clientY: number) => ({
    imageX: clientX,
    imageY: clientY,
  })),
}));

vi.mock('@/lib/polygonGeometry', () => ({
  isPointInPolygon: vi.fn(() => false),
  findClosestVertex: vi.fn(() => null),
  findClosestSegment: vi.fn(() => null),
  calculatePolygonArea: vi.fn(() => 100),
  calculatePolygonPerimeter: vi.fn(
    (pts: { x: number; y: number }[]) => pts.length * 10
  ),
  createPolygon: vi.fn((points: { x: number; y: number }[]) => ({
    id: 'created-polyline',
    points,
    confidence: 0.9,
    type: 'external',
    geometry: 'polyline',
  })),
}));

vi.mock('@/lib/rendering/VertexSpatialIndex', () => ({
  vertexSpatialIndex: {
    findNearestVertex: vi.fn(() => null),
    invalidate: vi.fn(),
  },
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const CANVAS_REF = { current: document.createElement('div') };

const DEFAULT_TRANSFORM: TransformState = {
  zoom: 1,
  translateX: 0,
  translateY: 0,
};

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

const SQUARE: Polygon = {
  id: 'sq',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
  confidence: 0.9,
  type: 'external',
};

const POLYLINE: Polygon = {
  id: 'pl',
  points: [
    { x: 0, y: 0 },
    { x: 5, y: 5 },
    { x: 10, y: 10 },
  ],
  confidence: 0.8,
  type: 'external',
  geometry: 'polyline',
};

function makeProps(
  overrides: Partial<Parameters<typeof useAdvancedInteractions>[0]> = {}
) {
  return {
    editMode: EditMode.View,
    interactionState: IDLE,
    transform: DEFAULT_TRANSFORM,
    canvasRef: CANVAS_REF,
    selectedPolygonId: null as string | null,
    tempPoints: [] as { x: number; y: number }[],
    cursorPosition: null,
    isShiftPressed: vi.fn(() => false),
    isSpacePressed: vi.fn(() => false),
    onPolygonSelection: vi.fn(),
    setEditMode: vi.fn(),
    setInteractionState: vi.fn(),
    setTempPoints: vi.fn(),
    setHoveredVertex: vi.fn(),
    setVertexDragState: vi.fn(),
    updatePolygons: vi.fn(),
    getPolygons: vi.fn(() => [SQUARE, POLYLINE]),
    handlePan: vi.fn(),
    ...overrides,
  };
}

const leftClick = (
  x = 5,
  y = 5,
  extra: Partial<React.MouseEvent> = {}
): React.MouseEvent<HTMLDivElement> =>
  ({
    button: 0,
    clientX: x,
    clientY: y,
    altKey: false,
    shiftKey: false,
    target: document.createElement('div'),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...extra,
  }) as unknown as React.MouseEvent<HTMLDivElement>;

const rightClick = (x = 5, y = 5): React.MouseEvent<HTMLDivElement> =>
  ({
    button: 2,
    clientX: x,
    clientY: y,
    target: document.createElement('div'),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }) as unknown as React.MouseEvent<HTMLDivElement>;

const middleClick = (x = 5, y = 5): React.MouseEvent<HTMLDivElement> =>
  ({
    button: 1,
    clientX: x,
    clientY: y,
    target: document.createElement('div'),
    preventDefault: vi.fn(),
  }) as unknown as React.MouseEvent<HTMLDivElement>;

const moveEvent = (x = 10, y = 10): React.MouseEvent<HTMLDivElement> =>
  ({
    clientX: x,
    clientY: y,
    target: document.createElement('div'),
  }) as unknown as React.MouseEvent<HTMLDivElement>;

const upEvent = (x = 10, y = 10): React.MouseEvent<HTMLDivElement> =>
  ({
    clientX: x,
    clientY: y,
    target: document.createElement('div'),
  }) as unknown as React.MouseEvent<HTMLDivElement>;

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useAdvancedInteractions – extra2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // 1. Right-click in Slice mode: polygon selected, no temp points → deselect
  // --------------------------------------------------------------------------

  it('right-click in Slice mode with selected polygon and no temp points → deselects', () => {
    const props = makeProps({
      editMode: EditMode.Slice,
      selectedPolygonId: 'sq',
      tempPoints: [],
      interactionState: { ...IDLE, sliceStartPoint: null },
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(rightClick()));

    expect(props.onPolygonSelection).toHaveBeenCalledWith(null);
    expect(props.setEditMode).not.toHaveBeenCalledWith(EditMode.View);
  });

  // --------------------------------------------------------------------------
  // 2. Right-click in Slice mode: nothing selected + no temp points → View mode
  // --------------------------------------------------------------------------

  it('right-click in Slice mode with nothing selected → exits to View', () => {
    const props = makeProps({
      editMode: EditMode.Slice,
      selectedPolygonId: null,
      tempPoints: [],
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(rightClick()));

    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
  });

  // --------------------------------------------------------------------------
  // 3. Right-click in non-View, non-Slice, non-CreatePolyline mode → View + clears
  // --------------------------------------------------------------------------

  it('right-click in EditVertices mode → sets View mode', () => {
    const props = makeProps({
      editMode: EditMode.EditVertices,
      selectedPolygonId: 'sq',
      tempPoints: [{ x: 1, y: 1 }],
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(rightClick()));

    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
    expect(props.setTempPoints).toHaveBeenCalledWith([]);
  });

  // --------------------------------------------------------------------------
  // 4. Alt key held on left-click → forces panning
  // --------------------------------------------------------------------------

  it('alt + left-click forces panning regardless of current mode', () => {
    const props = makeProps({
      editMode: EditMode.CreatePolygon,
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() =>
      result.current.handleMouseDown(leftClick(5, 5, { altKey: true }))
    );

    expect(props.setInteractionState).toHaveBeenCalledWith(
      expect.objectContaining({ isPanning: true })
    );
    // createPolygon click should NOT have been called
    expect(props.setTempPoints).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 5. Middle mouse button → starts panning
  // --------------------------------------------------------------------------

  it('middle button starts panning in any mode', () => {
    const props = makeProps({ editMode: EditMode.Slice });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(middleClick(3, 3)));

    expect(props.setInteractionState).toHaveBeenCalledWith(
      expect.objectContaining({ isPanning: true, panStart: { x: 3, y: 3 } })
    );
  });

  // --------------------------------------------------------------------------
  // 6. CreatePolyline double-click with ≥ 2 temp points → updatePolygons + reset
  // --------------------------------------------------------------------------

  it('handleCreatePolylineDoubleClick with ≥2 points creates a polyline', () => {
    const props = makeProps({
      editMode: EditMode.CreatePolyline,
      tempPoints: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 10 },
      ],
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleCreatePolylineDoubleClick());

    expect(props.updatePolygons).toHaveBeenCalledTimes(1);
    expect(props.setTempPoints).toHaveBeenCalledWith([]);
    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
  });

  // --------------------------------------------------------------------------
  // 7. CreatePolyline double-click with < 2 points → no-op
  // --------------------------------------------------------------------------

  it('handleCreatePolylineDoubleClick with 1 point is a no-op', () => {
    const props = makeProps({
      editMode: EditMode.CreatePolyline,
      tempPoints: [{ x: 0, y: 0 }],
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleCreatePolylineDoubleClick());

    expect(props.updatePolygons).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 8. handleMouseMove – panning: calls handlePan
  // --------------------------------------------------------------------------

  it('handleMouseMove while panning calls handlePan with delta', () => {
    const props = makeProps({
      interactionState: {
        ...IDLE,
        isPanning: true,
        panStart: { x: 5, y: 5 },
      },
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseMove(moveEvent(15, 10)));

    expect(props.handlePan).toHaveBeenCalledWith(10, 5);
  });

  // --------------------------------------------------------------------------
  // 9. handleMouseMove – vertex drag: calls setVertexDragState with offset
  // --------------------------------------------------------------------------

  it('handleMouseMove while dragging a vertex updates setVertexDragState offset', () => {
    const props = makeProps({
      interactionState: {
        ...IDLE,
        isDraggingVertex: true,
        draggedVertexInfo: { polygonId: 'sq', vertexIndex: 0 },
        originalVertexPosition: { x: 0, y: 0 },
      },
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseMove(moveEvent(8, 6)));

    expect(props.setVertexDragState).toHaveBeenCalledWith(
      expect.objectContaining({
        isDragging: true,
        dragOffset: { x: 8, y: 6 },
      })
    );
  });

  // --------------------------------------------------------------------------
  // 10. handleMouseMove – shift NOT pressed: no auto-add, no setTempPoints
  // --------------------------------------------------------------------------

  it('handleMouseMove without shift does not call setTempPoints in CreatePolygon', () => {
    const props = makeProps({
      editMode: EditMode.CreatePolygon,
      tempPoints: [{ x: 0, y: 0 }],
      isShiftPressed: vi.fn(() => false),
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseMove(moveEvent(50, 50)));

    expect(props.setTempPoints).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 11. Right-click CreatePolyline with 0 temp points → exits to View
  // --------------------------------------------------------------------------

  it('right-click CreatePolyline with 0 temp points exits to View', () => {
    const props = makeProps({
      editMode: EditMode.CreatePolyline,
      tempPoints: [],
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(rightClick()));

    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
  });

  // --------------------------------------------------------------------------
  // 12. Right-click Slice: selected polygon + 1 temp point → clears temp point
  // --------------------------------------------------------------------------

  it('right-click Slice with 1 temp point clears temp points', () => {
    const props = makeProps({
      editMode: EditMode.Slice,
      selectedPolygonId: 'sq',
      tempPoints: [{ x: 5, y: 5 }],
      interactionState: {
        ...IDLE,
        sliceStartPoint: { x: 5, y: 5 },
      },
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(rightClick()));

    expect(props.setTempPoints).toHaveBeenCalledWith([]);
  });

  // --------------------------------------------------------------------------
  // 13. handleMouseUp – no pan, no drag → no state setters called
  // --------------------------------------------------------------------------

  it('handleMouseUp with idle interactionState calls no setters', () => {
    const props = makeProps({ interactionState: IDLE });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseUp(upEvent()));

    expect(props.setInteractionState).not.toHaveBeenCalled();
    expect(props.setVertexDragState).not.toHaveBeenCalled();
    expect(props.updatePolygons).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // 14. AddPoints on open polyline: anchors at head when closer to head
  // --------------------------------------------------------------------------

  it('AddPoints on open polyline: click near head anchors at index 0', () => {
    const props = makeProps({
      editMode: EditMode.AddPoints,
      selectedPolygonId: 'pl',
      interactionState: { ...IDLE, isAddingPoints: false },
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    // Click near head (0,0) of the polyline
    act(() => result.current.handleMouseDown(leftClick(1, 1)));

    expect(props.setInteractionState).toHaveBeenCalledWith(
      expect.objectContaining({
        isAddingPoints: true,
        addPointStartVertex: expect.objectContaining({ vertexIndex: 0 }),
      })
    );
  });

  // --------------------------------------------------------------------------
  // 15. DeletePolygon click → is a no-op (no state changes)
  // --------------------------------------------------------------------------

  it('handleMouseDown in DeletePolygon mode is a no-op', () => {
    const props = makeProps({
      editMode: EditMode.DeletePolygon,
      selectedPolygonId: 'sq',
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(leftClick()));

    // handleDeletePolygonClick returns immediately without calling any setters
    expect(props.updatePolygons).not.toHaveBeenCalled();
    expect(props.setEditMode).not.toHaveBeenCalled();
  });
});
