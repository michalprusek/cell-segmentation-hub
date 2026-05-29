/**
 * Behavioral tests for useAuthToasts
 *
 * The hook subscribes to all 8 auth event types via authEventEmitter.on()
 * and calls toast.success / toast.error / toast.warning depending on the
 * event type.  It unsubscribes on unmount.
 *
 * Covered behaviors:
 *  - signin_success → toast.success with description
 *  - signup_success → toast.success with description
 *  - signin_error → toast.error with event.data.error (or fallback i18n key)
 *  - signup_error → toast.error with event.data.error (or fallback i18n key)
 *  - logout_error → toast.error with event.data.error
 *  - profile_error → toast.error with event.data.error
 *  - token_missing → toast.error with description
 *  - token_expired → toast.warning with description
 *  - unmount removes all 8 listeners
 *
 * We mock `sonner` (toast) and `authEventEmitter` to control events, and
 * provide a minimal LanguageContext wrapper so `useLanguage` resolves.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAuthToasts } from '../useAuthToasts';
import { authEventEmitter, type AuthEvent } from '@/lib/authEvents';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/authEvents', () => {
  const listeners = new Map<string, ((e: AuthEvent) => void)[]>();
  return {
    authEventEmitter: {
      on: vi.fn((type: string, cb: (e: AuthEvent) => void) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type)!.push(cb);
      }),
      off: vi.fn((type: string, cb: (e: AuthEvent) => void) => {
        const arr = listeners.get(type) ?? [];
        const idx = arr.indexOf(cb);
        if (idx > -1) arr.splice(idx, 1);
      }),
      emit: vi.fn((event: AuthEvent) => {
        (listeners.get(event.type) ?? []).forEach(fn => fn(event));
      }),
      _listeners: listeners,
    },
  };
});

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => key, // identity translator returns the key
    language: 'en',
    setLanguage: vi.fn(),
    translations: {},
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emit(event: AuthEvent) {
  (authEventEmitter.emit as ReturnType<typeof vi.fn>)(event);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAuthToasts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subscribes to all 8 event types on mount', () => {
    renderHook(() => useAuthToasts());

    const expectedTypes = [
      'signin_success',
      'signup_success',
      'signin_error',
      'signup_error',
      'logout_error',
      'profile_error',
      'token_missing',
      'token_expired',
    ];

    for (const type of expectedTypes) {
      expect(authEventEmitter.on).toHaveBeenCalledWith(
        type,
        expect.any(Function)
      );
    }
  });

  it('unsubscribes from all 8 event types on unmount', () => {
    const { unmount } = renderHook(() => useAuthToasts());
    unmount();

    const expectedTypes = [
      'signin_success',
      'signup_success',
      'signin_error',
      'signup_error',
      'logout_error',
      'profile_error',
      'token_missing',
      'token_expired',
    ];

    for (const type of expectedTypes) {
      expect(authEventEmitter.off).toHaveBeenCalledWith(
        type,
        expect.any(Function)
      );
    }
  });

  it('calls toast.success for signin_success', () => {
    renderHook(() => useAuthToasts());
    emit({ type: 'signin_success' });

    expect(toast.success).toHaveBeenCalledWith(
      'auth.signInSuccess',
      expect.objectContaining({ description: 'auth.welcomeMessage' })
    );
  });

  it('calls toast.success for signup_success', () => {
    renderHook(() => useAuthToasts());
    emit({ type: 'signup_success' });

    expect(toast.success).toHaveBeenCalledWith(
      'auth.registrationSuccess',
      expect.objectContaining({ description: 'auth.welcomeMessage' })
    );
  });

  it('calls toast.error for signin_error using event.data.error when present', () => {
    renderHook(() => useAuthToasts());
    emit({ type: 'signin_error', data: { error: 'Invalid credentials' } });

    expect(toast.error).toHaveBeenCalledWith('Invalid credentials');
  });

  it('calls toast.error for signin_error using i18n fallback when data.error absent', () => {
    renderHook(() => useAuthToasts());
    emit({ type: 'signin_error' });

    expect(toast.error).toHaveBeenCalledWith('auth.signInFailed');
  });

  it('calls toast.error for signup_error using event.data.error when present', () => {
    renderHook(() => useAuthToasts());
    emit({ type: 'signup_error', data: { error: 'Email taken' } });

    expect(toast.error).toHaveBeenCalledWith('Email taken');
  });

  it('calls toast.error for signup_error using i18n fallback when data.error absent', () => {
    renderHook(() => useAuthToasts());
    emit({ type: 'signup_error' });

    expect(toast.error).toHaveBeenCalledWith('auth.registrationFailed');
  });

  it('calls toast.error for logout_error using event.data.error', () => {
    renderHook(() => useAuthToasts());
    emit({ type: 'logout_error', data: { error: 'Logout failed' } });

    expect(toast.error).toHaveBeenCalledWith('Logout failed');
  });

  it('calls toast.error for logout_error with i18n fallback when no data', () => {
    renderHook(() => useAuthToasts());
    emit({ type: 'logout_error' });

    expect(toast.error).toHaveBeenCalledWith('auth.logoutFailed');
  });

  it('calls toast.error for profile_error using event.data.error', () => {
    renderHook(() => useAuthToasts());
    emit({ type: 'profile_error', data: { error: 'Save failed' } });

    expect(toast.error).toHaveBeenCalledWith('Save failed');
  });

  it('calls toast.error for profile_error with i18n fallback when no data', () => {
    renderHook(() => useAuthToasts());
    emit({ type: 'profile_error' });

    expect(toast.error).toHaveBeenCalledWith('auth.profileUpdateFailed');
  });

  it('calls toast.error for token_missing with data.message and data.description', () => {
    renderHook(() => useAuthToasts());
    emit({
      type: 'token_missing',
      data: { message: 'Token not found', description: 'Please log in' },
    });

    expect(toast.error).toHaveBeenCalledWith(
      'Token not found',
      expect.objectContaining({ description: 'Please log in' })
    );
  });

  it('calls toast.error for token_missing with i18n fallbacks when no data', () => {
    renderHook(() => useAuthToasts());
    emit({ type: 'token_missing' });

    expect(toast.error).toHaveBeenCalledWith(
      'auth.tokenMissing',
      expect.objectContaining({ description: 'auth.pleaseSignInAgain' })
    );
  });

  it('calls toast.warning for token_expired with data.message and data.description', () => {
    renderHook(() => useAuthToasts());
    emit({
      type: 'token_expired',
      data: { message: 'Session expired', description: 'Sign in again' },
    });

    expect(toast.warning).toHaveBeenCalledWith(
      'Session expired',
      expect.objectContaining({ description: 'Sign in again' })
    );
  });

  it('calls toast.warning for token_expired with i18n fallbacks when no data', () => {
    renderHook(() => useAuthToasts());
    emit({ type: 'token_expired' });

    expect(toast.warning).toHaveBeenCalledWith(
      'auth.tokenExpired',
      expect.objectContaining({ description: 'auth.pleaseSignInAgain' })
    );
  });

  it('does not fire any toast after unmount', () => {
    const { unmount } = renderHook(() => useAuthToasts());
    unmount();
    vi.clearAllMocks();

    emit({ type: 'signin_success' });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
