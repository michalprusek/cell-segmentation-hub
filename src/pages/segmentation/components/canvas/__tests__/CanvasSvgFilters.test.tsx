/**
 * Tests for CanvasSvgFilters component.
 *
 * CanvasSvgFilters renders a <defs> block with five SVG <filter> elements.
 * Tests assert that the component is renderable inside an <svg> wrapper
 * and that each filter id is present in the DOM.
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
    it('renders filter with id "point-shadow"', () => {
      const { container } = renderInSvg();
      expect(container.querySelector('filter#point-shadow')).not.toBeNull();
    });

    it('renders filter with id "line-glow"', () => {
      const { container } = renderInSvg();
      expect(container.querySelector('filter#line-glow')).not.toBeNull();
    });

    it('renders filter with id "red-glow"', () => {
      const { container } = renderInSvg();
      expect(container.querySelector('filter#red-glow')).not.toBeNull();
    });

    it('renders filter with id "blue-glow"', () => {
      const { container } = renderInSvg();
      expect(container.querySelector('filter#blue-glow')).not.toBeNull();
    });

    it('renders filter with id "point-glow"', () => {
      const { container } = renderInSvg();
      expect(container.querySelector('filter#point-glow')).not.toBeNull();
    });

    it('renders exactly five filter elements', () => {
      const { container } = renderInSvg();
      expect(container.querySelectorAll('filter')).toHaveLength(5);
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
      // All five filters should live inside the single defs
      expect(defs!.querySelectorAll('filter')).toHaveLength(5);
    });
  });

  // -----------------------------------------------------------------------
  // feDropShadow inside point-shadow
  // -----------------------------------------------------------------------

  describe('Filter primitives', () => {
    it('point-shadow contains feDropShadow', () => {
      const { container } = renderInSvg();
      const filter = container.querySelector('filter#point-shadow');
      expect(filter!.querySelector('feDropShadow')).not.toBeNull();
    });

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
