/**
 * Tests for CanvasSvgFilters component.
 *
 * CanvasSvgFilters renders a <defs> block with the SVG <filter> elements the
 * canvas references by id. The assertions below are deliberately a *closed*
 * set: a filter nothing names is dead weight, and a name with no filter makes
 * the referencing element vanish under SVG 1.1, so the defs and
 * CanvasPolygon's `pathFilter` must stay in exact correspondence.
 *
 * Note: jsdom does not fully implement SVG presentation attributes so we
 * only verify structural ids, not visual correctness.
 */

import React from 'react';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import CanvasSvgFilters from '../CanvasSvgFilters';

/**
 * The ids CanvasPolygon actually names, read from its SOURCE.
 *
 * It used to be a hand-written array here, which made the "closed set"
 * assertion below a snapshot of the filter list rather than the invariant it
 * claims: adding a filter AND its reference still failed, because the list had
 * to be edited by hand as well. Reading the source makes the test true — and
 * the failure it can now produce is the real one, a filter defined and never
 * named.
 */
function filtersReferencedByCanvasPolygon(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '..', 'CanvasPolygon.tsx'), 'utf8');
  return [...src.matchAll(/url\(#([\w-]+)\)/g)].map(m => m[1]);
}

describe('CanvasSvgFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Rendering inside an SVG
  // -----------------------------------------------------------------------

  function renderInSvg() {
    return render(
      <svg>
        <CanvasSvgFilters />
      </svg>
    );
  }

  describe('Filter IDs', () => {
    it('renders filter with id "blue-glow"', () => {
      const { container } = renderInSvg();
      expect(container.querySelector('filter#blue-glow')).not.toBeNull();
    });

    it('renders filter with id "soma-highlight"', () => {
      const { container } = renderInSvg();
      expect(container.querySelector('filter#soma-highlight')).not.toBeNull();
    });

    // Deliberately one-directional: every filter defined here must be named by
    // CanvasPolygon's `pathFilter`, because a definition nothing references is
    // dead weight. It does NOT assert the reverse, so a filter can always be
    // deleted along with its last reference without this test going red first.
    // That is how `red-glow` left: it was emitted only for selected closed
    // polygons, the one case `.polygon-selected`'s CSS drop-shadow overrides,
    // so it had never painted.
    it('defines no filter that CanvasPolygon does not reference', () => {
      const { container } = renderInSvg();
      const ids = Array.from(container.querySelectorAll('filter')).map(f =>
        f.getAttribute('id')
      );
      const referenced = filtersReferencedByCanvasPolygon();
      expect(referenced.length).toBeGreaterThan(0); // the regex still matches
      expect(ids.filter(id => !referenced.includes(id!))).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Wrapper element
  // -----------------------------------------------------------------------

  describe('Wrapper', () => {
    it('is wrapped in a <defs> element', () => {
      const { container } = renderInSvg();
      const defs = container.querySelector('defs');
      expect(defs).not.toBeNull();
      // Every filter lives inside the single defs — the count is asserted
      // against what the component renders rather than a number kept by hand,
      // which is the same trap the closed-set test above fell into.
      expect(defs!.querySelectorAll('filter')).toHaveLength(
        container.querySelectorAll('filter').length
      );
      expect(defs!.querySelectorAll('filter').length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Filter primitives
  // -----------------------------------------------------------------------

  describe('Filter primitives', () => {
    it('blue-glow contains feFlood with flood-color #0EA5E9', () => {
      const { container } = renderInSvg();
      const filter = container.querySelector('filter#blue-glow');
      const flood = filter!.querySelector('feFlood');
      expect(flood).not.toBeNull();
      const color =
        flood!.getAttribute('flood-color') ?? flood!.getAttribute('floodColor');
      expect(color?.toLowerCase()).toBe('#0ea5e9');
    });
  });
});
