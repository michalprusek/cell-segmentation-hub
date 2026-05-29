import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import ProtectedRoute from '@/components/ProtectedRoute';
import React from 'react';

// Mock the auth hook
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/protected' }),
  };
});

const mockAuth = {
  user: null,
  loading: false,
  isAuthenticated: false,
};

vi.mock('@/contexts/useAuth', () => ({
  useAuth: () => mockAuth,
}));

vi.mock('@/contexts/exports', async () => {
  const actual = await vi.importActual('@/contexts/exports');
  return {
    ...actual,
    useAuth: () => mockAuth,
  };
});

// Mock components
const MockProtectedComponent = () => <div>Protected Content</div>;

// Helper: wait for the 200ms grace period to pass and React to re-render
// Uses waitFor which polls, so this works with real timers.
const GRACE_PERIOD_MS = 300; // slightly more than the 200ms grace period

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.user = null;
    mockAuth.loading = false;
    mockAuth.isAuthenticated = false;
    mockNavigate.mockReset();
  });

  it('should render protected content when authenticated', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: '1', email: 'test@example.com' };

    render(
      <ProtectedRoute>
        <MockProtectedComponent />
      </ProtectedRoute>
    );

    // Wait for grace period to expire
    await waitFor(
      () => expect(screen.getByText('Protected Content')).toBeInTheDocument(),
      { timeout: GRACE_PERIOD_MS }
    );
  });

  it('should show redirecting message when not authenticated', async () => {
    mockAuth.isAuthenticated = false;
    mockAuth.user = null;

    render(
      <ProtectedRoute>
        <MockProtectedComponent />
      </ProtectedRoute>
    );

    await waitFor(
      () =>
        expect(
          screen.getByText('Redirecting to sign-in...')
        ).toBeInTheDocument(),
      { timeout: GRACE_PERIOD_MS }
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/sign-in?returnTo=%2Fprotected',
        { replace: true }
      );
    });
  });

  it('should show loading state when authentication is being checked', () => {
    mockAuth.loading = true;
    mockAuth.isAuthenticated = false;

    render(
      <ProtectedRoute>
        <MockProtectedComponent />
      </ProtectedRoute>
    );

    // During loading, the spinner is shown (both loading and grace period active)
    expect(screen.getByText('Loading your account...')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('should handle grace period during initial load', () => {
    mockAuth.isAuthenticated = false;
    mockAuth.user = null;

    render(
      <ProtectedRoute>
        <MockProtectedComponent />
      </ProtectedRoute>
    );

    // During grace period (immediately after render), shows loading
    expect(screen.getByText('Loading your account...')).toBeInTheDocument();
  });

  it('should render multiple children when authenticated', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: '1', email: 'test@example.com' };

    render(
      <ProtectedRoute>
        <div>Child 1</div>
        <div>Child 2</div>
        <div>Child 3</div>
      </ProtectedRoute>
    );

    await waitFor(
      () => expect(screen.getByText('Child 1')).toBeInTheDocument(),
      { timeout: GRACE_PERIOD_MS }
    );
    expect(screen.getByText('Child 2')).toBeInTheDocument();
    expect(screen.getByText('Child 3')).toBeInTheDocument();
  });

  it('should handle user without tokens correctly', async () => {
    mockAuth.isAuthenticated = false;
    mockAuth.user = { id: '1', email: 'test@example.com' }; // User exists but not authenticated

    render(
      <ProtectedRoute>
        <MockProtectedComponent />
      </ProtectedRoute>
    );

    await waitFor(
      () =>
        expect(
          screen.getByText('Redirecting to sign-in...')
        ).toBeInTheDocument(),
      { timeout: GRACE_PERIOD_MS }
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });
  });

  it('should handle authentication state transitions', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: '1', email: 'test@example.com' };

    const { rerender } = render(
      <ProtectedRoute>
        <MockProtectedComponent />
      </ProtectedRoute>
    );

    await waitFor(
      () => expect(screen.getByText('Protected Content')).toBeInTheDocument(),
      { timeout: GRACE_PERIOD_MS }
    );

    // Simulate logout
    mockAuth.isAuthenticated = false;
    mockAuth.user = null;

    rerender(
      <ProtectedRoute>
        <MockProtectedComponent />
      </ProtectedRoute>
    );

    expect(screen.getByText('Redirecting to sign-in...')).toBeInTheDocument();
  });

  it('should properly use location pathname for redirect', async () => {
    mockAuth.isAuthenticated = false;
    mockAuth.user = null;

    render(
      <ProtectedRoute>
        <MockProtectedComponent />
      </ProtectedRoute>
    );

    await waitFor(
      () => {
        expect(mockNavigate).toHaveBeenCalledWith(
          '/sign-in?returnTo=%2Fprotected',
          { replace: true }
        );
      },
      { timeout: GRACE_PERIOD_MS }
    );
  });

  it('should handle edge case of authenticated user without user object', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = null; // Edge case: authenticated but no user object

    render(
      <ProtectedRoute>
        <MockProtectedComponent />
      </ProtectedRoute>
    );

    await waitFor(
      () =>
        expect(
          screen.getByText('Redirecting to sign-in...')
        ).toBeInTheDocument(),
      { timeout: GRACE_PERIOD_MS }
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });
  });
});
