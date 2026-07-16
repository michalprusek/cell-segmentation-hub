import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReactNode } from 'react';
import { useDashboardProjects } from '@/hooks/useDashboardProjects';
import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';

// ── module mocks ────────────────────────────────────────────────────────────

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

// Pin apiBaseUrl so thumbnail-URL construction is deterministic.
vi.mock('@/lib/config', () => ({
  default: { apiBaseUrl: 'http://localhost:3001/api' },
}));

import apiClient from '@/lib/api';

// ── helpers ──────────────────────────────────────────────────────────────────

const makeProject = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Project ${id}`,
  description: 'desc',
  image_count: 0,
  created_at: '2024-01-01T00:00:00.000Z',
  // Fixed (deterministic) so multiple makeProject() calls tie on updated_at and
  // the default `updated_at desc` sort is STABLE — preserving input order.
  // `new Date()` here made the order flaky: two calls in one array occasionally
  // straddled a millisecond boundary, so `p2` sorted before `p1` under CI load.
  // Sorting tests pass an explicit `daysAgo(n)` override, so they're unaffected.
  updated_at: '2024-06-01T00:00:00.000Z',
  ...overrides,
});

/** Build an updated_at/created_at timestamp N days in the past. */
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

/** Set an arbitrary (possibly non-array) getSharedProjects response shape. */
const mockShared = (value: unknown) =>
  vi
    .mocked(apiClient.getSharedProjects)
    .mockResolvedValue(
      value as Awaited<ReturnType<typeof apiClient.getSharedProjects>>
    );

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

const renderDashboard = (options = defaultOptions) =>
  renderHook(() => useDashboardProjects(options), { wrapper });

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.getProjects).mockResolvedValue({ projects: [] });
  vi.mocked(apiClient.getSharedProjects).mockResolvedValue([]);
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useDashboardProjects', () => {
  describe('fetching', () => {
    it('fetches owned projects on mount when userId is provided', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1'), makeProject('p2')],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(vi.mocked(apiClient.getProjects)).toHaveBeenCalled();
      expect(result.current.projects).toHaveLength(2);
      expect(result.current.projects[0].id).toBe('p1');
    });

    it('does not fetch when userId is undefined', async () => {
      const { result } = renderDashboard({
        ...defaultOptions,
        userId: undefined,
      });

      // Give the 300ms debounce window time to (not) fire.
      await new Promise(r => setTimeout(r, 350));

      expect(vi.mocked(apiClient.getProjects)).not.toHaveBeenCalled();
      expect(result.current.projects).toHaveLength(0);
    });

    it('handles shared projects API failure gracefully and continues with owned', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1')],
      });
      vi.mocked(apiClient.getSharedProjects).mockRejectedValue(
        new Error('Shared fetch failed')
      );

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));

      // Owned projects still show despite the shared-fetch failure being swallowed.
      expect(result.current.projects).toHaveLength(1);
      expect(result.current.projects[0].id).toBe('p1');
      expect(result.current.fetchError).toBeNull();
    });

    it('sets fetchError on getProjects failure', async () => {
      vi.mocked(apiClient.getProjects).mockRejectedValue(
        new Error('Network error')
      );

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.fetchError).toBeTruthy();
      expect(result.current.projects).toHaveLength(0);
    });
  });

  describe('sorting', () => {
    it('sorts by updated_at descending', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('old', { updated_at: daysAgo(10) }),
          makeProject('new', { updated_at: daysAgo(1) }),
        ],
      });

      const { result } = renderDashboard({
        ...defaultOptions,
        sortField: 'updated_at',
        sortDirection: 'desc',
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.projects[0].id).toBe('new');
      expect(result.current.projects[1].id).toBe('old');
    });

    it('sorts by updated_at ascending', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('new', { updated_at: daysAgo(1) }),
          makeProject('old', { updated_at: daysAgo(10) }),
        ],
      });

      const { result } = renderDashboard({
        ...defaultOptions,
        sortField: 'updated_at',
        sortDirection: 'asc',
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.projects[0].id).toBe('old');
      expect(result.current.projects[1].id).toBe('new');
    });

    it('sorts by created_at descending (date comparison path)', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('newer', { created_at: daysAgo(1) }),
          makeProject('older', { created_at: daysAgo(10) }),
        ],
      });

      const { result } = renderDashboard({
        ...defaultOptions,
        sortField: 'created_at',
        sortDirection: 'desc',
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.projects[0].id).toBe('newer');
      expect(result.current.projects[1].id).toBe('older');
    });

    it('treats invalid dates as -Infinity (lowest priority) in desc sort', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('invalid-date', { updated_at: 'not-a-date' }),
          makeProject('valid-date', { updated_at: daysAgo(1) }),
        ],
      });

      const { result } = renderDashboard({
        ...defaultOptions,
        sortField: 'updated_at',
        sortDirection: 'desc',
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.projects[0].id).toBe('valid-date');
      expect(result.current.projects[1].id).toBe('invalid-date');
    });

    it('sorts by title ascending using localeCompare', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('z-proj', { name: 'Zebra' }),
          makeProject('a-proj', { name: 'Alpha' }),
          makeProject('m-proj', { name: 'Mango' }),
        ],
      });

      const { result } = renderDashboard({
        ...defaultOptions,
        sortField: 'title',
        sortDirection: 'asc',
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      const titles = result.current.projects.map(p => p.title);
      expect(titles).toEqual(['Alpha', 'Mango', 'Zebra']);
    });

    it('sorts by title descending', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('z-proj', { name: 'Zebra' }),
          makeProject('a-proj', { name: 'Alpha' }),
        ],
      });

      const { result } = renderDashboard({
        ...defaultOptions,
        sortField: 'title',
        sortDirection: 'desc',
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      const titles = result.current.projects.map(p => p.title);
      expect(titles).toEqual(['Zebra', 'Alpha']);
    });

    it('sorts by imageCount descending', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('low', { image_count: 2 }),
          makeProject('high', { image_count: 50 }),
          makeProject('mid', { image_count: 10 }),
        ],
      });

      const { result } = renderDashboard({
        ...defaultOptions,
        sortField: 'imageCount',
        sortDirection: 'desc',
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      const ids = result.current.projects.map(p => p.id);
      expect(ids).toEqual(['high', 'mid', 'low']);
    });

    it('sorts NaN imageCount values below real numbers in desc order', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('nan-img', { image_count: NaN }),
          makeProject('real-img', { image_count: 10 }),
        ],
      });

      const { result } = renderDashboard({
        ...defaultOptions,
        sortField: 'imageCount',
        sortDirection: 'desc',
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.projects[0].id).toBe('real-img');
    });

    it('returns 0 (stable) when two projects have equal imageCount', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject('p1', { image_count: 5 }),
          makeProject('p2', { image_count: 5 }),
        ],
      });

      const { result } = renderDashboard({
        ...defaultOptions,
        sortField: 'imageCount',
        sortDirection: 'asc',
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.projects).toHaveLength(2);
    });
  });

  describe('optimistic updates', () => {
    it('removeProjectOptimistically filters the project from the list', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1'), makeProject('p2'), makeProject('p3')],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.projects).toHaveLength(3);

      act(() => {
        result.current.removeProjectOptimistically('p2');
      });

      expect(result.current.projects).toHaveLength(2);
      expect(result.current.projects.find(p => p.id === 'p2')).toBeUndefined();
    });

    it('removeProjectOptimistically is a no-op for an unknown id', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1')],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.removeProjectOptimistically('nonexistent');
      });

      expect(result.current.projects).toHaveLength(1);
    });

    it('updateProjectOptimistically merges partial updates into the project', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1')],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.updateProjectOptimistically('p1', {
          title: 'Updated Title',
          imageCount: 42,
        } as Partial<(typeof result.current.projects)[number]>);
      });

      const updated = result.current.projects.find(p => p.id === 'p1');
      expect(updated?.title).toBe('Updated Title');
      expect(updated?.imageCount).toBe(42);
    });

    it('updateProjectOptimistically is a no-op for an unknown id', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1')],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        result.current.updateProjectOptimistically('bad-id', {
          title: 'X',
        } as Partial<(typeof result.current.projects)[number]>);
      });

      expect(result.current.projects[0].id).toBe('p1');
    });
  });

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

      const { result } = renderDashboard();

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
              { thumbnailPath: 'uploads/thumb.jpg', originalPath: null },
            ],
          }),
        ],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));

      // apiBaseUrl 'http://localhost:3001/api' → base 'http://localhost:3001'
      expect(result.current.projects[0].thumbnail).toBe(
        'http://localhost:3001/uploads/thumb.jpg'
      );
    });

    it('falls back to /placeholder.svg when there are no images', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1', { images: [] })],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.projects[0].thumbnail).toBe('/placeholder.svg');
    });
  });

  describe('formatDate output via project.date field', () => {
    it('formats today as "Updated today"', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1', { updated_at: new Date().toISOString() })],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.projects[0].date).toBe('Updated today');
    });

    it('formats 1 day ago as "Updated yesterday"', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1', { updated_at: daysAgo(1) })],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.projects[0].date).toBe('Updated yesterday');
    });

    it('formats 3 days ago as "Updated 3 days ago"', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1', { updated_at: daysAgo(3) })],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.projects[0].date).toBe('Updated 3 days ago');
    });

    it('formats 8 days ago as "Updated 1 week ago"', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1', { updated_at: daysAgo(8) })],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.projects[0].date).toBe('Updated 1 week ago');
    });

    it('formats 14 days ago as "Updated 2 weeks ago"', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1', { updated_at: daysAgo(14) })],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.projects[0].date).toBe('Updated 2 weeks ago');
    });

    it('formats 35 days ago as "Updated 1 month ago"', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1', { updated_at: daysAgo(35) })],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.projects[0].date).toBe('Updated 1 month ago');
    });

    it('formats 65 days ago as "Updated 2 months ago"', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1', { updated_at: daysAgo(65) })],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.projects[0].date).toBe('Updated 2 months ago');
    });
  });

  describe('shared projects merging', () => {
    it('handles a getSharedProjects response with { data: [...] } shape', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('owned-1')],
      });
      mockShared({
        data: [
          {
            id: 'shared-1',
            name: 'Shared Project',
            image_count: 0,
            created_at: daysAgo(2),
            updated_at: daysAgo(1),
          },
        ],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));

      const ids = result.current.projects.map(p => p.id);
      expect(ids).toContain('owned-1');
      expect(ids).toContain('shared-1');
    });

    it('handles a getSharedProjects response with { projects: [...] } shape', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({ projects: [] });
      mockShared({
        projects: [
          {
            id: 'sp-1',
            name: 'Via projects key',
            image_count: 0,
            created_at: daysAgo(3),
            updated_at: daysAgo(2),
          },
        ],
      });

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.projects.map(p => p.id)).toContain('sp-1');
    });

    it('excludes an owned project that also appears in the shared list', async () => {
      const sharedId = 'overlap-project';

      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [
          makeProject(sharedId), // appears in owned AND shared
          makeProject('exclusive'), // owned only
        ],
      });
      mockShared([
        {
          project: {
            id: sharedId,
            name: 'Overlap',
            image_count: 0,
            created_at: daysAgo(2),
            updated_at: daysAgo(1),
          },
          sharedBy: { email: 'other@example.com' },
        },
      ]);

      const { result } = renderDashboard();

      await waitFor(() => expect(result.current.loading).toBe(false));

      const ids = result.current.projects.map(p => p.id);
      expect(ids).toContain('exclusive');
      // The overlap project must come from the shared side (isShared=true).
      const overlapProject = result.current.projects.find(
        p => p.id === sharedId
      );
      expect(overlapProject?.isShared).toBe(true);
    });
  });

  describe('folderId path', () => {
    it('does not call getSharedProjects when folderId is provided', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1')],
      });

      const { result } = renderDashboard({
        ...defaultOptions,
        folderId: 'folder-abc',
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(vi.mocked(apiClient.getSharedProjects)).not.toHaveBeenCalled();
      expect(result.current.projects).toHaveLength(1);
    });

    it('passes folderId to the getProjects call', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({ projects: [] });

      const { result } = renderDashboard({
        ...defaultOptions,
        folderId: 'root',
      });

      await waitFor(() => expect(result.current.loading).toBe(false));

      const calls = vi.mocked(apiClient.getProjects).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0] as Record<string, unknown>).toMatchObject({
        folderId: 'root',
      });
    });
  });

  describe('project-refetch-needed window event', () => {
    it('triggers an additional getProjects call when the event is dispatched', async () => {
      vi.mocked(apiClient.getProjects).mockResolvedValue({
        projects: [makeProject('p1')],
      });

      const { result } = renderDashboard();
      await waitFor(() => expect(result.current.loading).toBe(false));

      const callsBefore = vi.mocked(apiClient.getProjects).mock.calls.length;

      await act(async () => {
        window.dispatchEvent(new CustomEvent('project-refetch-needed'));
      });

      await waitFor(() => {
        expect(
          vi.mocked(apiClient.getProjects).mock.calls.length
        ).toBeGreaterThan(callsBefore);
      });
    });

    it('removes the event listener on unmount', async () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = renderDashboard();

      await waitFor(() => {
        expect(addSpy).toHaveBeenCalledWith(
          'project-refetch-needed',
          expect.any(Function)
        );
      });

      unmount();

      expect(removeSpy).toHaveBeenCalledWith(
        'project-refetch-needed',
        expect.any(Function)
      );
    });
  });

  describe('loading state', () => {
    it('starts with loading true and sets to false after fetch', async () => {
      let resolve: (v: unknown) => void;
      vi.mocked(apiClient.getProjects).mockImplementationOnce(
        () =>
          new Promise(r => {
            resolve = r;
          })
      );

      const { result } = renderDashboard();

      expect(result.current.loading).toBe(true);

      act(() => resolve!({ projects: [] }));

      await waitFor(() => expect(result.current.loading).toBe(false));
    });
  });

  describe('abort on unmount', () => {
    it('does not update state after unmount (aborts in-flight request)', async () => {
      let resolveProjects: (v: unknown) => void;
      vi.mocked(apiClient.getProjects).mockImplementationOnce(
        () =>
          new Promise(r => {
            resolveProjects = r;
          })
      );

      const { result, unmount } = renderDashboard();

      expect(result.current.loading).toBe(true);

      unmount();

      // Resolving after unmount must not throw or update unmounted state.
      act(() => resolveProjects!({ projects: [makeProject('p1')] }));
    });
  });
});
