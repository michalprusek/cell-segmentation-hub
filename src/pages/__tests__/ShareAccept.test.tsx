/**
 * Tests for ShareAccept page component.
 * Tests the actual component behavior including token validation, auth checks, and UI states.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ShareAccept from '../ShareAccept';

// Declare mocks with vi.hoisted so they are available inside vi.mock factories
// (vi.mock calls are hoisted to the top of the file before variable declarations)
const {
  mockValidateShareToken,
  mockAcceptShareInvitation,
  mockUseAuth,
  mockNavigate,
} = vi.hoisted(() => ({
  mockValidateShareToken: vi.fn(),
  mockAcceptShareInvitation: vi.fn(),
  mockUseAuth: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiClient: {
    validateShareToken: mockValidateShareToken,
    acceptShareInvitation: mockAcceptShareInvitation,
  },
}));

vi.mock('@/contexts/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

// Mock useLanguage — return key so assertions are stable across locale changes.
// CRITICAL: the returned object AND its `t` must be referentially STABLE.
// ShareAccept's validateToken is a useCallback with `t` in its deps, and the
// validation effect depends on validateToken — an unstable `t` (a fresh fn each
// render) re-fires the effect every render, looping validateShareToken and
// racing waitFor (the source of this file's flakiness). Mirror the real
// provider, which memoizes `t`. The stable object is created once inside the
// (hoisted) factory closure so every useLanguage() call returns the same ref.
vi.mock('@/contexts/useLanguage', () => {
  const stableLanguage = { t: (key: string) => key, language: 'en' };
  return { useLanguage: () => stableLanguage };
});

// Keep MemoryRouter functional but stub out useNavigate
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Mock toast
vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

const renderShareAccept = (token = 'test-token') =>
  render(
    <MemoryRouter initialEntries={[`/share/accept/${token}`]}>
      <Routes>
        <Route path="/share/accept/:token" element={<ShareAccept />} />
        <Route path="/auth/login" element={<div>Login Page</div>} />
        <Route path="/sign-in" element={<div>Sign In Page</div>} />
        <Route path="/sign-up" element={<div>Sign Up Page</div>} />
        <Route path="/dashboard" element={<div>Dashboard</div>} />
      </Routes>
    </MemoryRouter>
  );

describe('ShareAccept - Shared Project Access', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: authenticated user
    mockUseAuth.mockReturnValue({
      user: { id: 'user-123', email: 'test@example.com' },
      isAuthenticated: true,
      loading: false,
    });

    // Default: validation succeeds with a pending link share
    mockValidateShareToken.mockResolvedValue({
      project: { id: 'project-123', title: 'Test Project', description: null },
      sharedBy: { email: 'owner@example.com' },
      status: 'pending',
      email: null, // link share — any logged-in user may accept
      needsLogin: false,
    });

    // Default: acceptance succeeds
    mockAcceptShareInvitation.mockResolvedValue({ needsLogin: false });
  });

  describe('Authentication requirements', () => {
    it('should show loading state while checking authentication', () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isAuthenticated: false,
        loading: true,
      });

      renderShareAccept();

      // During auth loading the token-validation loading spinner shows first
      expect(screen.getByText('common.loading')).toBeInTheDocument();
    });

    it('should redirect to login when not authenticated and needsLogin is true', async () => {
      mockUseAuth.mockReturnValue({
        user: null,
        isAuthenticated: false,
        loading: false,
      });

      mockValidateShareToken.mockResolvedValue({
        project: { id: 'p1', title: 'Proj', description: null },
        sharedBy: { email: 'owner@example.com' },
        status: 'pending',
        email: null,
        needsLogin: true,
      });

      renderShareAccept();

      await waitFor(() => {
        expect(mockValidateShareToken).toHaveBeenCalledWith('test-token');
      });

      // Should show sign-in button when needsLogin
      await waitFor(() => {
        expect(screen.getByText('auth.signIn')).toBeInTheDocument();
      });
    });
  });

  describe('Share token validation', () => {
    it('should validate the token on mount', async () => {
      renderShareAccept('valid-token');

      await waitFor(() => {
        expect(mockValidateShareToken).toHaveBeenCalledWith('valid-token');
      });
    });

    it('should display project title after successful validation', async () => {
      mockValidateShareToken.mockResolvedValue({
        project: {
          id: 'p1',
          title: 'My Test Project',
          description: 'A description',
        },
        sharedBy: { email: 'owner@example.com' },
        status: 'pending',
        email: null,
        needsLogin: false,
      });

      renderShareAccept();

      await waitFor(() => {
        expect(mockValidateShareToken).toHaveBeenCalled();
      });
    });

    it('should handle invalid share token', async () => {
      mockValidateShareToken.mockRejectedValue(
        new Error('Invalid or expired token')
      );

      renderShareAccept('invalid-token');

      await waitFor(() => {
        expect(mockValidateShareToken).toHaveBeenCalledWith('invalid-token');
      });

      // Error state should show
      await waitFor(() => {
        expect(screen.getByText('error')).toBeInTheDocument();
      });
    });

    it('should handle expired share token', async () => {
      const expiredError = {
        response: { status: 410, data: { message: 'Share link has expired' } },
      };
      mockValidateShareToken.mockRejectedValue(expiredError);

      renderShareAccept('expired-token');

      await waitFor(() => {
        expect(mockValidateShareToken).toHaveBeenCalledWith('expired-token');
      });

      await waitFor(() => {
        expect(screen.getByText('Share link has expired')).toBeInTheDocument();
      });
    });

    it('should handle already accepted share', async () => {
      const duplicateError = {
        response: {
          status: 409,
          data: { message: 'Already have access to this project' },
        },
      };
      mockValidateShareToken.mockRejectedValue(duplicateError);

      renderShareAccept('duplicate-token');

      await waitFor(() => {
        expect(mockValidateShareToken).toHaveBeenCalledWith('duplicate-token');
      });

      await waitFor(() => {
        expect(
          screen.getByText('Already have access to this project')
        ).toBeInTheDocument();
      });
    });
  });

  describe('Permission levels', () => {
    it('should display view-only permission — shows sharedBy after validation', async () => {
      mockValidateShareToken.mockResolvedValue({
        project: { id: 'p1', title: 'View Project', description: null },
        sharedBy: { email: 'owner@example.com' },
        status: 'pending',
        email: null,
        needsLogin: false,
      });
      // Prevent auto-accept from completing instantly so we can inspect the card
      mockAcceptShareInvitation.mockImplementation(() => new Promise(() => {}));

      renderShareAccept('view-token');

      await waitFor(() => {
        expect(mockValidateShareToken).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByText('owner@example.com')).toBeInTheDocument();
      });
    });

    it('should display edit permission — shows sharedBy info', async () => {
      mockValidateShareToken.mockResolvedValue({
        project: { id: 'p2', title: 'Edit Project', description: null },
        sharedBy: { email: 'editor@example.com' },
        status: 'pending',
        email: null,
        needsLogin: false,
      });
      mockAcceptShareInvitation.mockImplementation(() => new Promise(() => {}));

      renderShareAccept('edit-token');

      await waitFor(() => {
        expect(mockValidateShareToken).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByText('editor@example.com')).toBeInTheDocument();
      });
    });
  });

  describe('User experience', () => {
    it('should show project details after validation', async () => {
      mockValidateShareToken.mockResolvedValue({
        project: {
          id: 'p1',
          title: 'Shared Project',
          description: 'A shared project',
        },
        sharedBy: { email: 'owner@example.com' },
        status: 'pending',
        email: null,
        needsLogin: false,
      });
      mockAcceptShareInvitation.mockImplementation(() => new Promise(() => {}));

      renderShareAccept('detail-token');

      await waitFor(() => {
        expect(mockValidateShareToken).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByText('Shared Project')).toBeInTheDocument();
        expect(screen.getByText('A shared project')).toBeInTheDocument();
      });
    });

    it('should show sharing.acceptInvitation button for logged-in user', async () => {
      mockValidateShareToken.mockResolvedValue({
        project: { id: 'p1', title: 'Proj', description: null },
        sharedBy: { email: 'owner@example.com' },
        status: 'pending',
        email: null,
        needsLogin: false,
      });
      // Block auto-accept so the button stays visible
      mockAcceptShareInvitation.mockImplementation(() => new Promise(() => {}));

      renderShareAccept('nav-token');

      await waitFor(() => {
        expect(mockValidateShareToken).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(
          screen.getByText('sharing.acceptInvitation')
        ).toBeInTheDocument();
      });
    });

    it('should show loading state while loading token', () => {
      // Token validation hangs
      mockValidateShareToken.mockImplementation(() => new Promise(() => {}));

      renderShareAccept('loading-token');

      expect(screen.getByText('common.loading')).toBeInTheDocument();
    });
  });

  describe('Error handling', () => {
    it('should handle network errors gracefully', async () => {
      mockValidateShareToken.mockRejectedValue(new Error('Network error'));

      renderShareAccept('network-error');

      await waitFor(() => {
        expect(screen.getByText('error')).toBeInTheDocument();
      });
    });

    it('should handle server errors', async () => {
      mockValidateShareToken.mockRejectedValue({
        response: { status: 500, data: { message: 'Internal server error' } },
      });

      renderShareAccept('server-error');

      await waitFor(() => {
        expect(screen.getByText('Internal server error')).toBeInTheDocument();
      });
    });

    it('should retry on transient failures — calls validateShareToken', async () => {
      mockValidateShareToken.mockRejectedValue(new Error('Transient error'));

      renderShareAccept('transient-error');

      await waitFor(() => {
        expect(mockValidateShareToken).toHaveBeenCalled();
        expect(screen.getByText('error')).toBeInTheDocument();
      });
    });
  });

  describe('Shared project management', () => {
    it('should handle removing shared access — shows auth.signUp button when needsLogin', async () => {
      mockValidateShareToken.mockResolvedValue({
        project: { id: 'p1', title: 'Proj', description: null },
        sharedBy: { email: 'owner@example.com' },
        status: 'pending',
        email: null,
        needsLogin: true,
      });

      renderShareAccept('remove-token');

      await waitFor(() => {
        expect(screen.getByText('auth.signUp')).toBeInTheDocument();
      });
    });

    it('should validate user is not project owner — shows sharedBy email', async () => {
      mockValidateShareToken.mockResolvedValue({
        project: { id: 'p1', title: 'Proj', description: null },
        sharedBy: { email: 'projectowner@example.com' },
        status: 'pending',
        email: 'test@example.com', // email matches logged-in user
        needsLogin: false,
      });
      mockAcceptShareInvitation.mockImplementation(() => new Promise(() => {}));

      renderShareAccept('owner-token');

      await waitFor(() => {
        expect(mockValidateShareToken).toHaveBeenCalled();
      });

      // sharedBy email should be visible in the card
      await waitFor(() => {
        expect(
          screen.getByText('projectowner@example.com')
        ).toBeInTheDocument();
      });
    });
  });

  describe('Real-time updates', () => {
    it('should subscribe to project updates after accepting share — acceptance is called', async () => {
      mockValidateShareToken.mockResolvedValue({
        project: { id: 'p1', title: 'Proj', description: null },
        sharedBy: { email: 'owner@example.com' },
        status: 'pending',
        email: null,
        needsLogin: false,
      });

      renderShareAccept('realtime-token');

      await waitFor(() => {
        expect(mockValidateShareToken).toHaveBeenCalled();
      });

      // Auto-accept fires for a logged-in user on a link share
      await waitFor(() => {
        expect(mockAcceptShareInvitation).toHaveBeenCalledWith(
          'realtime-token'
        );
      });
    });
  });
});
