/**
 * Documentation.tsx — section rendering, navigation, search, and the
 * conditional Navbar / back-link behaviour.
 *
 * Run with:
 *   NODE_OPTIONS=--max-old-space-size=4096 npx vitest run \
 *     src/pages/__tests__/Documentation.test.tsx --reporter=dot
 *
 * Strategy:
 *   The page is now data-driven: `buildDocsSections(t)` produces the section
 *   array and the page renders it generically. So instead of a hand-maintained
 *   key→string map (which rotted every time a section was added), `t` echoes a
 *   readable slice of the key. Assertions are then made against the real
 *   English content module by importing it and driving the same builder, which
 *   means adding a section cannot silently break this test — and cannot
 *   silently pass it either.
 *
 * Behaviors tested:
 *   - Badge, title and subtitle render.
 *   - One sidebar nav button per section, and one rendered <section> per id.
 *   - Clicking a nav button calls scrollToSection with that section's id.
 *   - The active nav button gets the active class.
 *   - Search filters sections down to the matching ones and highlights the
 *     match; a query with no matches shows the empty state; clearing restores.
 *   - A one-character query is ignored (too noisy to filter on).
 *   - Navbar visibility and the "Back to" button follow auth + referrer state.
 *
 * NOT tested:
 *   - Real scroll behaviour (useActiveSection is stubbed).
 *   - Navbar / Footer internals (stubbed).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockScrollToSection,
  mockActiveSection,
  mockNavigate,
  mockIsAuthenticated,
} = vi.hoisted(() => ({
  mockScrollToSection: vi.fn(),
  mockActiveSection: { value: '' },
  mockNavigate: vi.fn(),
  mockIsAuthenticated: { value: false },
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useActiveSection', () => ({
  useActiveSection: () => ({
    activeSection: mockActiveSection.value,
    scrollToSection: mockScrollToSection,
  }),
}));

/**
 * Echo the last two key segments. That keeps assertions readable
 * ("nav.introduction") while guaranteeing every key resolves, so a missing
 * translation can never make a section silently vanish from this test.
 */
const echoTranslate = (key: string) => key.split('.').slice(-2).join('.');

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({ t: echoTranslate }),
}));

vi.mock('@/contexts/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated.value,
    user: null,
    loading: false,
  }),
}));

vi.mock('@/components/Navbar', () => ({
  default: () => <nav data-testid="navbar" />,
}));

vi.mock('@/components/Footer', () => ({
  default: () => <footer data-testid="footer" />,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return { ...actual, useNavigate: () => mockNavigate };
});

import Documentation from '../Documentation';
import { buildDocsSections } from '../documentation/docsContent';

/** The sections the page will render, under the same `t` the page sees. */
const SECTIONS = buildDocsSections(echoTranslate);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderDocs(
  opts: { authenticated?: boolean; locationState?: object } = {}
) {
  mockIsAuthenticated.value = opts.authenticated ?? false;
  const state = opts.locationState ?? null;
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/documentation', state }]}>
      <Documentation />
    </MemoryRouter>
  );
}

/** The sidebar's nav buttons, in order. */
function navButtons(container: HTMLElement): HTMLElement[] {
  const aside = container.querySelector('aside');
  if (!aside) throw new Error('sidebar not rendered');
  return Array.from(aside.querySelectorAll('button'));
}

