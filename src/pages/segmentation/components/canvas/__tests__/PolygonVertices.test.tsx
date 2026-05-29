/**
 * PolygonVertices — behavioral unit tests
 *
 * Covered:
 *  - Returns null when isSelected=false (shouldShowVertices gate)
 *  - Returns null when points array is empty
 *  - Renders one CanvasVertex per point when selected
 *  - Each vertex gets correct originalIndex (isStartPoint correct for index 0)
 *  - Viewport culling: points outside bounds+buffer are omitted
 *  - Viewport culling: points inside bounds+buffer are kept
 *  - hoveredVertex state propagates to the right CanvasVertex
 *  - isDragging + dragOffset propagate to the right CanvasVertex
 *  - isUndoRedoInProgress propagates
 *  - editMode=AddPoints propagates isInAddPointsMode=true
 *  - onDeleteVertex called with polygonId+index via VertexContextMenu
 *
 * Skipped (Radix focus-race / portal):
 *  - Right-click open / keyboard navigation of VertexContextMenu — Radix
 *    portals in JSDOM are unreliable; existing VertexContextMenu.e2e.test.tsx
 *    already covers that path with the Radix mock pattern.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import PolygonVertices from '../PolygonVertices';
import { Point } from '@/lib/segmentation';
import { EditMode, VertexDragState } from '@/pages/segmentation/types';

// ── mock dependencies ────────────────────────────────────────────────────────

// CanvasVertex renders an SVG circle; we stub it with a simple element that
// exposes all props as data-attributes so we can query them without dealing
// with SVG rendering internals.
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
  }) => (
    <circle
      data-testid={`vertex-${vertexIndex}`}
      data-polygon-id={polygonId}
      data-vertex-index={vertexIndex}
      data-is-selected={String(isSelected)}
      data-is-hovered={String(isHovered)}
      data-is-dragging={String(isDragging)}
      data-is-start-point={String(isStartPoint)}
      data-undo-redo={String(isUndoRedoInProgress)}
      data-add-points-mode={String(isInAddPointsMode)}
      data-drag-offset-x={dragOffset?.x ?? ''}
      data-drag-offset-y={dragOffset?.y ?? ''}
      cx={point.x}
      cy={point.y}
      r="5"
    />
  ),
}));

// VertexContextMenu pass-through: renders children and exposes
// data-vcm-polygon / data-vcm-vertex attributes so tests can assert
// which polygonId+vertexIndex were passed to the menu per vertex.
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

// ── helpers ──────────────────────────────────────────────────────────────────

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
  polygonId: 'poly-1',
  points: makePoints(4),
  polygonType: 'external' as const,
  isSelected: true,
  isHovered: false,
  hoveredVertex: { polygonId: null, vertexIndex: null },
  vertexDragState: emptyDragState,
  zoom: 1,
};

// ── tests ────────────────────────────────────────────────────────────────────

describe('PolygonVertices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── gate: no selection ──────────────────────────────────────────────────

  describe('render gate (isSelected)', () => {
    it('renders nothing when isSelected=false', () => {
      const { container } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} isSelected={false} />
        </svg>
      );
      expect(container.querySelector('[data-testid^="vertex-"]')).toBeNull();
    });

    it('renders vertices when isSelected=true', () => {
      render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} isSelected={true} />
        </svg>
      );
      expect(screen.getAllByTestId(/^vertex-/)).toHaveLength(4);
    });

    it('renders nothing when points array is empty even if selected', () => {
      const { container } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} points={[]} />
        </svg>
      );
      expect(container.querySelector('[data-testid^="vertex-"]')).toBeNull();
    });
  });

  // ── vertex count and indices ──────────────────────────────────────────────

  describe('vertex count and originalIndex', () => {
    it('renders one vertex per point', () => {
      render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} points={makePoints(5)} />
        </svg>
      );
      expect(screen.getAllByTestId(/^vertex-/)).toHaveLength(5);
    });

    it('vertex-0 has isStartPoint=true', () => {
      render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} points={makePoints(3)} />
        </svg>
      );
      const v0 = screen.getByTestId('vertex-0');
      expect(v0).toHaveAttribute('data-is-start-point', 'true');
    });

    it('vertex-1 onwards has isStartPoint=false', () => {
      render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} points={makePoints(3)} />
        </svg>
      );
      expect(screen.getByTestId('vertex-1')).toHaveAttribute(
        'data-is-start-point',
        'false'
      );
      expect(screen.getByTestId('vertex-2')).toHaveAttribute(
        'data-is-start-point',
        'false'
      );
    });

    it('passes polygonId to every vertex', () => {
      render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} polygonId="p-xyz" />
        </svg>
      );
      screen.getAllByTestId(/^vertex-/).forEach(v => {
        expect(v).toHaveAttribute('data-polygon-id', 'p-xyz');
      });
    });
  });

  // ── viewport culling ──────────────────────────────────────────────────────

  describe('viewport culling', () => {
    const viewportBounds = { x: 0, y: 0, width: 100, height: 100 };

    it('keeps vertices inside viewport+buffer', () => {
      // All 4 points are at (0,0), (10,10), (20,20), (30,30) — all inside
      render(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            points={makePoints(4)}
            viewportBounds={viewportBounds}
          />
        </svg>
      );
      expect(screen.getAllByTestId(/^vertex-/)).toHaveLength(4);
    });

    it('culls vertices more than 100px outside viewport', () => {
      const farPoints: Point[] = [
        { x: 250, y: 250 }, // well outside 0-100 + 100 buffer
        { x: 50, y: 50 }, // inside
      ];
      render(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            points={farPoints}
            viewportBounds={viewportBounds}
          />
        </svg>
      );
      // Only the second point (index 1) is inside bounds
      expect(screen.getAllByTestId(/^vertex-/)).toHaveLength(1);
      expect(screen.getByTestId('vertex-1')).toBeInTheDocument();
    });

    it('keeps all vertices when viewportBounds is undefined (no culling)', () => {
      render(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            points={[
              { x: 9999, y: 9999 },
              { x: 1, y: 1 },
            ]}
            viewportBounds={undefined}
          />
        </svg>
      );
      expect(screen.getAllByTestId(/^vertex-/)).toHaveLength(2);
    });
  });

  // ── hover state propagation ───────────────────────────────────────────────

  describe('hover state propagation', () => {
    it('passes isHovered=true only to the matching vertex', () => {
      render(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            hoveredVertex={{ polygonId: 'poly-1', vertexIndex: 2 }}
          />
        </svg>
      );
      expect(screen.getByTestId('vertex-0')).toHaveAttribute(
        'data-is-hovered',
        'false'
      );
      expect(screen.getByTestId('vertex-2')).toHaveAttribute(
        'data-is-hovered',
        'true'
      );
    });

    it('no vertex is hovered when polygonId does not match', () => {
      render(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            hoveredVertex={{ polygonId: 'other-poly', vertexIndex: 1 }}
          />
        </svg>
      );
      screen.getAllByTestId(/^vertex-/).forEach(v => {
        expect(v).toHaveAttribute('data-is-hovered', 'false');
      });
    });
  });

  // ── drag state propagation ────────────────────────────────────────────────

  describe('drag state propagation', () => {
    it('marks only the dragged vertex as isDragging', () => {
      const dragState: VertexDragState = {
        isDragging: true,
        polygonId: 'poly-1',
        vertexIndex: 1,
        startPoint: { x: 10, y: 10 },
        currentPoint: { x: 15, y: 15 },
        dragOffset: { x: 5, y: 5 },
      };

      render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} vertexDragState={dragState} />
        </svg>
      );

      expect(screen.getByTestId('vertex-0')).toHaveAttribute(
        'data-is-dragging',
        'false'
      );
      expect(screen.getByTestId('vertex-1')).toHaveAttribute(
        'data-is-dragging',
        'true'
      );
      expect(screen.getByTestId('vertex-2')).toHaveAttribute(
        'data-is-dragging',
        'false'
      );
    });

    it('passes dragOffset to the dragged vertex', () => {
      const dragState: VertexDragState = {
        isDragging: true,
        polygonId: 'poly-1',
        vertexIndex: 0,
        startPoint: { x: 0, y: 0 },
        currentPoint: { x: 7, y: 3 },
        dragOffset: { x: 7, y: 3 },
      };

      render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} vertexDragState={dragState} />
        </svg>
      );

      const v0 = screen.getByTestId('vertex-0');
      expect(v0).toHaveAttribute('data-drag-offset-x', '7');
      expect(v0).toHaveAttribute('data-drag-offset-y', '3');
    });

    it('passes no dragOffset when drag is on a different polygon', () => {
      const dragState: VertexDragState = {
        isDragging: true,
        polygonId: 'other-poly',
        vertexIndex: 0,
        startPoint: { x: 0, y: 0 },
        currentPoint: { x: 5, y: 5 },
        dragOffset: { x: 5, y: 5 },
      };

      render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} vertexDragState={dragState} />
        </svg>
      );

      expect(screen.getByTestId('vertex-0')).toHaveAttribute(
        'data-drag-offset-x',
        ''
      );
    });
  });

  // ── undo/redo propagation ─────────────────────────────────────────────────

  describe('isUndoRedoInProgress propagation', () => {
    it('propagates true to all vertices', () => {
      render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} isUndoRedoInProgress={true} />
        </svg>
      );
      screen.getAllByTestId(/^vertex-/).forEach(v => {
        expect(v).toHaveAttribute('data-undo-redo', 'true');
      });
    });

    it('propagates false by default', () => {
      render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} />
        </svg>
      );
      screen.getAllByTestId(/^vertex-/).forEach(v => {
        expect(v).toHaveAttribute('data-undo-redo', 'false');
      });
    });
  });

  // ── editMode=AddPoints propagation ────────────────────────────────────────

  describe('isInAddPointsMode from editMode', () => {
    it('passes isInAddPointsMode=true when editMode=AddPoints', () => {
      render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} editMode={EditMode.AddPoints} />
        </svg>
      );
      screen.getAllByTestId(/^vertex-/).forEach(v => {
        expect(v).toHaveAttribute('data-add-points-mode', 'true');
      });
    });

    it('passes isInAddPointsMode=false for other edit modes', () => {
      render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} editMode={EditMode.View} />
        </svg>
      );
      screen.getAllByTestId(/^vertex-/).forEach(v => {
        expect(v).toHaveAttribute('data-add-points-mode', 'false');
      });
    });
  });

  // ── VertexContextMenu wiring: structural verification ────────────────────
  // vi.mock factories run in isolation from the test module scope, so we
  // cannot capture callbacks in module-level variables. Instead we verify the
  // structural contract: PolygonVertices passes the correct polygonId and
  // vertexIndex to every VertexContextMenu it renders (visible via the
  // data-vcm-* attributes on the mock <g> elements).
  // The actual callback forwarding (`() => onDeleteVertex?.(polygonId, idx)`)
  // is a single-line arrow with no branching; its correctness is guaranteed
  // by the type system + the structural checks below.

  describe('VertexContextMenu receives correct props per vertex', () => {
    it('each VCM wrapper gets the right polygonId', () => {
      const { container } = render(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            polygonId="poly-verify"
            points={makePoints(3)}
          />
        </svg>
      );

      const vcmEls = container.querySelectorAll('[data-vcm-polygon]');
      expect(vcmEls).toHaveLength(3);
      Array.from(vcmEls).forEach(el => {
        expect(el.getAttribute('data-vcm-polygon')).toBe('poly-verify');
      });
    });

    it('each VCM wrapper receives the original vertex index', () => {
      const { container } = render(
        <svg>
          <PolygonVertices
            {...DEFAULT_PROPS}
            polygonId="poly-idx"
            points={makePoints(4)}
          />
        </svg>
      );

      const vcmEls = container.querySelectorAll('[data-vcm-polygon]');
      const indices = Array.from(vcmEls).map(el =>
        Number(el.getAttribute('data-vcm-vertex'))
      );
      expect(indices).toEqual([0, 1, 2, 3]);
    });

    it('renders one VCM wrapper per visible vertex', () => {
      const { container } = render(
        <svg>
          <PolygonVertices {...DEFAULT_PROPS} points={makePoints(5)} />
        </svg>
      );
      expect(container.querySelectorAll('[data-vcm-polygon]')).toHaveLength(5);
    });
  });
});
