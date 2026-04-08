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
    isAuthenticated: vi.fn(() => false),
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    getAccessToken: vi.fn(() => null),
    deleteAccount: vi.fn(),
  },
  apiClient: {
    isAuthenticated: vi.fn(() => false),
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    getAccessToken: vi.fn(() => null),
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

vi.mock('@/lib/emergencyLogout', () => ({
  isEmergencyLogout: vi.fn(() => false),
  clearEmergencyFlag: vi.fn(),
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

    localStorageMock = createLocalStorageMock();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });

    // Default: not authenticated, no profile
    vi.mocked(apiClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(apiClient.getUserProfile).mockRejectedValue(
      new Error('Not authenticated')
    );
    vi.mocked(apiClient.getAccessToken).mockReturnValue(null);
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
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);
      vi.mocked(apiClient.getUserProfile).mockResolvedValue(mockProfile as any);
      vi.mocked(apiClient.getAccessToken).mockReturnValue('token-abc');
      vi.mocked(apiClient.updateUserProfile).mockResolvedValue(
        undefined as any
      );

      localStorageMock.getItem.mockReturnValue(null);

      const { result } = renderHook(() => useLanguage(), { wrapper });

      await waitFor(() => {
        expect(result.current.language).toBeDefined();
      });

      await act(async () => {
        await result.current.setLanguage('es');
      });

      expect(vi.mocked(apiClient.updateUserProfile)).toHaveBeenCalledWith(
        expect.objectContaining({ preferredLang: 'es' })
      );
    });

    it('does not call apiClient.updateUserProfile when not authenticated', async () => {
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(false);
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
      const mockProfile = {
        id: '99',
        email: 'prof@example.com',
        preferredLang: 'de',
      };
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);
      vi.mocked(apiClient.getUserProfile).mockResolvedValue(mockProfile as any);
      vi.mocked(apiClient.getAccessToken).mockReturnValue('token-xyz');

      localStorageMock.getItem.mockReturnValue(null);

      const { result } = renderHook(() => useLanguage(), { wrapper });

      await waitFor(() => {
        expect(result.current.language).toBe('de');
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('language', 'de');
    });
  });
});
