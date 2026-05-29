/**
 * Behavioral tests for ResponsiveStack.tsx
 *
 * The component is a thin Tailwind-class compositor.  The test environment
 * has no CSS runtime, so assertions target the *class strings* on the DOM
 * node and that children are forwarded — which is the full observable
 * contract.
 *
 * Covered behaviours:
 *  - Always renders a flex div
 *  - direction prop: vertical → flex-col <bp>:flex-row
 *                    horizontal → flex-row <bp>:flex-col
 *  - breakpoint prop: sm | md (default) | lg prefix
 *  - gap prop: gap-N classes
 *  - align prop: items-* classes
 *  - justify prop: justify-* classes
 *  - custom className merging
 *  - children forwarding
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ResponsiveStack } from '../ResponsiveStack';

const getRoot = (container: HTMLElement) => container.firstChild as HTMLElement;

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------
describe('ResponsiveStack — base class', () => {
  it('always renders a div with "flex"', () => {
    const { container } = render(
      <ResponsiveStack>
        <span />
      </ResponsiveStack>
    );
    expect(getRoot(container).classList.contains('flex')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// direction prop
// ---------------------------------------------------------------------------
describe('ResponsiveStack — direction prop', () => {
  it('defaults to vertical: applies flex-col and md:flex-row', () => {
    const { container } = render(
      <ResponsiveStack>
        <span />
      </ResponsiveStack>
    );
    const cls = getRoot(container).className;
    expect(cls).toContain('flex-col');
    expect(cls).toContain('md:flex-row');
  });

  it('direction="vertical" applies flex-col and <bp>:flex-row', () => {
    const { container } = render(
      <ResponsiveStack direction="vertical" breakpoint="lg">
        <span />
      </ResponsiveStack>
    );
    const cls = getRoot(container).className;
    expect(cls).toContain('flex-col');
    expect(cls).toContain('lg:flex-row');
    expect(cls).not.toContain('flex-col lg:flex-col');
  });

  it('direction="horizontal" applies flex-row and <bp>:flex-col', () => {
    const { container } = render(
      <ResponsiveStack direction="horizontal" breakpoint="sm">
        <span />
      </ResponsiveStack>
    );
    const cls = getRoot(container).className;
    expect(cls).toContain('flex-row');
    expect(cls).toContain('sm:flex-col');
  });
});

// ---------------------------------------------------------------------------
// breakpoint prop
// ---------------------------------------------------------------------------
describe('ResponsiveStack — breakpoint prop', () => {
  for (const bp of ['sm', 'md', 'lg'] as const) {
    it(`breakpoint="${bp}" uses "${bp}:" prefix in direction class`, () => {
      const { container } = render(
        <ResponsiveStack breakpoint={bp}>
          <span />
        </ResponsiveStack>
      );
      expect(getRoot(container).className).toContain(`${bp}:`);
    });
  }
});

// ---------------------------------------------------------------------------
// gap prop
// ---------------------------------------------------------------------------
describe('ResponsiveStack — gap prop', () => {
  it('defaults to gap-4', () => {
    const { container } = render(
      <ResponsiveStack>
        <span />
      </ResponsiveStack>
    );
    expect(getRoot(container).className).toContain('gap-4');
  });

  for (const gap of [2, 3, 4, 6, 8] as const) {
    it(`gap=${gap} applies gap-${gap}`, () => {
      const { container } = render(
        <ResponsiveStack gap={gap}>
          <span />
        </ResponsiveStack>
      );
      expect(getRoot(container).className).toContain(`gap-${gap}`);
    });
  }
});

// ---------------------------------------------------------------------------
// align prop
// ---------------------------------------------------------------------------
describe('ResponsiveStack — align prop', () => {
  it('defaults to items-stretch', () => {
    const { container } = render(
      <ResponsiveStack>
        <span />
      </ResponsiveStack>
    );
    expect(getRoot(container).className).toContain('items-stretch');
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
        <ResponsiveStack align={prop as keyof typeof alignMap}>
          <span />
        </ResponsiveStack>
      );
      expect(getRoot(container).className).toContain(cls);
    });
  }
});

// ---------------------------------------------------------------------------
// justify prop
// ---------------------------------------------------------------------------
describe('ResponsiveStack — justify prop', () => {
  it('defaults to justify-start', () => {
    const { container } = render(
      <ResponsiveStack>
        <span />
      </ResponsiveStack>
    );
    expect(getRoot(container).className).toContain('justify-start');
  });

  const justifyMap = {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
    between: 'justify-between',
    around: 'justify-around',
  } as const;

  for (const [prop, cls] of Object.entries(justifyMap)) {
    it(`justify="${prop}" applies ${cls}`, () => {
      const { container } = render(
        <ResponsiveStack justify={prop as keyof typeof justifyMap}>
          <span />
        </ResponsiveStack>
      );
      expect(getRoot(container).className).toContain(cls);
    });
  }
});

// ---------------------------------------------------------------------------
// className merging
// ---------------------------------------------------------------------------
describe('ResponsiveStack — className prop', () => {
  it('merges custom className alongside generated classes', () => {
    const { container } = render(
      <ResponsiveStack className="my-custom-class">
        <span />
      </ResponsiveStack>
    );
    const cls = getRoot(container).className;
    expect(cls).toContain('my-custom-class');
    expect(cls).toContain('flex');
  });
});

// ---------------------------------------------------------------------------
// children rendering
// ---------------------------------------------------------------------------
describe('ResponsiveStack — children rendering', () => {
  it('renders a single child', () => {
    render(
      <ResponsiveStack>
        <div data-testid="child-a">alpha</div>
      </ResponsiveStack>
    );
    expect(screen.getByTestId('child-a')).toBeInTheDocument();
  });

  it('renders multiple children', () => {
    render(
      <ResponsiveStack>
        <div data-testid="c1">one</div>
        <div data-testid="c2">two</div>
        <div data-testid="c3">three</div>
      </ResponsiveStack>
    );
    expect(screen.getByTestId('c1')).toBeInTheDocument();
    expect(screen.getByTestId('c2')).toBeInTheDocument();
    expect(screen.getByTestId('c3')).toBeInTheDocument();
  });

  it('renders text content unchanged', () => {
    render(
      <ResponsiveStack>
        <span>Hello stack</span>
      </ResponsiveStack>
    );
    expect(screen.getByText('Hello stack')).toBeInTheDocument();
  });

  it('renders nothing when children is null', () => {
    const { container } = render(<ResponsiveStack>{null}</ResponsiveStack>);
    expect(getRoot(container).childNodes).toHaveLength(0);
  });
});
