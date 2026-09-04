/**
 * useAdvancedInteractions — Add-Points endpoint JOIN and the double-click
 * guard.
 *
 * Both behaviours come from one 2026-09-04 bug report:
 *
 *  • "when I double click in the adds point mode it makes a new polygon" —
 *    the canvas bound the CreatePolyline finaliser straight to `onDoubleClick`
 *    with no mode check, and the second mousedown of the double-click had
 *    already pushed a temp point, so the finaliser's `tempPoints.length >= 2`
 *    branch fired in the wrong mode.
 *
 *  • "this feature does not work if the polygons are not labelled the same
 *    (so also if one is labeled and the other is not)" — the class gate was a
 *    strict equality, so `'t1'` vs `undefined` refused the join, silently.
 *
 * The join branch of `handleAddPointsClick` had no test at all before this
 * file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAdvancedInteractions } from '../useAdvancedInteractions';
import { EditMode, InteractionState, TransformState } from '../../types';
import type { Polygon } from '@/lib/segmentation';

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
  calculatePolygonPerimeter: vi.fn(() => 40),
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

// ===== FIXTURES =====

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

/** A horizontal polyline from (x0,0) to (x1,0). */
const line = (
  id: string,
  x0: number,
  x1: number,
  extra: Partial<Polygon> = {}
): Polygon => ({
  id,
  points: [
    { x: x0, y: 0 },
    { x: x1, y: 0 },
  ],
  type: 'external',
  geometry: 'polyline',
  ...extra,
});

function makeProps(
  overrides: Partial<Parameters<typeof useAdvancedInteractions>[0]> = {}
) {
  return {
    editMode: EditMode.AddPoints,
    interactionState: IDLE,
    transform: TRANSFORM,
    canvasRef: CANVAS_REF,
    selectedPolygonId: 'a' as string | null,
    tempPoints: [] as { x: number; y: number }[],
    cursorPosition: null,
    isShiftPressed: vi.fn(() => false),
    isSpacePressed: vi.fn(() => false),
    projectType: 'microtubules' as const,
    onJoinBlockedByClass: vi.fn(),
    onPolygonSelection: vi.fn(),
    setEditMode: vi.fn(),
    setInteractionState: vi.fn(),
    setTempPoints: vi.fn(),
    setHoveredVertex: vi.fn(),
    setHoveredJoinTarget: vi.fn(),
    setVertexDragState: vi.fn(),
    updatePolygons: vi.fn(),
    getPolygons: vi.fn(() => [line('a', 0, 10), line('b', 20, 30)]),
    handlePan: vi.fn(),
    ...overrides,
  };
}

