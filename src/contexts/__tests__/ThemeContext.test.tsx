import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, useTheme, Theme } from '@/contexts/ThemeContext';
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

// Mock document methods
const mockDocumentElement = {
  classList: {
    add: vi.fn(),
    remove: vi.fn(),
    contains: vi.fn(),
  },
  setAttribute: vi.fn(),
  style: {},
};

const mockBody = {
  classList: {
    add: vi.fn(),
    remove: vi.fn(),
  },
  style: {},
};

// Preserve existing document methods and only override what we need
Object.defineProperty(document, 'documentElement', {
  value: mockDocumentElement,
  writable: true,
  configurable: true,
});

Object.defineProperty(document, 'body', {
  value: mockBody,
  writable: true,
  configurable: true,
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
    localStorageMock.clear();

    // Reset API client mocks
    vi.mocked(apiClient.isAuthenticated).mockReturnValue(false);
    vi.mocked(apiClient.getUserProfile).mockRejectedValue(
      new Error('Not authenticated')
    );
    vi.mocked(apiClient.getAccessToken).mockReturnValue(null);
    vi.mocked(apiClient.updateUserProfile).mockResolvedValue({});

    // Reset DOM mocks
    mockDocumentElement.classList.add.mockClear();
    mockDocumentElement.classList.remove.mockClear();
    mockDocumentElement.classList.contains.mockClear();
    mockDocumentElement.setAttribute.mockClear();
    mockBody.classList.add.mockClear();
    mockBody.classList.remove.mockClear();

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
      const mockProfile = {
        preferred_theme: 'light',
        id: '1',
        email: 'test@example.com',
      };

      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);
      vi.mocked(apiClient.getUserProfile).mockResolvedValueOnce(mockProfile);
      vi.mocked(apiClient.getAccessToken).mockReturnValue('token');

      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.theme).toBe('light');
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'light');
    });

    it('should handle error when loading user profile', async () => {
      localStorageMock.getItem.mockReturnValue('dark');
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);
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
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);
      vi.mocked(apiClient.getAccessToken).mockReturnValue('token');

      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.theme).toBeDefined();
      });

      await act(async () => {
        await result.current.setTheme('light');
      });

      expect(vi.mocked(apiClient.updateUserProfile)).toHaveBeenCalledWith({
        preferred_theme: 'light',
      });
    });

    it('should handle profile update error gracefully', async () => {
      vi.mocked(apiClient.isAuthenticated).mockReturnValue(true);
      vi.mocked(apiClient.getAccessToken).mockReturnValue('token');
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

      expect(mockDocumentElement.classList.remove).toHaveBeenCalledWith(
        'light',
        'dark'
      );
      expect(mockDocumentElement.classList.add).toHaveBeenCalledWith('light');
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith(
        'data-theme',
        'light'
      );
    });

    it('should apply dark theme correctly', async () => {
      mockDocumentElement.classList.contains.mockReturnValue(true);

      const { result } = renderHook(() => useTheme(), { wrapper });

      await waitFor(() => {
        expect(result.current.theme).toBeDefined();
      });

      await act(async () => {
        await result.current.setTheme('dark');
      });

      expect(mockDocumentElement.classList.remove).toHaveBeenCalledWith(
        'light',
        'dark'
      );
      expect(mockDocumentElement.classList.add).toHaveBeenCalledWith('dark');
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith(
        'data-theme',
        'dark'
      );
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

      expect(mockDocumentElement.classList.remove).toHaveBeenCalledWith(
        'light',
        'dark'
      );
      expect(mockDocumentElement.classList.add).toHaveBeenCalledWith('dark');
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith(
        'data-theme',
        'dark'
      );
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
      expect(() => {
        renderHook(() => useTheme());
      }).toThrow('useTheme must be used within a ThemeProvider');
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
