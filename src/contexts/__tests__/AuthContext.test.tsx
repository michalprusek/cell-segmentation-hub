import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React, { ReactNode } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { useAuth } from '@/contexts/exports';
import apiClient from '@/lib/api';

// ── mocks ─────────────────────────────────────────────────────────────────────
//
// Auth lives in httpOnly cookies now; the client no longer exposes
// isAuthenticated()/getAccessToken(). The only client-visible session signal is
// the /auth/profile response, gated on the non-secret `authenticated` hint
// cookie. The event emitter is hoisted so tests can assert on emitted events.

const mockAuthEventEmitter = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));

const mockTokenRefreshManager = vi.hoisted(() => ({
  startTokenRefreshManager: vi.fn(),
  stopTokenRefreshManager: vi.fn(),
}));

vi.mock('@/lib/api', () => {
  const client = {
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    refreshAccessToken: vi.fn(),
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    deleteAccount: vi.fn(),
  };
  return { default: client, apiClient: client };
});

vi.mock('@/lib/authEvents', () => ({
  authEventEmitter: mockAuthEventEmitter,
}));

vi.mock('@/lib/tokenRefresh', () => ({
  tokenRefreshManager: mockTokenRefreshManager,
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── shared helpers ──────────────────────────────────────────────────────────────

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

/** Renders the hook and waits for the initial /auth/profile probe to settle. */
const renderAuth = async () => {
  const { result } = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
};

/** Finds an emitted auth event by type (events fire in a setTimeout(0)). */
const findEmitted = (type: string) =>
  (mockAuthEventEmitter.emit.mock.calls as Array<[{ type: string }]>).find(
    ([event]) => event?.type === type
  );

beforeEach(() => {
  vi.clearAllMocks();
  // The init probe only runs when the non-secret `authenticated` hint cookie is
  // present. Set it so tests exercise the probe path; the default profile mock
  // rejects, so the result is the unauthenticated state unless a test overrides
  // getUserProfile.
  document.cookie = 'authenticated=1';
  vi.mocked(apiClient.getUserProfile).mockRejectedValue(
    new Error('Not authenticated')
  );
  // localStorage is a global vi.fn mock (see src/test/setup.ts). Default to no
  // stored preferences; sync tests override per-test.
  vi.mocked(localStorage.getItem).mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── initial state / provider init ─────────────────────────────────────────────

describe('AuthContext – initial state', () => {
  it('initializes unauthenticated when the /auth/profile probe rejects', async () => {
    const result = await renderAuth();

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('skips the /auth/profile probe entirely on a logged-out cold load (no hint cookie)', async () => {
    // No `authenticated` hint cookie → a fresh visitor makes ZERO auth requests
    // (avoids the guaranteed 401 + console error).
    document.cookie = 'authenticated=; expires=Thu, 01 Jan 1970 00:00:00 GMT';

    const result = await renderAuth();

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(vi.mocked(apiClient.getUserProfile)).not.toHaveBeenCalled();
  });

  it('restores the session from the /auth/profile probe on mount', async () => {
    const mockProfile = {
      id: '1',
      email: 'test@example.com',
      username: undefined,
    };
    vi.mocked(apiClient.getUserProfile).mockResolvedValueOnce(mockProfile);

    const result = await renderAuth();

    // The init probe is the suppress-errors variant (silent on 401).
    expect(vi.mocked(apiClient.getUserProfile)).toHaveBeenCalledWith({
      suppressAuthErrors: true,
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual({
      id: '1',
      email: 'test@example.com',
      username: undefined,
      emailVerified: true,
    });
  });

  it('renders signed-out (and suppresses errors) when the probe fails on mount', async () => {
    vi.mocked(apiClient.getUserProfile).mockRejectedValueOnce(
      new Error('Unauthorized')
    );

    const result = await renderAuth();

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    // The probe always runs the suppress-errors variant so a fresh visitor with
    // a stale hint cookie sees no error toast.
    expect(apiClient.getUserProfile).toHaveBeenCalledWith({
      suppressAuthErrors: true,
    });
  });

  it('renders signed-out when the probe returns a profile missing its id', async () => {
    vi.mocked(apiClient.getUserProfile).mockResolvedValue({
      email: 'user@example.com',
      // id intentionally absent
    } as never);

    const result = await renderAuth();

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(apiClient.logout).not.toHaveBeenCalled();
  });

  it('renders signed-out when the probe returns a profile missing its email', async () => {
    vi.mocked(apiClient.getUserProfile).mockResolvedValue({
      id: 'u1',
      // email intentionally absent
    } as never);

    const result = await renderAuth();

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });
});

// ── signIn ─────────────────────────────────────────────────────────────────────

describe('AuthContext – signIn', () => {
  it('signs in successfully, sets user, and emits signin_success', async () => {
    vi.mocked(apiClient.login).mockResolvedValueOnce(validAuthResponse);
    vi.mocked(apiClient.getUserProfile).mockResolvedValue(validProfile);

    const result = await renderAuth();

    await act(async () => {
      await result.current.signIn('user@example.com', 'pw');
    });

    // rememberMe defaults to true.
    expect(vi.mocked(apiClient.login)).toHaveBeenCalledWith(
      'user@example.com',
      'pw',
      true
    );
    expect(result.current.user).toEqual(validAuthResponse.user);
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await waitFor(() => expect(findEmitted('signin_success')).toBeDefined());
  });

  it('rejects, stays signed out, and emits signin_error when login fails', async () => {
    vi.mocked(apiClient.login).mockRejectedValueOnce(
      new Error('Invalid credentials')
    );

    const result = await renderAuth();

    await expect(
      act(async () => {
        await result.current.signIn('test@example.com', 'wrong');
      })
    ).rejects.toThrow('Invalid credentials');

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    await waitFor(() => expect(findEmitted('signin_error')).toBeDefined());
  });

  it('still succeeds when the post-login profile fetch rejects', async () => {
    vi.mocked(apiClient.login).mockResolvedValue(validAuthResponse);
    // getUserProfile rejects for both the init probe and the post-login fetch.
    vi.mocked(apiClient.getUserProfile).mockRejectedValue(
      new Error('Profile load failed')
    );

    const result = await renderAuth();

    await act(async () => {
      await result.current.signIn('user@example.com', 'pw');
    });

    expect(result.current.user).toEqual(validAuthResponse.user);
    expect(result.current.isAuthenticated).toBe(true);
  });
});

// ── signUp ─────────────────────────────────────────────────────────────────────

describe('AuthContext – signUp', () => {
  it('signs up successfully, sets user, and emits signup_success', async () => {
    const consentOptions = {
      consentToMLTraining: true,
      consentToAlgorithmImprovement: false,
    };
    vi.mocked(apiClient.register).mockResolvedValueOnce(validAuthResponse);
    vi.mocked(apiClient.getUserProfile).mockResolvedValue(validProfile);

    const result = await renderAuth();

    await act(async () => {
      await result.current.signUp(
        'new@example.com',
        'pw',
        consentOptions,
        'newuser'
      );
    });

    expect(vi.mocked(apiClient.register)).toHaveBeenCalledWith(
      'new@example.com',
      'pw',
      'newuser',
      consentOptions
    );
    expect(result.current.user).toEqual(validAuthResponse.user);
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await waitFor(() => expect(findEmitted('signup_success')).toBeDefined());
  });

  it('rejects, stays signed out, and emits signup_error when register fails', async () => {
    vi.mocked(apiClient.register).mockRejectedValueOnce(
      new Error('Email already exists')
    );

    const result = await renderAuth();

    await expect(
      act(async () => {
        await result.current.signUp('existing@example.com', 'pw');
      })
    ).rejects.toThrow('Email already exists');

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    await waitFor(() => expect(findEmitted('signup_error')).toBeDefined());
  });

  it('still succeeds when the post-register profile fetch rejects', async () => {
    vi.mocked(apiClient.register).mockResolvedValue(validAuthResponse);
    vi.mocked(apiClient.getUserProfile).mockRejectedValue(
      new Error('No profile yet')
    );

    const result = await renderAuth();

    await act(async () => {
      await result.current.signUp('new@example.com', 'pw');
    });

    expect(result.current.user).toEqual(validAuthResponse.user);
    expect(result.current.isAuthenticated).toBe(true);
  });
});

// ── signOut ────────────────────────────────────────────────────────────────────

describe('AuthContext – signOut', () => {
  it('signs out successfully and clears state', async () => {
    vi.mocked(apiClient.login).mockResolvedValueOnce(validAuthResponse);
    vi.mocked(apiClient.getUserProfile).mockResolvedValue(validProfile);
    vi.mocked(apiClient.logout).mockResolvedValueOnce(undefined);

    const result = await renderAuth();

    await act(async () => {
      await result.current.signIn('user@example.com', 'pw');
    });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await result.current.signOut();
    });

    expect(vi.mocked(apiClient.logout)).toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('clears local state and emits logout_error even when logout API throws', async () => {
    vi.mocked(apiClient.login).mockResolvedValueOnce(validAuthResponse);
    vi.mocked(apiClient.getUserProfile).mockResolvedValue(validProfile);
    vi.mocked(apiClient.logout).mockRejectedValueOnce(
      new Error('Network error')
    );

    const result = await renderAuth();

    await act(async () => {
      await result.current.signIn('user@example.com', 'pw');
    });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await result.current.signOut();
    });

    // State is cleared despite the API error.
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    await waitFor(() => expect(findEmitted('logout_error')).toBeDefined());
  });
});

// ── deleteAccount ──────────────────────────────────────────────────────────────

describe('AuthContext – deleteAccount', () => {
  const signInFirst = async () => {
    vi.mocked(apiClient.login).mockResolvedValueOnce(validAuthResponse);
    vi.mocked(apiClient.getUserProfile).mockResolvedValue(validProfile);
    const result = await renderAuth();
    await act(async () => {
      await result.current.signIn('user@example.com', 'pw');
    });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    return result;
  };

  it('deletes the account when the confirmation matches the email', async () => {
    vi.mocked(apiClient.deleteAccount).mockResolvedValueOnce(undefined);
    const result = await signInFirst();

    await act(async () => {
      await result.current.deleteAccount('user@example.com');
    });

    expect(vi.mocked(apiClient.deleteAccount)).toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('throws and stays authenticated when the confirmation does not match', async () => {
    const result = await signInFirst();

    await expect(
      act(async () => {
        await result.current.deleteAccount('wrong-email@example.com');
      })
    ).rejects.toThrow(
      'Confirmation text is required and must match your email address'
    );

    expect(vi.mocked(apiClient.deleteAccount)).not.toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('throws when the confirmation text is undefined', async () => {
    const result = await signInFirst();

    await expect(
      act(async () => {
        await result.current.deleteAccount(undefined);
      })
    ).rejects.toThrow();
  });

  it('rethrows and emits profile_error when the delete API throws', async () => {
    vi.mocked(apiClient.deleteAccount).mockRejectedValue(
      new Error('Delete failed')
    );
    const result = await signInFirst();

    await expect(
      act(async () => {
        await result.current.deleteAccount('user@example.com');
      })
    ).rejects.toThrow('Delete failed');

    await waitFor(() => expect(findEmitted('profile_error')).toBeDefined());
  });
});

// ── refreshProfile ─────────────────────────────────────────────────────────────

describe('AuthContext – refreshProfile', () => {
  it('is a no-op when there is no user', async () => {
    const result = await renderAuth();
    const callsBefore = vi.mocked(apiClient.getUserProfile).mock.calls.length;

    await act(async () => {
      await result.current.refreshProfile();
    });

    // No additional getUserProfile call beyond the init probe.
    expect(vi.mocked(apiClient.getUserProfile).mock.calls.length).toBe(
      callsBefore
    );
    expect(result.current.user).toBeNull();
  });

  it('updates the profile when getUserProfile succeeds', async () => {
    vi.mocked(apiClient.login).mockResolvedValueOnce(validAuthResponse);
    vi.mocked(apiClient.getUserProfile)
      .mockResolvedValueOnce(validProfile) // init probe
      .mockResolvedValueOnce(validProfile) // post-login fetch
      .mockResolvedValueOnce({ ...validProfile, username: 'updated-user' }); // refresh

    const result = await renderAuth();
    await act(async () => {
      await result.current.signIn('user@example.com', 'pw');
    });

    await act(async () => {
      await result.current.refreshProfile();
    });

    expect(result.current.profile?.username).toBe('updated-user');
  });

  it('rethrows and emits profile_error when getUserProfile fails', async () => {
    vi.mocked(apiClient.login).mockResolvedValueOnce(validAuthResponse);
    vi.mocked(apiClient.getUserProfile)
      .mockResolvedValueOnce(validProfile) // init probe
      .mockResolvedValueOnce(validProfile) // post-login fetch
      .mockRejectedValueOnce(new Error('Profile refresh failed')); // refresh

    const result = await renderAuth();
    await act(async () => {
      await result.current.signIn('user@example.com', 'pw');
    });

    await expect(
      act(async () => {
        await result.current.refreshProfile();
      })
    ).rejects.toThrow('Profile refresh failed');

    await waitFor(() => expect(findEmitted('profile_error')).toBeDefined());
  });
});

// ── syncLocalPreferencesToDatabase ─────────────────────────────────────────────

describe('AuthContext – syncLocalPreferencesToDatabase (on signIn)', () => {
  it('forwards both theme and language when both are valid', async () => {
    vi.mocked(localStorage.getItem).mockImplementation((key: string) => {
      if (key === 'theme') return 'dark';
      if (key === 'language') return 'cs';
      return null;
    });
    vi.mocked(apiClient.login).mockResolvedValue(validAuthResponse);
    vi.mocked(apiClient.getUserProfile).mockResolvedValue(validProfile);
    vi.mocked(apiClient.updateUserProfile).mockResolvedValue(validProfile);

    const result = await renderAuth();
    await act(async () => {
      await result.current.signIn('user@example.com', 'pw');
    });

    expect(apiClient.updateUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'dark', language: 'cs' })
    );
  });

  it('forwards only theme when the stored language is invalid', async () => {
    vi.mocked(localStorage.getItem).mockImplementation((key: string) => {
      if (key === 'theme') return 'light';
      if (key === 'language') return 'klingon'; // invalid
      return null;
    });
    vi.mocked(apiClient.login).mockResolvedValue(validAuthResponse);
    vi.mocked(apiClient.getUserProfile).mockResolvedValue(validProfile);
    vi.mocked(apiClient.updateUserProfile).mockResolvedValue(validProfile);

    const result = await renderAuth();
    await act(async () => {
      await result.current.signIn('user@example.com', 'pw');
    });

    const callArg = vi.mocked(apiClient.updateUserProfile).mock.calls[0][0];
    expect(callArg).toEqual(expect.objectContaining({ theme: 'light' }));
    expect(callArg).not.toHaveProperty('language');
  });

  it('does not call updateUserProfile when nothing is stored', async () => {
    // localStorage.getItem returns null for everything (beforeEach default).
    vi.mocked(apiClient.login).mockResolvedValue(validAuthResponse);
    vi.mocked(apiClient.getUserProfile).mockResolvedValue(validProfile);

    const result = await renderAuth();
    await act(async () => {
      await result.current.signIn('user@example.com', 'pw');
    });

    expect(apiClient.updateUserProfile).not.toHaveBeenCalled();
  });

  it('does not block signIn when updateUserProfile throws', async () => {
    vi.mocked(localStorage.getItem).mockImplementation((key: string) => {
      if (key === 'theme') return 'system';
      return null;
    });
    vi.mocked(apiClient.login).mockResolvedValue(validAuthResponse);
    vi.mocked(apiClient.getUserProfile).mockResolvedValue(validProfile);
    vi.mocked(apiClient.updateUserProfile).mockRejectedValue(
      new Error('DB error')
    );

    const result = await renderAuth();
    await act(async () => {
      await result.current.signIn('user@example.com', 'pw');
    });

    expect(result.current.user).toEqual(validAuthResponse.user);
  });
});

// ── hook usage ─────────────────────────────────────────────────────────────────

describe('AuthContext – hook usage', () => {
  it('throws when useAuth is used outside an AuthProvider', () => {
    const originalError = console.error;
    console.error = vi.fn();
    try {
      expect(() => renderHook(() => useAuth())).toThrow(
        'useAuth must be used within an AuthProvider'
      );
    } finally {
      console.error = originalError;
    }
  });
});
