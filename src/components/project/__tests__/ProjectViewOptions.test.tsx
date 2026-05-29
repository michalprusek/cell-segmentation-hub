/**
 * Behavioral tests for ProjectViewOptions.tsx
 *
 * The component renders a Radix ToggleGroup with two items (grid / list).
 * Covered behaviours:
 *  - Renders both toggle buttons (grid and list)
 *  - aria-labels use translated strings (accessibility.gridView / listView)
 *  - Current viewMode value is reflected as the selected/pressed toggle
 *  - Clicking the inactive toggle calls setViewMode with the correct mode string
 *  - Clicking the already-active toggle does NOT call setViewMode (value guard)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { render } from '@/test/utils/test-utils';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('@/contexts/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'u1' },
    isAuthenticated: true,
    isLoading: false,
  })),
}));

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: vi.fn(() => ({
    language: 'en',
    setLanguage: vi.fn(),
    t: (key: string) => {
      const map: Record<string, string> = {
        'accessibility.gridView': 'Grid view',
        'accessibility.listView': 'List view',
      };
      return map[key] ?? key;
    },
  })),
}));

// toggle-group.tsx imports `toggleVariants` from `@/components/ui/toggle`, but
// toggle.tsx only exports `Toggle` (not toggleVariants).  Provide the missing
// re-export so the test environment doesn't throw.
vi.mock('@/components/ui/toggle', async () => {
  const actual = await vi.importActual('@/components/ui/toggle');
  const variants = await vi.importActual('@/components/ui/toggle-variants');
  return {
    ...(actual as object),
    toggleVariants: (variants as { toggleVariants: unknown }).toggleVariants,
  };
});

import ProjectViewOptions from '../ProjectViewOptions';

// ---------------------------------------------------------------------------

describe('ProjectViewOptions', () => {
  const setViewMode = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the grid toggle button with correct aria-label', () => {
    render(<ProjectViewOptions viewMode="grid" setViewMode={setViewMode} />);
    expect(
      screen.getByRole('radio', { name: 'Grid view' })
    ).toBeInTheDocument();
  });

  it('renders the list toggle button with correct aria-label', () => {
    render(<ProjectViewOptions viewMode="list" setViewMode={setViewMode} />);
    expect(
      screen.getByRole('radio', { name: 'List view' })
    ).toBeInTheDocument();
  });

  it('grid button is pressed when viewMode="grid"', () => {
    render(<ProjectViewOptions viewMode="grid" setViewMode={setViewMode} />);
    const gridBtn = screen.getByRole('radio', { name: 'Grid view' });
    expect(gridBtn).toHaveAttribute('data-state', 'on');
  });

  it('list button is not pressed when viewMode="grid"', () => {
    render(<ProjectViewOptions viewMode="grid" setViewMode={setViewMode} />);
    const listBtn = screen.getByRole('radio', { name: 'List view' });
    expect(listBtn).toHaveAttribute('data-state', 'off');
  });

  it('list button is pressed when viewMode="list"', () => {
    render(<ProjectViewOptions viewMode="list" setViewMode={setViewMode} />);
    const listBtn = screen.getByRole('radio', { name: 'List view' });
    expect(listBtn).toHaveAttribute('data-state', 'on');
  });

  it('clicking the list button calls setViewMode("list") when grid is active', async () => {
    const user = userEvent.setup();
    render(<ProjectViewOptions viewMode="grid" setViewMode={setViewMode} />);
    await user.click(screen.getByRole('radio', { name: 'List view' }));
    await waitFor(() => {
      expect(setViewMode).toHaveBeenCalledWith('list');
    });
  });

  it('clicking the grid button calls setViewMode("grid") when list is active', async () => {
    const user = userEvent.setup();
    render(<ProjectViewOptions viewMode="list" setViewMode={setViewMode} />);
    await user.click(screen.getByRole('radio', { name: 'Grid view' }));
    await waitFor(() => {
      expect(setViewMode).toHaveBeenCalledWith('grid');
    });
  });

  it('does NOT call setViewMode when clicking the already-active toggle', async () => {
    // The onValueChange guard: `if (value) setViewMode(...)` — ToggleGroup
    // fires onValueChange with empty string when you click the active item,
    // so setViewMode should not be called.
    const user = userEvent.setup();
    render(<ProjectViewOptions viewMode="grid" setViewMode={setViewMode} />);
    await user.click(screen.getByRole('radio', { name: 'Grid view' }));
    expect(setViewMode).not.toHaveBeenCalled();
  });
});
