/**
 * useAdvancedInteractions – uncovered branches (38 % → higher).
 *
 * The existing vertex.test.tsx covers right-click / vertex detection.
 * This file covers the 560 un-hit lines across all the remaining handlers:
 *
 *  handleMouseDown (button===0) paths:
 *   • View mode: deselects polygon when one is selected
 *   • View mode: starts pan when no polygon is selected
 *   • CreatePolygon: adds points; closes polygon when near first point (≥3 pts)
 *   • CreatePolyline: adds a point
 *   • EditVertices: clicks near a vertex → starts drag
 *   • EditVertices: Shift+vertex click → switches to AddPoints mode
 *   • EditVertices: click not near a vertex but inside polygon → starts pan
 *   • AddPoints: isAddingPoints=false on closed polygon → anchors start vertex
 *   • AddPoints: isAddingPoints=true → adds intermediate point
 *   • AddPoints: isAddingPoints=true, clicks end vertex → completes splice
 *   • Slice: first click sets sliceStartPoint; second click sets second temp point
 *   • CreatePolyline double-click → finalizes polyline
 *   • Middle button → panning in any mode
 *   • Alt key held → forces panning
 *   • Right-click in CreatePolyline mode → undoes last point
 *   • Right-click in Slice mode with a temp point → clears temp point
 *   • Right-click in non-view mode → exits to View
 *
 *  handleMouseMove paths:
 *   • Panning: calls handlePan with delta
 *   • Vertex dragging: calls setVertexDragState with offset
 *   • EditVertices hover: calls setHoveredVertex when within hit radius
 *   • Shift equidistant point auto-add in CreatePolygon
 *
 *  handleMouseUp paths:
 *   • Ends pan (isPanning → false)
 *   • Ends vertex drag: applies final position via updatePolygons, resets drag state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAdvancedInteractions } from '../useAdvancedInteractions';
import { EditMode, InteractionState, TransformState } from '../../types';
import { Polygon } from '@/lib/segmentation';

// ===== MOCKS =====

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
    id: 'created-polygon',
    points,
    confidence: 0.9,
    type: 'external',
  })),
}));

vi.mock('@/lib/rendering/VertexSpatialIndex', () => ({
  vertexSpatialIndex: {
    findNearestVertex: vi.fn(() => null),
    invalidate: vi.fn(),
  },
}));

import {
  isPointInPolygon,
  findClosestVertex,
  calculatePolygonPerimeter,
} from '@/lib/polygonGeometry';
import { vertexSpatialIndex } from '@/lib/rendering/VertexSpatialIndex';

// ===== FIXTURES =====

const CANVAS_REF = { current: document.createElement('div') };

const DEFAULT_TRANSFORM: TransformState = {
  zoom: 1,
  translateX: 0,
  translateY: 0,
};

const IDLE_INTERACTION: InteractionState = {
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

const _POLYLINE: Polygon = {
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
    interactionState: IDLE_INTERACTION,
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
    setHoveredJoinTarget: vi.fn(),
    setVertexDragState: vi.fn(),
    updatePolygons: vi.fn(),
    getPolygons: vi.fn(() => [SQUARE]),
    handlePan: vi.fn(),
    ...overrides,
  };
}

function leftClick(x = 5, y = 5, extra: Partial<React.MouseEvent> = {}) {
  return {
    button: 0,
    clientX: x,
    clientY: y,
    altKey: false,
    shiftKey: false,
    target: document.createElement('div'),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...extra,
  } as unknown as React.MouseEvent<HTMLDivElement>;
}

function rightClick(x = 5, y = 5) {
  return {
    button: 2,
    clientX: x,
    clientY: y,
    target: document.createElement('div'),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent<HTMLDivElement>;
}

function middleClick(x = 5, y = 5) {
  return {
    button: 1,
    clientX: x,
    clientY: y,
    target: document.createElement('div'),
    preventDefault: vi.fn(),
  } as unknown as React.MouseEvent<HTMLDivElement>;
}

describe('useAdvancedInteractions – uncovered handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // handleMouseDown – View mode
  // --------------------------------------------------------------------------

  describe('handleMouseDown – View mode', () => {
    it('deselects polygon when one is selected and empty space is clicked', () => {
      const props = makeProps({ selectedPolygonId: 'sq' });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(leftClick()));

      expect(props.onPolygonSelection).toHaveBeenCalledWith(null);
    });

    it('starts panning when no polygon is selected in View mode', () => {
      const props = makeProps({ selectedPolygonId: null });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(leftClick(50, 50)));

      expect(props.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({ isPanning: true })
      );
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseDown – middle button panning
  // --------------------------------------------------------------------------

  describe('handleMouseDown – middle button', () => {
    it('starts panning in any mode when middle button is pressed', () => {
      const props = makeProps({ editMode: EditMode.CreatePolygon });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(middleClick(30, 30)));

      expect(props.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({ isPanning: true })
      );
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseDown – Alt / Space forces panning
  // --------------------------------------------------------------------------

  describe('handleMouseDown – Alt key forces panning', () => {
    it('starts panning when altKey is held regardless of edit mode', () => {
      const props = makeProps({ editMode: EditMode.EditVertices });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() =>
        result.current.handleMouseDown(
          leftClick(10, 10, { altKey: true } as Partial<React.MouseEvent>)
        )
      );

      expect(props.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({ isPanning: true })
      );
    });

    it('starts panning when Space is held via isSpacePressed callback', () => {
      const props = makeProps({
        editMode: EditMode.EditVertices,
        isSpacePressed: vi.fn(() => true),
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(leftClick()));

      expect(props.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({ isPanning: true })
      );
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseDown – CreatePolygon
  // --------------------------------------------------------------------------

  describe('handleMouseDown – CreatePolygon mode', () => {
    it('adds a point to tempPoints on click', () => {
      const props = makeProps({ editMode: EditMode.CreatePolygon });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(leftClick(20, 20)));

      expect(props.setTempPoints).toHaveBeenCalledWith([{ x: 20, y: 20 }]);
    });

    it('closes the polygon when clicking near the first point (≥3 existing points)', () => {
      const existingPoints = [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
      ];
      const props = makeProps({
        editMode: EditMode.CreatePolygon,
        tempPoints: existingPoints,
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      // Click very near the first point (within CLOSE_POLYGON_DISTANCE=15)
      act(() => result.current.handleMouseDown(leftClick(101, 101)));

      // Should create a polygon and reset tempPoints
      expect(props.updatePolygons).toHaveBeenCalled();
      expect(props.setTempPoints).toHaveBeenCalledWith([]);
      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
    });

    it('does NOT close polygon when <3 temp points even if clicking near first point', () => {
      const props = makeProps({
        editMode: EditMode.CreatePolygon,
        tempPoints: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      // Click near first point — should NOT close (only 2 points)
      act(() => result.current.handleMouseDown(leftClick(1, 1)));

      expect(props.updatePolygons).not.toHaveBeenCalled();
      // Adds the point instead
      expect(props.setTempPoints).toHaveBeenCalledWith(
        expect.arrayContaining([{ x: 1, y: 1 }])
      );
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseDown – CreatePolyline
  // --------------------------------------------------------------------------

  describe('handleMouseDown – CreatePolyline mode', () => {
    it('appends the clicked point to tempPoints', () => {
      const props = makeProps({
        editMode: EditMode.CreatePolyline,
        tempPoints: [{ x: 0, y: 0 }],
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(leftClick(10, 10)));

      expect(props.setTempPoints).toHaveBeenCalledWith([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]);
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseDown – CreatePolyline double-click finalizer
  // --------------------------------------------------------------------------

  describe('handleCreatePolylineDoubleClick', () => {
    it('creates a polyline when tempPoints has ≥2 points', () => {
      const props = makeProps({
        editMode: EditMode.CreatePolyline,
        tempPoints: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 20, y: 5 },
        ],
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleCreatePolylineDoubleClick());

      expect(props.updatePolygons).toHaveBeenCalled();
      expect(props.setTempPoints).toHaveBeenCalledWith([]);
      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
    });

    it('does nothing when tempPoints has < 2 points', () => {
      const props = makeProps({
        editMode: EditMode.CreatePolyline,
        tempPoints: [{ x: 0, y: 0 }],
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleCreatePolylineDoubleClick());

      expect(props.updatePolygons).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseDown – EditVertices: vertex click → drag
  // --------------------------------------------------------------------------

  describe('handleMouseDown – EditVertices vertex drag', () => {
    it('starts vertex drag when clicking on a vertex element', () => {
      const props = makeProps({
        editMode: EditMode.EditVertices,
        selectedPolygonId: 'sq',
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      // Create a vertex SVG element with dataset attrs
      const vertexEl = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'circle'
      );
      vertexEl.setAttribute('data-polygon-id', 'sq');
      vertexEl.setAttribute('data-vertex-index', '0');

      const event = {
        button: 0,
        clientX: 0,
        clientY: 0,
        altKey: false,
        shiftKey: false,
        target: vertexEl,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => result.current.handleMouseDown(event));

      expect(props.setVertexDragState).toHaveBeenCalledWith(
        expect.objectContaining({
          isDragging: true,
          polygonId: 'sq',
          vertexIndex: 0,
        })
      );
    });

    it('starts AddPoints mode when Shift+vertex click in EditVertices', () => {
      const props = makeProps({
        editMode: EditMode.EditVertices,
        selectedPolygonId: 'sq',
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      const vertexEl = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'circle'
      );
      vertexEl.setAttribute('data-polygon-id', 'sq');
      vertexEl.setAttribute('data-vertex-index', '1');

      const event = {
        button: 0,
        clientX: 10,
        clientY: 0,
        altKey: false,
        shiftKey: true,
        target: vertexEl,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => result.current.handleMouseDown(event));

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.AddPoints);
      expect(props.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({ isAddingPoints: true })
      );
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseDown – EditVertices: click inside polygon (no vertex) → pan
  // --------------------------------------------------------------------------

  describe('handleMouseDown – EditVertices inside polygon starts pan', () => {
    it('starts panning when clicking inside polygon but not on a vertex', () => {
      vi.mocked(isPointInPolygon).mockReturnValueOnce(true);
      vi.mocked(findClosestVertex).mockReturnValueOnce(null);

      const props = makeProps({
        editMode: EditMode.EditVertices,
        selectedPolygonId: 'sq',
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(leftClick(5, 5)));

      expect(props.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({ isPanning: true })
      );
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseDown – Slice mode
  // --------------------------------------------------------------------------

  describe('handleMouseDown – Slice mode', () => {
    it('sets first temp point when slice mode has no temp points', () => {
      const props = makeProps({
        editMode: EditMode.Slice,
        selectedPolygonId: 'sq',
        tempPoints: [],
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(leftClick(3, 3)));

      expect(props.setTempPoints).toHaveBeenCalledWith([{ x: 3, y: 3 }]);
      expect(props.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({ sliceStartPoint: { x: 3, y: 3 } })
      );
    });

    it('sets second temp point when slice mode already has one point', () => {
      const props = makeProps({
        editMode: EditMode.Slice,
        selectedPolygonId: 'sq',
        tempPoints: [{ x: 2, y: 2 }],
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(leftClick(8, 8)));

      expect(props.setTempPoints).toHaveBeenCalledWith([
        { x: 2, y: 2 },
        { x: 8, y: 8 },
      ]);
    });

    it('is a no-op in Slice mode when no polygon is selected', () => {
      const props = makeProps({
        editMode: EditMode.Slice,
        selectedPolygonId: null,
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(leftClick(5, 5)));

      expect(props.setTempPoints).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseDown – right-click undo behaviors
  // --------------------------------------------------------------------------

  describe('handleMouseDown – right-click CreatePolyline undo', () => {
    it('removes last temp point when right-clicking with points placed', () => {
      const props = makeProps({
        editMode: EditMode.CreatePolyline,
        tempPoints: [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(rightClick()));

      expect(props.setTempPoints).toHaveBeenCalledWith([{ x: 0, y: 0 }]);
    });

    it('exits to View mode when right-clicking with no temp points in CreatePolyline', () => {
      const props = makeProps({
        editMode: EditMode.CreatePolyline,
        tempPoints: [],
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(rightClick()));

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
    });
  });

  describe('handleMouseDown – right-click Slice mode undo', () => {
    it('clears temp point and sliceStartPoint when right-clicking with one slice point', () => {
      const props = makeProps({
        editMode: EditMode.Slice,
        selectedPolygonId: 'sq',
        tempPoints: [{ x: 3, y: 3 }],
        interactionState: {
          ...IDLE_INTERACTION,
          sliceStartPoint: { x: 3, y: 3 },
        },
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(rightClick()));

      expect(props.setTempPoints).toHaveBeenCalledWith([]);
      expect(props.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({ sliceStartPoint: null })
      );
    });

    it('deselects polygon when right-clicking in Slice mode with polygon selected but no temp points', () => {
      const props = makeProps({
        editMode: EditMode.Slice,
        selectedPolygonId: 'sq',
        tempPoints: [],
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(rightClick()));

      expect(props.onPolygonSelection).toHaveBeenCalledWith(null);
    });

    it('exits Slice to View when right-clicking with nothing selected and no temp points', () => {
      const props = makeProps({
        editMode: EditMode.Slice,
        selectedPolygonId: null,
        tempPoints: [],
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(rightClick()));

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
    });
  });

  describe('handleMouseDown – right-click exits non-View modes', () => {
    it('exits CreatePolygon to View and clears tempPoints', () => {
      const props = makeProps({
        editMode: EditMode.CreatePolygon,
        tempPoints: [{ x: 5, y: 5 }],
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(rightClick()));

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
      expect(props.setTempPoints).toHaveBeenCalledWith([]);
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseMove – panning
  // --------------------------------------------------------------------------

  describe('handleMouseMove – panning', () => {
    it('calls handlePan with the mouse delta when isPanning is true', () => {
      const props = makeProps({
        editMode: EditMode.View,
        interactionState: {
          ...IDLE_INTERACTION,
          isPanning: true,
          panStart: { x: 0, y: 0 },
        },
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      const moveEvent = {
        clientX: 20,
        clientY: 15,
        target: document.createElement('div'),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => result.current.handleMouseMove(moveEvent));

      expect(props.handlePan).toHaveBeenCalledWith(20, 15);
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseMove – vertex drag offset
  // --------------------------------------------------------------------------

  describe('handleMouseMove – vertex dragging', () => {
    it('updates setVertexDragState with the drag offset', () => {
      const props = makeProps({
        editMode: EditMode.EditVertices,
        selectedPolygonId: 'sq',
        interactionState: {
          ...IDLE_INTERACTION,
          isDraggingVertex: true,
          draggedVertexInfo: { polygonId: 'sq', vertexIndex: 0 },
          originalVertexPosition: { x: 0, y: 0 },
        },
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      const moveEvent = {
        clientX: 5,
        clientY: 5,
        target: document.createElement('div'),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => result.current.handleMouseMove(moveEvent));

      expect(props.setVertexDragState).toHaveBeenCalledWith(
        expect.objectContaining({
          isDragging: true,
          dragOffset: { x: 5, y: 5 },
        })
      );
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseMove – hover detection in EditVertices
  // --------------------------------------------------------------------------

  describe('handleMouseMove – hover detection', () => {
    it('calls setHoveredVertex when a vertex is within hit radius', () => {
      vi.mocked(vertexSpatialIndex.findNearestVertex).mockReturnValueOnce(2);

      const props = makeProps({
        editMode: EditMode.EditVertices,
        selectedPolygonId: 'sq',
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      const moveEvent = {
        clientX: 10,
        clientY: 10,
        target: document.createElement('div'),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => result.current.handleMouseMove(moveEvent));

      expect(props.setHoveredVertex).toHaveBeenCalledWith({
        polygonId: 'sq',
        vertexIndex: 2,
      });
    });

    it('calls setHoveredVertex(null) when no vertex is near', () => {
      vi.mocked(vertexSpatialIndex.findNearestVertex).mockReturnValueOnce(null);

      const props = makeProps({
        editMode: EditMode.EditVertices,
        selectedPolygonId: 'sq',
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      const moveEvent = {
        clientX: 50,
        clientY: 50,
        target: document.createElement('div'),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => result.current.handleMouseMove(moveEvent));

      expect(props.setHoveredVertex).toHaveBeenCalledWith(null);
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseMove – Shift equidistant point auto-add
  // --------------------------------------------------------------------------

  describe('handleMouseMove – Shift equidistant auto-add (CreatePolygon)', () => {
    it('auto-adds a point when Shift is held and cursor has moved far enough', () => {
      const props = makeProps({
        editMode: EditMode.CreatePolygon,
        tempPoints: [{ x: 0, y: 0 }],
        isShiftPressed: vi.fn(() => true),
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      // Distance from (0,0) to (20,0) = 20 > MIN_AUTO_ADD_DISTANCE(10)
      const moveEvent = {
        clientX: 20,
        clientY: 0,
        target: document.createElement('div'),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => result.current.handleMouseMove(moveEvent));

      expect(props.setTempPoints).toHaveBeenCalledWith(
        expect.arrayContaining([{ x: 20, y: 0 }])
      );
    });

    it('does not auto-add when distance is less than MIN_AUTO_ADD_DISTANCE', () => {
      const props = makeProps({
        editMode: EditMode.CreatePolygon,
        tempPoints: [{ x: 0, y: 0 }],
        isShiftPressed: vi.fn(() => true),
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      // Distance from (0,0) to (3,4) = 5 < 10 threshold
      const moveEvent = {
        clientX: 3,
        clientY: 4,
        target: document.createElement('div'),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => result.current.handleMouseMove(moveEvent));

      expect(props.setTempPoints).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseUp – end panning
  // --------------------------------------------------------------------------

  describe('handleMouseUp – end panning', () => {
    it('resets isPanning to false when mouse is released', () => {
      const props = makeProps({
        interactionState: {
          ...IDLE_INTERACTION,
          isPanning: true,
          panStart: { x: 10, y: 10 },
        },
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      const upEvent = {
        clientX: 30,
        clientY: 30,
        target: document.createElement('div'),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => result.current.handleMouseUp(upEvent));

      expect(props.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({ isPanning: false, panStart: null })
      );
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseUp – end vertex drag
  // --------------------------------------------------------------------------

  describe('handleMouseUp – end vertex drag', () => {
    it('applies the final vertex position and clears drag state', () => {
      const props = makeProps({
        editMode: EditMode.EditVertices,
        selectedPolygonId: 'sq',
        interactionState: {
          ...IDLE_INTERACTION,
          isDraggingVertex: true,
          draggedVertexInfo: { polygonId: 'sq', vertexIndex: 0 },
          originalVertexPosition: { x: 0, y: 0 },
        },
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      const upEvent = {
        clientX: 7,
        clientY: 7,
        target: document.createElement('div'),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => result.current.handleMouseUp(upEvent));

      // updatePolygons should have been called with the moved vertex
      expect(props.updatePolygons).toHaveBeenCalled();
      const updatedPolygons = vi.mocked(props.updatePolygons).mock.calls[0][0];
      const updatedVertex = updatedPolygons.find((p: Polygon) => p.id === 'sq')
        ?.points[0];
      expect(updatedVertex).toEqual({ x: 7, y: 7 });

      // Drag state cleared
      expect(props.setVertexDragState).toHaveBeenCalledWith(
        expect.objectContaining({ isDragging: false })
      );
      // Interaction state cleared
      expect(props.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({ isDraggingVertex: false })
      );
    });
  });

  // --------------------------------------------------------------------------
  // handleMouseDown – AddPoints mode (closed polygon)
  // --------------------------------------------------------------------------

  describe('handleMouseDown – AddPoints mode on closed polygon', () => {
    it('anchors start vertex when clicking on a vertex for the first time', () => {
      vi.mocked(findClosestVertex).mockReturnValueOnce({
        index: 2,
        distance: 1,
      });

      const props = makeProps({
        editMode: EditMode.AddPoints,
        selectedPolygonId: 'sq',
        interactionState: { ...IDLE_INTERACTION, isAddingPoints: false },
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(leftClick(10, 10)));

      expect(props.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({
          isAddingPoints: true,
          addPointStartVertex: { polygonId: 'sq', vertexIndex: 2 },
        })
      );
    });

    it('adds intermediate point to tempPoints when already adding points', () => {
      vi.mocked(findClosestVertex).mockReturnValueOnce(null); // not on a vertex

      const props = makeProps({
        editMode: EditMode.AddPoints,
        selectedPolygonId: 'sq',
        tempPoints: [{ x: 5, y: 5 }],
        interactionState: {
          ...IDLE_INTERACTION,
          isAddingPoints: true,
          addPointStartVertex: { polygonId: 'sq', vertexIndex: 0 },
        },
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(leftClick(7, 7)));

      expect(props.setTempPoints).toHaveBeenCalledWith([
        { x: 5, y: 5 },
        { x: 7, y: 7 },
      ]);
    });

    it('completes point splice when clicking a different end vertex', () => {
      // Mock findClosestVertex to return end vertex (index 2, different from start 0)
      vi.mocked(findClosestVertex).mockReturnValueOnce({
        index: 2,
        distance: 1,
      });
      vi.mocked(calculatePolygonPerimeter).mockImplementation(
        (pts: { x: number; y: number }[]) => pts.length * 5
      );

      const props = makeProps({
        editMode: EditMode.AddPoints,
        selectedPolygonId: 'sq',
        tempPoints: [{ x: 5, y: 5 }],
        interactionState: {
          ...IDLE_INTERACTION,
          isAddingPoints: true,
          addPointStartVertex: { polygonId: 'sq', vertexIndex: 0 },
        },
      });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleMouseDown(leftClick(10, 10)));

      expect(props.updatePolygons).toHaveBeenCalled();
      expect(props.setTempPoints).toHaveBeenCalledWith([]);
      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.EditVertices);
    });
  });

  // --------------------------------------------------------------------------
  // useEffect resets lastHoverCheckPoint on selectedPolygonId change
  // --------------------------------------------------------------------------

  describe('useEffect – hover point reset on editMode change', () => {
    it('does not skip hover after editMode changes (lastHoverCheckPoint cleared)', () => {
      // Use a getPolygons that includes the selected polygon
      const sq2: Polygon = { ...SQUARE, id: 'sq2' };
      const getPolygons = vi.fn(() => [SQUARE, sq2]);

      const props = makeProps({
        editMode: EditMode.EditVertices,
        selectedPolygonId: 'sq',
        getPolygons,
      });
      vi.mocked(vertexSpatialIndex.findNearestVertex).mockReturnValue(1);

      const { result, rerender } = renderHook(p => useAdvancedInteractions(p), {
        initialProps: props,
      });

      // Trigger a move to set lastHoverCheckPoint
      act(() => {
        result.current.handleMouseMove({
          clientX: 10,
          clientY: 0,
          target: document.createElement('div'),
        } as unknown as React.MouseEvent<HTMLDivElement>);
      });

      // Switch editMode (triggers useEffect that resets lastHoverCheckPoint)
      rerender({
        ...props,
        editMode: EditMode.AddPoints,
        selectedPolygonId: 'sq',
      });

      // Clear mock counts after the rerender
      vi.mocked(vertexSpatialIndex.findNearestVertex).mockClear();

      // Move to a clearly different position
      act(() => {
        result.current.handleMouseMove({
          clientX: 100,
          clientY: 100,
          target: document.createElement('div'),
        } as unknown as React.MouseEvent<HTMLDivElement>);
      });

      // After the useEffect cleared lastHoverCheckPoint, the next move must trigger
      // a fresh vertex lookup (not skip it via the "barely moved" guard)
      expect(vertexSpatialIndex.findNearestVertex).toHaveBeenCalled();
    });
  });
});
