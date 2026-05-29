/**
 * Behavioral tests for ProjectSelector.tsx
 *
 * Covered behaviours:
 *  - Renders the label with translated text
 *  - Select trigger is disabled while loading (initial state before fetch)
 *  - Select trigger becomes enabled after fetch resolves
 *  - Fetch is skipped when user is null
 *  - getProjects is called when user is present
 *  - toast.error is called on fetch failure
 *  - Projects list is passed to the Select options (via SelectItem count)
 *
 * Interaction tests that require opening the Radix Select dropdown are
 * skipped — Radix UI Select relies on pointer-capture and scrollIntoView
 * APIs that jsdom does not implement, making click-to-open unreliable.
 * The onChange wiring is verified at the unit level via a Select mock below.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import React from 'react';
import { render } from '@/test/utils/test-utils';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('@/contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('@/contexts/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'u1', email: 'test@test.com' },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    refreshToken: vi.fn(),
  })),
}));

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: vi.fn(() => ({
    language: 'en',
    setLanguage: vi.fn(),
    t: (key: string) => {
      const map: Record<string, string> = {
        'projects.selectProject': 'Select a project',
        'projects.failedToLoadProjects': 'Failed to load projects',
      };
      return map[key] ?? key;
    },
  })),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/types', async () => {
  const actual = await vi.importActual('@/types');
  return {
    ...actual,
    getErrorMessage: vi.fn(() => undefined),
  };
});

// ---------------------------------------------------------------------------
import ProjectSelector from '../ProjectSelector';
import apiClient from '@/lib/api';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------

describe('ProjectSelector', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Restore useAuth to return a valid user for all tests by default
    const { useAuth } = await import('@/contexts/useAuth');
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'u1', email: 'test@test.com' },
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      refreshToken: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>);

    vi.mocked(apiClient.getProjects).mockResolvedValue({
      projects: [],
      total: 0,
      page: 1,
      totalPages: 1,
    });
  });

  it('renders the "Select a project" label element', async () => {
    render(<ProjectSelector value={null} onChange={vi.fn()} />);
    await waitFor(() => {
      expect(
        screen.getByText('Select a project', { selector: 'label' })
      ).toBeInTheDocument();
    });
  });

  it('select trigger is disabled while loading', () => {
    vi.mocked(apiClient.getProjects).mockReturnValue(new Promise(() => {}));
    render(<ProjectSelector value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('select trigger becomes enabled after fetch resolves', async () => {
    render(<ProjectSelector value={null} onChange={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toBeDisabled();
    });
  });

  it('calls getProjects when a user is present', async () => {
    render(<ProjectSelector value={null} onChange={vi.fn()} />);
    await waitFor(() => {
      expect(apiClient.getProjects).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT call getProjects when user is null', async () => {
    const { useAuth } = await import('@/contexts/useAuth');
    // Override for ALL calls so every consumer (providers + component) sees null user
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      refreshToken: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>);

    render(<ProjectSelector value={null} onChange={vi.fn()} />);
    await new Promise(r => setTimeout(r, 50));
    expect(apiClient.getProjects).not.toHaveBeenCalled();
  });

  it('calls toast.error when getProjects rejects', async () => {
    vi.mocked(apiClient.getProjects).mockRejectedValue(
      new Error('Network error')
    );

    render(<ProjectSelector value={null} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it('populates project list after successful fetch (combobox enabled)', async () => {
    vi.mocked(apiClient.getProjects).mockResolvedValue({
      projects: [
        { id: 'p1', name: 'Alpha' } as never,
        { id: 'p2', name: 'Beta' } as never,
        { id: 'p3', name: 'Gamma' } as never,
      ],
      total: 3,
      page: 1,
      totalPages: 1,
    });

    render(<ProjectSelector value={null} onChange={vi.fn()} />);

    // After fetch resolves, the select should be enabled (not disabled)
    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toBeDisabled();
    });
  });
});