/** `detail` defaults to 1 — the FIRST click of any sequence. */
function leftClick(x: number, y = 0, detail = 1) {
  return {
    button: 0,
    detail,
    clientX: x,
    clientY: y,
    altKey: false,
    shiftKey: false,
    target: document.createElement('div'),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent<HTMLDivElement>;
}

/** The polygon list handed to `updatePolygons` by the last call. */
const lastPolygons = (fn: (polygons: Polygon[]) => void): Polygon[] => {
  const { calls } = vi.mocked(fn).mock;
  return calls[calls.length - 1][0];
};

describe('useAdvancedInteractions – Add-Points endpoint join', () => {
  beforeEach(() => vi.clearAllMocks());

  it('joins an UNLABELLED selected polyline onto a labelled one and inherits the label', () => {
    const a = line('a', 0, 10); // no mtType
    const b = line('b', 20, 30, { mtType: 't1' });
    const props = makeProps({ getPolygons: vi.fn(() => [a, b]) });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    // Click right on B's head (20,0), which is within the hit radius.
    act(() => result.current.handleMouseDown(leftClick(20)));

    expect(props.updatePolygons).toHaveBeenCalledTimes(1);
    const next = lastPolygons(props.updatePolygons);
    expect(next.map(p => p.id)).toEqual(['a']); // B was merged away
    expect(next[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
    // The surviving polyline must carry the label the user had assigned to B.
    expect(next[0].mtType).toBe('t1');
    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.EditVertices);
    expect(props.onJoinBlockedByClass).not.toHaveBeenCalled();
  });

  it('joins a LABELLED selected polyline onto an unlabelled one and keeps its own label', () => {
    const a = line('a', 0, 10, { mtType: 't1' });
    const b = line('b', 20, 30);
    const props = makeProps({ getPolygons: vi.fn(() => [a, b]) });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(leftClick(20)));

    const next = lastPolygons(props.updatePolygons);
    expect(next.map(p => p.id)).toEqual(['a']);
    expect(next[0].mtType).toBe('t1');
  });

  it('treats a raw null mtType as unlabelled, not as a distinct label', () => {
    const a = line('a', 0, 10, { mtType: null as unknown as string });
    const b = line('b', 20, 30, { mtType: 't1' });
    const props = makeProps({ getPolygons: vi.fn(() => [a, b]) });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(leftClick(20)));

    expect(props.updatePolygons).toHaveBeenCalledTimes(1);
    expect(lastPolygons(props.updatePolygons)[0].mtType).toBe('t1');
    expect(props.onJoinBlockedByClass).not.toHaveBeenCalled();
  });

  it('refuses two DIFFERENTLY labelled polylines and says so', () => {
    const a = line('a', 0, 10, { mtType: 't1' });
    const b = line('b', 20, 30, { mtType: 't2' });
    const props = makeProps({ getPolygons: vi.fn(() => [a, b]) });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(leftClick(20)));

    expect(props.onJoinBlockedByClass).toHaveBeenCalledTimes(1);
    // No merge: the click degrades into seeding the extension instead.
    expect(props.updatePolygons).not.toHaveBeenCalled();
  });

  it('says nothing when there is no foreign endpoint under the click at all', () => {
    const props = makeProps();
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(leftClick(200, 200)));

    expect(props.onJoinBlockedByClass).not.toHaveBeenCalled();
    expect(props.updatePolygons).not.toHaveBeenCalled();
  });

  it('carries the drawn points across as a bridge when already extending', () => {
    const a = line('a', 0, 10);
    const b = line('b', 20, 30, { mtType: 't1' });
    const props = makeProps({
      getPolygons: vi.fn(() => [a, b]),
      interactionState: {
        ...IDLE,
        isAddingPoints: true,
        addPointStartVertex: { polygonId: 'a', vertexIndex: 1 },
      },
      tempPoints: [{ x: 15, y: 3 }],
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(leftClick(20)));

    expect(lastPolygons(props.updatePolygons)[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 3 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it('sperm projects gate on partClass and inherit it the same way', () => {
    const a = line('a', 0, 10);
    const b = line('b', 20, 30, { partClass: 'tail' as const });
    const props = makeProps({
      projectType: 'sperm' as const,
      getPolygons: vi.fn(() => [a, b]),
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(leftClick(20)));

    expect(lastPolygons(props.updatePolygons)[0].partClass).toBe('tail');
  });
});

describe('useAdvancedInteractions – double-click does not place a point', () => {
  beforeEach(() => vi.clearAllMocks());

  it('AddPoints: the second mousedown of a double-click is ignored', () => {
    const props = makeProps({ tempPoints: [{ x: 4, y: 0 }] });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    // detail === 2 → the browser has already decided this is a double-click,
    // so a `dblclick` will follow and commit. Counting the point here would
    // append a duplicate vertex at the finishing position.
    act(() => result.current.handleMouseDown(leftClick(5, 0, 2)));

    expect(props.setTempPoints).not.toHaveBeenCalled();
    expect(props.setInteractionState).not.toHaveBeenCalled();
  });

  it('AddPoints: the first mousedown still places its point', () => {
    const props = makeProps({ tempPoints: [{ x: 4, y: 0 }] });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(leftClick(5, 0, 1)));

    expect(props.setTempPoints).toHaveBeenCalled();
  });

  it('CreatePolyline: the second mousedown of a double-click is ignored', () => {
    const props = makeProps({
      editMode: EditMode.CreatePolyline,
      tempPoints: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(leftClick(5, 0, 2)));
    expect(props.setTempPoints).not.toHaveBeenCalled();

    act(() => result.current.handleMouseDown(leftClick(5, 0, 1)));
    expect(props.setTempPoints).toHaveBeenCalledWith([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 0 },
    ]);
  });

  // Suppression is only sound where a dblclick COMMITS. Where it does not,
  // dropping the press loses a vertex and puts nothing in its place — worse
  // than the duplicate, which at least was visible and step-undoable.
  it('CreatePolygon: the second mousedown still places its point', () => {
    const props = makeProps({
      editMode: EditMode.CreatePolygon,
      tempPoints: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(leftClick(5, 0, 2)));

    expect(props.setTempPoints).toHaveBeenCalledWith([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 0 },
    ]);
  });

  it('AddPoints on a CLOSED polygon: the second mousedown still places its point', () => {
    // `handleEnterPolyline` refuses a closed polygon (that flow finishes by
    // clicking a second vertex), so nothing would commit the dropped press.
    const square: Polygon = {
      id: 'a',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      type: 'external',
    };
    const props = makeProps({
      getPolygons: vi.fn(() => [square]),
      tempPoints: [{ x: 4, y: 4 }],
      interactionState: {
        ...IDLE,
        isAddingPoints: true,
        addPointStartVertex: { polygonId: 'a', vertexIndex: 0 },
      },
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(leftClick(5, 5, 2)));

    expect(props.setTempPoints).toHaveBeenCalledWith([
      { x: 4, y: 4 },
      { x: 5, y: 5 },
    ]);
  });
});

/**
 * Drive a real click SEQUENCE, feeding each `setTempPoints` back in as the
 * next render's prop — which is what React does between two DOM mousedowns
 * (they are separate events, so separate batches). Asserting only that one
 * handler was skipped would not catch an off-by-one in the geometry that
 * actually gets committed.
 */
describe('a full click sequence commits exactly the points that were placed', () => {
  beforeEach(() => vi.clearAllMocks());

  const sequence = (
    editMode: EditMode,
    clicks: Array<[x: number, detail: number]>
  ) => {
    let tempPoints: { x: number; y: number }[] = [];
    let interactionState: InteractionState = IDLE;
    const setTempPoints = vi.fn((pts: { x: number; y: number }[]) => {
      tempPoints = pts;
    });
    const setInteractionState = vi.fn((s: InteractionState) => {
      interactionState = s;
    });
    const props = makeProps({
      editMode,
      setTempPoints,
      setInteractionState,
      // Only the polyline being extended: the shared fixture's second
      // polyline starts at x=20, which is inside the 8 px join radius of
      // the clicks below and would merge instead of extending.
      getPolygons: vi.fn(() => [line('a', 0, 10)]),
    });
    const { result, rerender } = renderHook(p => useAdvancedInteractions(p), {
      initialProps: { ...props, tempPoints, interactionState },
    });
    for (const [x, detail] of clicks) {
      act(() => result.current.handleMouseDown(leftClick(x, 0, detail)));
      rerender({ ...props, tempPoints, interactionState });
    }
    return { tempPoints: () => tempPoints, result, props };
  };

  it('CreatePolyline: three points then a double-click leaves three points, not four', () => {
    // detail 1,1,1 place P1..P3; the 4th mousedown is the double-click's
    // second press (detail 2) at the same spot as P3.
    const s = sequence(EditMode.CreatePolyline, [
      [10, 1],
      [20, 1],
      [30, 1],
      [30, 2],
    ]);
    expect(s.tempPoints()).toEqual([
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it('AddPoints: the committed extension carries no duplicate final vertex', () => {
    const s = sequence(EditMode.AddPoints, [
      [12, 1], // seeds the anchor AND counts as the first drawn point
      [14, 1],
      [16, 1],
      [16, 2], // second press of the double-click — must not be counted
    ]);
    expect(s.tempPoints()).toEqual([
      { x: 12, y: 0 },
      { x: 14, y: 0 },
      { x: 16, y: 0 },
    ]);
  });

  it('AddPoints: a triple-click adds no points beyond the first press either', () => {
    const s = sequence(EditMode.AddPoints, [
      [12, 1],
      [12, 2],
      [12, 3],
    ]);
    expect(s.tempPoints()).toEqual([{ x: 12, y: 0 }]);
  });
});

describe('handleCreatePolylineDoubleClick is mode-gated', () => {
  beforeEach(() => vi.clearAllMocks());

  const TEMP = [
    { x: 0, y: 0 },
    { x: 5, y: 5 },
    { x: 10, y: 10 },
  ];

  it.each([
    ['AddPoints', EditMode.AddPoints],
    ['CreatePolygon', EditMode.CreatePolygon],
    ['EditVertices', EditMode.EditVertices],
    ['View', EditMode.View],
    ['Slice', EditMode.Slice],
  ])(
    'creates nothing in %s mode even with ≥2 temp points',
    (_name, editMode) => {
      const props = makeProps({ editMode, tempPoints: TEMP });
      const { result } = renderHook(() => useAdvancedInteractions(props));

      act(() => result.current.handleCreatePolylineDoubleClick());

      expect(props.updatePolygons).not.toHaveBeenCalled();
      expect(props.setEditMode).not.toHaveBeenCalled();
    }
  );

  it('still finalises in CreatePolyline mode', () => {
    const props = makeProps({
      editMode: EditMode.CreatePolyline,
      tempPoints: TEMP,
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleCreatePolylineDoubleClick());

    const next = lastPolygons(props.updatePolygons);
    expect(next).toHaveLength(3); // the 2 existing + the new polyline
    expect(next[2].geometry).toBe('polyline');
    expect(next[2].points).toEqual(TEMP);
    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
  });
});
