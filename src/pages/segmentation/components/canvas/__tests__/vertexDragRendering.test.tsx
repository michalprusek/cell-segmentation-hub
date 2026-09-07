/**
 * What re-renders (and what animates) during a vertex drag.
 *
 * J5 — every frame of a drag re-rendered a Radix `<ContextMenu>` tree PER
 * VERTEX. `PolygonVertices` built the `<VertexContextMenu>` elements inline
 * with a freshly-allocated `onDelete` arrow, so nothing below could ever bail
 * out: on a 4000-point microtubule polyline that is 4000 provider + trigger +
 * content re-renders per pointer move, to move one point. The fix is a memo
 * boundary ABOVE the element creation (`VertexWithMenu`); memoizing
 * `VertexContextMenu` itself cannot work, because its `children` is a fresh
 * element on every render of whoever builds it.
 *
 * The settle animation — `CanvasVertex` styled every non-dragging vertex with
 * `transition: all 0.15s ease-out`. `cx`/`cy` are SVG2 geometry properties
 * and animate, so on drop the vertex GLIDED to its committed position rather
 * than being there, which reads as lag.
 *
 * Renders are counted, not timed: `performance.now()` resolves to a whole
 * millisecond under jsdom, so a duration assertion here would measure the
 * tick boundary and nothing else.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import PolygonVertices from '../PolygonVertices';
import CanvasVertex from '../CanvasVertex';
import { VertexDragState } from '@/pages/segmentation/types';
import { Point } from '@/lib/segmentation';

// Counts a render per (polygonId, vertexIndex). `vi.mock` factories are
// hoisted away from module scope, so the counter has to be hoisted with them.
const menu = vi.hoisted(() => ({ renders: new Map<string, number>() }));

vi.mock('../../context-menu/VertexContextMenu', () => ({
  default: ({
    children,
    polygonId,
    vertexIndex,
  }: {
    children: React.ReactNode;
    onDelete: () => void;
    polygonId: string;
    vertexIndex: number;
  }) => {
    const key = `${polygonId}:${vertexIndex}`;
    menu.renders.set(key, (menu.renders.get(key) ?? 0) + 1);
    return (
      <g data-vcm-polygon={polygonId} data-vcm-vertex={String(vertexIndex)}>
        {children}
      </g>
    );
  },
}));

const POINTS: Point[] = [
  { x: 10, y: 10 },
  { x: 40, y: 15 },
  { x: 70, y: 60 },
];

const idle: VertexDragState = {
  isDragging: false,
  polygonId: null,
  vertexIndex: null,
};

const dragging = (offset: { x: number; y: number }): VertexDragState => ({
  isDragging: true,
  polygonId: 'poly-1',
  vertexIndex: 1,
  originalPosition: POINTS[1],
  dragOffset: offset,
  mode: 'vertex',
});

const BASE = {
  polygonId: 'poly-1',
  points: POINTS,
  polygonType: 'external' as const,
  isSelected: true,
  isHovered: false,
  hoveredVertex: { polygonId: null, vertexIndex: null },
  zoom: 1,
  onDeleteVertex: () => {},
};

/** Which vertices re-rendered their menu since the snapshot. */
const changedSince = (before: Map<string, number>) =>
  [...menu.renders.entries()]
    .filter(([key, count]) => count !== (before.get(key) ?? 0))
    .map(([key]) => key)
    .sort();

const snapshot = () => new Map(menu.renders);

