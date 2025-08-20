import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import apiClient from '@/lib/api';
import { ReactNode } from 'react';
import React from 'react';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock the apiClient to match the actual interface
vi.mock('@/lib/api', () => ({
  default: {
    isAuthenticated: vi.fn(() => false),
    getUserProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    getAccessToken: vi.fn(),
    updateUserProfile: vi.fn(),
    deleteAccount: vi.fn(),
  },
  apiClient: {
    isAuthenticated: vi.fn(() => false),
    getUserProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    getAccessToken: vi.fn(),
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
    // Reset mock implementations to default unauthenticated state
    vi.mocked(apiClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(apiClient.getUserProfile).mockRejectedValue(
      new Error('Not authenticated')
    );
    vi.mocked(apiClient.getAccessToken).mockReturnValue(null);
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
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(false);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });

    it('should check for existing token on mount', async () => {
      const mockProfile = {
        id: '1',
        email: 'test@example.com',
        user: { id: '1', email: 'test@example.com' },
      };
      const mockToken = 'existing-token';

      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);
      vi.mocked(apiClient.getAccessToken).mockReturnValue(mockToken);
      vi.mocked(apiClient.getUserProfile).mockResolvedValueOnce(mockProfile);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).toEqual(mockProfile.user);
      expect(result.current.token).toBe(mockToken);
    });

    it('should handle invalid token on mount', async () => {
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);
      vi.mocked(apiClient.getAccessToken).mockReturnValue('invalid-token');
      vi.mocked(apiClient.getUserProfile).mockRejectedValueOnce(
        new Error('Unauthorized')
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(vi.mocked(apiClient.logout)).toHaveBeenCalled();
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
      vi.mocked(apiClient.getAccessToken).mockReturnValue('access-token');
      // Set up apiClient.isAuthenticated to return true after login
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);

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

      // Check that user state was updated
      expect(result.current.user).toEqual(mockResponse.user);
      expect(result.current.token).toBe('access-token');

      // Wait for the useEffect to process the user change and set isAuthenticated
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
      vi.mocked(apiClient.getAccessToken).mockReturnValue('access-token');
      vi.mocked(apiClient.logout).mockResolvedValueOnce(undefined);

      // Initially mock as authenticated after login
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);

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

      // Mock as unauthenticated after logout
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(false);

      // Then sign out
      await act(async () => {
        await result.current.signOut();
      });

      expect(vi.mocked(apiClient.logout)).toHaveBeenCalled();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(result.current.token).toBeNull();
    });

    it('should handle sign out error gracefully', async () => {
      // Setup authenticated state first
      const mockResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: '1', email: 'test@example.com', username: 'test' },
      };

      vi.mocked(apiClient.login).mockResolvedValueOnce(mockResponse);
      vi.mocked(apiClient.getAccessToken).mockReturnValue('access-token');
      vi.mocked(apiClient.logout).mockRejectedValueOnce(
        new Error('Network error')
      );
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);

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

      // Mock as unauthenticated after logout attempt
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(false);

      // Then try to sign out with error
      await act(async () => {
        await result.current.signOut();
      });

      // Should still logout locally even if API call fails
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(result.current.token).toBeNull();
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
      vi.mocked(apiClient.getAccessToken).mockReturnValue('access-token');
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);

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
      expect(result.current.token).toBe('access-token');

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
      vi.mocked(apiClient.getAccessToken).mockReturnValue('access-token');
      vi.mocked(apiClient.deleteAccount).mockResolvedValueOnce(undefined);
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);

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

      // Mock as unauthenticated after account deletion
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(false);

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
      vi.mocked(apiClient.getAccessToken).mockReturnValue('access-token');
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);

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
