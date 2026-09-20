import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React, { ReactNode } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { ModelProvider } from '@/contexts/ModelContext';
import { useModel } from '@/contexts/exports';
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

// localStorage mock with a controllable in-memory store
const createStoreMock = (initial: Record<string, string> = {}) => {
  const store: Record<string, string> = { ...initial };
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

describe('ModelContext', () => {
  let localStorageMock: ReturnType<typeof createStoreMock>;

  // Standard unauthenticated wrapper
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <AuthProvider>
        <ModelProvider>{children}</ModelProvider>
      </AuthProvider>
    </MemoryRouter>
  );

  beforeEach(() => {
    vi.clearAllMocks();

    localStorageMock = createStoreMock();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });

    vi.mocked(apiClient.getUserProfile).mockRejectedValue(
      new Error('Not authenticated')
    );
  });

  // This provider used to hold the selected model, its threshold, the model
  // catalogue and a getModelInfo lookup. All four moved onto the project
  // (`projects.segmentationModel`, resolved by `useProjectModel`), so the
  // suites covering them were deleted rather than adapted — there is nothing
  // left in this context for them to assert against.

  describe('surface', () => {
    it('exposes only detectHoles and its setter', () => {
      const { result } = renderHook(() => useModel(), { wrapper });

      expect(Object.keys(result.current).sort()).toEqual([
        'detectHoles',
        'setDetectHoles',
      ]);
    });

    it('defaults detectHoles to true', async () => {
      const { result } = renderHook(() => useModel(), { wrapper });

      await waitFor(() => {
        expect(result.current.detectHoles).toBe(true);
      });
    });
  });

  describe('setDetectHoles', () => {
    it('toggles detectHoles and persists the new value', async () => {
      const { result } = renderHook(() => useModel(), { wrapper });

      await waitFor(() => {
        expect(result.current.detectHoles).toBe(true);
      });

      act(() => {
        result.current.setDetectHoles(false);
      });

      expect(result.current.detectHoles).toBe(false);
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'guest_detectHoles',
        'false'
      );

      act(() => {
        result.current.setDetectHoles(true);
      });

      expect(result.current.detectHoles).toBe(true);
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'guest_detectHoles',
        'true'
      );
    });

    it('saves to the user-specific key when authenticated', async () => {
      const userId = 'user-42';
      // AuthProvider only verifies a session when the `authenticated=` cookie
      // hint is present (AuthContext.tsx:30) — without it the profile is never
      // fetched, `user` stays null, and this would silently exercise the GUEST
      // key. The suite this replaced asserted
      // `expect.stringContaining('selectedModel')`, which matches
      // `guest_selectedModel` too, so it passed while proving nothing.
      document.cookie = 'authenticated=1';
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: userId,
        email: 'u@example.com',
        username: 'u',
      } as any);

      const { result } = renderHook(() => useModel(), { wrapper });

      // Wait for AUTH, not for the default value: `detectHoles` is already
      // true before the profile resolves, so asserting on it would let the
      // toggle below run against the guest key and write `guest_detectHoles`.
      // The provider re-reads storage under the user key once the id lands —
      // that read is the observable signal that it has.
      await waitFor(() => {
        expect(localStorageMock.getItem).toHaveBeenCalledWith(
          `user_${userId}_detectHoles`
        );
      });

      act(() => {
        result.current.setDetectHoles(false);
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        `user_${userId}_detectHoles`,
        'false'
      );
    });
  });

  describe('localStorage hydration', () => {
    it('reads a saved detectHoles under the guest key when no user', async () => {
      localStorageMock = createStoreMock({ guest_detectHoles: 'false' });
      Object.defineProperty(window, 'localStorage', {
        value: localStorageMock,
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useModel(), { wrapper });

      await waitFor(() => {
        expect(result.current.detectHoles).toBe(false);
      });
    });

    it('does not read a stale selectedModel left by an older build', async () => {
      // Deliberate: there is nowhere to migrate it TO. One global model cannot
      // describe projects of different types, which is the whole reason the
      // setting moved. Reading it here would be worse than ignoring it — it
      // would resurrect a value the user can no longer see or change.
      localStorageMock = createStoreMock({
        guest_selectedModel: 'mamba_unet',
        guest_confidenceThreshold: '0.9',
      });
      Object.defineProperty(window, 'localStorage', {
        value: localStorageMock,
        writable: true,
        configurable: true,
      });

      renderHook(() => useModel(), { wrapper });

      await waitFor(() => {
        expect(localStorageMock.getItem).toHaveBeenCalledWith(
          'guest_detectHoles'
        );
      });
      expect(localStorageMock.getItem).not.toHaveBeenCalledWith(
        'guest_selectedModel'
      );
      expect(localStorageMock.getItem).not.toHaveBeenCalledWith(
        'guest_confidenceThreshold'
      );
    });
  });
});
