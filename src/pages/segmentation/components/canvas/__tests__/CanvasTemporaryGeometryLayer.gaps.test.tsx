/**
 * CanvasTemporaryGeometryLayer — gap coverage
 *
 * Existing test covers: View/EditVertices (no temp geometry), CreatePolygon
 * (vertex circles, connecting lines, cursor preview line, closing-line
 * proximity, empty temp points), Slice (yellow circle, preview dashed line,
 * final solid line, empty), CreatePolyline (purple circles, preview line,
 * empty), AddPoints (with isAddingPoints=true, with isAddingPoints=false),
 * cursor reactivity.
 *
 * Uncovered lines 187-289, 291-316 are inside renderAddPointsPreview:
 *   187-220: temp point circles + connecting lines between temp points
 *   237-268: start-vertex-line from startVertex to tempPoints[0]
 *   270-283: cursor-add-line from last temp point to cursor
 *   285-316: start-cursor-line from startVertex to cursor when tempPoints=[]
 *
 * Also not yet hit: CreatePolygon closing-line (≥3 points, cursor within
 * closeDistance of first point).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import CanvasTemporaryGeometryLayer from '../CanvasTemporaryGeometryLayer';
import {
  EditMode,
  type InteractionState,
  type TransformState,
} from '@/pages/segmentation/types';
import {
  createMockPolygon,
  createMockInteractionState,
  createMockTransformState,
} from '@/test-utils/segmentationTestUtils';

vi.mock('../CanvasVertex', async () => {
  const actual =
    await vi.importActual<typeof import('../CanvasVertex')>('../CanvasVertex');
  return {
    ...actual,
    calculateVertexRadius: vi.fn(() => 4),
    defaultConfig: actual.defaultConfig,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTransform = (overrides?: Partial<TransformState>): TransformState =>
  createMockTransformState(overrides);

const makeInteraction = (
  overrides?: Partial<InteractionState>
): InteractionState => createMockInteractionState(overrides);

interface RenderOptions {
  transform?: TransformState;
  editMode?: EditMode;
  tempPoints?: Array<{ x: number; y: number }>;
  cursorPosition?: { x: number; y: number } | null;
  interactionState?: InteractionState;
  selectedPolygonId?: string | null;
  polygons?: ReturnType<typeof createMockPolygon>[];
}

const renderLayer = (opts: RenderOptions = {}) =>
  render(
    <svg>
      <CanvasTemporaryGeometryLayer
        transform={opts.transform ?? makeTransform()}
        editMode={opts.editMode ?? EditMode.View}
        tempPoints={opts.tempPoints ?? []}
        cursorPosition={opts.cursorPosition ?? null}
        interactionState={opts.interactionState ?? makeInteraction()}
        selectedPolygonId={opts.selectedPolygonId ?? null}
        polygons={opts.polygons ?? []}
      />
    </svg>
  );

beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// CreatePolygon — closing-line (≥3 points + cursor within closeDistance)
// ---------------------------------------------------------------------------

describe('CreatePolygon — closing-line highlight', () => {
  it('renders a closing-line and first-point highlight when cursor is near first point', () => {
    // With zoom=1, closeDistance = 15/1 = 15px
    // first point at (50, 50), cursor at (52, 52) → distance ≈ 2.8 → within range
    const { container } = renderLayer({
      editMode: EditMode.CreatePolygon,
      tempPoints: [
        { x: 50, y: 50 },
        { x: 100, y: 50 },
        { x: 100, y: 100 },
      ],
      cursorPosition: { x: 52, y: 52 },
    });

    // Should have circles for 3 vertices + first-point-highlight circle
    const circles = container.querySelectorAll('circle');
    // 3 vertex circles + 1 highlight circle = 4
    expect(circles.length).toBeGreaterThanOrEqual(4);

    // The closing line (green #22c55e)
    const closingLine = Array.from(container.querySelectorAll('line')).find(
      l => l.getAttribute('stroke') === '#22c55e'
    );
    expect(closingLine).toBeTruthy();

    // The first-point-highlight circle (stroke=#22c55e, fill=none)
    const highlightCircle = Array.from(circles).find(
      c =>
        c.getAttribute('stroke') === '#22c55e' &&
        c.getAttribute('fill') === 'none'
    );
    expect(highlightCircle).toBeTruthy();
  });

  it('does NOT render closing-line when cursor is far from first point', () => {
    const { container } = renderLayer({
      editMode: EditMode.CreatePolygon,
      tempPoints: [
        { x: 50, y: 50 },
        { x: 100, y: 50 },
        { x: 100, y: 100 },
      ],
      cursorPosition: { x: 200, y: 200 }, // far away
    });

    const closingLine = Array.from(container.querySelectorAll('line')).find(
      l => l.getAttribute('stroke') === '#22c55e'
    );
    expect(closingLine).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// AddPoints — connecting lines between temp points (lines 218-234)
// ---------------------------------------------------------------------------

describe('AddPoints — connecting lines between multiple temp points', () => {
  it('renders connecting lines between consecutive temp points', () => {
    const polygon = createMockPolygon({ id: 'target' });
    const { container } = renderLayer({
      editMode: EditMode.AddPoints,
      tempPoints: [
        { x: 10, y: 10 },
        { x: 30, y: 30 },
        { x: 50, y: 50 },
      ],
      selectedPolygonId: 'target',
      polygons: [polygon],
      interactionState: makeInteraction({
        isAddingPoints: true,
        addPointStartVertex: { polygonId: 'target', vertexIndex: 0 },
      }),
    });

    // 3 circles + connecting lines between 3 consecutive points (2 lines)
    // + start-vertex-line + cursor-add-line (if cursor present)
    const addLines = Array.from(container.querySelectorAll('line')).filter(
      l => l.getAttribute('stroke') === '#60a5fa'
    );
    expect(addLines.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// AddPoints — start-vertex-line (lines 237-268): line from startVertex to
// first temp point, when addPointStartVertex is set + polygon has enough points
// ---------------------------------------------------------------------------

describe('AddPoints — start-vertex-line to first temp point', () => {
  it('renders a line from the start vertex to the first temp point', () => {
    const polygon = createMockPolygon({
      id: 'poly-sv',
      points: [
        { x: 5, y: 5 }, // vertex 0 — this is the start vertex
        { x: 20, y: 5 },
        { x: 20, y: 20 },
      ],
    });

    const { container } = renderLayer({
      editMode: EditMode.AddPoints,
      tempPoints: [{ x: 40, y: 40 }],
      selectedPolygonId: 'poly-sv',
      polygons: [polygon],
      interactionState: makeInteraction({
        isAddingPoints: true,
        addPointStartVertex: { polygonId: 'poly-sv', vertexIndex: 0 },
      }),
    });

    // start-vertex-line should have key="start-vertex-line"
    // It connects vertex[0] (5,5) to tempPoints[0] (40,40)
    const lines = container.querySelectorAll('line');
    const svLine = Array.from(lines).find(
      l =>
        l.getAttribute('x1') === '5' &&
        l.getAttribute('y1') === '5' &&
        l.getAttribute('x2') === '40' &&
        l.getAttribute('y2') === '40'
    );
    expect(svLine).toBeTruthy();
  });

  it('does NOT render start-vertex-line when vertexIndex is out of range', () => {
    const polygon = createMockPolygon({
      id: 'poly-oob',
      points: [{ x: 5, y: 5 }], // only 1 point (index 0)
    });

    const { container } = renderLayer({
      editMode: EditMode.AddPoints,
      tempPoints: [{ x: 40, y: 40 }],
      selectedPolygonId: 'poly-oob',
      polygons: [polygon],
      interactionState: makeInteraction({
        isAddingPoints: true,
        addPointStartVertex: {
          polygonId: 'poly-oob',
          vertexIndex: 99, // out of range
        },
      }),
    });

    // No line from vertex[99] (doesn't exist) to tempPoints[0]
    const lines = container.querySelectorAll('line');
    // No lines with x1=undefined (out-of-range vertex has no coords)
    const svLine = Array.from(lines).find(
      l => l.getAttribute('x1') === 'undefined'
    );
    expect(svLine).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// AddPoints — cursor-add-line (lines 270-283): line from last temp point
// to cursor when tempPoints.length > 0 AND cursorPosition is set
// ---------------------------------------------------------------------------

describe('AddPoints — cursor-add-line from last temp point', () => {
  it('renders a dotted line from the last temp point to the cursor', () => {
    const polygon = createMockPolygon({ id: 'cadd' });

    const { container } = renderLayer({
      editMode: EditMode.AddPoints,
      tempPoints: [
        { x: 10, y: 10 },
        { x: 30, y: 30 },
      ],
      cursorPosition: { x: 80, y: 80 },
      selectedPolygonId: 'cadd',
      polygons: [polygon],
      interactionState: makeInteraction({ isAddingPoints: true }),
    });

    // cursor-add-line connects (30,30) to (80,80)
    const cursorLine = Array.from(container.querySelectorAll('line')).find(
      l =>
        l.getAttribute('x1') === '30' &&
        l.getAttribute('y1') === '30' &&
        l.getAttribute('x2') === '80' &&
        l.getAttribute('y2') === '80'
    );
    expect(cursorLine).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AddPoints — start-cursor-line (lines 285-316):
// when tempPoints=[] AND cursorPosition set AND addPointStartVertex set
// ---------------------------------------------------------------------------

describe('AddPoints — start-cursor-line (no temp points, cursor present)', () => {
  it('renders a line from the start vertex directly to the cursor when no temp points exist', () => {
    const polygon = createMockPolygon({
      id: 'svc',
      points: [
        { x: 15, y: 15 }, // vertex 0 = start vertex
        { x: 50, y: 15 },
        { x: 50, y: 50 },
      ],
    });

    const { container } = renderLayer({
      editMode: EditMode.AddPoints,
      tempPoints: [], // no temp points
      cursorPosition: { x: 70, y: 70 },
      selectedPolygonId: 'svc',
      polygons: [polygon],
      interactionState: makeInteraction({
        isAddingPoints: true,
        addPointStartVertex: { polygonId: 'svc', vertexIndex: 0 },
      }),
    });

    // start-cursor-line connects vertex[0] (15,15) to cursor (70,70)
    const cursorLine = Array.from(container.querySelectorAll('line')).find(
      l =>
        l.getAttribute('x1') === '15' &&
        l.getAttribute('y1') === '15' &&
        l.getAttribute('x2') === '70' &&
        l.getAttribute('y2') === '70'
    );
    expect(cursorLine).toBeTruthy();
  });

  it('does NOT render start-cursor-line when addPointStartVertex is absent', () => {
    const polygon = createMockPolygon({
      id: 'svc-none',
      points: [
        { x: 15, y: 15 },
        { x: 50, y: 15 },
      ],
    });

    const { container } = renderLayer({
      editMode: EditMode.AddPoints,
      tempPoints: [],
      cursorPosition: { x: 70, y: 70 },
      selectedPolygonId: 'svc-none',
      polygons: [polygon],
      interactionState: makeInteraction({
        isAddingPoints: true,
        addPointStartVertex: undefined, // not set
      }),
    });

    expect(container.querySelectorAll('line')).toHaveLength(0);
  });

  it('does NOT render start-cursor-line when vertexIndex is out of range', () => {
    const polygon = createMockPolygon({
      id: 'svc-oob',
      points: [{ x: 15, y: 15 }], // only 1 point
    });

    const { container } = renderLayer({
      editMode: EditMode.AddPoints,
      tempPoints: [],
      cursorPosition: { x: 70, y: 70 },
      selectedPolygonId: 'svc-oob',
      polygons: [polygon],
      interactionState: makeInteraction({
        isAddingPoints: true,
        addPointStartVertex: { polygonId: 'svc-oob', vertexIndex: 50 },
      }),
    });

    expect(container.querySelectorAll('line')).toHaveLength(0);
  });

  it('does NOT render start-cursor-line when selectedPolygonId does not match any polygon', () => {
    const polygon = createMockPolygon({ id: 'other-poly' });

    const { container } = renderLayer({
      editMode: EditMode.AddPoints,
      tempPoints: [],
      cursorPosition: { x: 70, y: 70 },
      selectedPolygonId: 'missing-poly', // no polygon with this id
      polygons: [polygon],
      interactionState: makeInteraction({
        isAddingPoints: true,
        addPointStartVertex: { polygonId: 'missing-poly', vertexIndex: 0 },
      }),
    });

    expect(container.querySelectorAll('line')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CreatePolyline — multi-point connecting lines
// ---------------------------------------------------------------------------

describe('CreatePolyline — multiple temp points with connecting lines', () => {
  it('renders connecting lines between consecutive polyline temp points', () => {
    const { container } = renderLayer({
      editMode: EditMode.CreatePolyline,
      tempPoints: [
        { x: 10, y: 10 },
        { x: 30, y: 30 },
        { x: 60, y: 20 },
      ],
    });

    // 3 vertex circles
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(3);

    // 2 connecting lines between the 3 points
    const lines = container.querySelectorAll('line');
    // 2 between-point lines + 1 cursor-preview (if cursor present) or just 2
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT render a closing line for polylines (unlike CreatePolygon)', () => {
    // Even if cursor is right on the first point, no closing line for polylines
    const { container } = renderLayer({
      editMode: EditMode.CreatePolyline,
      tempPoints: [
        { x: 50, y: 50 },
        { x: 100, y: 50 },
        { x: 100, y: 100 },
      ],
      cursorPosition: { x: 52, y: 52 }, // near first point
    });

    // No closing line (no green #22c55e line)
    const closingLine = Array.from(container.querySelectorAll('line')).find(
      l => l.getAttribute('stroke') === '#22c55e'
    );
    expect(closingLine).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// renderDragPreview — always returns null
// ---------------------------------------------------------------------------

describe('renderDragPreview', () => {
  it('never renders any drag ghost elements', () => {
    // The renderDragPreview function always returns null — no drag indicator
    const { container } = renderLayer({
      editMode: EditMode.View,
      interactionState: makeInteraction({ isDragging: true }),
    });

    // Only the <g> wrapper, nothing inside
    const g = container.querySelector('g.temporary-geometry-layer');
    expect(g?.children).toHaveLength(0);
  });
});
