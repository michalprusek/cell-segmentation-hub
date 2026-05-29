/**
 * PolygonVertices – React.memo comparator gap coverage
 *
 * The primary test file covers rendering and prop-propagation branches.
 * This file targets the custom memo comparator logic that determines
 * whether the component re-renders. The comparator returns:
 *   true  → props are equal → skip re-render
 *   false → props differ   → do re-render
 *
 * We can't call the comparator directly (it's a local function), so we
 * observe re-renders by tracking how many times our CanvasVertex stub
 * is called after a re-render (each render produces one call per vertex).
 *
 * Branches targeted (not covered by primary test):
 *  1. isZooming=true suppresses zoom-only re-renders (zoom changed but isZooming).
 *  2. zoom change with isZooming=false triggers re-render.
 *  3. viewportBounds: one side null → false (re-render).
 *  4. viewportBounds: prev null, next non-null → false (re-render).
 *  5. hoveredVertex: one side null → false (re-render).
 *  6. vertexDragState: one side null → false (re-render).
 *  7. vertexDragState: dragOffset one side null → false (re-render).
 *  8. points array same length, different coordinates → re-render.
 *  9. points array same length, same coordinates → no re-render.
 * 10. polygonType change triggers re-render.
 * 11. isHovered change triggers re-render.
 * 12. isUndoRedoInProgress change triggers re-render.
 * 13. vertexDragState: isDragging/polygonId/vertexIndex change → re-render.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import PolygonVertices from '../PolygonVertices';
import { Point } from '@/lib/segmentation';
import { VertexDragState } from '@/pages/segmentation/types';

// ── mock CanvasVertex with a render counter ───────────────────────────────────

// We need to track how many times CanvasVertex renders across all invocations.
// The mock increments a shared counter each time it's called.
let renderCount = 0;

vi.mock('../CanvasVertex', () => ({
  default: ({
    vertexIndex,
    polygonId,
    isSelected,
    isHovered,
    isDragging,
    isStartPoint,
    isUndoRedoInProgress,
    isInAddPointsMode,
    dragOffset,
    point,
  }: {
    vertexIndex: number;
    polygonId: string;
    isSelected: boolean;
    isHovered: boolean;
    isDragging: boolean;
    isStartPoint: boolean;
    isUndoRedoInProgress: boolean;
    isInAddPointsMode: boolean;
    dragOffset?: { x: number; y: number };
    point: Point;
  }) => {
    renderCount++;
    return (
      <circle
        data-testid={`vertex-${vertexIndex}`}
        data-polygon-id={polygonId}
        data-is-selected={String(isSelected)}
        data-is-hovered={String(isHovered)}
        data-is-dragging={String(isDragging)}
        data-is-start-point={String(isStartPoint)}
        data-undo-redo={String(isUndoRedoInProgress)}
        data-add-points-mode={String(isInAddPointsMode)}
        data-drag-offset-x={dragOffset?.x ?? ''}
        cx={point.x}
        cy={point.y}
        r="5"
      />
    );
  },
}));

vi.mock('../../context-menu/VertexContextMenu', () => ({
  default: ({
    children,
    vertexIndex,
    polygonId,
  }: {
    children: React.ReactNode;
    onDelete: () => void;
    vertexIndex: number;
    polygonId: string;
  }) => (
    <g data-vcm-polygon={polygonId} data-vcm-vertex={String(vertexIndex)}>
      {children}
    </g>
  ),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function makePoints(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: i * 10, y: i * 10 }));
}

const emptyDragState: VertexDragState = {
  isDragging: false,
  polygonId: null,
  vertexIndex: null,
  startPoint: null,
  currentPoint: null,
  dragOffset: null,
};

const DEFAULT_PROPS = {
  polygonId: 'poly-memo',
  points: makePoints(3),
  polygonType: 'external' as const,
  isSelected: true,
  isHovered: false,
  hoveredVertex: { polygonId: null, vertexIndex: null },
  vertexDragState: emptyDragState,
  zoom: 1,
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('PolygonVertices – memo comparator branches', () => {
  beforeEach(() => {
    renderCount = 0;
    vi.clearAllMocks();
  });

  // ── zoom changes ────────────────────────────────────────────────────────────

  describe('zoom change and isZooming guard', () => {
    it('does NOT re-render when zoom changes while isZooming=true', () => {
      const { rerender } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} zoom={1} isZooming={true} />
        </svg>
      );

      const firstRenderCount = renderCount;

      // Change zoom but keep isZooming=true — comparator returns true (skip)
      rerender(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} zoom={2} isZooming={true} />
        </svg>
      );

      // No additional CanvasVertex renders (same count as after first render)
      expect(renderCount).toBe(firstRenderCount);
    });

    it('re-renders when zoom changes with isZooming=false', () => {
      const { rerender } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} zoom={1} isZooming={false} />
        </svg>
      );

      const firstRenderCount = renderCount;

      // Change zoom with isZooming=false → comparator returns false (re-render)
      rerender(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} zoom={2} isZooming={false} />
        </svg>
      );

      // CanvasVertex should have been called again (3 vertices × re-render)
      expect(renderCount).toBeGreaterThan(firstRenderCount);
    });
  });

  // ── viewportBounds changes ──────────────────────────────────────────────────

  describe('viewportBounds comparator', () => {
    it('re-renders when viewportBounds changes from undefined to a value', () => {
      const { rerender } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} viewportBounds={undefined} />
        </svg>
      );

      const firstRenderCount = renderCount;

      rerender(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            viewportBounds={{ x: 0, y: 0, width: 100, height: 100 }}
          />
        </svg>
      );

      expect(renderCount).toBeGreaterThan(firstRenderCount);
    });

    it('re-renders when viewportBounds changes from a value to undefined', () => {
      const bounds = { x: 0, y: 0, width: 100, height: 100 };

      const { rerender } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} viewportBounds={bounds} />
        </svg>
      );

      const firstRenderCount = renderCount;

      rerender(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} viewportBounds={undefined} />
        </svg>
      );

      expect(renderCount).toBeGreaterThan(firstRenderCount);
    });

    it('does NOT re-render when viewportBounds object is identical (same coords)', () => {
      const bounds = { x: 0, y: 0, width: 100, height: 100 };

      const { rerender } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} viewportBounds={bounds} />
        </svg>
      );

      const firstRenderCount = renderCount;

      // Same values, new object reference — comparator deep-compares coordinates
      rerender(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            viewportBounds={{ x: 0, y: 0, width: 100, height: 100 }}
          />
        </svg>
      );

      expect(renderCount).toBe(firstRenderCount);
    });

    it('re-renders when viewportBounds coordinates change', () => {
      const { rerender } = render(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            viewportBounds={{ x: 0, y: 0, width: 100, height: 100 }}
          />
        </svg>
      );

      const firstRenderCount = renderCount;

      rerender(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            viewportBounds={{ x: 10, y: 0, width: 100, height: 100 }}
          />
        </svg>
      );

      expect(renderCount).toBeGreaterThan(firstRenderCount);
    });
  });

  // ── hoveredVertex comparator ────────────────────────────────────────────────

  describe('hoveredVertex comparator', () => {
    it('re-renders when hoveredVertex changes from null to a value', () => {
      const { rerender } = render(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            hoveredVertex={{ polygonId: null, vertexIndex: null }}
          />
        </svg>
      );

      const firstRenderCount = renderCount;

      rerender(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            hoveredVertex={{ polygonId: 'poly-memo', vertexIndex: 1 }}
          />
        </svg>
      );

      expect(renderCount).toBeGreaterThan(firstRenderCount);
    });

    it('does NOT re-render when hoveredVertex values are identical', () => {
      const hovered = { polygonId: 'poly-memo', vertexIndex: 2 };

      const { rerender } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} hoveredVertex={hovered} />
        </svg>
      );

      const firstRenderCount = renderCount;

      rerender(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            hoveredVertex={{ polygonId: 'poly-memo', vertexIndex: 2 }}
          />
        </svg>
      );

      expect(renderCount).toBe(firstRenderCount);
    });
  });

  // ── vertexDragState comparator ──────────────────────────────────────────────

  describe('vertexDragState comparator', () => {
    it('re-renders when isDragging changes', () => {
      const { rerender } = render(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            vertexDragState={emptyDragState}
          />
        </svg>
      );

      const firstRenderCount = renderCount;

      rerender(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            vertexDragState={{
              isDragging: true,
              polygonId: 'poly-memo',
              vertexIndex: 0,
              startPoint: { x: 0, y: 0 },
              currentPoint: { x: 5, y: 5 },
              dragOffset: { x: 5, y: 5 },
            }}
          />
        </svg>
      );

      expect(renderCount).toBeGreaterThan(firstRenderCount);
    });

    it('re-renders when dragOffset changes', () => {
      const drag1: VertexDragState = {
        isDragging: true,
        polygonId: 'poly-memo',
        vertexIndex: 0,
        startPoint: { x: 0, y: 0 },
        currentPoint: { x: 5, y: 5 },
        dragOffset: { x: 5, y: 5 },
      };

      const { rerender } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} vertexDragState={drag1} />
        </svg>
      );

      const firstRenderCount = renderCount;

      rerender(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            vertexDragState={{
              ...drag1,
              dragOffset: { x: 10, y: 10 },
            }}
          />
        </svg>
      );

      expect(renderCount).toBeGreaterThan(firstRenderCount);
    });

    it('does NOT re-render when dragOffset values are identical', () => {
      const drag: VertexDragState = {
        isDragging: true,
        polygonId: 'poly-memo',
        vertexIndex: 0,
        startPoint: { x: 0, y: 0 },
        currentPoint: { x: 5, y: 5 },
        dragOffset: { x: 5, y: 5 },
      };

      const { rerender } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} vertexDragState={drag} />
        </svg>
      );

      const firstRenderCount = renderCount;

      rerender(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            vertexDragState={{
              ...drag,
              dragOffset: { x: 5, y: 5 }, // same values, new object
            }}
          />
        </svg>
      );

      expect(renderCount).toBe(firstRenderCount);
    });

    it('re-renders when dragOffset goes from non-null to null', () => {
      const dragWithOffset: VertexDragState = {
        isDragging: true,
        polygonId: 'poly-memo',
        vertexIndex: 0,
        startPoint: { x: 0, y: 0 },
        currentPoint: { x: 5, y: 5 },
        dragOffset: { x: 5, y: 5 },
      };

      const { rerender } = render(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            vertexDragState={dragWithOffset}
          />
        </svg>
      );

      const firstRenderCount = renderCount;

      rerender(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            vertexDragState={{
              ...dragWithOffset,
              dragOffset: null,
            }}
          />
        </svg>
      );

      expect(renderCount).toBeGreaterThan(firstRenderCount);
    });
  });

  // ── points deep-comparison ──────────────────────────────────────────────────

  describe('points deep-comparison in comparator', () => {
    it('re-renders when a point coordinate changes', () => {
      const pts = makePoints(3);

      const { rerender } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} points={pts} />
        </svg>
      );

      const firstRenderCount = renderCount;

      // Change one coordinate
      const modified = pts.map((p, i) =>
        i === 1 ? { x: p.x + 1, y: p.y } : { ...p }
      );

      rerender(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} points={modified} />
        </svg>
      );

      expect(renderCount).toBeGreaterThan(firstRenderCount);
    });

    it('does NOT re-render when points have the same coordinates (new array, same values)', () => {
      const pts = makePoints(3);

      const { rerender } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} points={pts} />
        </svg>
      );

      const firstRenderCount = renderCount;

      // Same coordinates, new array reference
      const sameValues = makePoints(3);

      rerender(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} points={sameValues} />
        </svg>
      );

      expect(renderCount).toBe(firstRenderCount);
    });
  });

  // ── simple prop changes that always trigger re-render ────────────────────────

  describe('basic prop equality checks', () => {
    it('re-renders when polygonType changes', () => {
      const { rerender } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} polygonType="external" />
        </svg>
      );

      const firstRenderCount = renderCount;

      rerender(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} polygonType="internal" />
        </svg>
      );

      expect(renderCount).toBeGreaterThan(firstRenderCount);
    });

    it('re-renders when isHovered changes', () => {
      const { rerender } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} isHovered={false} />
        </svg>
      );

      const firstRenderCount = renderCount;

      rerender(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} isHovered={true} />
        </svg>
      );

      expect(renderCount).toBeGreaterThan(firstRenderCount);
    });

    it('re-renders when isUndoRedoInProgress changes', () => {
      const { rerender } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} isUndoRedoInProgress={false} />
        </svg>
      );

      const firstRenderCount = renderCount;

      rerender(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} isUndoRedoInProgress={true} />
        </svg>
      );

      expect(renderCount).toBeGreaterThan(firstRenderCount);
    });

    it('does NOT re-render when all props are identical (full stable props)', () => {
      const { rerender } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} />
        </svg>
      );

      const firstRenderCount = renderCount;

      // Re-render with identical props — comparator should return true (skip)
      rerender(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} />
        </svg>
      );

      expect(renderCount).toBe(firstRenderCount);
    });
  });
});
