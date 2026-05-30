import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { useTheme } from '@/contexts/exports';
import type { Theme } from '@/contexts/ThemeContext.types';
import { AuthProvider } from '@/contexts/AuthContext';
import apiClient from '@/lib/api';
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
const mockMatchMedia = vi.fn();
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: mockMatchMedia,
});

// Spy on document.documentElement and document.body methods instead of replacing
// the DOM nodes. Replacing these nodes strips methods (appendChild etc.) that
// @testing-library/react requires internally.
let rootClassListAddSpy: ReturnType<typeof vi.spyOn>;
let rootClassListRemoveSpy: ReturnType<typeof vi.spyOn>;
let rootClassListContainsSpy: ReturnType<typeof vi.spyOn>;
let rootSetAttributeSpy: ReturnType<typeof vi.spyOn>;

// Mock apiClient
vi.mock('@/lib/api', () => ({
  default: {
    getUserProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
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

describe('ThemeContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <AuthProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </AuthProvider>
    </MemoryRouter>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    // Cookie-auth: AuthProvider only probes /auth/profile when the non-secret
    // `authenticated` hint cookie is present. Set it so the provider hydrates
    // the user (the getUserProfile mock then decides authed vs signed-out).
    document.cookie = 'authenticated=1';
    localStorageMock.clear();

    // Install spies on the real DOM nodes so @testing-library/react keeps
    // its internal DOM references intact.
    rootClassListAddSpy = vi.spyOn(document.documentElement.classList, 'add');
    rootClassListRemoveSpy = vi.spyOn(
      document.documentElement.classList,
      'remove'
    );
    rootClassListContainsSpy = vi.spyOn(
      document.documentElement.classList,
      'contains'
    );
    rootSetAttributeSpy = vi.spyOn(document.documentElement, 'setAttribute');
    vi.spyOn(document.body.classList, 'add');
    vi.spyOn(document.body.classList, 'remove');

    // Reset API client mocks
    vi.mocked(apiClient.getUserProfile).mockRejectedValue(
      new Error('Not authenticated')
    );
    vi.mocked(apiClient.updateUserProfile).mockResolvedValue({});

    // Mock matchMedia to return light theme by default
    mockMatchMedia.mockReturnValue({
      matches: false, // Light theme
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should initialize with system theme when no localStorage value exists', async () => {
      localStorageMock.getItem.mockReturnValue(null);

      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.theme).toBe('system');
      });
    });

    it('should initialize with localStorage value when available', async () => {
      localStorageMock.getItem.mockReturnValue('dark');

      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.theme).toBe('dark');
      });
    });

    it('should load theme from user profile when authenticated', async () => {
      // BE serialises preferredTheme as `theme` on the wire (PR #207/#208)
      const mockProfile = {
        theme: 'light',
        id: '1',
        email: 'test@example.com',
      };

      // AuthProvider calls getUserProfile first (to hydrate user state).
      // ThemeProvider's effect re-runs once user is set and calls it again.
      // Provide two resolved values: first for AuthProvider, second for ThemeProvider.
      vi.mocked(apiClient.getUserProfile)
        .mockResolvedValueOnce({ id: '1', email: 'test@example.com' })
        .mockResolvedValueOnce(mockProfile);

      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(
        () => {
          expect(result.current.theme).toBe('light');
        },
        { timeout: 3000 }
      );

      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'light');
    });

    it('should handle error when loading user profile', async () => {
      localStorageMock.getItem.mockReturnValue('dark');
      vi.mocked(apiClient.getUserProfile).mockRejectedValueOnce(
        new Error('Profile load failed')
      );

      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.theme).toBe('dark');
      });
    });
  });

  describe('setTheme', () => {
    it('should update theme and localStorage', async () => {
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

    it('should update user profile when authenticated', async () => {
      // AuthProvider calls getUserProfile on mount to hydrate the user object.
      // ThemeProvider only calls updateUserProfile when user is truthy.
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: '1',
        email: 'test@example.com',
      });

      const { result } = renderHook(() => useTheme(), { wrapper });

      // Wait until the ThemeProvider has finished loading (user is set)
      await waitFor(() => {
        expect(result.current.theme).toBeDefined();
      });

      await act(async () => {
        await result.current.setTheme('light');
      });

      // BE updateProfileSchema expects `theme`, not `preferred_theme` (PR #207/#208)
      expect(vi.mocked(apiClient.updateUserProfile)).toHaveBeenCalledWith({
        theme: 'light',
      });
    });

    it('should handle profile update error gracefully', async () => {
      vi.mocked(apiClient.updateUserProfile).mockRejectedValueOnce(
        new Error('Update failed')
      );

      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.theme).toBeDefined();
      });

      await act(async () => {
        await result.current.setTheme('dark');
      });

      // Should still update local state
      expect(result.current.theme).toBe('dark');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark');
    });
  });

  describe('theme application', () => {
    it('should apply light theme correctly', async () => {
      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.theme).toBeDefined();
      });

      await act(async () => {
        await result.current.setTheme('light');
      });

      expect(rootClassListRemoveSpy).toHaveBeenCalledWith('light', 'dark');
      expect(rootClassListAddSpy).toHaveBeenCalledWith('light');
      expect(rootSetAttributeSpy).toHaveBeenCalledWith('data-theme', 'light');
    });

    it('should apply dark theme correctly', async () => {
      // Simulate the documentElement having 'dark' class (for the contains check)
      rootClassListContainsSpy.mockReturnValue(true);

      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.theme).toBeDefined();
      });

      await act(async () => {
        await result.current.setTheme('dark');
      });

      expect(rootClassListRemoveSpy).toHaveBeenCalledWith('light', 'dark');
      expect(rootClassListAddSpy).toHaveBeenCalledWith('dark');
      expect(rootSetAttributeSpy).toHaveBeenCalledWith('data-theme', 'dark');
    });

    it('should apply system theme based on media query', async () => {
      mockMatchMedia.mockReturnValue({
        matches: true, // Dark system theme
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.theme).toBeDefined();
      });

      await act(async () => {
        await result.current.setTheme('system');
      });

      expect(rootClassListRemoveSpy).toHaveBeenCalledWith('light', 'dark');
      expect(rootClassListAddSpy).toHaveBeenCalledWith('dark');
      expect(rootSetAttributeSpy).toHaveBeenCalledWith('data-theme', 'dark');
    });

    it('should listen for system theme changes when using system theme', async () => {
      const mockMediaQuery = {
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      mockMatchMedia.mockReturnValue(mockMediaQuery);

      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.theme).toBeDefined();
      });

      await act(async () => {
        await result.current.setTheme('system');
      });

      expect(mockMediaQuery.addEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function)
      );
    });
  });

  describe('theme transitions', () => {
    it('should transition from light to dark', async () => {
      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.theme).toBeDefined();
      });

      await act(async () => {
        await result.current.setTheme('light');
      });

      expect(result.current.theme).toBe('light');

      await act(async () => {
        await result.current.setTheme('dark');
      });

      expect(result.current.theme).toBe('dark');
    });

    it('should transition from system to specific theme', async () => {
      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.theme).toBeDefined();
      });

      await act(async () => {
        await result.current.setTheme('system');
      });

      expect(result.current.theme).toBe('system');

      await act(async () => {
        await result.current.setTheme('light');
      });

      expect(result.current.theme).toBe('light');
    });
  });

  describe('error handling', () => {
    it('should handle context usage outside provider', () => {
      // ThemeContext has a non-undefined default value so useTheme() does not
      // throw when used outside a provider — it returns the default context.
      // The check guards against an *undefined* return which never occurs here.
      const { result } = renderHook(() => useTheme());
      // Verify the hook returns the default (safe) context values
      expect(result.current.theme).toBeDefined();
      expect(typeof result.current.setTheme).toBe('function');
    });
  });

  describe('loading state', () => {
    it('should eventually render children when theme is loaded', async () => {
      const TestComponent = () => {
        const { theme } = useTheme();
        return <div data-testid="theme-value">{theme}</div>;
      };

      const { getByTestId } = render(
        <MemoryRouter>
          <AuthProvider>
            <ThemeProvider>
              <TestComponent />
            </ThemeProvider>
          </AuthProvider>
        </MemoryRouter>
      );

      // Should eventually render when theme loads
      await waitFor(() => {
        expect(getByTestId('theme-value')).toBeInTheDocument();
      });

      // Should have a valid theme value
      const themeElement = getByTestId('theme-value');
      expect(['light', 'dark', 'system']).toContain(themeElement.textContent);
    });
  });

  describe('all theme values', () => {
    const themes: Theme[] = ['light', 'dark', 'system'];

    themes.forEach(theme => {
      it(`should handle ${theme} theme correctly`, async () => {
        const { result } = renderHook(() => useTheme(), { wrapper });

        await waitFor(() => {
          expect(result.current.theme).toBeDefined();
        });

        await act(async () => {
          await result.current.setTheme(theme);
        });

        expect(result.current.theme).toBe(theme);
        expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', theme);
      });
    });
  });
});
