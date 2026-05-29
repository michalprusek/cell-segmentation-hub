/**
 * Behavioral tests for ResponsiveGrid.tsx
 *
 * The component is a thin wrapper around Tailwind grid classes.  Since the
 * test environment has no CSS runtime, we can only assert on the *class
 * strings* applied to the DOM node and that children are rendered — which
 * is exactly the observable contract of this component.
 *
 * We test:
 *  - default class generation (grid, grid-cols-1, md:grid-cols-2, etc.)
 *  - each col breakpoint prop
 *  - gap prop
 *  - custom className merging
 *  - children rendering (count, content, types)
 *  - pre-configured variants (ProjectsGrid, StatsGrid, TwoColumnGrid)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import {
  ResponsiveGrid,
  ProjectsGrid,
  StatsGrid,
  TwoColumnGrid,
} from '../ResponsiveGrid';

// ---------------------------------------------------------------------------
// Helper: get the single root div rendered by ResponsiveGrid
// ---------------------------------------------------------------------------
const getGrid = (container: HTMLElement) => container.firstChild as HTMLElement;

// ---------------------------------------------------------------------------
// ResponsiveGrid — base component
// ---------------------------------------------------------------------------

describe('ResponsiveGrid', () => {
  describe('base class', () => {
    it('always renders a div with the "grid" class', () => {
      const { container } = render(
        <ResponsiveGrid>
          <span>child</span>
        </ResponsiveGrid>
      );
      expect(getGrid(container).classList.contains('grid')).toBe(true);
    });
  });

  // ---- default props ------------------------------------------------------

  describe('default props (cols={default:1, md:2, lg:3}, gap=6)', () => {
    it('applies grid-cols-1 for the default breakpoint', () => {
      const { container } = render(
        <ResponsiveGrid>
          <span />
        </ResponsiveGrid>
      );
      expect(getGrid(container).className).toContain('grid-cols-1');
    });

    it('applies md:grid-cols-2', () => {
      const { container } = render(
        <ResponsiveGrid>
          <span />
        </ResponsiveGrid>
      );
      expect(getGrid(container).className).toContain('md:grid-cols-2');
    });

    it('applies lg:grid-cols-3', () => {
      const { container } = render(
        <ResponsiveGrid>
          <span />
        </ResponsiveGrid>
      );
      expect(getGrid(container).className).toContain('lg:grid-cols-3');
    });

    it('applies gap-6 by default', () => {
      const { container } = render(
        <ResponsiveGrid>
          <span />
        </ResponsiveGrid>
      );
      expect(getGrid(container).className).toContain('gap-6');
    });
  });

  // ---- cols breakpoints ---------------------------------------------------

  describe('cols prop — individual breakpoints', () => {
    it('applies sm:grid-cols-N when cols.sm is set', () => {
      const { container } = render(
        <ResponsiveGrid cols={{ sm: 2 }}>
          <span />
        </ResponsiveGrid>
      );
      expect(getGrid(container).className).toContain('sm:grid-cols-2');
    });

    it('applies md:grid-cols-N when cols.md is set', () => {
      const { container } = render(
        <ResponsiveGrid cols={{ md: 4 }}>
          <span />
        </ResponsiveGrid>
      );
      expect(getGrid(container).className).toContain('md:grid-cols-4');
    });

    it('applies lg:grid-cols-N when cols.lg is set', () => {
      const { container } = render(
        <ResponsiveGrid cols={{ lg: 5 }}>
          <span />
        </ResponsiveGrid>
      );
      expect(getGrid(container).className).toContain('lg:grid-cols-5');
    });

    it('applies xl:grid-cols-N when cols.xl is set', () => {
      const { container } = render(
        <ResponsiveGrid cols={{ xl: 6 }}>
          <span />
        </ResponsiveGrid>
      );
      expect(getGrid(container).className).toContain('xl:grid-cols-6');
    });

    it('does NOT emit sm:grid-cols when cols.sm is absent', () => {
      const { container } = render(
        <ResponsiveGrid cols={{ default: 1 }}>
          <span />
        </ResponsiveGrid>
      );
      expect(getGrid(container).className).not.toContain('sm:grid-cols');
    });

    it('does NOT emit xl:grid-cols when cols.xl is absent', () => {
      const { container } = render(
        <ResponsiveGrid cols={{ default: 1 }}>
          <span />
        </ResponsiveGrid>
      );
      expect(getGrid(container).className).not.toContain('xl:grid-cols');
    });

    it('emits all five breakpoints when every key is specified', () => {
      const { container } = render(
        <ResponsiveGrid cols={{ default: 1, sm: 2, md: 3, lg: 4, xl: 5 }}>
          <span />
        </ResponsiveGrid>
      );
      const cls = getGrid(container).className;
      expect(cls).toContain('grid-cols-1');
      expect(cls).toContain('sm:grid-cols-2');
      expect(cls).toContain('md:grid-cols-3');
      expect(cls).toContain('lg:grid-cols-4');
      expect(cls).toContain('xl:grid-cols-5');
    });
  });

  // ---- gap prop -----------------------------------------------------------

  describe('gap prop', () => {
    for (const gap of [2, 3, 4, 6, 8, 12] as const) {
      it(`applies gap-${gap} when gap=${gap}`, () => {
        const { container } = render(
          <ResponsiveGrid gap={gap}>
            <span />
          </ResponsiveGrid>
        );
        expect(getGrid(container).className).toContain(`gap-${gap}`);
      });
    }
  });

  // ---- custom className ---------------------------------------------------

  describe('className prop', () => {
    it('merges a custom className with the generated classes', () => {
      const { container } = render(
        <ResponsiveGrid className="my-custom-class">
          <span />
        </ResponsiveGrid>
      );
      expect(getGrid(container).className).toContain('my-custom-class');
    });

    it('keeps "grid" class alongside a custom className', () => {
      const { container } = render(
        <ResponsiveGrid className="extra">
          <span />
        </ResponsiveGrid>
      );
      const cls = getGrid(container).className;
      expect(cls).toContain('grid');
      expect(cls).toContain('extra');
    });
  });

  // ---- children rendering -------------------------------------------------

  describe('children rendering', () => {
    it('renders a single child element', () => {
      render(
        <ResponsiveGrid>
          <div data-testid="child-one">one</div>
        </ResponsiveGrid>
      );
      expect(screen.getByTestId('child-one')).toBeInTheDocument();
    });

    it('renders multiple children', () => {
      render(
        <ResponsiveGrid>
          <div data-testid="c1">a</div>
          <div data-testid="c2">b</div>
          <div data-testid="c3">c</div>
        </ResponsiveGrid>
      );
      expect(screen.getByTestId('c1')).toBeInTheDocument();
      expect(screen.getByTestId('c2')).toBeInTheDocument();
      expect(screen.getByTestId('c3')).toBeInTheDocument();
    });

    it('renders children text content unchanged', () => {
      render(
        <ResponsiveGrid>
          <span>Hello world</span>
        </ResponsiveGrid>
      );
      expect(screen.getByText('Hello world')).toBeInTheDocument();
    });

    it('renders nothing when children is null', () => {
      const { container } = render(<ResponsiveGrid>{null}</ResponsiveGrid>);
      expect(getGrid(container).childNodes).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Pre-configured variants
// ---------------------------------------------------------------------------

describe('ProjectsGrid', () => {
  it('renders children', () => {
    render(
      <ProjectsGrid>
        <div data-testid="project">Project</div>
      </ProjectsGrid>
    );
    expect(screen.getByTestId('project')).toBeInTheDocument();
  });

  it('uses 1/2/3 column layout (default/md/lg)', () => {
    const { container } = render(
      <ProjectsGrid>
        <span />
      </ProjectsGrid>
    );
    const cls = getGrid(container).className;
    expect(cls).toContain('grid-cols-1');
    expect(cls).toContain('md:grid-cols-2');
    expect(cls).toContain('lg:grid-cols-3');
  });

  it('default gap is 6', () => {
    const { container } = render(
      <ProjectsGrid>
        <span />
      </ProjectsGrid>
    );
    expect(getGrid(container).className).toContain('gap-6');
  });

  it('merges custom className', () => {
    const { container } = render(
      <ProjectsGrid className="projects-override">
        <span />
      </ProjectsGrid>
    );
    expect(getGrid(container).className).toContain('projects-override');
  });
});

describe('StatsGrid', () => {
  it('renders children', () => {
    render(
      <StatsGrid>
        <div data-testid="stat">Stat</div>
      </StatsGrid>
    );
    expect(screen.getByTestId('stat')).toBeInTheDocument();
  });

  it('uses 1/2/4 column layout (default/md/lg)', () => {
    const { container } = render(
      <StatsGrid>
        <span />
      </StatsGrid>
    );
    const cls = getGrid(container).className;
    expect(cls).toContain('grid-cols-1');
    expect(cls).toContain('md:grid-cols-2');
    expect(cls).toContain('lg:grid-cols-4');
  });

  it('default gap is 4', () => {
    const { container } = render(
      <StatsGrid>
        <span />
      </StatsGrid>
    );
    expect(getGrid(container).className).toContain('gap-4');
  });
});

describe('TwoColumnGrid', () => {
  it('renders children', () => {
    render(
      <TwoColumnGrid>
        <div data-testid="col-a">A</div>
        <div data-testid="col-b">B</div>
      </TwoColumnGrid>
    );
    expect(screen.getByTestId('col-a')).toBeInTheDocument();
    expect(screen.getByTestId('col-b')).toBeInTheDocument();
  });

  it('uses 1/2 column layout (default/md)', () => {
    const { container } = render(
      <TwoColumnGrid>
        <span />
      </TwoColumnGrid>
    );
    const cls = getGrid(container).className;
    expect(cls).toContain('grid-cols-1');
    expect(cls).toContain('md:grid-cols-2');
  });

  it('does NOT apply a lg:grid-cols class', () => {
    const { container } = render(
      <TwoColumnGrid>
        <span />
      </TwoColumnGrid>
    );
    expect(getGrid(container).className).not.toContain('lg:grid-cols');
  });

  it('default gap is 4', () => {
    const { container } = render(
      <TwoColumnGrid>
        <span />
      </TwoColumnGrid>
    );
    expect(getGrid(container).className).toContain('gap-4');
  });
});
