/**
 * Tests for CanvasTemporaryGeometryLayer.
 *
 * The component renders SVG elements inside a <g>, so every render must be
 * wrapped in an <svg> container. Tests are grouped by EditMode (the component's
 * primary branching axis) plus the always-null drag-preview path.
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

// ---------------------------------------------------------------------------
// CanvasVertex exports are used by the component for radius calculation –
// mock them to avoid full canvas setup requirements.
// ---------------------------------------------------------------------------

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

const lineWithStroke = (container: HTMLElement, stroke: string) =>
  Array.from(container.querySelectorAll('line')).find(
    l => l.getAttribute('stroke') === stroke
  );

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Null / no-op cases
// ---------------------------------------------------------------------------

describe('No temporary geometry', () => {
  it('renders the wrapper <g> but no circles or lines in View mode with no temp points', () => {
    const { container } = renderLayer({ editMode: EditMode.View });

    const g = container.querySelector('g.temporary-geometry-layer');
    expect(g).toBeInTheDocument();
    expect(container.querySelectorAll('circle')).toHaveLength(0);
    expect(container.querySelectorAll('line')).toHaveLength(0);
  });

  it('renders nothing visible in EditVertices mode with no temp points', () => {
    const { container } = renderLayer({ editMode: EditMode.EditVertices });

    expect(container.querySelectorAll('circle')).toHaveLength(0);
    expect(container.querySelectorAll('line')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CreatePolygon preview
// ---------------------------------------------------------------------------

describe('CreatePolygon mode', () => {
  it('renders vertex circles for each temp point', () => {
    const { container } = renderLayer({
      editMode: EditMode.CreatePolygon,
      tempPoints: [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 50 },
      ],
    });

    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(
      3
    );
  });

  it('renders connecting lines between temp points', () => {
    const { container } = renderLayer({
      editMode: EditMode.CreatePolygon,
      tempPoints: [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 50 },
      ],
    });

    // 2 lines between 3 points
    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(2);
  });

  it('renders a preview line from the last point to the cursor', () => {
    const { container } = renderLayer({
      editMode: EditMode.CreatePolygon,
      tempPoints: [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
      ],
      cursorPosition: { x: 70, y: 40 },
    });

    // Line between temp points + cursor preview line
    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(2);
  });

  it('renders nothing when temp points are empty', () => {
    const { container } = renderLayer({
      editMode: EditMode.CreatePolygon,
      tempPoints: [],
    });

    expect(container.querySelectorAll('circle')).toHaveLength(0);
    expect(container.querySelectorAll('line')).toHaveLength(0);
  });

  it('renders a closing-line and first-point highlight when cursor is near the first point', () => {
    // With zoom=1, closeDistance = 15/1 = 15px.
    // first point (50,50), cursor (52,52) → distance ≈ 2.8 → within range.
    const { container } = renderLayer({
      editMode: EditMode.CreatePolygon,
      tempPoints: [
        { x: 50, y: 50 },
        { x: 100, y: 50 },
        { x: 100, y: 100 },
      ],
      cursorPosition: { x: 52, y: 52 },
    });

    // 3 vertex circles + first-point-highlight circle
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThanOrEqual(4);

    // Green closing line
    expect(lineWithStroke(container, '#22c55e')).toBeTruthy();

    // First-point-highlight circle (stroke=#22c55e, fill=none)
    const highlightCircle = Array.from(circles).find(
      c =>
        c.getAttribute('stroke') === '#22c55e' &&
        c.getAttribute('fill') === 'none'
    );
    expect(highlightCircle).toBeTruthy();
  });

  it('does NOT render the closing-line when cursor is far from the first point', () => {
    const { container } = renderLayer({
      editMode: EditMode.CreatePolygon,
      tempPoints: [
        { x: 50, y: 50 },
        { x: 100, y: 50 },
        { x: 100, y: 100 },
      ],
      cursorPosition: { x: 200, y: 200 },
    });

    expect(lineWithStroke(container, '#22c55e')).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Slice mode
// ---------------------------------------------------------------------------

describe('Slice mode', () => {
  it('renders a yellow circle for each slice point', () => {
    const { container } = renderLayer({
      editMode: EditMode.Slice,
      tempPoints: [{ x: 30, y: 30 }],
    });

    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThanOrEqual(1);

    const sliceCircle = Array.from(circles).find(
      c => c.getAttribute('fill') === '#ffcc00'
    );
    expect(sliceCircle).toBeTruthy();
  });

  it('renders a preview dashed line from the slice start point to the cursor', () => {
    const { container } = renderLayer({
      editMode: EditMode.Slice,
      tempPoints: [{ x: 30, y: 30 }],
      cursorPosition: { x: 100, y: 100 },
    });

    expect(lineWithStroke(container, '#ffcc00')).toBeTruthy();
  });

  it('renders a solid final slice line when two temp points are present', () => {
    const { container } = renderLayer({
      editMode: EditMode.Slice,
      tempPoints: [
        { x: 10, y: 10 },
        { x: 90, y: 90 },
      ],
    });

    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(1);
  });

  it('renders nothing when there are no temp points and no cursor', () => {
    const { container } = renderLayer({
      editMode: EditMode.Slice,
      tempPoints: [],
      cursorPosition: null,
    });

    expect(container.querySelectorAll('circle')).toHaveLength(0);
    expect(container.querySelectorAll('line')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CreatePolyline preview
// ---------------------------------------------------------------------------

describe('CreatePolyline mode', () => {
  it('renders purple vertex circles for each polyline temp point', () => {
    const { container } = renderLayer({
      editMode: EditMode.CreatePolyline,
      tempPoints: [
        { x: 5, y: 5 },
        { x: 20, y: 30 },
      ],
    });

    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThanOrEqual(2);

    const purpleCircle = Array.from(circles).find(
      c => c.getAttribute('fill') === '#a855f7'
    );
    expect(purpleCircle).toBeTruthy();
  });

  it('renders a preview line to the cursor', () => {
    const { container } = renderLayer({
      editMode: EditMode.CreatePolyline,
      tempPoints: [{ x: 5, y: 5 }],
      cursorPosition: { x: 60, y: 60 },
    });

    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(1);
  });

  it('renders nothing when temp points are empty', () => {
    const { container } = renderLayer({
      editMode: EditMode.CreatePolyline,
      tempPoints: [],
    });

    expect(container.querySelectorAll('circle')).toHaveLength(0);
    expect(container.querySelectorAll('line')).toHaveLength(0);
  });

  it('renders connecting lines between consecutive temp points', () => {
    const { container } = renderLayer({
      editMode: EditMode.CreatePolyline,
      tempPoints: [
        { x: 10, y: 10 },
        { x: 30, y: 30 },
        { x: 60, y: 20 },
      ],
    });

    expect(container.querySelectorAll('circle')).toHaveLength(3);
    // 2 between-point lines
    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT render a closing line even when the cursor is on the first point (unlike CreatePolygon)', () => {
    const { container } = renderLayer({
      editMode: EditMode.CreatePolyline,
      tempPoints: [
        { x: 50, y: 50 },
        { x: 100, y: 50 },
        { x: 100, y: 100 },
      ],
      cursorPosition: { x: 52, y: 52 },
    });

    expect(lineWithStroke(container, '#22c55e')).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// AddPoints mode (renderAddPointsPreview)
// ---------------------------------------------------------------------------

describe('AddPoints mode', () => {
  it('renders temp point circles when adding points to a polygon', () => {
    const polygon = createMockPolygon({ id: 'target-polygon' });

    const { container } = renderLayer({
      editMode: EditMode.AddPoints,
      tempPoints: [
        { x: 15, y: 15 },
        { x: 25, y: 25 },
      ],
      selectedPolygonId: 'target-polygon',
      polygons: [polygon],
      interactionState: makeInteraction({
        isAddingPoints: true,
        addPointStartVertex: { polygonId: 'target-polygon', vertexIndex: 0 },
      }),
    });

    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(
      2
    );
  });

  it('renders nothing when isAddingPoints is false', () => {
    const { container } = renderLayer({
      editMode: EditMode.AddPoints,
      tempPoints: [{ x: 15, y: 15 }],
      interactionState: makeInteraction({ isAddingPoints: false }),
    });

    expect(container.querySelectorAll('circle')).toHaveLength(0);
    expect(container.querySelectorAll('line')).toHaveLength(0);
  });

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

    // Blue add-preview lines between the 3 consecutive points
    const addLines = Array.from(container.querySelectorAll('line')).filter(
      l => l.getAttribute('stroke') === '#60a5fa'
    );
    expect(addLines.length).toBeGreaterThanOrEqual(2);
  });

  it('renders a start-vertex-line from the start vertex to the first temp point', () => {
    const polygon = createMockPolygon({
      id: 'poly-sv',
      points: [
        { x: 5, y: 5 }, // vertex 0 = start vertex
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

    // Connects vertex[0] (5,5) to tempPoints[0] (40,40)
    const svLine = Array.from(container.querySelectorAll('line')).find(
      l =>
        l.getAttribute('x1') === '5' &&
        l.getAttribute('y1') === '5' &&
        l.getAttribute('x2') === '40' &&
        l.getAttribute('y2') === '40'
    );
    expect(svLine).toBeTruthy();
  });

  it('does NOT render the start-vertex-line when vertexIndex is out of range', () => {
    const polygon = createMockPolygon({
      id: 'poly-oob',
      points: [{ x: 5, y: 5 }], // only index 0 exists
    });

    const { container } = renderLayer({
      editMode: EditMode.AddPoints,
      tempPoints: [{ x: 40, y: 40 }],
      selectedPolygonId: 'poly-oob',
      polygons: [polygon],
      interactionState: makeInteraction({
        isAddingPoints: true,
        addPointStartVertex: { polygonId: 'poly-oob', vertexIndex: 99 },
      }),
    });

    // Out-of-range vertex has no coords → no line with x1="undefined"
    const svLine = Array.from(container.querySelectorAll('line')).find(
      l => l.getAttribute('x1') === 'undefined'
    );
    expect(svLine).toBeFalsy();
  });

  it('renders a cursor-add-line from the last temp point to the cursor', () => {
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

    // Connects last temp point (30,30) to cursor (80,80)
    const cursorLine = Array.from(container.querySelectorAll('line')).find(
      l =>
        l.getAttribute('x1') === '30' &&
        l.getAttribute('y1') === '30' &&
        l.getAttribute('x2') === '80' &&
        l.getAttribute('y2') === '80'
    );
    expect(cursorLine).toBeTruthy();
  });

  // start-cursor-line: tempPoints=[] AND cursor set AND valid start vertex
  it('renders a start-cursor-line from the start vertex to the cursor when no temp points exist', () => {
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
      tempPoints: [],
      cursorPosition: { x: 70, y: 70 },
      selectedPolygonId: 'svc',
      polygons: [polygon],
      interactionState: makeInteraction({
        isAddingPoints: true,
        addPointStartVertex: { polygonId: 'svc', vertexIndex: 0 },
      }),
    });

    // Connects vertex[0] (15,15) to cursor (70,70)
    const cursorLine = Array.from(container.querySelectorAll('line')).find(
      l =>
        l.getAttribute('x1') === '15' &&
        l.getAttribute('y1') === '15' &&
        l.getAttribute('x2') === '70' &&
        l.getAttribute('y2') === '70'
    );
    expect(cursorLine).toBeTruthy();
  });

  it('does NOT render the start-cursor-line when addPointStartVertex is absent', () => {
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
        addPointStartVertex: undefined,
      }),
    });

    expect(container.querySelectorAll('line')).toHaveLength(0);
  });

  it('does NOT render the start-cursor-line when vertexIndex is out of range', () => {
    const polygon = createMockPolygon({
      id: 'svc-oob',
      points: [{ x: 15, y: 15 }],
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

  it('does NOT render the start-cursor-line when selectedPolygonId matches no polygon', () => {
    const polygon = createMockPolygon({ id: 'other-poly' });

    const { container } = renderLayer({
      editMode: EditMode.AddPoints,
      tempPoints: [],
      cursorPosition: { x: 70, y: 70 },
      selectedPolygonId: 'missing-poly',
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
// renderDragPreview — always returns null
// ---------------------------------------------------------------------------

describe('renderDragPreview', () => {
  it('never renders any drag ghost elements', () => {
    const { container } = renderLayer({
      editMode: EditMode.View,
      interactionState: makeInteraction({ isDragging: true }),
    });

    const g = container.querySelector('g.temporary-geometry-layer');
    expect(g?.children).toHaveLength(0);
  });
});
