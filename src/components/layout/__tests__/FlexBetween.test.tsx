/**
 * Behavioral tests for FlexBetween.tsx
 *
 * Observable contract:
 *  - Always has "flex" and "justify-between"
 *  - align prop maps to items-* classes (default: items-center)
 *  - direction prop: "row" (default) → flex-row, "col" → flex-col
 *  - custom className merges
 *  - children forwarded
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { FlexBetween } from '../FlexBetween';

const getRoot = (container: HTMLElement) => container.firstChild as HTMLElement;

// ---------------------------------------------------------------------------
// Base classes
// ---------------------------------------------------------------------------
describe('FlexBetween — base classes', () => {
  it('always has "flex"', () => {
    const { container } = render(
      <FlexBetween>
        <span />
      </FlexBetween>
    );
    expect(getRoot(container).classList.contains('flex')).toBe(true);
  });

  it('always has "justify-between"', () => {
    const { container } = render(
      <FlexBetween>
        <span />
      </FlexBetween>
    );
    expect(getRoot(container).className).toContain('justify-between');
  });
});

// ---------------------------------------------------------------------------
// align prop
// ---------------------------------------------------------------------------
describe('FlexBetween — align prop', () => {
  it('defaults to items-center', () => {
    const { container } = render(
      <FlexBetween>
        <span />
      </FlexBetween>
    );
    expect(getRoot(container).className).toContain('items-center');
  });

  const alignMap = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
    stretch: 'items-stretch',
  } as const;

  for (const [prop, cls] of Object.entries(alignMap)) {
    it(`align="${prop}" applies ${cls}`, () => {
      const { container } = render(
        <FlexBetween align={prop as keyof typeof alignMap}>
          <span />
        </FlexBetween>
      );
      expect(getRoot(container).className).toContain(cls);
    });
  }
});

// ---------------------------------------------------------------------------
// direction prop
// ---------------------------------------------------------------------------
describe('FlexBetween — direction prop', () => {
  it('defaults to flex-row', () => {
    const { container } = render(
      <FlexBetween>
        <span />
      </FlexBetween>
    );
    expect(getRoot(container).className).toContain('flex-row');
  });

  it('direction="row" applies flex-row', () => {
    const { container } = render(
      <FlexBetween direction="row">
        <span />
      </FlexBetween>
    );
    expect(getRoot(container).className).toContain('flex-row');
  });

  it('direction="col" applies flex-col', () => {
    const { container } = render(
      <FlexBetween direction="col">
        <span />
      </FlexBetween>
    );
    expect(getRoot(container).className).toContain('flex-col');
  });

  it('direction="col" does NOT apply flex-row', () => {
    const { container } = render(
      <FlexBetween direction="col">
        <span />
      </FlexBetween>
    );
    expect(getRoot(container).className).not.toContain('flex-row');
  });
});

// ---------------------------------------------------------------------------
// className prop
// ---------------------------------------------------------------------------
describe('FlexBetween — className prop', () => {
  it('merges custom className with base classes', () => {
    const { container } = render(
      <FlexBetween className="p-4 gap-2">
        <span />
      </FlexBetween>
    );
    const cls = getRoot(container).className;
    expect(cls).toContain('p-4');
    expect(cls).toContain('gap-2');
    expect(cls).toContain('flex');
    expect(cls).toContain('justify-between');
  });
});

// ---------------------------------------------------------------------------
// Children rendering
// ---------------------------------------------------------------------------
describe('FlexBetween — children rendering', () => {
  it('renders a single child', () => {
    render(
      <FlexBetween>
        <span data-testid="left">Left</span>
      </FlexBetween>
    );
    expect(screen.getByTestId('left')).toBeInTheDocument();
  });

  it('renders two children (typical title + action pattern)', () => {
    render(
      <FlexBetween>
        <h3 data-testid="title">Title</h3>
        <button data-testid="action">Action</button>
      </FlexBetween>
    );
    expect(screen.getByTestId('title')).toBeInTheDocument();
    expect(screen.getByTestId('action')).toBeInTheDocument();
  });

  it('preserves child text content', () => {
    render(
      <FlexBetween>
        <span>Left side</span>
        <span>Right side</span>
      </FlexBetween>
    );
    expect(screen.getByText('Left side')).toBeInTheDocument();
    expect(screen.getByText('Right side')).toBeInTheDocument();
  });
});
