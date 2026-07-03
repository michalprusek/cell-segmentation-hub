import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React, { ReactNode } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { useLanguage } from '@/contexts/exports';
import apiClient from '@/lib/api';

vi.mock('@/lib/api', () => ({
  default: {
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    deleteAccount: vi.fn(),
  },
  apiClient: {
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    deleteAccount: vi.fn(),
  },
}));

vi.mock('@/lib/authEvents', () => ({
  authEventEmitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('@/lib/tokenRefresh', () => ({
  tokenRefreshManager: {
    startTokenRefreshManager: vi.fn(),
    stopTokenRefreshManager: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/i18nLogger', () => ({
  i18nLogger: { logMissingKey: vi.fn() },
}));

// Helper: localStorage mock as a simple in-memory store
const createLocalStorageMock = () => {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach(k => delete store[k]);
    }),
    _store: store,
  };
};

describe('LanguageContext', () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;

  // Unauthenticated wrapper — no user in AuthContext
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <AuthProvider>
        <LanguageProvider>{children}</LanguageProvider>
      </AuthProvider>
    </MemoryRouter>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    // Cookie-auth: AuthProvider only probes /auth/profile when the non-secret
    // `authenticated` hint cookie is present. Set it so the provider hydrates
    // the user (the getUserProfile mock then decides authed vs signed-out).
    document.cookie = 'authenticated=1';

    localStorageMock = createLocalStorageMock();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });

    // Default: not authenticated, no profile
    vi.mocked(apiClient.getUserProfile).mockRejectedValue(
      new Error('Not authenticated')
    );
  });

  describe('initial language detection', () => {
    it('defaults to "en" when no localStorage or browser preference is set', async () => {
      // No stored language, browser language not in our supported set
      localStorageMock.getItem.mockReturnValue(null);
      Object.defineProperty(window.navigator, 'language', {
        value: 'ja-JP',
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useLanguage(), { wrapper });

      await waitFor(() => {
        expect(result.current.language).toBeDefined();
      });

      expect(result.current.language).toBe('en');
    });

    it('uses stored localStorage language when available', async () => {
      localStorageMock.getItem.mockImplementation((key: string) =>
        key === 'language' ? 'cs' : null
      );

      const { result } = renderHook(() => useLanguage(), { wrapper });

      await waitFor(() => {
        expect(result.current.language).toBe('cs');
      });
    });

    it('falls back to browser language when no localStorage preference is stored', async () => {
      localStorageMock.getItem.mockReturnValue(null);
      Object.defineProperty(window.navigator, 'language', {
        value: 'de-DE',
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useLanguage(), { wrapper });

      await waitFor(() => {
        expect(result.current.language).toBe('de');
      });
    });
  });

  describe('t() translation function', () => {
    it('returns the translated string for a valid nested key', async () => {
      localStorageMock.getItem.mockImplementation((key: string) =>
        key === 'language' ? 'en' : null
      );

      const { result } = renderHook(() => useLanguage(), { wrapper });

      await waitFor(() => {
        expect(result.current.language).toBe('en');
      });

      // 'common.appName' is defined in en.ts as 'Spheroid Segmentation'
      const translation = result.current.t('common.appName');
      expect(translation).toBe('Spheroid Segmentation');
    });

    it('returns the key itself for a missing translation', async () => {
      localStorageMock.getItem.mockImplementation((key: string) =>
        key === 'language' ? 'en' : null
      );

      const { result } = renderHook(() => useLanguage(), { wrapper });

      await waitFor(() => {
        expect(result.current.language).toBe('en');
      });

      const missing = result.current.t('nonexistent.deeply.nested.key');
      expect(missing).toBe('nonexistent.deeply.nested.key');
    });

    it('replaces {{placeholder}} tokens with provided option values', async () => {
      localStorageMock.getItem.mockImplementation((key: string) =>
        key === 'language' ? 'en' : null
      );

      const { result } = renderHook(() => useLanguage(), { wrapper });

      await waitFor(() => {
        expect(result.current.language).toBe('en');
      });

      // 'projects.imagesQueuedForSegmentation' is defined in en.ts as
      // '{{count}} images added to segmentation queue'
      const translated = result.current.t(
        'projects.imagesQueuedForSegmentation',
        { count: 42 }
      );
      expect(translated).toContain('42');
      expect(translated).not.toContain('{{count}}');
    });
  });

  describe('setLanguage', () => {
    it('updates language state and persists to localStorage', async () => {
      localStorageMock.getItem.mockImplementation((key: string) =>
        key === 'language' ? 'en' : null
      );

      const { result } = renderHook(() => useLanguage(), { wrapper });

      await waitFor(() => {
        expect(result.current.language).toBe('en');
      });

      await act(async () => {
        await result.current.setLanguage('fr');
      });

      expect(result.current.language).toBe('fr');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('language', 'fr');
    });

    it('calls apiClient.updateUserProfile when user is authenticated', async () => {
      // Set up authenticated user with language preference
      const mockProfile = {
        id: '1',
        email: 'user@example.com',
        preferredLang: 'en',
      };
      vi.mocked(apiClient.getUserProfile).mockResolvedValue(mockProfile as any);
      vi.mocked(apiClient.updateUserProfile).mockResolvedValue(
        undefined as any
      );

      localStorageMock.getItem.mockReturnValue(null);

      const { result } = renderHook(() => useLanguage(), { wrapper });

      // setLanguage only persists to the profile when AuthProvider has
      // populated `user` (its init effect awaits getUserProfile). Wait for
      // that async init to settle before acting, otherwise user is still
      // null and the update is correctly skipped.
      await waitFor(() => {
        expect(vi.mocked(apiClient.getUserProfile)).toHaveBeenCalled();
      });
      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.setLanguage('es');
      });

      // Wire field is `language` (BE serialises preferredLang as `language`;
      // see PR #207/#208). Production setLanguage sends { language }.
      expect(vi.mocked(apiClient.updateUserProfile)).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'es' })
      );
    });

    it('does not call apiClient.updateUserProfile when not authenticated', async () => {
      vi.mocked(apiClient.getUserProfile).mockRejectedValue(
        new Error('Not authenticated')
      );

      localStorageMock.getItem.mockImplementation((key: string) =>
        key === 'language' ? 'en' : null
      );

      const { result } = renderHook(() => useLanguage(), { wrapper });

      await waitFor(() => {
        expect(result.current.language).toBe('en');
      });

      await act(async () => {
        await result.current.setLanguage('zh');
      });

      expect(vi.mocked(apiClient.updateUserProfile)).not.toHaveBeenCalled();
      expect(result.current.language).toBe('zh');
    });
  });

  describe('authenticated user language preference', () => {
    it('loads language from user profile when authenticated', async () => {
      // BE serialises the preference as `language` on the wire (PR #207/#208);
      // production reads profile.language, so the mock must use that name.
      const mockProfile = {
        id: '99',
        email: 'prof@example.com',
        language: 'de',
      };
      vi.mocked(apiClient.getUserProfile).mockResolvedValue(mockProfile as any);

      localStorageMock.getItem.mockReturnValue(null);

      const { result } = renderHook(() => useLanguage(), { wrapper });

      // Multi-effect async chain: AuthProvider init → getUserProfile →
      // setUser → LanguageContext userId-effect → getUserProfile →
      // setLanguage('de'). Under full-suite CPU contention this can exceed
      // waitFor's default 1000ms, so give it a load-tolerant deadline.
      //
      // Persistence (localStorage.setItem) happens in a SEPARATE effect keyed on
      // `language`, one commit AFTER `result.current.language` flips to 'de'.
      // Asserting setItem synchronously right after the language waitFor raced
      // that effect (flaky "Number of calls: 0" under load), so wait for the
      // side-effect itself inside the same polling window.
      await waitFor(
        () => {
          expect(result.current.language).toBe('de');
          expect(localStorageMock.setItem).toHaveBeenCalledWith(
            'language',
            'de'
          );
        },
        { timeout: 5000 }
      );
    });
  });
});
