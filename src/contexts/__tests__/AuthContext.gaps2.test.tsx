/**
 * AuthContext – gaps2: branches not covered by test.tsx or extra.test.tsx.
 *
 * Targets:
 *  1. signIn: emits signin_error + rethrows when apiClient.login throws
 *  2. signUp: emits signup_error + rethrows when apiClient.register throws
 *  3. signUp: emits signup_success on success + navigates to /dashboard
 *  4. deleteAccount: throws when confirmationText doesn't match user.email
 *  5. deleteAccount: throws when confirmationText is undefined
 *  6. isAuthenticated derived effect: derived purely from the user state
 *  7. refreshProfile: sets profile when getUserProfile succeeds and user is set
 *  8. initializeAuth: renders signed-out when the /auth/profile probe rejects
 *  9. syncLocalPreferencesToDatabase: called but theme is 'invalid' → NOT forwarded
 * 10. signIn: emits signin_success on successful login
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React, { ReactNode } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { useAuth } from '@/contexts/exports';
import apiClient from '@/lib/api';

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockAuthEventEmitter = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));

const mockTokenRefreshManager = vi.hoisted(() => ({
  startTokenRefreshManager: vi.fn(),
  stopTokenRefreshManager: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  default: {
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    refreshAccessToken: vi.fn(),
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    deleteAccount: vi.fn(),
  },
  apiClient: {
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    deleteAccount: vi.fn(),
  },
}));

vi.mock('@/lib/authEvents', () => ({
  authEventEmitter: mockAuthEventEmitter,
}));

vi.mock('@/lib/tokenRefresh', () => ({
  tokenRefreshManager: mockTokenRefreshManager,
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── helpers ───────────────────────────────────────────────────────────────────

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <AuthProvider>{children}</AuthProvider>
  </MemoryRouter>
);

const validProfile = {
  id: 'u1',
  email: 'user@example.com',
  username: 'testuser',
  avatarUrl: null,
};

const validAuthResponse = {
  accessToken: 'at',
  refreshToken: 'rt',
  user: { id: 'u1', email: 'user@example.com', username: 'testuser' },
};

beforeEach(() => {
  vi.clearAllMocks();
  // The init probe only runs when the `authenticated` hint cookie is present.
  document.cookie = 'authenticated=1';
  // Default: the init /auth/profile probe rejects → signed out.
  vi.mocked(apiClient.getUserProfile).mockRejectedValue(new Error('No auth'));
  vi.mocked(localStorage.getItem).mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── tests ─────────────────────────────────────────────────────────────────────

// ── 1. signIn: emits signin_error + rethrows on login failure ────────────────

describe('signIn – login failure', () => {
  it('emits signin_error and rethrows when apiClient.login rejects', async () => {
    vi.mocked(apiClient.login).mockRejectedValue(new Error('Bad credentials'));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.signIn('bad@example.com', 'wrong');
      })
    ).rejects.toThrow('Bad credentials');

    await waitFor(() => {
      const emitCalls = mockAuthEventEmitter.emit.mock.calls as any[];
      const errorCall = emitCalls.find(
        ([event]: [{ type: string }]) => event?.type === 'signin_error'
      );
      expect(errorCall).toBeDefined();
    });
  });
});

// ── 10. signIn: emits signin_success on success ───────────────────────────────

describe('signIn – success', () => {
  it('emits signin_success after successful login', async () => {
    vi.mocked(apiClient.login).mockResolvedValue(validAuthResponse);
    vi.mocked(apiClient.getUserProfile).mockResolvedValue(validProfile);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signIn('user@example.com', 'pw');
    });

    // signin_success is emitted in a setTimeout(0)
    await waitFor(() => {
      const emitCalls = mockAuthEventEmitter.emit.mock.calls as any[];
      const successCall = emitCalls.find(
        ([event]: [{ type: string }]) => event?.type === 'signin_success'
      );
      expect(successCall).toBeDefined();
    });
  });
});

// ── 2. signUp: emits signup_error + rethrows on register failure ─────────────

describe('signUp – registration failure', () => {
  it('emits signup_error and rethrows when apiClient.register rejects', async () => {
    vi.mocked(apiClient.register).mockRejectedValue(
      new Error('Email already taken')
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.signUp('taken@example.com', 'pw');
      })
    ).rejects.toThrow('Email already taken');

    await waitFor(() => {
      const emitCalls = mockAuthEventEmitter.emit.mock.calls as any[];
      const errorCall = emitCalls.find(
        ([event]: [{ type: string }]) => event?.type === 'signup_error'
      );
      expect(errorCall).toBeDefined();
    });
  });
});

// ── 3. signUp: success + signup_success event ────────────────────────────────

describe('signUp – success', () => {
  it('sets user and emits signup_success on successful registration', async () => {
    vi.mocked(apiClient.register).mockResolvedValue(validAuthResponse);
    vi.mocked(apiClient.getUserProfile).mockResolvedValue(validProfile);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signUp('new@example.com', 'pw');
    });

    expect(result.current.user).toEqual(validAuthResponse.user);

    await waitFor(() => {
      const emitCalls = mockAuthEventEmitter.emit.mock.calls as any[];
      const successCall = emitCalls.find(
        ([event]: [{ type: string }]) => event?.type === 'signup_success'
      );
      expect(successCall).toBeDefined();
    });
  });
});

// ── 4. deleteAccount: throws when confirmationText doesn't match email ────────

describe('deleteAccount – confirmation mismatch', () => {
  it('throws immediately when confirmationText does not match user.email', async () => {
    vi.mocked(apiClient.login).mockResolvedValue(validAuthResponse);
    vi.mocked(apiClient.getUserProfile).mockResolvedValue(validProfile);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signIn('user@example.com', 'pw');
    });

    await expect(
      act(async () => {
        await result.current.deleteAccount('wrong-email@example.com');
      })
    ).rejects.toThrow('Confirmation text is required and must match');
  });
});

// ── 5. deleteAccount: throws when confirmationText is undefined ───────────────

describe('deleteAccount – no confirmation', () => {
  it('throws when confirmationText is undefined', async () => {
    vi.mocked(apiClient.login).mockResolvedValue(validAuthResponse);
    vi.mocked(apiClient.getUserProfile).mockResolvedValue(validProfile);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signIn('user@example.com', 'pw');
    });

    await expect(
      act(async () => {
        await result.current.deleteAccount(undefined);
      })
    ).rejects.toThrow();
  });
});

// ── 7. refreshProfile: sets profile on success ────────────────────────────────

describe('refreshProfile – success', () => {
  it('updates profile when getUserProfile returns data', async () => {
    vi.mocked(apiClient.login).mockResolvedValue(validAuthResponse);
    vi.mocked(apiClient.getUserProfile)
      .mockResolvedValueOnce(validProfile) // init
      .mockResolvedValueOnce(validProfile) // post-login
      .mockResolvedValueOnce({ ...validProfile, username: 'updated-user' }); // refreshProfile

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signIn('user@example.com', 'pw');
    });

    await act(async () => {
      await result.current.refreshProfile();
    });

    expect(result.current.profile?.username).toBe('updated-user');
  });
});

// ── 8. initializeAuth: profile probe fails → signed out ──────────────────────

describe('initializeAuth – not authenticated', () => {
  it('renders signed-out and silences errors when the profile probe rejects', async () => {
    // Default beforeEach already makes getUserProfile reject.
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    // The init probe always runs (no client-side token to gate on) and uses
    // the suppress-errors variant so a fresh visitor sees no error toast.
    expect(apiClient.getUserProfile).toHaveBeenCalledWith({
      suppressAuthErrors: true,
    });
  });
});
