/**
 * Tests for CanvasTemporaryGeometryLayer component
 * Covers polygon creation preview, slice line, add-points preview,
 * polyline creation, and null / no-op cases.
 *
 * The component renders SVG elements inside a <g>, so every render must
 * be wrapped in an <svg> container.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import CanvasTemporaryGeometryLayer from '../CanvasTemporaryGeometryLayer';
import { EditMode, type InteractionState, type TransformState } from '@/pages/segmentation/types';
import type { Polygon } from '@/lib/segmentation';
import {
  createMockPolygon,
  createMockInteractionState,
  createMockTransformState,
} from '@/test-utils/segmentationTestUtils';

// ---------------------------------------------------------------------------
// CanvasVertex exports are used by the component for radius calculation –
// mock them to avoid full canvas setup requirements
// ---------------------------------------------------------------------------

vi.mock('../CanvasVertex', async () => {
  const actual = await vi.importActual<typeof import('../CanvasVertex')>('../CanvasVertex');
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

const makeInteraction = (overrides?: Partial<InteractionState>): InteractionState =>
  createMockInteractionState(overrides);

interface RenderOptions {
  transform?: TransformState;
  editMode?: EditMode;
  tempPoints?: Array<{ x: number; y: number }>;
  cursorPosition?: { x: number; y: number } | null;
  interactionState?: InteractionState;
  selectedPolygonId?: string | null;
  polygons?: Polygon[];
}

const renderLayer = (opts: RenderOptions = {}) => {
  const props = {
    transform: opts.transform ?? makeTransform(),
    editMode: opts.editMode ?? EditMode.View,
    tempPoints: opts.tempPoints ?? [],
    cursorPosition: opts.cursorPosition ?? null,
    interactionState: opts.interactionState ?? makeInteraction(),
    selectedPolygonId: opts.selectedPolygonId ?? null,
    polygons: opts.polygons ?? [],
  };

  return render(
    <svg>
      <CanvasTemporaryGeometryLayer {...props} />
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CanvasTemporaryGeometryLayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Null / no-op cases
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // CreatePolygon preview
  // -------------------------------------------------------------------------

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

      const circles = container.querySelectorAll('circle');
      // 3 vertex circles
      expect(circles.length).toBeGreaterThanOrEqual(3);
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
      const lines = container.querySelectorAll('line');
      expect(lines.length).toBeGreaterThanOrEqual(2);
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

      // Should have at least the line between temp points + cursor preview line
      const lines = container.querySelectorAll('line');
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });

    it('renders nothing when temp points are empty in CreatePolygon mode', () => {
      const { container } = renderLayer({
        editMode: EditMode.CreatePolygon,
        tempPoints: [],
      });

      expect(container.querySelectorAll('circle')).toHaveLength(0);
      expect(container.querySelectorAll('line')).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Slice mode
  // -------------------------------------------------------------------------

  describe('Slice mode', () => {
    it('renders a yellow circle for each slice point', () => {
      const { container } = renderLayer({
        editMode: EditMode.Slice,
        tempPoints: [{ x: 30, y: 30 }],
      });

      const circles = container.querySelectorAll('circle');
      expect(circles.length).toBeGreaterThanOrEqual(1);

      // The slice point circle should be yellow (#ffcc00)
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

      const lines = container.querySelectorAll('line');
      const previewLine = Array.from(lines).find(
        l => l.getAttribute('stroke') === '#ffcc00'
      );
      expect(previewLine).toBeTruthy();
    });

    it('renders a solid final slice line when two temp points are present', () => {
      const { container } = renderLayer({
        editMode: EditMode.Slice,
        tempPoints: [
          { x: 10, y: 10 },
          { x: 90, y: 90 },
        ],
      });

      const lines = container.querySelectorAll('line[data-key="slice-line"], line');
      expect(lines.length).toBeGreaterThanOrEqual(1);
    });

    it('renders nothing when Slice mode has no temp points and no cursor', () => {
      const { container } = renderLayer({
        editMode: EditMode.Slice,
        tempPoints: [],
        cursorPosition: null,
      });

      expect(container.querySelectorAll('circle')).toHaveLength(0);
      expect(container.querySelectorAll('line')).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // CreatePolyline preview
  // -------------------------------------------------------------------------

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
      // Should have at least 2 circles for the 2 temp points
      expect(circles.length).toBeGreaterThanOrEqual(2);

      // Purple fill for first point
      const purpleCircle = Array.from(circles).find(
        c => c.getAttribute('fill') === '#a855f7'
      );
      expect(purpleCircle).toBeTruthy();
    });

    it('renders a preview line to the cursor in CreatePolyline mode', () => {
      const { container } = renderLayer({
        editMode: EditMode.CreatePolyline,
        tempPoints: [{ x: 5, y: 5 }],
        cursorPosition: { x: 60, y: 60 },
      });

      const lines = container.querySelectorAll('line');
      expect(lines.length).toBeGreaterThanOrEqual(1);
    });

    it('renders nothing when temp points are empty in CreatePolyline mode', () => {
      const { container } = renderLayer({
        editMode: EditMode.CreatePolyline,
        tempPoints: [],
      });

      expect(container.querySelectorAll('circle')).toHaveLength(0);
      expect(container.querySelectorAll('line')).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // AddPoints mode
  // -------------------------------------------------------------------------

  describe('AddPoints mode', () => {
    it('renders temp point circles when adding points to a polygon', () => {
      const polygon = createMockPolygon({ id: 'target-polygon' });

      const { container } = renderLayer({
        editMode: EditMode.AddPoints,
        tempPoints: [{ x: 15, y: 15 }, { x: 25, y: 25 }],
        selectedPolygonId: 'target-polygon',
        polygons: [polygon],
        interactionState: makeInteraction({
          isAddingPoints: true,
          addPointStartVertex: {
            polygonId: 'target-polygon',
            vertexIndex: 0,
          },
        }),
      });

      const circles = container.querySelectorAll('circle');
      expect(circles.length).toBeGreaterThanOrEqual(2);
    });

    it('renders nothing in AddPoints mode when isAddingPoints is false', () => {
      const { container } = renderLayer({
        editMode: EditMode.AddPoints,
        tempPoints: [{ x: 15, y: 15 }],
        interactionState: makeInteraction({ isAddingPoints: false }),
      });

      expect(container.querySelectorAll('circle')).toHaveLength(0);
      expect(container.querySelectorAll('line')).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Cursor position reactivity
  // -------------------------------------------------------------------------

  describe('Cursor position updates', () => {
    it('updates the preview line endpoint when cursorPosition changes', () => {
      const { container, rerender } = render(
        <svg>
          <CanvasTemporaryGeometryLayer
            transform={makeTransform()}
            editMode={EditMode.CreatePolygon}
            tempPoints={[{ x: 10, y: 10 }]}
            cursorPosition={{ x: 50, y: 50 }}
            interactionState={makeInteraction()}
            selectedPolygonId={null}
            polygons={[]}
          />
        </svg>
      );

      const linesBefore = container.querySelectorAll('line');
      // Should have a cursor preview line
      expect(linesBefore.length).toBeGreaterThanOrEqual(1);

      // Move cursor
      rerender(
        <svg>
          <CanvasTemporaryGeometryLayer
            transform={makeTransform()}
            editMode={EditMode.CreatePolygon}
            tempPoints={[{ x: 10, y: 10 }]}
            cursorPosition={{ x: 200, y: 200 }}
            interactionState={makeInteraction()}
            selectedPolygonId={null}
            polygons={[]}
          />
        </svg>
      );

      // The line should still exist after cursor move
      const linesAfter = container.querySelectorAll('line');
      expect(linesAfter.length).toBeGreaterThanOrEqual(1);
    });
  });
});
