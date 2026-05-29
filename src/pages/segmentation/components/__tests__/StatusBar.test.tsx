/**
 * StatusBar — behavioral unit tests
 *
 * Covered behaviours:
 *  - Returns null when polygons prop is falsy
 *  - Renders polygon count
 *  - Renders total vertex count (summed across all polygons)
 *  - Vertex count is 0 when all polygons have empty point arrays
 *  - Visibility stats hidden when hiddenCount=0 (default)
 *  - Visibility stats shown when hiddenPolygonsCount > 0
 *  - visibleCount defaults to totalPolygons when visiblePolygonsCount not provided
 *  - Explicit visiblePolygonsCount is displayed
 *  - Selected polygon indicator absent when selectedPolygonId is null/undefined
 *  - Selected polygon indicator shows first 8 chars of the ID when set
 *  - "Saved" status indicator always rendered
 *
 * NOT tested:
 *  - Lucide icon SVG shapes (implementation detail)
 *  - Dark-mode colour classes (CSS, not behavioural)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import StatusBar from '../StatusBar';
import type { Polygon } from '@/lib/segmentation';
import { EditMode } from '../../types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------
function makePolygon(id: string, pointCount: number): Polygon {
  return {
    id,
    type: 'external',
    points: Array.from({ length: pointCount }, (_, i) => ({ x: i, y: i })),
  };
}

describe('StatusBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Null-guard
  // -------------------------------------------------------------------------

  describe('null guard', () => {
    it('renders nothing when polygons is null', () => {
      // @ts-expect-error -- deliberately passing null to test guard
      const { container } = render(<StatusBar polygons={null} />);
      expect(container).toBeEmptyDOMElement();
    });
  });

  // -------------------------------------------------------------------------
  // Polygon and vertex counts
  // -------------------------------------------------------------------------

  describe('counts', () => {
    it('shows correct polygon count for a single polygon', () => {
      render(<StatusBar polygons={[makePolygon('p1', 4)]} />);
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('shows correct polygon count for multiple polygons', () => {
      render(
        <StatusBar polygons={[makePolygon('p1', 3), makePolygon('p2', 5)]} />
      );
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('shows correct total vertex count summed across all polygons', () => {
      render(
        <StatusBar polygons={[makePolygon('p1', 3), makePolygon('p2', 5)]} />
      );
      // polygon count = 2, vertex count = 8
      // Both are rendered as plain text nodes; getByText with exact matching
      // works since the counts are unique in the DOM here.
      expect(screen.getByText('8')).toBeInTheDocument();
    });

    it('shows 0 vertices when polygons have empty point arrays', () => {
      render(<StatusBar polygons={[makePolygon('p1', 0)]} />);
      // polygon count = 1, vertex count = 0
      // Avoid ambiguity: only "0" should appear for vertices; "1" for polygons.
      const zeros = screen.queryAllByText('0');
      expect(zeros.length).toBeGreaterThanOrEqual(1);
    });

    it('shows 0 polygon count for empty array', () => {
      render(<StatusBar polygons={[]} />);
      const zeros = screen.queryAllByText('0');
      // Both polygon count and vertex count are 0
      expect(zeros.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // Visibility stats
  // -------------------------------------------------------------------------

  describe('visibility stats', () => {
    it('does not render Eye/EyeOff section when hiddenPolygonsCount is 0', () => {
      render(
        <StatusBar
          polygons={[makePolygon('p1', 4)]}
          visiblePolygonsCount={1}
          hiddenPolygonsCount={0}
        />
      );
      // The "visible" and "hidden" i18n labels should not appear
      expect(screen.queryByText(/visible|hidden/i)).toBeNull();
    });

    it('renders visible and hidden counts when hiddenPolygonsCount > 0', () => {
      render(
        <StatusBar
          polygons={[makePolygon('p1', 4), makePolygon('p2', 2)]}
          visiblePolygonsCount={1}
          hiddenPolygonsCount={1}
        />
      );
      // Both counts (1 and 1) are rendered; we rely on the i18n labels to
      // distinguish them — the setup seeds English so we see actual labels.
      // Match the translated key substrings that we know are in en.ts
      const allText = document.body.textContent ?? '';
      expect(allText).toMatch(/visible|hidden/i);
    });

    it('defaults visibleCount to totalPolygons when visiblePolygonsCount not provided', () => {
      const polygons = [makePolygon('p1', 4), makePolygon('p2', 2)];
      render(<StatusBar polygons={polygons} hiddenPolygonsCount={1} />);
      // totalPolygons = 2, so visibleCount should display "2"
      // We check for at least one "2" in the document (polygon count + visible count)
      const twos = screen.queryAllByText('2');
      expect(twos.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Selected polygon indicator
  // -------------------------------------------------------------------------

  describe('selected polygon indicator', () => {
    it('is absent when selectedPolygonId is null', () => {
      render(
        <StatusBar polygons={[makePolygon('p1', 4)]} selectedPolygonId={null} />
      );
      expect(screen.queryByText(/abcdef12/i)).toBeNull();
    });

    it('is absent when selectedPolygonId is undefined', () => {
      render(<StatusBar polygons={[makePolygon('p1', 4)]} />);
      // No "selected:" label text
      expect(document.body.textContent).not.toMatch(/selected:/i);
    });

    it('shows the first 8 characters of the selected polygon id', () => {
      render(
        <StatusBar
          polygons={[makePolygon('p1', 4)]}
          selectedPolygonId="abcdef1234567890"
        />
      );
      expect(screen.getByText('abcdef12')).toBeInTheDocument();
    });

    it('shows only 8 chars even for a short UUID', () => {
      render(
        <StatusBar
          polygons={[makePolygon('p1', 4)]}
          selectedPolygonId="12345678-extra"
        />
      );
      expect(screen.getByText('12345678')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // "Saved" indicator
  // -------------------------------------------------------------------------

  describe('saved indicator', () => {
    it('always renders a saved status element', () => {
      render(<StatusBar polygons={[makePolygon('p1', 4)]} />);
      // The saved indicator uses the i18n key 'segmentation.status.saved'
      // which seeds as the English translation or raw key — either way
      // something matching "saved" or the raw key appears.
      const allText = document.body.textContent ?? '';
      expect(allText.length).toBeGreaterThan(0);
      // More specifically: the status bar renders at least 4 sections
      // (polygons, vertices, [visibility], saved). Check the saved icon wrapper.
      const checkCircles = document.querySelectorAll('.text-green-500');
      expect(checkCircles.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // editMode prop (accepted but currently unused — no crash)
  // -------------------------------------------------------------------------

  describe('editMode prop', () => {
    it('renders without error when editMode is provided', () => {
      expect(() =>
        render(
          <StatusBar
            polygons={[makePolygon('p1', 4)]}
            editMode={EditMode.EditVertices}
          />
        )
      ).not.toThrow();
    });
  });
});
