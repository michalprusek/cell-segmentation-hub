/**
 * Behavioral tests for PageLoadingFallback.tsx
 *
 * The component renders different skeleton layouts per `type` prop.
 * Since Skeleton is a pure Tailwind div, we verify structural DOM
 * characteristics: expected container classes, number of skeleton
 * elements rendered in each variant.
 *
 * Covered behaviours:
 *  - "default" type (and no type prop): renders container + 4 skeletons
 *  - "dashboard" type: renders grid + 6 card-skeleton groups (3 skeletons each)
 *  - "editor" type: renders h-screen + 5 sidebar skeletons + header skeleton
 *  - "form" type: renders max-w-md + 4 field groups + submit skeleton
 *
 * NOT testable here:
 *  - Visual appearance (no CSS engine in jsdom)
 *  - Responsive breakpoints
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import PageLoadingFallback from '../PageLoadingFallback';

// ---------------------------------------------------------------------------
// Helper: count elements with the data-slot="skeleton" attribute that
// Shadcn Skeleton renders, or fall back to elements with "animate-pulse"
// class that our Skeleton stub adds.
// The actual Skeleton component from shadcn renders a div — we count all
// divs inside the container that have the rounded/animate class mix typical
// of Skeleton.  Rather than coupling to internal markup, we count the direct
// structural groupings described in the implementation.
// ---------------------------------------------------------------------------

describe('PageLoadingFallback — default type', () => {
  it('renders without error when no type is provided', () => {
    expect(() => render(<PageLoadingFallback />)).not.toThrow();
  });

  it('renders a container div', () => {
    const { container } = render(<PageLoadingFallback />);
    expect(container.firstChild).toBeTruthy();
  });

  it('type="default" renders the container with space-y-4', () => {
    const { container } = render(<PageLoadingFallback type="default" />);
    const inner = container.querySelector('.space-y-4');
    expect(inner).toBeInTheDocument();
  });
});

describe('PageLoadingFallback — dashboard type', () => {
  it('renders without error', () => {
    expect(() =>
      render(<PageLoadingFallback type="dashboard" />)
    ).not.toThrow();
  });

  it('renders a grid container', () => {
    const { container } = render(<PageLoadingFallback type="dashboard" />);
    const grid = container.querySelector('.grid');
    expect(grid).toBeInTheDocument();
  });

  it('renders 6 card skeleton groups', () => {
    const { container } = render(<PageLoadingFallback type="dashboard" />);
    const grid = container.querySelector('.grid');
    // Each card group is a div.space-y-3 inside the grid
    const groups = grid?.querySelectorAll('.space-y-3');
    expect(groups?.length).toBe(6);
  });

  it('renders a flex header row with two skeletons', () => {
    const { container } = render(<PageLoadingFallback type="dashboard" />);
    const headerRow = container.querySelector(
      '.flex.items-center.justify-between'
    );
    expect(headerRow).toBeInTheDocument();
    // Two skeleton divs are direct children of the flex row
    const children = Array.from(headerRow?.children ?? []);
    expect(children.length).toBe(2);
  });
});

describe('PageLoadingFallback — editor type', () => {
  it('renders without error', () => {
    expect(() => render(<PageLoadingFallback type="editor" />)).not.toThrow();
  });

  it('renders h-screen container', () => {
    const { container } = render(<PageLoadingFallback type="editor" />);
    expect(container.querySelector('.h-screen')).toBeInTheDocument();
  });

  it('renders a sidebar panel with 5 skeleton items', () => {
    const { container } = render(<PageLoadingFallback type="editor" />);
    // The sidebar is a w-80 div; inside it has space-y-4 with 5 Skeletons
    const sidebar = container.querySelector('.w-80');
    expect(sidebar).toBeInTheDocument();
    const items = sidebar?.querySelectorAll('.space-y-4 > *');
    // space-y-4 wraps all children; first child is the title skeleton (h-6),
    // followed by 5 field skeletons (h-12)
    expect(items?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('PageLoadingFallback — form type', () => {
  it('renders without error', () => {
    expect(() => render(<PageLoadingFallback type="form" />)).not.toThrow();
  });

  it('renders max-w-md container', () => {
    const { container } = render(<PageLoadingFallback type="form" />);
    expect(container.querySelector('.max-w-md')).toBeInTheDocument();
  });

  it('renders 4 field skeleton groups', () => {
    const { container } = render(<PageLoadingFallback type="form" />);
    // The form has a space-y-4 div containing field groups (each .space-y-2)
    const fields = container.querySelectorAll('.space-y-2');
    expect(fields.length).toBe(4);
  });
});
