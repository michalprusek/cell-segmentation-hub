import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { AuthProvider } from '@/contexts/AuthContext';

// Mock the API client
vi.mock('@/lib/api', () => ({
  api: {
    post: vi.fn(),
    get: vi.fn(),
    defaults: {
      headers: {
        common: {},
      },
    },
  },
}));

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

describe('useAuth', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('initializes with no authenticated user', () => {
    mockLocalStorage.getItem.mockReturnValue(null);

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('loads user from localStorage on initialization', async () => {
    const mockUser = {
      id: 'user-id',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
    };

    mockLocalStorage.getItem.mockImplementation(key => {
      if (key === 'user') return JSON.stringify(mockUser);
      if (key === 'accessToken') return 'mock-access-token';
      return null;
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.user).toEqual(mockUser);
      expect(result.current.isAuthenticated).toBe(true);
    });
  });

  it('successfully logs in user', async () => {
    const { api } = await import('@/lib/api');
    const mockPost = api.post as vi.MockedFunction<typeof api.post>;

    const loginResponse = {
      data: {
        success: true,
        data: {
          user: {
            id: 'user-id',
            email: 'test@example.com',
            firstName: 'Test',
            lastName: 'User',
          },
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
      },
    };

    mockPost.mockResolvedValueOnce(loginResponse);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login('test@example.com', 'password');
    });

    expect(mockPost).toHaveBeenCalledWith('/auth/login', {
      email: 'test@example.com',
      password: 'password',
    });

    expect(result.current.user).toEqual(loginResponse.data.data.user);
    expect(result.current.isAuthenticated).toBe(true);

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'user',
      JSON.stringify(loginResponse.data.data.user)
    );
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'accessToken',
      'access-token'
    );
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'refreshToken',
      'refresh-token'
    );
  });

  it('handles login error', async () => {
    const { api } = await import('@/lib/api');
    const mockPost = api.post as vi.MockedFunction<typeof api.post>;

    mockPost.mockRejectedValueOnce(new Error('Invalid credentials'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => {
        await result.current.login('test@example.com', 'wrong-password');
      })
    ).rejects.toThrow('Invalid credentials');

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('successfully registers user', async () => {
    const { api } = await import('@/lib/api');
    const mockPost = api.post as vi.MockedFunction<typeof api.post>;

    const registerResponse = {
      data: {
        success: true,
        data: {
          user: {
            id: 'new-user-id',
            email: 'newuser@example.com',
            firstName: 'New',
            lastName: 'User',
          },
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
      },
    };

    mockPost.mockResolvedValueOnce(registerResponse);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.register({
        email: 'newuser@example.com',
        password: 'password',
        firstName: 'New',
        lastName: 'User',
      });
    });

    expect(mockPost).toHaveBeenCalledWith('/auth/register', {
      email: 'newuser@example.com',
      password: 'password',
      firstName: 'New',
      lastName: 'User',
    });

    expect(result.current.user).toEqual(registerResponse.data.data.user);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('logs out user successfully', async () => {
    const { api } = await import('@/lib/api');
    const mockPost = api.post as vi.MockedFunction<typeof api.post>;

    // Set up authenticated user
    const mockUser = {
      id: 'user-id',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
    };

    mockLocalStorage.getItem.mockImplementation(key => {
      if (key === 'user') return JSON.stringify(mockUser);
      if (key === 'accessToken') return 'mock-access-token';
      return null;
    });

    mockPost.mockResolvedValueOnce({ data: { success: true } });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.logout();
    });

    expect(mockPost).toHaveBeenCalledWith('/auth/logout');
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);

    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('user');
    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('accessToken');
    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('refreshToken');
  });

  it('refreshes token successfully', async () => {
    const { api } = await import('@/lib/api');
    const mockPost = api.post as vi.MockedFunction<typeof api.post>;

    const refreshResponse = {
      data: {
        success: true,
        data: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        },
      },
    };

    mockLocalStorage.getItem.mockReturnValue('old-refresh-token');
    mockPost.mockResolvedValueOnce(refreshResponse);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.refreshToken();
    });

    expect(mockPost).toHaveBeenCalledWith('/auth/refresh', {
      refreshToken: 'old-refresh-token',
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'accessToken',
      'new-access-token'
    );
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'refreshToken',
      'new-refresh-token'
    );
  });

  it('handles refresh token error by logging out', async () => {
    const { api } = await import('@/lib/api');
    const mockPost = api.post as vi.MockedFunction<typeof api.post>;

    mockPost.mockRejectedValueOnce(new Error('Invalid refresh token'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      try {
        await result.current.refreshToken();
      } catch (error) {
        // Expected to throw
      }
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('sets authorization header when access token is available', async () => {
    const { api } = await import('@/lib/api');

    mockLocalStorage.getItem.mockImplementation(key => {
      if (key === 'accessToken') return 'mock-access-token';
      return null;
    });

    renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(api.defaults.headers.common['Authorization']).toBe(
        'Bearer mock-access-token'
      );
    });
  });

  it('removes authorization header when no access token', async () => {
    const { api } = await import('@/lib/api');

    mockLocalStorage.getItem.mockReturnValue(null);

    renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(api.defaults.headers.common['Authorization']).toBeUndefined();
    });
  });
});
