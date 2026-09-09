/**
 * useAdvancedInteractions — panning the canvas while the neurite→soma
 * assignment mode is armed.
 *
 * From a 2026-09-09 request: "když mám aktivovaný tool na spojování neurites a
 * soma, tak mi povol pan, když klikám mimo neurites a soma".
 *
 * Before this, `EditMode.AssignNeurite` had no case in the mousedown switch at
 * all, so a press on empty canvas did nothing whatsoever — and a neurite whose
 * soma sat off-screen could not be assigned without leaving the mode to
 * navigate and coming back.
 *
 * The behaviour it does NOT share with View/Move is the point of this file:
 * those deselect first when something is selected, and here the selection is
 * the ARMED HALF of the gesture (`assignmentClickAction` needs a selected
 * neurite to pair with the soma that is clicked next). Panning to bring that
 * soma into view must therefore keep it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAdvancedInteractions } from '../useAdvancedInteractions';
import { EditMode, InteractionState, TransformState } from '../../types';
import type { Polygon } from '@/lib/segmentation';

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
  createPolygon: vi.fn(() => ({ id: 'created', points: [] })),
}));

vi.mock('@/lib/rendering/VertexSpatialIndex', () => ({
  vertexSpatialIndex: {
    findNearestVertex: vi.fn(() => null),
    invalidate: vi.fn(),
  },
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

const shape = (id: string, partClass: string): Polygon =>
  ({
    id,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    type: 'external',
    geometry: 'polygon',
    partClass,
  }) as Polygon;

function makeProps(
  overrides: Partial<Parameters<typeof useAdvancedInteractions>[0]> = {}
) {
  return {
    editMode: EditMode.AssignNeurite,
    interactionState: IDLE,
    transform: TRANSFORM,
    canvasRef: CANVAS_REF,
    selectedPolygonId: 'neurite-1' as string | null,
    tempPoints: [] as { x: number; y: number }[],
    cursorPosition: null,
    isShiftPressed: vi.fn(() => false),
    isSpacePressed: vi.fn(() => false),
    projectType: 'neurite' as const,
    onJoinBlockedByClass: vi.fn(),
    onPolygonSelection: vi.fn(),
    setEditMode: vi.fn(),
    setInteractionState: vi.fn(),
    setTempPoints: vi.fn(),
    setHoveredVertex: vi.fn(),
    setHoveredJoinTarget: vi.fn(),
    setVertexDragState: vi.fn(),
    updatePolygons: vi.fn(),
    getPolygons: vi.fn(() => [
      shape('neurite-1', 'neurite'),
      shape('soma-1', 'soma'),
    ]),
    handlePan: vi.fn(),
    ...overrides,
  };
}

/** A press on bare canvas: nothing under the pointer carries a polygon id. */
function pressEmptyCanvas(x = 120, y = 80) {
  return {
    button: 0,
    detail: 1,
    clientX: x,
    clientY: y,
    altKey: false,
    shiftKey: false,
    target: document.createElement('div'),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent<HTMLDivElement>;
}

/** A press ON a shape — `CanvasPolygon` binds no mousedown, so this lands
 *  in the very same handler and must NOT be read as a miss. */
function pressShape(polygonId: string) {
  const el = document.createElement('div');
  el.dataset.polygonId = polygonId;
  return {
    button: 0,
    detail: 1,
    clientX: 5,
    clientY: 5,
    altKey: false,
    shiftKey: false,
    target: el,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent<HTMLDivElement>;
}

const panState = (fn: unknown) =>
  vi
    .mocked(fn as (s: InteractionState) => void)
    .mock.calls.map(c => c[0])
    .filter(s => s?.isPanning);

describe('useAdvancedInteractions – panning in the assignment mode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts panning when the press misses every shape', () => {
    const props = makeProps();
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(pressEmptyCanvas(120, 80)));

    const pans = panState(props.setInteractionState);
    expect(pans).toHaveLength(1);
    expect(pans[0].panStart).toEqual({ x: 120, y: 80 });
  });

  it('KEEPS the armed neurite selected while panning', () => {
    // The whole reason this does not borrow View's handler: the selection is
    // the first half of the gesture, and panning exists precisely to reach a
    // soma that is off-screen. Dropping it here would make the next click
    // silently start over instead of completing the assignment.
    const props = makeProps();
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(pressEmptyCanvas()));

    expect(props.onPolygonSelection).not.toHaveBeenCalled();
  });

  it('does NOT pan when the press lands on a shape', () => {
    const props = makeProps();
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(pressShape('soma-1')));

    expect(panState(props.setInteractionState)).toHaveLength(0);
  });

  it('View mode still deselects on empty canvas — the two are not the same', () => {
    // Locks the difference in place: a later "simplification" that routes
    // AssignNeurite through `handleViewModeClick` turns the test above red,
    // but without this one it could look like the modes had simply converged.
    const props = makeProps({
      editMode: EditMode.View,
      selectedPolygonId: 'neurite-1',
    });
    const { result } = renderHook(() => useAdvancedInteractions(props));

    act(() => result.current.handleMouseDown(pressEmptyCanvas()));

    expect(props.onPolygonSelection).toHaveBeenCalledWith(null);
    expect(panState(props.setInteractionState)).toHaveLength(0);
  });
});