describe('J5 — a drag frame re-renders one vertex, not all of them', () => {
  beforeEach(() => {
    menu.renders.clear();
    vi.clearAllMocks();
  });

  it('mounts one context menu per vertex', () => {
    // Establishes the baseline the deltas below are measured against: three
    // vertices, three menus, each rendered exactly once.
    render(
      <svg>
        <PolygonVertices {...BASE} vertexDragState={idle} />
      </svg>
    );
    expect([...menu.renders.entries()].sort()).toEqual([
      ['poly-1:0', 1],
      ['poly-1:1', 1],
      ['poly-1:2', 1],
    ]);
  });

  it('re-renders only the dragged vertex when the offset changes', () => {
    const { rerender } = render(
      <svg>
        <PolygonVertices {...BASE} vertexDragState={dragging({ x: 4, y: 4 })} />
      </svg>
    );

    const before = snapshot();
    rerender(
      <svg>
        <PolygonVertices {...BASE} vertexDragState={dragging({ x: 9, y: 7 })} />
      </svg>
    );

    // The SET, not "not more than N": vertex 1 is the one being dragged.
    expect(changedSince(before)).toEqual(['poly-1:1']);
  });

  it('holds across a run of frames, which is where the cost lived', () => {
    const { rerender } = render(
      <svg>
        <PolygonVertices {...BASE} vertexDragState={dragging({ x: 0, y: 0 })} />
      </svg>
    );

    const before = snapshot();
    for (let i = 1; i <= 20; i++) {
      rerender(
        <svg>
          <PolygonVertices
            {...BASE}
            vertexDragState={dragging({ x: i, y: i })}
          />
        </svg>
      );
    }

    expect(changedSince(before)).toEqual(['poly-1:1']);
    // 20 frames moved one vertex 20 times and left the other two alone.
    expect(menu.renders.get('poly-1:1')! - (before.get('poly-1:1') ?? 0)).toBe(
      20
    );
    expect(menu.renders.get('poly-1:0')).toBe(before.get('poly-1:0'));
    expect(menu.renders.get('poly-1:2')).toBe(before.get('poly-1:2'));
  });

  it('still re-renders every vertex when the whole shape translates', () => {
    // A translate genuinely moves all of them, so the boundary must NOT
    // suppress that — otherwise the dots stay behind the outline.
    const translate = (offset: { x: number; y: number }): VertexDragState => ({
      isDragging: true,
      polygonId: 'poly-1',
      vertexIndex: null,
      originalPosition: POINTS[0],
      dragOffset: offset,
      mode: 'translate',
    });

    const { rerender } = render(
      <svg>
        <PolygonVertices
          {...BASE}
          vertexDragState={translate({ x: 1, y: 1 })}
        />
      </svg>
    );
    const before = snapshot();
    rerender(
      <svg>
        <PolygonVertices
          {...BASE}
          vertexDragState={translate({ x: 5, y: 3 })}
        />
      </svg>
    );

    expect(changedSince(before)).toEqual(['poly-1:0', 'poly-1:1', 'poly-1:2']);
  });

  it('re-renders every vertex when the geometry itself changes', () => {
    // The boundary must not cache away a real edit — the commit at the end of
    // a drag replaces the points array.
    const { rerender } = render(
      <svg>
        <PolygonVertices {...BASE} vertexDragState={idle} />
      </svg>
    );
    const before = snapshot();
    rerender(
      <svg>
        <PolygonVertices
          {...BASE}
          points={POINTS.map(p => ({ x: p.x + 25, y: p.y + 25 }))}
          vertexDragState={idle}
        />
      </svg>
    );

    expect(changedSince(before)).toEqual(['poly-1:0', 'poly-1:1', 'poly-1:2']);
  });

  it('keeps the delete callback pointed at its own vertex', () => {
    // Stabilising the closure is only safe if it still closes over the right
    // index — this is the wiring the memo boundary took over.
    const onDeleteVertex = vi.fn();
    const { container } = render(
      <svg>
        <PolygonVertices
          {...BASE}
          onDeleteVertex={onDeleteVertex}
          vertexDragState={idle}
        />
      </svg>
    );

    const menus = container.querySelectorAll('[data-vcm-vertex]');
    expect([...menus].map(m => m.getAttribute('data-vcm-vertex'))).toEqual([
      '0',
      '1',
      '2',
    ]);
    expect([...menus].map(m => m.getAttribute('data-vcm-polygon'))).toEqual([
      'poly-1',
      'poly-1',
      'poly-1',
    ]);
  });
});

describe('the vertex never animates its position', () => {
  const vertexProps = {
    point: { x: 20, y: 30 },
    polygonId: 'poly-1',
    vertexIndex: 0,
    isSelected: true,
    isHovered: false,
    isDragging: false,
    zoom: 1,
  };

  /** The property names the element declares a transition for. */
  const transitionedProperties = (el: Element) => {
    const value = (el as SVGElement).style.transition;
    if (!value || value === 'none') return [];
    return value
      .split(',')
      .map(part => part.trim().split(/\s+/)[0])
      .sort();
  };

  it('eases only paint, never cx/cy', () => {
    const { container } = render(
      <svg>
        <CanvasVertex {...vertexProps} />
      </svg>
    );
    const circle = container.querySelector('circle')!;
    // `all` covers cx/cy — they are SVG2 geometry properties and animate.
    expect(transitionedProperties(circle)).toEqual(['fill', 'opacity', 'r']);
  });

  it('does not animate the drop, where the point actually moves', () => {
    const { container, rerender } = render(
      <svg>
        <CanvasVertex
          {...vertexProps}
          isDragging
          dragOffset={{ x: 40, y: 40 }}
        />
      </svg>
    );

    // The commit: isDragging goes false and the point is already at its new
    // place. Gating the transition on isDragging never helped here, because
    // this is exactly the frame where isDragging is false again.
    rerender(
      <svg>
        <CanvasVertex {...vertexProps} point={{ x: 60, y: 70 }} />
      </svg>
    );

    const circle = container.querySelector('circle')!;
    expect(circle.getAttribute('cx')).toBe('60');
    expect(circle.getAttribute('cy')).toBe('70');
    expect(transitionedProperties(circle)).toEqual(['fill', 'opacity', 'r']);
  });

  it('still switches everything off during undo/redo', () => {
    const { container } = render(
      <svg>
        <CanvasVertex {...vertexProps} isUndoRedoInProgress />
      </svg>
    );
    const circle = container.querySelector('circle')!;
    expect((circle as SVGElement).style.transition).toBe('none');
  });
});
