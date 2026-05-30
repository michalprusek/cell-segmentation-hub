import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { useAuth } from '@/contexts/exports';
import apiClient from '@/lib/api';
import React, { ReactNode } from 'react';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock the apiClient to match the actual interface. Note: the client no
// longer exposes isAuthenticated()/getAccessToken() — auth lives in httpOnly
// cookies and the only client-visible signal is the /auth/profile response.
vi.mock('@/lib/api', () => ({
  default: {
    getUserProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUserProfile: vi.fn(),
    deleteAccount: vi.fn(),
  },
  apiClient: {
    getUserProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUserProfile: vi.fn(),
    deleteAccount: vi.fn(),
  },
}));

// Mock authEventEmitter
vi.mock('@/lib/authEvents', () => ({
  authEventEmitter: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

// Mock tokenRefreshManager
vi.mock('@/lib/tokenRefresh', () => ({
  tokenRefreshManager: {
    startTokenRefreshManager: vi.fn(),
    stopTokenRefreshManager: vi.fn(),
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AuthContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <AuthProvider>{children}</AuthProvider>
    </MemoryRouter>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    // The init probe only runs when the non-secret `authenticated` hint cookie
    // is present. Set it so these tests exercise the probe path; the default
    // profile mock rejects, so the result is still the unauthenticated state
    // unless a test overrides getUserProfile.
    document.cookie = 'authenticated=1';
    vi.mocked(apiClient.getUserProfile).mockRejectedValue(
      new Error('Not authenticated')
    );
    vi.mocked(apiClient.login).mockReset();
    vi.mocked(apiClient.logout).mockReset();
    vi.mocked(apiClient.register).mockReset();
    vi.mocked(apiClient.deleteAccount).mockReset();
    vi.mocked(apiClient.updateUserProfile).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should initialize with unauthenticated state', async () => {
      // Default beforeEach makes the /auth/profile probe reject → signed out.
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });

    it('skips the /auth/profile probe entirely on a logged-out cold load (no hint cookie)', async () => {
      // No `authenticated` hint cookie → a fresh visitor makes ZERO auth
      // requests (avoids the guaranteed 401 + console error).
      document.cookie = 'authenticated=; expires=Thu, 01 Jan 1970 00:00:00 GMT';

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(vi.mocked(apiClient.getUserProfile)).not.toHaveBeenCalled();
    });

    it('should restore the session from the /auth/profile probe on mount', async () => {
      const mockProfile = {
        id: '1',
        email: 'test@example.com',
        user: {
          id: '1',
          email: 'test@example.com',
          emailVerified: true,
          username: undefined,
        },
      };

      // A valid cookie → /auth/profile resolves → session restored.
      vi.mocked(apiClient.getUserProfile).mockResolvedValueOnce(mockProfile);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // The init probe is the suppress-errors variant (silent on 401).
      expect(vi.mocked(apiClient.getUserProfile)).toHaveBeenCalledWith({
        suppressAuthErrors: true,
      });
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).toEqual(mockProfile.user);
    });

    it('should render signed-out when the /auth/profile probe fails on mount', async () => {
      vi.mocked(apiClient.getUserProfile).mockRejectedValueOnce(
        new Error('Unauthorized')
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });
  });

  describe('signIn', () => {
    it('should sign in successfully', async () => {
      const email = 'test@example.com';
      const password = 'password';
      const mockResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: '1', email: 'test@example.com', username: 'test' },
      };

      vi.mocked(apiClient.login).mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Wait for initial load to complete
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.signIn(email, password);
      });

      // Check that the signIn was called correctly
      expect(vi.mocked(apiClient.login)).toHaveBeenCalledWith(
        email,
        password,
        true
      );

      // Check that user state was updated (no client-side token any more)
      expect(result.current.user).toEqual(mockResponse.user);

      // isAuthenticated is derived from the user state.
      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });
    });

    it('should handle sign in failure', async () => {
      const email = 'test@example.com';
      const password = 'wrong';
      const error = new Error('Invalid credentials');

      vi.mocked(apiClient.login).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Wait for initial load to complete
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.signIn(email, password);
        })
      ).rejects.toThrow('Invalid credentials');

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });

    it('should handle network error during sign in', async () => {
      const email = 'test@example.com';
      const password = 'password';
      const error = new Error('Network error');

      vi.mocked(apiClient.login).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Wait for initial load to complete
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.signIn(email, password);
        })
      ).rejects.toThrow('Network error');

      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('signOut', () => {
    it('should sign out successfully', async () => {
      // Setup authenticated state first by mocking successful sign in
      const mockResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: '1', email: 'test@example.com', username: 'test' },
      };

      vi.mocked(apiClient.login).mockResolvedValueOnce(mockResponse);
      vi.mocked(apiClient.logout).mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // First sign in
      await act(async () => {
        await result.current.signIn('test@example.com', 'password');
      });

      // Wait for authentication state to update
      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      // Then sign out
      await act(async () => {
        await result.current.signOut();
      });

      expect(vi.mocked(apiClient.logout)).toHaveBeenCalled();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });

    it('should handle sign out error gracefully', async () => {
      // Setup authenticated state first
      const mockResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: '1', email: 'test@example.com', username: 'test' },
      };

      vi.mocked(apiClient.login).mockResolvedValueOnce(mockResponse);
      vi.mocked(apiClient.logout).mockRejectedValueOnce(
        new Error('Network error')
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // First sign in
      await act(async () => {
        await result.current.signIn('test@example.com', 'password');
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      // Then try to sign out with error
      await act(async () => {
        await result.current.signOut();
      });

      // Should still clear local state even if the API call fails.
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });
  });

  describe('signUp', () => {
    it('should sign up successfully', async () => {
      const email = 'new@example.com';
      const password = 'password';
      const username = 'newuser';
      const consentOptions = {
        consentToMLTraining: true,
        consentToAlgorithmImprovement: false,
      };
      const mockResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: '2', email, username },
      };

      vi.mocked(apiClient.register).mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.signUp(email, password, consentOptions, username);
      });

      expect(vi.mocked(apiClient.register)).toHaveBeenCalledWith(
        email,
        password,
        username,
        consentOptions
      );
      expect(result.current.user).toEqual(mockResponse.user);

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });
    });

    it('should handle registration failure', async () => {
      const email = 'existing@example.com';
      const password = 'password';
      const error = new Error('Email already exists');

      vi.mocked(apiClient.register).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.signUp(email, password);
        })
      ).rejects.toThrow('Email already exists');

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });

    it('should handle validation errors during registration', async () => {
      const email = 'invalid-email';
      const password = '123'; // Too short
      const error = new Error('Validation failed');

      vi.mocked(apiClient.register).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.signUp(email, password);
        })
      ).rejects.toThrow('Validation failed');

      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('deleteAccount', () => {
    it('should delete account successfully with proper confirmation', async () => {
      // Setup authenticated state first
      const mockResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: '1', email: 'test@example.com', username: 'test' },
      };

      vi.mocked(apiClient.login).mockResolvedValueOnce(mockResponse);
      vi.mocked(apiClient.deleteAccount).mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // First sign in
      await act(async () => {
        await result.current.signIn('test@example.com', 'password');
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      // Then delete account
      await act(async () => {
        await result.current.deleteAccount('test@example.com');
      });

      expect(vi.mocked(apiClient.deleteAccount)).toHaveBeenCalled();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });

    it('should require confirmation text to match email', async () => {
      // Setup authenticated state
      const mockResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: '1', email: 'test@example.com', username: 'test' },
      };

      vi.mocked(apiClient.login).mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(() => useAuth(), { wrapper });

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // First sign in
      await act(async () => {
        await result.current.signIn('test@example.com', 'password');
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      // Try to delete with wrong confirmation
      await expect(
        act(async () => {
          await result.current.deleteAccount('wrong-email');
        })
      ).rejects.toThrow(
        'Confirmation text is required and must match your email address.'
      );

      expect(result.current.isAuthenticated).toBe(true); // Should still be authenticated
    });
  });

  describe('error boundaries', () => {
    it('should handle context usage outside provider', () => {
      // Mock console.error to suppress error output in test
      const originalError = console.error;
      console.error = vi.fn();

      try {
        expect(() => {
          renderHook(() => useAuth());
        }).toThrow('useAuth must be used within an AuthProvider');
      } finally {
        console.error = originalError;
      }
    });
  });
});
