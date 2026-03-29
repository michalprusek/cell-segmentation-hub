import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import UserProfileDropdown from '../UserProfileDropdown';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockSignOut = vi.fn().mockResolvedValue(undefined);
const mockNavigate = vi.fn();

vi.mock('@/contexts/useAuth', () => ({
  useAuth: vi.fn(() => ({
    signOut: mockSignOut,
    user: { id: 'user-1', email: 'test@example.com', username: 'testuser' },
    profile: { avatarUrl: null },
    isAuthenticated: false,
    isLoading: false,
  })),
}));

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: vi.fn(() => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common.profile': 'Profile',
        'common.settings': 'Settings',
        'common.dashboard': 'Dashboard',
        'common.logOut': 'Log out',
        'auth.successfulSignOut': 'Signed out',
      };
      return map[key] ?? key;
    },
    language: 'en',
  })),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const renderDropdown = (props = {}) =>
  rtlRender(
    <MemoryRouter>
      <UserProfileDropdown username="testuser" {...props} />
    </MemoryRouter>
  );

describe('UserProfileDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue(undefined);
  });

  it('renders the username in the trigger button', () => {
    renderDropdown();
    expect(screen.getByText('testuser')).toBeInTheDocument();
  });

  it('renders the trigger button', () => {
    renderDropdown();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('opens dropdown menu when trigger is clicked', async () => {
    const user = userEvent.setup();
    renderDropdown();
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('menuitem', { name: /log out/i })).toBeInTheDocument();
  });

  it('shows settings menu item', async () => {
    const user = userEvent.setup();
    renderDropdown();
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('menuitem', { name: /settings/i })).toBeInTheDocument();
  });

  it('shows dashboard menu item', async () => {
    const user = userEvent.setup();
    renderDropdown();
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('menuitem', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('navigates to /settings when settings is clicked', async () => {
    const user = userEvent.setup();
    renderDropdown();
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('menuitem', { name: /settings/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/settings');
  });

  it('navigates to /dashboard when dashboard is clicked', async () => {
    const user = userEvent.setup();
    renderDropdown();
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('menuitem', { name: /dashboard/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('calls signOut when log out is clicked', async () => {
    const user = userEvent.setup();
    renderDropdown();
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('menuitem', { name: /log out/i }));
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
    });
  });

  it('renders avatar image when avatarUrl is provided', async () => {
    const { useAuth } = await import('@/contexts/useAuth');
    vi.mocked(useAuth).mockReturnValueOnce({
      signOut: mockSignOut,
      user: { id: 'user-1', email: 'test@example.com', username: 'testuser' },
      profile: { avatarUrl: 'https://example.com/avatar.jpg' },
      isAuthenticated: false,
      isLoading: false,
    } as any);

    renderDropdown();
    const avatarImg = screen.getByRole('img');
    expect(avatarImg).toHaveAttribute('src', 'https://example.com/avatar.jpg');
    expect(avatarImg).toHaveAttribute('alt', 'testuser');
  });
});
