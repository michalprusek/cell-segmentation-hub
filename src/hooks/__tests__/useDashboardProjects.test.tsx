import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReactNode } from 'react';
import { useDashboardProjects } from '@/hooks/useDashboardProjects';
import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';

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
    getProjects: vi.fn(),
    getSharedProjects: vi.fn(),
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
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import apiClient from '@/lib/api';

const makeProject = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Project ${id}`,
  description: 'desc',
  image_count: 0,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-02T00:00:00.000Z',
  ...overrides,
});

describe('useDashboardProjects', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <AuthProvider>
        <LanguageProvider>{children}</LanguageProvider>
      </AuthProvider>
    </MemoryRouter>
  );

  const defaultOptions = {
    sortField: 'updated_at',
    sortDirection: 'desc' as const,
    userId: 'user-1',
    userEmail: 'user@example.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getProjects).mockResolvedValue({ projects: [] });
    vi.mocked(apiClient.getSharedProjects).mockResolvedValue([]);
  });

  describe('fetching', () => {
    it('fetches owned projects on mount when userId is provided', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1'), makeProject('p2')],
      });

      const { result } = renderHook(() => useDashboardProjects(defaultOptions), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(vi.mocked(apiClient.getProjects)).toHaveBeenCalledTimes(1);
      expect(result.current.projects).toHaveLength(2);
      expect(result.current.projects[0].id).toBe('p1');
    });

    it('does not fetch when userId is undefined', async () => {
      const { result } = renderHook(
        () => useDashboardProjects({ ...defaultOptions, userId: undefined }),
        { wrapper }
      );

      // Loading stays true while no fetch is triggered
      await waitFor(() => {
        expect(vi.mocked(apiClient.getProjects)).not.toHaveBeenCalled();
      });

      expect(result.current.projects).toHaveLength(0);
    });

    it('handles shared projects API failure gracefully and continues with owned', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1')],
      });
      vi.mocked(apiClient.getSharedProjects).mockRejectedValue(
        new Error('Shared fetch failed')
      );

      const { result } = renderHook(() => useDashboardProjects(defaultOptions), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      // Should still show owned projects despite shared failure
      expect(result.current.projects).toHaveLength(1);
      expect(result.current.projects[0].id).toBe('p1');
      expect(result.current.fetchError).toBeNull();
    });

    it('sets fetchError on getProjects failure', async () => {
      vi.mocked(apiClient.getProjects).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useDashboardProjects(defaultOptions), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.fetchError).toBeTruthy();
      expect(result.current.projects).toHaveLength(0);
    });
  });

  describe('sorting', () => {
    const now = Date.now();
    const older = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
    const newer = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();

    it('sorts by updated_at descending', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('old', { updated_at: older }),
          makeProject('new', { updated_at: newer }),
        ],
      });

      const { result } = renderHook(
        () => useDashboardProjects({ ...defaultOptions, sortField: 'updated_at', sortDirection: 'desc' }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.projects[0].id).toBe('new');
      expect(result.current.projects[1].id).toBe('old');
    });

    it('sorts by updated_at ascending', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('new', { updated_at: newer }),
          makeProject('old', { updated_at: older }),
        ],
      });

      const { result } = renderHook(
        () => useDashboardProjects({ ...defaultOptions, sortField: 'updated_at', sortDirection: 'asc' }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.projects[0].id).toBe('old');
      expect(result.current.projects[1].id).toBe('new');
    });

    it('sorts by name ascending', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('z', { name: 'Zebra' }),
          makeProject('a', { name: 'Apple' }),
          makeProject('m', { name: 'Mango' }),
        ],
      });

      const { result } = renderHook(
        () => useDashboardProjects({ ...defaultOptions, sortField: 'name', sortDirection: 'asc' }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      const names = result.current.projects.map(p => p.id);
      expect(names).toEqual(['a', 'm', 'z']);
    });

    it('sorts by imageCount descending', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('low', { image_count: 2 }),
          makeProject('high', { image_count: 50 }),
          makeProject('mid', { image_count: 10 }),
        ],
      });

      const { result } = renderHook(
        () => useDashboardProjects({ ...defaultOptions, sortField: 'imageCount', sortDirection: 'desc' }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      const ids = result.current.projects.map(p => p.id);
      expect(ids).toEqual(['high', 'mid', 'low']);
    });
  });

  describe('optimistic updates', () => {
    it('removeProjectOptimistically filters the project from the list', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1'), makeProject('p2'), makeProject('p3')],
      });

      const { result } = renderHook(() => useDashboardProjects(defaultOptions), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.projects).toHaveLength(3);

      act(() => {
        result.current.removeProjectOptimistically('p2');
      });

      expect(result.current.projects).toHaveLength(2);
      expect(result.current.projects.find(p => p.id === 'p2')).toBeUndefined();
    });

    it('updateProjectOptimistically merges partial updates into the project', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1', { image_count: 5 })],
      });

      const { result } = renderHook(() => useDashboardProjects(defaultOptions), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.updateProjectOptimistically('p1', { imageCount: 99 });
      });

      expect(result.current.projects[0].imageCount).toBe(99);
    });
  });

  describe('loading state', () => {
    it('starts with loading true and sets to false after fetch', async () => {
      let resolve: (v: unknown) => void;
      vi.mocked(apiClient.getProjects).mockImplementationOnce(
        () => new Promise(r => { resolve = r; })
      );

      const { result } = renderHook(() => useDashboardProjects(defaultOptions), { wrapper });

      expect(result.current.loading).toBe(true);

      act(() => resolve!({ projects: [] }));

      await waitFor(() => expect(result.current.loading).toBe(false));
    });
  });

  describe('abort on unmount', () => {
    it('does not update state after unmount (aborts in-flight request)', async () => {
      let resolveProjects: (v: unknown) => void;
      vi.mocked(apiClient.getProjects).mockImplementationOnce(
        () => new Promise(r => { resolveProjects = r; })
      );
      vi.mocked(apiClient.getSharedProjects).mockResolvedValue([]);

      const { result, unmount } = renderHook(
        () => useDashboardProjects(defaultOptions),
        { wrapper }
      );

      expect(result.current.loading).toBe(true);

      unmount();

      // Resolve after unmount — state should not update (no error thrown)
      act(() => resolveProjects!({ projects: [makeProject('p1')] }));

      // No assertion on state since component is unmounted; just verify no crash
    });
  });
});