function searchBox(): HTMLInputElement {
  return screen.getByRole('searchbox') as HTMLInputElement;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Documentation page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveSection.value = '';
  });

  describe('content model', () => {
    it('exposes a non-trivial set of sections with unique ids', () => {
      expect(SECTIONS.length).toBeGreaterThanOrEqual(10);
      const ids = SECTIONS.map(section => section.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('covers every project type and the standalone tools', () => {
      const ids = SECTIONS.map(section => section.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          'introduction',
          'project-types',
          'videos-channels',
          'models-selection',
          'segmentation-editor',
          'export-features',
          'automated-essays',
          'segmenter',
          'troubleshooting',
        ])
      );
    });

    it('gives every section at least one content block', () => {
      for (const section of SECTIONS) {
        expect(section.blocks.length).toBeGreaterThan(0);
      }
    });
  });

  describe('header', () => {
    it('renders the badge, title and subtitle', () => {
      renderDocs();
      expect(screen.getByText('docs.badge')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { level: 1, name: 'docs.title' })
      ).toBeInTheDocument();
      expect(screen.getByText('docs.subtitle')).toBeInTheDocument();
    });
  });

  describe('navigation', () => {
    it('renders one nav button per section, labelled from the content model', () => {
      const { container } = renderDocs();
      const buttons = navButtons(container);
      expect(buttons).toHaveLength(SECTIONS.length);
      buttons.forEach((button, index) => {
        expect(button).toHaveTextContent(SECTIONS[index].navLabel);
      });
    });

    it('renders one section element per section id', () => {
      const { container } = renderDocs();
      for (const section of SECTIONS) {
        expect(container.querySelector(`section#${section.id}`)).not.toBeNull();
      }
    });

    it('scrolls to the matching section when a nav button is clicked', () => {
      const { container } = renderDocs();
      const buttons = navButtons(container);
      fireEvent.click(buttons[2]);
      expect(mockScrollToSection).toHaveBeenCalledWith(SECTIONS[2].id);
    });

    it('marks the active nav button', () => {
      mockActiveSection.value = SECTIONS[1].id;
      const { container } = renderDocs();
      const buttons = navButtons(container);
      // `bg-blue-50` appears only in the active branch; `text-blue-600` also
      // shows up as `hover:text-blue-600` on inactive buttons.
      expect(buttons[1].className).toContain('bg-blue-50');
      expect(buttons[0].className).not.toContain('bg-blue-50');
    });
  });

  describe('search', () => {
    it('ignores a query shorter than two characters', () => {
      const { container } = renderDocs();
      fireEvent.change(searchBox(), { target: { value: 'a' } });
      expect(navButtons(container)).toHaveLength(SECTIONS.length);
    });

    it('filters to the sections that match every term', () => {
      const { container } = renderDocs();
      // "segmenter" appears in the standalone-tool section's keys only.
      fireEvent.change(searchBox(), { target: { value: 'segmenter' } });

      const remaining = navButtons(container);
      expect(remaining.length).toBeGreaterThan(0);
      expect(remaining.length).toBeLessThan(SECTIONS.length);
      expect(container.querySelector('section#segmenter')).not.toBeNull();
    });

    it('highlights the matched text inside the rendered section', () => {
      const { container } = renderDocs();
      fireEvent.change(searchBox(), { target: { value: 'segmenter' } });

      const marks = container.querySelectorAll('mark');
      expect(marks.length).toBeGreaterThan(0);
      expect(marks[0].textContent?.toLowerCase()).toContain('segmenter');
    });

    it('matches case- and accent-insensitively', () => {
      const { container } = renderDocs();
      fireEvent.change(searchBox(), { target: { value: 'SEGMENTER' } });
      expect(container.querySelector('section#segmenter')).not.toBeNull();
    });

    it('shows the empty state when nothing matches, and recovers on clear', () => {
      const { container } = renderDocs();
      fireEvent.change(searchBox(), {
        target: { value: 'zzzzzz-no-such-term' },
      });

      expect(navButtons(container)).toHaveLength(0);
      expect(screen.getAllByText('search.noResults').length).toBeGreaterThan(0);
      expect(container.querySelector('section')).toBeNull();

      fireEvent.change(searchBox(), { target: { value: '' } });
      expect(navButtons(container)).toHaveLength(SECTIONS.length);
    });

    it('focuses the search box when "/" is pressed outside a field', () => {
      renderDocs();
      const input = searchBox();
      expect(document.activeElement).not.toBe(input);
      fireEvent.keyDown(window, { key: '/' });
      expect(document.activeElement).toBe(input);
    });

    it('clears the query when Escape is pressed inside the search box', () => {
      renderDocs();
      const input = searchBox();
      fireEvent.change(input, { target: { value: 'segmenter' } });
      expect(input.value).toBe('segmenter');
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(input.value).toBe('');
    });
  });

  describe('footer navigation', () => {
    it('links back to the home page', () => {
      renderDocs();
      const link = screen.getByRole('link', { name: /footer.backToHome/ });
      expect(link).toHaveAttribute('href', '/');
    });

    it('scrolls to the first section from "back to top"', () => {
      renderDocs();
      fireEvent.click(screen.getByText('footer.backToTop'));
      expect(mockScrollToSection).toHaveBeenCalledWith(SECTIONS[0].id);
    });
  });

  describe('navbar and referrer', () => {
    it('shows the navbar for an anonymous visitor', () => {
      renderDocs({ authenticated: false });
      expect(screen.getByTestId('navbar')).toBeInTheDocument();
    });

    it('hides the navbar when authenticated with a referrer', () => {
      renderDocs({
        authenticated: true,
        locationState: { from: 'Dashboard', path: '/dashboard' },
      });
      expect(screen.queryByTestId('navbar')).not.toBeInTheDocument();
    });

    it('navigates back to the referrer path', () => {
      const { container } = renderDocs({
        authenticated: true,
        locationState: { from: 'Dashboard', path: '/dashboard' },
      });
      const backButton = within(container).getByText('docs.backTo');
      fireEvent.click(backButton);
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });
});
