import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen } from '@testing-library/react';
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

/**
 * ProtectedRoute.tsx holds a deliberate 200ms `gracePeriod` timer before it
 * will render children or redirect. Every test below has to get past it.
 *
 * This used to be done with `waitFor(..., { timeout: 300 })` — a wall-clock
 * budget of 300ms against a component that is not allowed to answer for 200ms,
 * leaving ~100ms of headroom for a full render. On a loaded box that lost:
 * measured 4 failures in 5 runs on a clean tree.
 *
 * That is NOT a threshold to widen. Raising 300 to 1000 would leave a second
 * hard-coded number to drift out of sync with `gracePeriod`, and would still be
 * a coin flip under enough load. Use fake timers and step over the grace period
 * deterministically instead: the test then does not depend on wall-clock at all.
 */
const GRACE_PERIOD_MS = 200; // MUST match the setTimeout in ProtectedRoute.tsx

/**
 * Advance past the grace period and flush the resulting React work.
 *
 * The first act() is load-bearing and easy to get wrong: React 18 runs passive
 * effects asynchronously, so at the moment `render()` returns, the grace-period
 * setTimeout does NOT exist yet (verified with vi.getTimerCount() — it reports
 * 0 before this flush and 1 after). Advancing the clock first would therefore
 * advance past nothing, and the component would sit in its loading state
 * forever. Flush effects, THEN advance, THEN flush the resulting re-render.
 */
const advancePastGracePeriod = async () => {
  // 1. let mount effects run, so the grace-period timer is actually scheduled
  await act(async () => {});
  // 2. step over it deterministically — no wall clock involved
  await act(async () => {
    await vi.advanceTimersByTimeAsync(GRACE_PERIOD_MS);
  });
};

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.clearAllMocks();
    mockAuth.user = null;
    mockAuth.loading = false;
    mockAuth.isAuthenticated = false;
    mockNavigate.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    await advancePastGracePeriod();
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('should show redirecting message when not authenticated', async () => {
    mockAuth.isAuthenticated = false;
    mockAuth.user = null;

    render(
      <ProtectedRoute>
        <MockProtectedComponent />
      </ProtectedRoute>
    );

    await advancePastGracePeriod();
    expect(screen.getByText('Redirecting to sign-in...')).toBeInTheDocument();

    expect(mockNavigate).toHaveBeenCalledWith(
      '/sign-in?returnTo=%2Fprotected',
      {
        replace: true,
      }
    );
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

    await advancePastGracePeriod();
    expect(screen.getByText('Child 1')).toBeInTheDocument();
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

    await advancePastGracePeriod();
    expect(screen.getByText('Redirecting to sign-in...')).toBeInTheDocument();

    expect(mockNavigate).toHaveBeenCalled();
  });

  it('should handle authentication state transitions', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: '1', email: 'test@example.com' };

    const { rerender } = render(
      <ProtectedRoute>
        <MockProtectedComponent />
      </ProtectedRoute>
    );

    await advancePastGracePeriod();
    expect(screen.getByText('Protected Content')).toBeInTheDocument();

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

    await advancePastGracePeriod();
    expect(mockNavigate).toHaveBeenCalledWith(
      '/sign-in?returnTo=%2Fprotected',
      {
        replace: true,
      }
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

    await advancePastGracePeriod();
    expect(screen.getByText('Redirecting to sign-in...')).toBeInTheDocument();

    expect(mockNavigate).toHaveBeenCalled();
  });
});
