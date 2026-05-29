/**
 * Behavioral tests for ContentCard.tsx
 *
 * Observable contract:
 *  - Base styles always present (background, border, rounded)
 *  - variant prop selects shadow / hover / cursor classes
 *  - hover prop on "default" variant adds transition hover classes
 *  - onClick prop sets cursor-pointer and fires callback
 *  - children are forwarded
 *  - custom className merges
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ContentCard } from '../ContentCard';

const getRoot = (container: HTMLElement) => container.firstChild as HTMLElement;

// ---------------------------------------------------------------------------
// Base styles
// ---------------------------------------------------------------------------
describe('ContentCard — base styles', () => {
  it('renders a div with bg-white class', () => {
    const { container } = render(
      <ContentCard>
        <span />
      </ContentCard>
    );
    expect(getRoot(container).className).toContain('bg-white');
  });

  it('always has rounded-lg', () => {
    const { container } = render(
      <ContentCard>
        <span />
      </ContentCard>
    );
    expect(getRoot(container).className).toContain('rounded-lg');
  });

  it('always has border', () => {
    const { container } = render(
      <ContentCard>
        <span />
      </ContentCard>
    );
    expect(getRoot(container).className).toContain('border');
  });
});

// ---------------------------------------------------------------------------
// variant prop
// ---------------------------------------------------------------------------
describe('ContentCard — variant prop', () => {
  it('defaults to "default" variant with shadow-sm', () => {
    const { container } = render(
      <ContentCard>
        <span />
      </ContentCard>
    );
    expect(getRoot(container).className).toContain('shadow-sm');
  });

  it('variant="interactive" applies cursor-pointer', () => {
    const { container } = render(
      <ContentCard variant="interactive">
        <span />
      </ContentCard>
    );
    expect(getRoot(container).className).toContain('cursor-pointer');
  });

  it('variant="interactive" applies hover:shadow-md', () => {
    const { container } = render(
      <ContentCard variant="interactive">
        <span />
      </ContentCard>
    );
    expect(getRoot(container).className).toContain('hover:shadow-md');
  });

  it('variant="interactive" applies transition-all duration-300', () => {
    const { container } = render(
      <ContentCard variant="interactive">
        <span />
      </ContentCard>
    );
    const cls = getRoot(container).className;
    expect(cls).toContain('transition-all');
    expect(cls).toContain('duration-300');
  });

  it('variant="elevated" applies shadow-md', () => {
    const { container } = render(
      <ContentCard variant="elevated">
        <span />
      </ContentCard>
    );
    expect(getRoot(container).className).toContain('shadow-md');
  });
});

// ---------------------------------------------------------------------------
// hover prop (only effective on "default" variant)
// ---------------------------------------------------------------------------
describe('ContentCard — hover prop', () => {
  it('hover=true on default variant adds hover:shadow-md', () => {
    const { container } = render(
      <ContentCard hover>
        <span />
      </ContentCard>
    );
    expect(getRoot(container).className).toContain('hover:shadow-md');
  });

  it('hover=true on default variant adds transition-all', () => {
    const { container } = render(
      <ContentCard hover>
        <span />
      </ContentCard>
    );
    expect(getRoot(container).className).toContain('transition-all');
  });

  it('hover=false (default) on default variant does NOT add hover:shadow-md', () => {
    const { container } = render(
      <ContentCard>
        <span />
      </ContentCard>
    );
    // default variant without hover prop should not have hover:shadow-md
    // (shadow-sm is from variantStyles, not hover)
    expect(getRoot(container).className).not.toContain('hover:shadow-md');
  });
});

// ---------------------------------------------------------------------------
// onClick prop
// ---------------------------------------------------------------------------
describe('ContentCard — onClick prop', () => {
  it('applies cursor-pointer when onClick is provided', () => {
    const { container } = render(
      <ContentCard onClick={vi.fn()}>
        <span />
      </ContentCard>
    );
    expect(getRoot(container).className).toContain('cursor-pointer');
  });

  it('does NOT apply cursor-pointer without onClick', () => {
    const { container } = render(
      <ContentCard>
        <span />
      </ContentCard>
    );
    // "interactive" variant adds cursor-pointer, but default without onClick should not
    expect(getRoot(container).className).not.toContain('cursor-pointer');
  });

  it('calls onClick when the card is clicked', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(
      <ContentCard onClick={handleClick}>
        <span>content</span>
      </ContentCard>
    );
    await user.click(screen.getByText('content'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// children
// ---------------------------------------------------------------------------
describe('ContentCard — children rendering', () => {
  it('renders child text', () => {
    render(<ContentCard>Card content</ContentCard>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('renders nested elements', () => {
    render(
      <ContentCard>
        <h3 data-testid="card-title">Title</h3>
        <p data-testid="card-body">Body</p>
      </ContentCard>
    );
    expect(screen.getByTestId('card-title')).toBeInTheDocument();
    expect(screen.getByTestId('card-body')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// className prop
// ---------------------------------------------------------------------------
describe('ContentCard — className prop', () => {
  it('merges custom className with base classes', () => {
    const { container } = render(
      <ContentCard className="p-6">
        <span />
      </ContentCard>
    );
    const cls = getRoot(container).className;
    expect(cls).toContain('p-6');
    expect(cls).toContain('bg-white');
  });
});
