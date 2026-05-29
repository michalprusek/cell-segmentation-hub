/**
 * Behavioral tests for PageContainer.tsx
 *
 * Observable contract:
 *  - Always has "container mx-auto px-4"
 *  - variant prop selects the padding/max-width combo
 *  - custom className merges
 *  - children forwarded
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { PageContainer } from '../PageContainer';

const getRoot = (container: HTMLElement) => container.firstChild as HTMLElement;

// ---------------------------------------------------------------------------
// Base classes
// ---------------------------------------------------------------------------
describe('PageContainer — base classes', () => {
  it('always has "container"', () => {
    const { container } = render(
      <PageContainer>
        <span />
      </PageContainer>
    );
    expect(getRoot(container).classList.contains('container')).toBe(true);
  });

  it('always has "mx-auto"', () => {
    const { container } = render(
      <PageContainer>
        <span />
      </PageContainer>
    );
    expect(getRoot(container).className).toContain('mx-auto');
  });

  it('always has "px-4"', () => {
    const { container } = render(
      <PageContainer>
        <span />
      </PageContainer>
    );
    expect(getRoot(container).className).toContain('px-4');
  });
});

// ---------------------------------------------------------------------------
// variant prop
// ---------------------------------------------------------------------------
describe('PageContainer — variant prop', () => {
  it('defaults to "default" variant with py-8', () => {
    const { container } = render(
      <PageContainer>
        <span />
      </PageContainer>
    );
    expect(getRoot(container).className).toContain('py-8');
  });

  it('variant="narrow" applies py-8 and max-w-4xl', () => {
    const { container } = render(
      <PageContainer variant="narrow">
        <span />
      </PageContainer>
    );
    const cls = getRoot(container).className;
    expect(cls).toContain('py-8');
    expect(cls).toContain('max-w-4xl');
  });

  it('variant="wide" applies py-20', () => {
    const { container } = render(
      <PageContainer variant="wide">
        <span />
      </PageContainer>
    );
    expect(getRoot(container).className).toContain('py-20');
  });

  it('variant="legal" applies py-12, flex-1, mt-16', () => {
    const { container } = render(
      <PageContainer variant="legal">
        <span />
      </PageContainer>
    );
    const cls = getRoot(container).className;
    expect(cls).toContain('py-12');
    expect(cls).toContain('flex-1');
    expect(cls).toContain('mt-16');
  });

  it('variant="compact" applies py-4', () => {
    const { container } = render(
      <PageContainer variant="compact">
        <span />
      </PageContainer>
    );
    expect(getRoot(container).className).toContain('py-4');
  });

  it('variant="default" does NOT apply max-w-4xl', () => {
    const { container } = render(
      <PageContainer variant="default">
        <span />
      </PageContainer>
    );
    expect(getRoot(container).className).not.toContain('max-w-4xl');
  });
});

// ---------------------------------------------------------------------------
// className prop
// ---------------------------------------------------------------------------
describe('PageContainer — className prop', () => {
  it('merges custom className with base classes', () => {
    const { container } = render(
      <PageContainer className="my-extra-class">
        <span />
      </PageContainer>
    );
    const cls = getRoot(container).className;
    expect(cls).toContain('my-extra-class');
    expect(cls).toContain('container');
  });
});

// ---------------------------------------------------------------------------
// Children rendering
// ---------------------------------------------------------------------------
describe('PageContainer — children rendering', () => {
  it('renders text children', () => {
    render(<PageContainer>Page content here</PageContainer>);
    expect(screen.getByText('Page content here')).toBeInTheDocument();
  });

  it('renders nested elements', () => {
    render(
      <PageContainer>
        <h1 data-testid="heading">Heading</h1>
        <p data-testid="para">Paragraph</p>
      </PageContainer>
    );
    expect(screen.getByTestId('heading')).toBeInTheDocument();
    expect(screen.getByTestId('para')).toBeInTheDocument();
  });

  it('renders nothing when children is null', () => {
    const { container } = render(<PageContainer>{null}</PageContainer>);
    expect(getRoot(container).childNodes).toHaveLength(0);
  });
});
