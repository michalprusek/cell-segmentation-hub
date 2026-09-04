/**
 * The impersonation banner.
 *
 * Two claims worth testing, both of which a shallow "it renders" test would
 * miss: the bar must name BOTH people (the account being viewed and the admin
 * really signed in — naming only one is how an operator forgets which they
 * are), and returning must be a full page load, because the new auth cookies
 * belong to a different account than every cache and context still holds.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ImpersonationBanner from '@/components/admin/ImpersonationBanner';

const mockAuth: {
  user: { id: string; email: string } | null;
  impersonatedBy: { id: string; email: string } | null;
} = { user: null, impersonatedBy: null };

vi.mock('@/contexts/exports', () => ({
  useAuth: () => mockAuth,
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/api', () => ({
  default: { stopImpersonation: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

import apiClient from '@/lib/api';

describe('ImpersonationBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.user = { id: 'u1', email: 'user@example.com' };
    mockAuth.impersonatedBy = null;
    vi.mocked(window.location.assign).mockClear();
  });

  it('renders nothing at all for an ordinary session', () => {
    const { container } = render(<ImpersonationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names BOTH the viewed account and the real actor', () => {
    mockAuth.impersonatedBy = { id: 'a1', email: 'admin@admin.com' };
    render(<ImpersonationBanner />);

    const banner = screen.getByTestId('impersonation-banner');
    expect(banner).toHaveTextContent('user@example.com');
    expect(banner).toHaveTextContent('admin@admin.com');
  });

  it('is announced as an alert', () => {
    mockAuth.impersonatedBy = { id: 'a1', email: 'admin@admin.com' };
    render(<ImpersonationBanner />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('returns to the user list with a FULL page load, not a soft navigation', async () => {
    mockAuth.impersonatedBy = { id: 'a1', email: 'admin@admin.com' };
    vi.mocked(apiClient.stopImpersonation).mockResolvedValue({
      user: { id: 'a1', email: 'admin@admin.com' },
    } as never);

    render(<ImpersonationBanner />);
    await userEvent.click(
      screen.getByRole('button', { name: /returnToUserList/i })
    );

    await waitFor(() => expect(apiClient.stopImpersonation).toHaveBeenCalled());
    // A react-router navigate would leave the React Query cache, the
    // WebSocket subscription and every context holding the impersonated
    // user's data under the admin's name.
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith('/admin/users')
    );
  });

  it('keeps the banner up and reports the failure when the stop call fails', async () => {
    mockAuth.impersonatedBy = { id: 'a1', email: 'admin@admin.com' };
    vi.mocked(apiClient.stopImpersonation).mockRejectedValue(new Error('boom'));

    render(<ImpersonationBanner />);
    const button = screen.getByRole('button', { name: /returnToUserList/i });
    await userEvent.click(button);

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    // Navigating away on a failed stop would strand the admin in the user's
    // account with no banner.
    expect(window.location.assign).not.toHaveBeenCalled();
    expect(screen.getByTestId('impersonation-banner')).toBeInTheDocument();
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('does not fire a second stop while one is in flight', async () => {
    mockAuth.impersonatedBy = { id: 'a1', email: 'admin@admin.com' };
    let resolveStop: (v: unknown) => void = () => {};
    vi.mocked(apiClient.stopImpersonation).mockReturnValue(
      new Promise(res => {
        resolveStop = res;
      }) as never
    );

    render(<ImpersonationBanner />);
    const button = screen.getByRole('button', { name: /returnToUserList/i });
    await userEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    await userEvent.click(button);

    expect(apiClient.stopImpersonation).toHaveBeenCalledTimes(1);
    resolveStop({ user: { id: 'a1', email: 'admin@admin.com' } });
  });
});
