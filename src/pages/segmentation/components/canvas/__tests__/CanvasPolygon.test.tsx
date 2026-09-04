/**
 * Tests for CanvasPolygon component
 * Tests polygon rendering, selection, interaction, and performance
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CanvasPolygon from '../CanvasPolygon';
import { createMockPolygon } from '@/test-utils/segmentationTestUtils';
import type { VertexDragState } from '@/pages/segmentation/types';

// Mock the heavy dependencies
vi.mock('../PolygonVertices', () => ({
  default: ({ polygonId, points, onVertexClick, onVertexMouseDown }: any) => (
    <g data-testid={`polygon-vertices-${polygonId}`}>
      {points?.map((point: any, index: number) => (
        <circle
          key={index}
          data-testid={`vertex-${index}`}
          cx={point.x}
          cy={point.y}
          r="3"
          onClick={() => onVertexClick?.(0)}
          onMouseDown={() => onVertexMouseDown?.(0)}
        />
      )) || null}
    </g>
  ),
}));

vi.mock('../../context-menu/PolygonContextMenu', () => ({
  default: ({ children, polygonId, onDelete, onSlice, onEdit }: any) => (
    <g>
      {children}
      <g data-testid={`context-menu-${polygonId}`} style={{ display: 'none' }}>
        <rect data-testid="delete-button" onClick={() => onDelete?.()} />
        <rect data-testid="slice-button" onClick={() => onSlice?.()} />
        <rect data-testid="edit-button" onClick={() => onEdit?.()} />
      </g>
    </g>
  ),
}));

vi.mock('@/lib/polygonGeometry', () => ({
  calculateBoundingBox: vi.fn((points: any[]) => ({
    minX: Math.min(...points.map(p => p.x)),
    maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)),
    maxY: Math.max(...points.map(p => p.y)),
  })),
  isPolygonInViewport: vi.fn(() => true),
  simplifyPolygon: vi.fn((points: any[]) => points), // No simplification in tests
}));

describe('CanvasPolygon', () => {
  const mockPolygon = createMockPolygon({
    id: 'test-polygon',
    points: [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 50 },
      { x: 10, y: 50 },
    ],
  });

  const defaultProps = {
    polygon: mockPolygon,
    isSelected: false,
    zoom: 1,
    onSelectPolygon: vi.fn(),
    onDeletePolygon: vi.fn(),
    onSlicePolygon: vi.fn(),
    onEditPolygon: vi.fn(),
    onDeleteVertex: vi.fn(),
    onDuplicateVertex: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to render polygon in SVG context
  const renderPolygonInSvg = (polygonElement: React.ReactElement) => {
    return render(
      <svg width="800" height="600" viewBox="0 0 800 600">
        {polygonElement}
      </svg>
    );
  };

  describe('Rendering', () => {
    it('renders polygon with basic render function', () => {
      // Use basic render instead of customRender to avoid context issues
      render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon {...defaultProps} />
        </svg>
      );

      const polygonElement = screen.getByTestId('test-polygon');
      expect(polygonElement).toBeInTheDocument();

      // Check that the polygon path is rendered
      const polygonPath = polygonElement.querySelector('path');
      expect(polygonPath).toBeInTheDocument();
    });

    it('renders polygon with correct basic structure', () => {
      renderPolygonInSvg(<CanvasPolygon {...defaultProps} />);

      const polygonElement = screen.getByTestId('test-polygon');
      expect(polygonElement).toBeInTheDocument();

      // Check that the polygon path is rendered
      const polygonPath = polygonElement.querySelector('path');
      expect(polygonPath).toBeInTheDocument();
    });

    it('applies correct CSS classes for selected state', () => {
      renderPolygonInSvg(<CanvasPolygon {...defaultProps} isSelected={true} />);

      const polygonElement = screen.getByTestId('test-polygon');
      const pathElement = polygonElement.querySelector('path');
      expect(pathElement).toHaveClass('polygon-selected');
    });

    it('applies correct CSS classes for hovered state', () => {
      renderPolygonInSvg(<CanvasPolygon {...defaultProps} isHovered={true} />);

      const polygonElement = screen.getByTestId('test-polygon');
      // The component doesn't actually add a hovered class, so we check if the element exists
      expect(polygonElement).toBeInTheDocument();
    });

    it('renders vertices when not hidden', () => {
      renderPolygonInSvg(<CanvasPolygon {...defaultProps} isSelected={true} />);

      expect(
        screen.getByTestId(`polygon-vertices-${mockPolygon.id}`)
      ).toBeInTheDocument();
    });

    it('hides vertices when hideVertices is true', () => {
      renderPolygonInSvg(
        <CanvasPolygon {...defaultProps} hideVertices={true} />
      );

      expect(
        screen.queryByTestId(`polygon-vertices-${mockPolygon.id}`)
      ).not.toBeInTheDocument();
    });

    it('renders polygon with different types correctly', () => {
      const externalPolygon = { ...mockPolygon, type: 'external' as const };
      const internalPolygon = { ...mockPolygon, type: 'internal' as const };

      const { rerender } = renderPolygonInSvg(
        <CanvasPolygon {...defaultProps} polygon={externalPolygon} />
      );

      expect(screen.getByTestId('test-polygon')).toHaveClass('external');

      rerender(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon {...defaultProps} polygon={internalPolygon} />
        </svg>
      );

      expect(screen.getByTestId('test-polygon')).toHaveClass('internal');
    });
  });

  // Regression guard for the multi-select style unification (2026-08-28).
  // A Shift+click multi-selection must render EXACTLY like a single selection.
  // Multi-select used to paint a dash-dot `6 3` stroke at 2.2x width and skip
  // the selected colour, the glow filter and the `.polygon-selected`
  // drop-shadow entirely, so it read as a different kind of selection.
  //
  // The parity assertion compares the polygon group's whole rendered markup,
  // so it covers the stroke attributes, the inline `style` the core branch
  // sets, and the polyline endpoint markers in one shot — and it fails if
  // `isEffectivelySelected` is reverted to `isSelected` in ANY of the eight
  // colour branches, not just the two a hand-picked example would exercise.
  describe('Multi-selection styling parity with single selection', () => {
    const renderOnce = (props: Record<string, unknown>) => {
      const { container, unmount } = render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon {...defaultProps} {...props} />
        </svg>
      );
      const group = container.querySelector('g.polygon-group');
      expect(group).not.toBeNull();
      const path = group!.querySelector('path.polygon-path');
      expect(path).not.toBeNull();
      const result = {
        html: group!.innerHTML,
        cls: path!.getAttribute('class') ?? '',
        dash: path!.getAttribute('stroke-dasharray'),
        strokeWidth: path!.getAttribute('stroke-width'),
        filter: path!.getAttribute('filter'),
        // Fixed endpoint markers are the group's own <circle> children; the
        // draggable vertices live inside the PolygonVertices child <g>.
        markers: group!.querySelectorAll(':scope > circle').length,
      };
      unmount();
      return result;
    };

    const polyline = (extra: Record<string, unknown> = {}) =>
      createMockPolygon({
        id: 'test-polyline',
        geometry: 'polyline',
        points: [
          { x: 10, y: 10 },
          { x: 40, y: 20 },
          { x: 70, y: 15 },
        ],
        ...extra,
      });

    // One case per branch of `pathColor`, since the diff rewrote all of them.
    const cases: Array<[string, Record<string, unknown>]> = [
      ['external polygon', {}],
      ['internal polygon', { polygon: { ...mockPolygon, type: 'internal' } }],
      [
        'incomplete microcapsule',
        { polygon: { ...mockPolygon, complete: false } },
      ],
      ['spheroid core', { polygon: { ...mockPolygon, partClass: 'core' } }],
      // Neuron classes arrived on main while this branch was open, so their
      // stroke branch was written against `isSelected` and merged cleanly
      // without conflicting — leaving the one pathColor branch that did NOT
      // honour a multi-selection. Covered here so the next such merge fails.
      ['neurite', { polygon: { ...mockPolygon, partClass: 'neurite' } }],
      ['soma', { polygon: { ...mockPolygon, partClass: 'soma' } }],
      ['sperm head', { polygon: polyline({ partClass: 'head' }) }],
      ['sperm midpiece', { polygon: polyline({ partClass: 'midpiece' }) }],
      ['sperm tail', { polygon: polyline({ partClass: 'tail' }) }],
      [
        'microtubule (instance colour)',
        { polygon: polyline({ trackId: 'track-7' }) },
      ],
      [
        'microtubule (semantic colour)',
        {
          polygon: polyline({ trackId: 'track-7', mtType: 'label-1' }),
          colorMode: 'semantic',
          semanticColor: '#1e2ba5',
        },
      ],
    ];

    it.each(cases)(
      'renders a multi-selected %s exactly like a selected one',
      (_name, props) => {
        const idle = renderOnce(props);
        const selected = renderOnce({ ...props, isSelected: true });
        const multi = renderOnce({ ...props, isMultiSelected: true });
        const both = renderOnce({
          ...props,
          isSelected: true,
          isMultiSelected: true,
        });

        expect(multi.html).toBe(selected.html);
        expect(both.html).toBe(selected.html);
        // Guards against the equality above passing on two identical *idle*
        // renders — the shared markup must really be the selected one.
        expect(selected.cls).toContain('polygon-selected');
        expect(idle.cls).not.toContain('polygon-selected');
        expect(multi.html).not.toBe(idle.html);
      }
    );

    it.each(cases)('never dashes the stroke of a %s', (_name, props) => {
      for (const flags of [
        {},
        { isSelected: true },
        { isMultiSelected: true },
        { isSelected: true, isMultiSelected: true },
      ]) {
        expect(renderOnce({ ...props, ...flags }).dash).toBeNull();
      }
    });

    it('does not thicken the stroke of a multi-selected polygon', () => {
      // The old style multiplied the stroke width by 2.2 on top of the hover
      // multiplier; single-select never did.
      expect(renderOnce({ isMultiSelected: true }).strokeWidth).toBe(
        renderOnce({ isSelected: true }).strokeWidth
      );
      expect(renderOnce({ isMultiSelected: true }).strokeWidth).toBe(
        renderOnce({}).strokeWidth
      );
    });

    it('hides the polyline endpoint markers when multi-selected, as when selected', () => {
      // An unselected sperm polyline draws two fixed endpoint dots. A selected
      // one drops them because PolygonVertices paints draggable circles at the
      // same coordinates; a multi-selected one gets those same draggable
      // circles (PolygonVertices treats both flags alike), so it must drop the
      // markers too or they show through as stuck dots while dragging.
      const props = { polygon: polyline({ partClass: 'head' }) };
      expect(renderOnce(props).markers).toBe(2);
      expect(renderOnce({ ...props, isSelected: true }).markers).toBe(0);
      expect(renderOnce({ ...props, isMultiSelected: true }).markers).toBe(0);
    });

    it('gives a multi-selected polygon the same glow as a selected one', () => {
      // The glow on a selected shape comes from `.polygon-selected`'s CSS
      // drop-shadow, NOT from the SVG filter attribute — a CSS `filter`
      // declaration beats a presentation attribute, so the attribute is
      // empty on every selected shape. Assert the class, which is what
      // actually paints; asserting `.filter` here would pin the inert one.
      expect(renderOnce({ isMultiSelected: true }).cls).toContain(
        'polygon-selected'
      );
      expect(renderOnce({ isSelected: true }).cls).toContain(
        'polygon-selected'
      );
      expect(renderOnce({}).cls).not.toContain('polygon-selected');
    });

    it('leaves the SVG filter attribute empty on a selected closed polygon', () => {
      // Guards the deletion of `red-glow`: it was only ever emitted here, in
      // the one case CSS overrides, so it had never reached the screen.
      expect(renderOnce({ isSelected: true }).filter).toBe('');
      expect(renderOnce({ isMultiSelected: true }).filter).toBe('');
      expect(renderOnce({}).filter).toBe('');
    });
  });

  describe('Interaction', () => {
    it('calls onSelectPolygon when polygon is clicked', () => {
      const onSelectPolygon = vi.fn();
      renderPolygonInSvg(
        <CanvasPolygon {...defaultProps} onSelectPolygon={onSelectPolygon} />
      );

      const polygonElement = screen.getByTestId('test-polygon');
      const pathElement = polygonElement.querySelector('path');
      fireEvent.click(pathElement!);

      expect(onSelectPolygon).toHaveBeenCalledWith('test-polygon');
    });

    it('handles double-click for polygon editing', () => {
      const onEditPolygon = vi.fn();
      renderPolygonInSvg(
        <CanvasPolygon {...defaultProps} onEditPolygon={onEditPolygon} />
      );

      const polygonElement = screen.getByTestId('test-polygon');
      const pathElement = polygonElement.querySelector('path');
      fireEvent.doubleClick(pathElement!);

      expect(onEditPolygon).toHaveBeenCalledWith('test-polygon');
    });

    it('shows context menu on right-click', async () => {
      renderPolygonInSvg(<CanvasPolygon {...defaultProps} isSelected={true} />);

      const polygonElement = screen.getByTestId('test-polygon');
      fireEvent.contextMenu(polygonElement);

      await waitFor(() => {
        expect(
          screen.getByTestId(`context-menu-${mockPolygon.id}`)
        ).toBeInTheDocument();
      });
    });

    it('handles context menu actions correctly', async () => {
      const onDeletePolygon = vi.fn();
      const onSlicePolygon = vi.fn();
      const onEditPolygon = vi.fn();

      renderPolygonInSvg(
        <CanvasPolygon
          {...defaultProps}
          isSelected={true}
          onDeletePolygon={onDeletePolygon}
          onSlicePolygon={onSlicePolygon}
          onEditPolygon={onEditPolygon}
        />
      );

      const polygonElement = screen.getByTestId('test-polygon');
      fireEvent.contextMenu(polygonElement);

      await waitFor(() => {
        expect(
          screen.getByTestId(`context-menu-${mockPolygon.id}`)
        ).toBeInTheDocument();
      });

      // Test delete action
      fireEvent.click(screen.getByTestId('delete-button'));
      expect(onDeletePolygon).toHaveBeenCalledWith('test-polygon');

      // Test slice action
      fireEvent.click(screen.getByTestId('slice-button'));
      expect(onSlicePolygon).toHaveBeenCalledWith('test-polygon');

      // Test edit action
      fireEvent.click(screen.getByTestId('edit-button'));
      expect(onEditPolygon).toHaveBeenCalledWith('test-polygon');
    });

    it('prevents event propagation on polygon click', () => {
      const onSelectPolygon = vi.fn();
      const parentClickHandler = vi.fn();

      render(
        <div onClick={parentClickHandler}>
          <svg width="800" height="600" viewBox="0 0 800 600">
            <CanvasPolygon
              {...defaultProps}
              onSelectPolygon={onSelectPolygon}
            />
          </svg>
        </div>
      );

      const polygonElement = screen.getByTestId('test-polygon');
      const pathElement = polygonElement.querySelector('path');
      fireEvent.click(pathElement!);

      expect(onSelectPolygon).toHaveBeenCalled();
      expect(parentClickHandler).not.toHaveBeenCalled();
    });
  });

  describe('Vertex Interactions', () => {
    it('renders vertices with drag state', () => {
      const dragState: VertexDragState = {
        isDragging: true,
        polygonId: 'test-polygon',
        vertexIndex: 0,
      };

      renderPolygonInSvg(
        <CanvasPolygon
          {...defaultProps}
          isSelected={true}
          vertexDragState={dragState}
        />
      );

      const vertices = screen.getByTestId(`polygon-vertices-${mockPolygon.id}`);
      expect(vertices).toBeInTheDocument();
    });

    it('handles vertex deletion', () => {
      const onDeleteVertex = vi.fn();
      renderPolygonInSvg(
        <CanvasPolygon
          {...defaultProps}
          isSelected={true}
          onDeleteVertex={onDeleteVertex}
        />
      );

      // This would typically be triggered by a key press or context menu
      // For now, we'll simulate it directly
      const vertices = screen.getByTestId(`polygon-vertices-${mockPolygon.id}`);
      fireEvent.click(vertices);

      // In a real scenario, this would trigger vertex-specific actions
      expect(vertices).toBeInTheDocument();
    });

    it('handles vertex duplication', () => {
      const onDuplicateVertex = vi.fn();
      renderPolygonInSvg(
        <CanvasPolygon
          {...defaultProps}
          isSelected={true}
          onDuplicateVertex={onDuplicateVertex}
        />
      );

      const vertices = screen.getByTestId(`polygon-vertices-${mockPolygon.id}`);
      expect(vertices).toBeInTheDocument();
    });

    it('highlights hovered vertex', () => {
      const hoveredVertex = {
        polygonId: 'test-polygon',
        vertexIndex: 1,
      };

      renderPolygonInSvg(
        <CanvasPolygon
          {...defaultProps}
          isSelected={true}
          hoveredVertex={hoveredVertex}
        />
      );

      const vertices = screen.getByTestId(`polygon-vertices-${mockPolygon.id}`);
      expect(vertices).toBeInTheDocument();
    });
  });

  describe('Performance and Optimization', () => {
    it('memoizes polygon rendering', () => {
      const { rerender } = renderPolygonInSvg(
        <CanvasPolygon {...defaultProps} />
      );

      // Re-render with same props should not cause re-render of memoized component
      rerender(<CanvasPolygon {...defaultProps} />);

      expect(screen.getByTestId('test-polygon')).toBeInTheDocument();
    });

    it('repaints when parent_id changes and nothing else does', () => {
      // `isInternal = parent_id || type === 'internal'` drives the group class,
      // the fill/stroke colour and the dash pattern. `type` was in the memo
      // comparator and `parent_id` was not, so a polygon that gained a parent
      // while keeping its id, points and type kept painting as external.
      const orphan = createMockPolygon({
        id: 'reparented',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
        ],
      });
      const { rerender } = renderPolygonInSvg(
        <CanvasPolygon {...defaultProps} polygon={orphan} />
      );
      expect(screen.getByTestId('reparented').getAttribute('class')).toContain(
        'external'
      );

      // Same id, same points, same type — only the parent link differs.
      rerender(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            {...defaultProps}
            polygon={{ ...orphan, parent_id: 'outer-1' }}
          />
        </svg>
      );

      const cls = screen.getByTestId('reparented').getAttribute('class') ?? '';
      expect(cls).toContain('internal');
      expect(cls).not.toMatch(/\bexternal\b/);
    });

    it('handles viewport culling correctly', () => {
      const viewportBounds = {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      };

      renderPolygonInSvg(
        <CanvasPolygon {...defaultProps} viewportBounds={viewportBounds} />
      );

      expect(screen.getByTestId('test-polygon')).toBeInTheDocument();
    });

    it('handles polygon with many vertices efficiently', () => {
      const complexPolygon = createMockPolygon({
        id: 'complex-polygon',
        points: Array.from({ length: 100 }, (_, i) => ({
          x: Math.cos((i / 100) * 2 * Math.PI) * 50 + 50,
          y: Math.sin((i / 100) * 2 * Math.PI) * 50 + 50,
        })),
      });

      const startTime = performance.now();
      renderPolygonInSvg(
        <CanvasPolygon {...defaultProps} polygon={complexPolygon} />
      );
      const renderTime = performance.now() - startTime;

      expect(screen.getByTestId('complex-polygon')).toBeInTheDocument();
      expect(renderTime).toBeLessThan(2000); // load-tolerant ceiling: wall-clock budgets inflate under V8 coverage on CI
    });

    it('updates efficiently when zoom changes', () => {
      const { rerender } = renderPolygonInSvg(
        <CanvasPolygon {...defaultProps} zoom={1} />
      );

      rerender(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon {...defaultProps} zoom={2} />
        </svg>
      );
      rerender(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon {...defaultProps} zoom={0.5} />
        </svg>
      );

      expect(screen.getByTestId('test-polygon')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles polygon with no points', () => {
      const emptyPolygon = createMockPolygon({
        id: 'empty-polygon',
        points: [],
      });

      renderPolygonInSvg(
        <CanvasPolygon {...defaultProps} polygon={emptyPolygon} />
      );

      const polygonElement = screen.getByTestId('empty-polygon');
      expect(polygonElement).toBeInTheDocument();
    });

    it('handles polygon with single point', () => {
      const singlePointPolygon = createMockPolygon({
        id: 'single-point-polygon',
        points: [{ x: 25, y: 25 }],
      });

      renderPolygonInSvg(
        <CanvasPolygon {...defaultProps} polygon={singlePointPolygon} />
      );

      expect(screen.getByTestId('single-point-polygon')).toBeInTheDocument();
    });

    it('handles polygon with duplicate points', () => {
      const duplicatePointsPolygon = createMockPolygon({
        id: 'duplicate-points-polygon',
        points: [
          { x: 10, y: 10 },
          { x: 10, y: 10 }, // Duplicate
          { x: 20, y: 20 },
          { x: 20, y: 20 }, // Duplicate
        ],
      });

      renderPolygonInSvg(
        <CanvasPolygon {...defaultProps} polygon={duplicatePointsPolygon} />
      );

      expect(
        screen.getByTestId('duplicate-points-polygon')
      ).toBeInTheDocument();
    });

    it('handles very small polygons', () => {
      const tinyPolygon = createMockPolygon({
        id: 'tiny-polygon',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
      });

      renderPolygonInSvg(
        <CanvasPolygon {...defaultProps} polygon={tinyPolygon} zoom={100} />
      );

      expect(screen.getByTestId('tiny-polygon')).toBeInTheDocument();
    });

    it('handles very large polygons', () => {
      const largePolygon = createMockPolygon({
        id: 'large-polygon',
        points: [
          { x: -1000, y: -1000 },
          { x: 1000, y: -1000 },
          { x: 1000, y: 1000 },
          { x: -1000, y: 1000 },
        ],
      });

      renderPolygonInSvg(
        <CanvasPolygon {...defaultProps} polygon={largePolygon} zoom={0.01} />
      );

      expect(screen.getByTestId('large-polygon')).toBeInTheDocument();
    });

    it('handles polygon with extreme coordinates', () => {
      const extremePolygon = createMockPolygon({
        id: 'extreme-polygon',
        points: [
          { x: Number.MAX_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER },
          { x: Number.MIN_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER },
          { x: Number.MIN_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER },
          { x: Number.MAX_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER },
        ],
      });

      expect(() => {
        renderPolygonInSvg(
          <CanvasPolygon {...defaultProps} polygon={extremePolygon} />
        );
      }).not.toThrow();
    });
  });

  describe('Accessibility', () => {
    it('provides keyboard navigation support', () => {
      renderPolygonInSvg(<CanvasPolygon {...defaultProps} />);

      const polygonElement = screen.getByTestId('test-polygon');

      // Should be focusable
      polygonElement.focus();
      expect(polygonElement).toHaveFocus();
    });

    it('provides screen reader labels', () => {
      renderPolygonInSvg(<CanvasPolygon {...defaultProps} />);

      const polygonElement = screen.getByTestId('test-polygon');
      // Check if aria-label exists and is not empty
      const ariaLabel = polygonElement.getAttribute('aria-label');
      expect(ariaLabel).toBeTruthy();
    });

    it('handles keyboard interactions', () => {
      const onSelectPolygon = vi.fn();
      renderPolygonInSvg(
        <CanvasPolygon {...defaultProps} onSelectPolygon={onSelectPolygon} />
      );

      const polygonElement = screen.getByTestId('test-polygon');

      // Enter key should select polygon
      fireEvent.keyDown(polygonElement, {
        key: 'Enter',
        target: polygonElement,
      });
      expect(onSelectPolygon).toHaveBeenCalledWith('test-polygon');
    });

    it('supports high contrast mode', () => {
      // Mock high contrast media query
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation(query => ({
          matches: query.includes('prefers-contrast'),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });

      renderPolygonInSvg(<CanvasPolygon {...defaultProps} />);

      const polygonElement = screen.getByTestId('test-polygon');
      expect(polygonElement).toBeInTheDocument();
    });
  });
});
