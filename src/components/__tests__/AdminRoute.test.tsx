/**
 * `AdminRoute` — the UI gate on /admin/*.
 *
 * It is not a security boundary (every endpoint behind it re-checks the flag
 * server-side), so what is worth testing is the part that IS load-bearing for
 * a human: it must not flash "not authorised" at a real admin while the
 * profile — which is where `isAdmin` lives — is still in flight. That flash
 * is indistinguishable from the flag never having been granted, which is
 * exactly the question the maintainer would be on this page to answer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import AdminRoute from '@/components/AdminRoute';

const mockAuth: {
  user: { id: string; email: string } | null;
  profile: { isAdmin?: boolean } | null;
  loading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
} = {
  user: { id: 'a1', email: 'admin@admin.com' },
  profile: { isAdmin: true },
  loading: false,
  isAuthenticated: true,
  isAdmin: true,
};

vi.mock('@/contexts/exports', () => ({
  useAuth: () => mockAuth,
  useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/admin/users' }),
  };
});

const Guarded = () => <div>Admin content</div>;

// The refusal panel links back to the dashboard, so the subtree needs a
// router even though the route itself is mocked out.
const renderGate = () =>
  render(
    <MemoryRouter>
      <AdminRoute>
        <Guarded />
      </AdminRoute>
    </MemoryRouter>
  );

// ProtectedRoute's 200 ms grace period sits in front of everything here.
const GRACE = 1500;

describe('AdminRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.user = { id: 'a1', email: 'admin@admin.com' };
    mockAuth.profile = { isAdmin: true };
    mockAuth.loading = false;
    mockAuth.isAuthenticated = true;
    mockAuth.isAdmin = true;
  });

  it('renders the page for an admin', async () => {
    renderGate();

    await waitFor(
      () => expect(screen.getByText('Admin content')).toBeInTheDocument(),
      { timeout: GRACE }
    );
  });

  it('refuses a non-admin with an explicit message, not a silent redirect', async () => {
    mockAuth.isAdmin = false;
    mockAuth.profile = { isAdmin: false };

    renderGate();

    await waitFor(
      () =>
        expect(
          screen.getByText('admin.notAuthorizedTitle')
        ).toBeInTheDocument(),
      { timeout: GRACE }
    );
    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
  });

  it('waits for the profile rather than flashing "not authorised" at a real admin', async () => {
    // `isAdmin` is derived from the profile, which arrives one request after
    // the user does — so mid-flight the context reports a signed-in
    // non-admin. Rendering the refusal here would look exactly like the flag
    // never having been granted.
    mockAuth.profile = null;
    mockAuth.isAdmin = false;

    renderGate();

    await new Promise(resolve => setTimeout(resolve, 400));
    expect(
      screen.queryByText('admin.notAuthorizedTitle')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
  });
});
