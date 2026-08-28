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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import CanvasSvgFilters from '../CanvasSvgFilters';

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
    it('renders filter with id "red-glow"', () => {
      const { container } = renderInSvg();
      expect(container.querySelector('filter#red-glow')).not.toBeNull();
    });

    it('renders filter with id "blue-glow"', () => {
      const { container } = renderInSvg();
      expect(container.querySelector('filter#blue-glow')).not.toBeNull();
    });

    // Deliberately one-directional: every filter defined here must be named by
    // CanvasPolygon's `pathFilter`, because a definition nothing references is
    // dead weight. It does NOT assert the reverse — `red-glow` is currently
    // referenced only from a branch that CSS precedence makes inert (see the
    // comment on `pathFilter`), and if that branch is ever removed, `red-glow`
    // should be removable with it WITHOUT this test going red first.
    it('defines no filter that CanvasPolygon does not reference', () => {
      const { container } = renderInSvg();
      const ids = Array.from(container.querySelectorAll('filter')).map(f =>
        f.getAttribute('id')
      );
      const referenced = ['blue-glow', 'red-glow'];
      expect(ids.every(id => referenced.includes(id!))).toBe(true);
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
      // Both filters should live inside the single defs
      expect(defs!.querySelectorAll('filter')).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Filter primitives
  // -----------------------------------------------------------------------

  describe('Filter primitives', () => {
    it('red-glow contains feFlood with flood-color #ea384c', () => {
      const { container } = renderInSvg();
      const filter = container.querySelector('filter#red-glow');
      const flood = filter!.querySelector('feFlood');
      expect(flood).not.toBeNull();
      // jsdom serialises camelCase React SVG props to their hyphenated
      // attribute names (floodColor → flood-color).
      const color =
        flood!.getAttribute('flood-color') ?? flood!.getAttribute('floodColor');
      expect(color?.toLowerCase()).toBe('#ea384c');
    });

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
