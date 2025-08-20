import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { ReactNode } from 'react';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock document
Object.defineProperty(window, 'document', {
  value: {
    documentElement: {
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
        contains: vi.fn(() => false),
      },
      setAttribute: vi.fn(),
      style: {},
    },
    body: {
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
      },
      style: {},
    },
    createElement: vi.fn(() => ({
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
      },
    })),
  },
  writable: true,
});

// Mock apiClient
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
}));

// Mock AuthContext dependencies
vi.mock('@/lib/authEvents', () => ({
  authEventEmitter: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('@/lib/tokenRefresh', () => ({
  tokenRefreshManager: {
    startTokenRefreshManager: vi.fn(),
    stopTokenRefreshManager: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ThemeContext - Simple Tests', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <AuthProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </AuthProvider>
    </MemoryRouter>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('basic functionality', () => {
    it('should provide theme context values', async () => {
      localStorageMock.getItem.mockReturnValue('dark');

      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.theme).toBeDefined();
        expect(result.current.setTheme).toBeInstanceOf(Function);
      });
    });

    it('should update theme when setTheme is called', async () => {
      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.theme).toBeDefined();
      });

      await act(async () => {
        await result.current.setTheme('dark');
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark');
      expect(result.current.theme).toBe('dark');
    });

    it('should handle all theme values', async () => {
      const themes = ['light', 'dark', 'system'] as const;

      for (const theme of themes) {
        const { result, unmount } = renderHook(() => useTheme(), { wrapper });

        await waitFor(() => {
          expect(result.current.theme).toBeDefined();
        });

        await act(async () => {
          await result.current.setTheme(theme);
        });

        expect(result.current.theme).toBe(theme);

        // Clean up each renderHook to prevent memory leaks
        unmount();
      }
    });

    it('should throw error when used outside provider', () => {
      expect(() => {
        renderHook(() => useTheme());
      }).toThrow();
    });
  });
});
