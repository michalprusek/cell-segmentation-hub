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

vi.mock('@/contexts/AuthContext', async () => {
  const actual = await vi.importActual('@/contexts/AuthContext');
  return {
    ...actual,
    useAuth: () => mockAuth,
  };
});

// Mock components
const MockProtectedComponent = () => <div>Protected Content</div>;

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.user = null;
    mockAuth.loading = false;
    mockAuth.isAuthenticated = false;
    mockNavigate.mockReset();
  });

  it('should render protected content when authenticated', () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: '1', email: 'test@example.com' };

    render(
      <ProtectedRoute>
        <MockProtectedComponent />
      </ProtectedRoute>
    );

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

    expect(screen.getByText('Redirecting to sign-in...')).toBeInTheDocument();

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

    // During grace period, should show loading
    expect(screen.getByText('Loading your account...')).toBeInTheDocument();
  });

  it('should render multiple children when authenticated', () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: '1', email: 'test@example.com' };

    render(
      <ProtectedRoute>
        <div>Child 1</div>
        <div>Child 2</div>
        <div>Child 3</div>
      </ProtectedRoute>
    );

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

    expect(screen.getByText('Redirecting to sign-in...')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });
  });

  it('should handle authentication state transitions', () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: '1', email: 'test@example.com' };

    const { rerender } = render(
      <ProtectedRoute>
        <MockProtectedComponent />
      </ProtectedRoute>
    );

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

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/sign-in?returnTo=%2Fprotected',
        { replace: true }
      );
    });
  });

  it('should handle edge case of authenticated user without user object', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = null; // Edge case: authenticated but no user object

    render(
      <ProtectedRoute>
        <MockProtectedComponent />
      </ProtectedRoute>
    );

    expect(screen.getByText('Redirecting to sign-in...')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });
  });
});
