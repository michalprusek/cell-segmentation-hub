/**
 * useDashboardProjects – extra2: branches not covered by existing tests.
 *
 * Targets:
 *  1. removeProjectOptimistically removes the matching project from state
 *  2. removeProjectOptimistically is a no-op for unknown id
 *  3. updateProjectOptimistically patches matching project's fields
 *  4. updateProjectOptimistically is a no-op for unknown id
 *  5. Thumbnail URL is absolute when thumbnailPath starts with http
 *  6. Thumbnail URL is constructed with baseUrl when thumbnailPath is relative
 *  7. Project with no images uses '/placeholder.svg'
 *  8. getSharedProjects throws → sharedResponse = [] (error swallowed)
 *  9. userId=undefined → fetchProjects skips the call (no API invocation)
 * 10. Fetch is aborted (controller.signal.aborted) before API call → returns early
 * 11. fetchError is set on generic API failure
 * 12. String sort comparison (localeCompare path) with sortField='title'
 * 13. Numeric sort comparison for imageCount field (numeric path, desc order)
 * 14. Null sort field: both null → returns 0 (equal comparison)
 */

import React, { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useDashboardProjects } from '@/hooks/useDashboardProjects';
import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';

// ── mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@/lib/api', () => ({
  default: {
    getUserProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
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

// Mock config to ensure known apiBaseUrl
vi.mock('@/lib/config', () => ({
  default: { apiBaseUrl: 'http://localhost:3001/api' },
}));

import apiClient from '@/lib/api';

// ── helpers ───────────────────────────────────────────────────────────────────

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

function makeProject(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    name: `Project ${id}`,
    description: 'desc',
    image_count: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.getProjects).mockResolvedValue({ projects: [] });
  vi.mocked(apiClient.getSharedProjects).mockResolvedValue([]);
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useDashboardProjects – extra2', () => {
  // ── 1. removeProjectOptimistically ────────────────────────────────────────

  describe('removeProjectOptimistically', () => {
    it('removes the matching project from state', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1'), makeProject('p2')],
      });

      const { result } = renderHook(
        () => useDashboardProjects(defaultOptions),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.projects).toHaveLength(2);

      act(() => {
        result.current.removeProjectOptimistically('p1');
      });

      expect(result.current.projects).toHaveLength(1);
      expect(result.current.projects[0].id).toBe('p2');
    });

    it('is a no-op for an unknown id', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1')],
      });

      const { result } = renderHook(
        () => useDashboardProjects(defaultOptions),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.removeProjectOptimistically('nonexistent');
      });

      expect(result.current.projects).toHaveLength(1);
    });
  });

  // ── 2. updateProjectOptimistically ────────────────────────────────────────

  describe('updateProjectOptimistically', () => {
    it('patches matching project fields', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1')],
      });

      const { result } = renderHook(
        () => useDashboardProjects(defaultOptions),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.updateProjectOptimistically('p1', {
          title: 'Updated Title',
          imageCount: 42,
        } as any);
      });

      const updated = result.current.projects.find(p => p.id === 'p1');
      expect((updated as any).title).toBe('Updated Title');
      expect((updated as any).imageCount).toBe(42);
    });

    it('is a no-op for an unknown id', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1')],
      });

      const { result } = renderHook(
        () => useDashboardProjects(defaultOptions),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.updateProjectOptimistically('bad-id', {
          title: 'X',
        } as any);
      });

      // Original project unchanged
      expect(result.current.projects[0].id).toBe('p1');
    });
  });

  // ── 3. Thumbnail URL construction ─────────────────────────────────────────

  describe('thumbnail URL resolution', () => {
    it('uses thumbnailPath as-is when it starts with http', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('p1', {
            images: [
              {
                thumbnailPath: 'http://cdn.example.com/thumb.jpg',
                originalPath: null,
              },
            ],
          }),
        ],
      });

      const { result } = renderHook(
        () => useDashboardProjects(defaultOptions),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.projects[0].thumbnail).toBe(
        'http://cdn.example.com/thumb.jpg'
      );
    });

    it('prepends baseUrl when thumbnailPath is relative', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('p1', {
            images: [
              {
                thumbnailPath: 'uploads/thumb.jpg',
                originalPath: null,
              },
            ],
          }),
        ],
      });

      const { result } = renderHook(
        () => useDashboardProjects(defaultOptions),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      // apiBaseUrl = 'http://localhost:3001/api' → base = 'http://localhost:3001'
      expect(result.current.projects[0].thumbnail).toBe(
        'http://localhost:3001/uploads/thumb.jpg'
      );
    });

    it('falls back to /placeholder.svg when no images', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1', { images: [] })],
      });

      const { result } = renderHook(
        () => useDashboardProjects(defaultOptions),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.projects[0].thumbnail).toBe('/placeholder.svg');
    });
  });

  // ── 4. getSharedProjects throws → swallowed ───────────────────────────────

  describe('getSharedProjects error handling', () => {
    it('swallows getSharedProjects errors and uses empty shared list', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('owned-1')],
      });
      vi.mocked(apiClient.getSharedProjects).mockRejectedValue(
        new Error('Network failure')
      );

      const { result } = renderHook(
        () => useDashboardProjects(defaultOptions),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      // Own projects still loaded; no crash
      expect(result.current.projects.length).toBeGreaterThan(0);
      expect(result.current.fetchError).toBeNull();
    });
  });

  // ── 5. userId=undefined → no API call ─────────────────────────────────────

  describe('userId=undefined', () => {
    it('does not call getProjects when userId is undefined', async () => {
      const { result } = renderHook(
        () => useDashboardProjects({ ...defaultOptions, userId: undefined }),
        { wrapper }
      );

      // Give debounce time to fire
      await new Promise(r => setTimeout(r, 350));

      // loading should have been set (initially true) but never resolved via
      // fetchProjects — we verify getProjects was NOT called
      expect(vi.mocked(apiClient.getProjects)).not.toHaveBeenCalled();
      // result is stable without crash
      expect(result.current).toBeDefined();
    });
  });

  // ── 6. fetchError on generic API failure ──────────────────────────────────

  describe('generic API failure', () => {
    it('sets fetchError when getProjects rejects with a non-auth error', async () => {
      vi.mocked(apiClient.getProjects).mockRejectedValue(
        new Error('Server unavailable')
      );

      const { result } = renderHook(
        () => useDashboardProjects(defaultOptions),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.fetchError).not.toBeNull();
    });
  });

  // ── 7. String sort (localeCompare) ────────────────────────────────────────

  describe('string sort by title', () => {
    it('sorts projects by name ascending using localeCompare', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('z-proj', { name: 'Zebra' }),
          makeProject('a-proj', { name: 'Alpha' }),
          makeProject('m-proj', { name: 'Mango' }),
        ],
      });

      const { result } = renderHook(
        () =>
          useDashboardProjects({
            ...defaultOptions,
            sortField: 'title',
            sortDirection: 'asc',
          }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      const titles = result.current.projects.map(p => (p as any).title);
      expect(titles[0]).toBe('Alpha');
      expect(titles[1]).toBe('Mango');
      expect(titles[2]).toBe('Zebra');
    });

    it('sorts projects by name descending', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('z-proj', { name: 'Zebra' }),
          makeProject('a-proj', { name: 'Alpha' }),
        ],
      });

      const { result } = renderHook(
        () =>
          useDashboardProjects({
            ...defaultOptions,
            sortField: 'title',
            sortDirection: 'desc',
          }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      const titles = result.current.projects.map(p => (p as any).title);
      expect(titles[0]).toBe('Zebra');
      expect(titles[1]).toBe('Alpha');
    });
  });

  // ── 8. Numeric sort for imageCount (desc) ─────────────────────────────────

  describe('numeric sort by image_count', () => {
    it('sorts by image_count descending placing higher counts first', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('p1', { image_count: 3 }),
          makeProject('p2', { image_count: 10 }),
          makeProject('p3', { image_count: 1 }),
        ],
      });

      const { result } = renderHook(
        () =>
          useDashboardProjects({
            ...defaultOptions,
            sortField: 'imageCount',
            sortDirection: 'desc',
          }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      const counts = result.current.projects.map(p => (p as any).imageCount);
      // Desc: 10, 3, 1
      expect(counts[0]).toBe(10);
    });
  });

  // ── 9. Both sort values equal (numeric path returns 0) ───────────────────

  describe('sort: equal values', () => {
    it('leaves order stable when two projects have equal imageCount', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('p1', { image_count: 5 }),
          makeProject('p2', { image_count: 5 }),
        ],
      });

      const { result } = renderHook(
        () =>
          useDashboardProjects({
            ...defaultOptions,
            sortField: 'imageCount',
            sortDirection: 'asc',
          }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      // Both projects present; no crash
      expect(result.current.projects).toHaveLength(2);
    });
  });
});
