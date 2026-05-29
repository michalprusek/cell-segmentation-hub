/**
 * Behavioral unit tests for MobileMenu.
 *
 * Strategy: render with isMenuOpen=true so the Sheet content is in the DOM
 * (Radix Sheet only renders content when open).
 *
 * Tested behaviours:
 *  1.  SpheroSeg brand name renders inside the open sheet.
 *  2.  Profile nav item renders.
 *  3.  Settings nav item renders.
 *  4.  Dashboard nav item renders.
 *  5.  Notifications nav item renders.
 *  6.  Log out button renders.
 *  7.  Notification dot is shown when hasNotifications=true.
 *  8.  Notification dot is absent when hasNotifications=false.
 *  9.  Clicking Profile navigates to /profile and calls setIsMenuOpen(false).
 *  10. Clicking Settings navigates to /settings and calls setIsMenuOpen(false).
 *  11. Clicking Dashboard navigates to /dashboard and calls setIsMenuOpen(false).
 *  12. Clicking Notifications navigates to /settings?tab=notifications and calls setIsMenuOpen(false).
 *  13. Clicking Log out calls signOut() and on success calls toast.success.
 *  14. The X button calls setIsMenuOpen(false).
 *
 * Skipped:
 *  - Sheet open/close animation (JSDOM + Radix does not animate).
 *  - signOut error path: logger.error is called but there is no visible DOM
 *    change to assert against; it is the catch-only case.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import MobileMenu from '../MobileMenu';

// ── mocks ────────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockSignOut = vi.fn();
vi.mock('@/contexts/useAuth', () => ({
  useAuth: () => ({ signOut: mockSignOut }),
}));

const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: vi.fn(),
  },
}));

// ── helpers ──────────────────────────────────────────────────────────────────

function setup(
  overrides: Partial<{
    isMenuOpen: boolean;
    setIsMenuOpen: (v: boolean) => void;
    hasNotifications: boolean;
  }> = {}
) {
  const props = {
    isMenuOpen: true,
    setIsMenuOpen: vi.fn(),
    hasNotifications: false,
    ...overrides,
  };
  const result = render(<MobileMenu {...props} />);
  return { ...result, props };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('MobileMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue(undefined);
  });

  // 1
  it('renders SpheroSeg brand name when open', () => {
    setup();
    expect(screen.getByText('SpheroSeg')).toBeInTheDocument();
  });

  // 2
  it('renders Profile nav item', () => {
    setup();
    expect(screen.getByText('Profile')).toBeInTheDocument();
  });

  // 3
  it('renders Settings nav item', () => {
    setup();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  // 4
  it('renders Dashboard nav item', () => {
    setup();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  // 5
  it('renders Notifications nav item', () => {
    setup();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  // 6
  it('renders Log out button', () => {
    setup();
    expect(screen.getByText('Log out')).toBeInTheDocument();
  });

  // 7
  it('shows notification dot when hasNotifications=true', () => {
    setup({ hasNotifications: true });
    // Sheet content renders in a Radix portal appended to document.body
    const dot = document.body.querySelector('.bg-red-500');
    expect(dot).toBeInTheDocument();
  });

  // 8
  it('hides notification dot when hasNotifications=false', () => {
    setup({ hasNotifications: false });
    expect(document.body.querySelector('.bg-red-500')).not.toBeInTheDocument();
  });

  // 9
  it('Profile button navigates to /profile and closes menu', async () => {
    const setIsMenuOpen = vi.fn();
    setup({ setIsMenuOpen });
    await userEvent.click(screen.getByText('Profile'));
    expect(setIsMenuOpen).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith('/profile');
  });

  // 10
  it('Settings button navigates to /settings and closes menu', async () => {
    const setIsMenuOpen = vi.fn();
    setup({ setIsMenuOpen });
    await userEvent.click(screen.getByText('Settings'));
    expect(setIsMenuOpen).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith('/settings');
  });

  // 11
  it('Dashboard button navigates to /dashboard and closes menu', async () => {
    const setIsMenuOpen = vi.fn();
    setup({ setIsMenuOpen });
    await userEvent.click(screen.getByText('Dashboard'));
    expect(setIsMenuOpen).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });

  // 12
  it('Notifications button navigates to /settings?tab=notifications and closes menu', async () => {
    const setIsMenuOpen = vi.fn();
    setup({ setIsMenuOpen });
    await userEvent.click(screen.getByText('Notifications'));
    expect(setIsMenuOpen).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith('/settings?tab=notifications');
  });

  // 13
  it('Log out calls signOut and on success calls toast.success', async () => {
    setup();
    await userEvent.click(screen.getByText('Log out'));
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    });
  });

  // 14
  it('X close button calls setIsMenuOpen(false)', async () => {
    const setIsMenuOpen = vi.fn();
    setup({ setIsMenuOpen });
    // The X close button inside the sheet header area has no accessible name;
    // find the ghost icon button inside the sheet content (portal in document.body).
    // It is the direct sibling of the "SpheroSeg" brand div inside the sheet.
    const allButtons = screen.getAllByRole('button');
    // Filter to buttons that contain an svg (icon buttons only)
    const iconButtons = allButtons.filter(btn => btn.querySelector('svg'));
    // The close "X" button is the last icon-only button before the nav items
    // It's the one that calls setIsMenuOpen(false) — clicking any of them closes
    // the sheet except the Log out button (which navigates).
    // We identify it by being inside the sheet's top bar (the brand header area).
    // Click the one with `onClick={() => setIsMenuOpen(false)}` directly.
    // Since there are multiple icon buttons, click the one containing the X svg.
    // The X icon button is distinct because its parent is the brand header flex row.
    const xIconButton = iconButtons.find(btn => {
      // The X button has a sibling span with 'SpheroSeg' text in its parent flex row
      return btn
        .closest('div')
        ?.parentElement?.textContent?.includes('SpheroSeg');
    });
    expect(xIconButton).toBeDefined();
    await userEvent.click(xIconButton!);
    expect(setIsMenuOpen).toHaveBeenCalledWith(false);
  });
});
