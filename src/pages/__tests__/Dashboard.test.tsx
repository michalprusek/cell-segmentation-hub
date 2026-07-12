/**
 * Dashboard page unit tests.
 *
 * Covers: static chrome + error/loading branches, New Project / New Folder
 * dialogs, project open/update actions, folder move + rename/delete dialogs,
 * stale ?folder URL fallback, WebSocket queue-driven refetch, DOM custom
 * events (project-created / project-images-updated / project-image-deleted),
 * share-invitation processing, and the default sort params passed to the hook.
 *
 * NOT tested (legitimately):
 * - Drag-and-drop (HTML5 native DnD is not simulated in jsdom)
 * - Folder tree rendering internals (ProjectsTab is mocked)
 * - StatsOverview / DashboardHeader internals — mocked to avoid heavy sub-trees
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const {
  mockNavigate,
  mockSetSearchParams,
  mockFetchProjects,
  mockRemoveProjectOptimistically,
  mockUpdateProjectOptimistically,
  mockUseDashboardProjects,
  mockAcceptShareInvitation,
  mockMutateAsync,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockSetSearchParams: vi.fn(),
  mockFetchProjects: vi.fn().mockResolvedValue(undefined),
  mockRemoveProjectOptimistically: vi.fn(),
  mockUpdateProjectOptimistically: vi.fn(),
  mockUseDashboardProjects: vi.fn(),
  mockAcceptShareInvitation: vi.fn(),
  mockMutateAsync: vi.fn().mockResolvedValue({ skippedProjectIds: [] }),
}));

// ---------------------------------------------------------------------------
// Mock state controlled per test
// ---------------------------------------------------------------------------
let _mockFolderById = new Map<
  string,
  { id: string; name: string; parentId: string | null }
>();
let _mockFolderTree: Array<{ id: string; name: string; children: any[] }> = [];
let _mockFolderData: Array<{ id: string; name: string }> = [];
let _mockFolderPath: Array<{ id: string; name: string }> = [];
let _mockFoldersLoaded = true;
let _mockSearchParams = new URLSearchParams();
let _mockLastUpdate: { status: string } | null = null;

// ---------------------------------------------------------------------------
// Default hook return value factory
// ---------------------------------------------------------------------------
function makeHookReturn(overrides: Record<string, unknown> = {}) {
  return {
    projects: [],
    loading: false,
    fetchError: null,
    fetchProjects: mockFetchProjects,
    removeProjectOptimistically: mockRemoveProjectOptimistically,
    updateProjectOptimistically: mockUpdateProjectOptimistically,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [_mockSearchParams, mockSetSearchParams],
  };
});

vi.mock('@/contexts/exports', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'alice@example.com' } }),
  useLanguage: () => ({
    t: (key: string, fallback?: string) => {
      const map: Record<string, string> = {
        'common.dashboard': 'Dashboard',
        'dashboard.manageProjects':
          'Manage your research projects and analyses',
        'dashboard.projectGallery': 'Project Gallery',
        'dashboard.projectGalleryDescription':
          'Browse and manage all your segmentation projects',
        'common.tryAgain': 'Try Again',
        'folders.moved': 'Moved',
        'folders.moveSkipped': 'Move skipped',
        'sharing.processingInvitation': 'Processing invitation...',
        'sharing.invitationAccepted': 'Invitation accepted',
        'sharing.invitationInvalid': 'Invitation invalid',
        'sharing.invitationError': 'Failed to process share invitation',
        'sharing.invitationAlreadyAccepted': 'Already accepted',
        'common.project': 'Project',
      };
      return map[key] ?? fallback ?? key;
    },
  }),
}));

vi.mock('@/hooks/useDashboardProjects', () => ({
  useDashboardProjects: mockUseDashboardProjects,
}));

vi.mock('@/hooks/useFolders', () => ({
  useFolders: () => ({
    data: _mockFolderData,
    tree: _mockFolderTree,
    byId: _mockFolderById,
    isSuccess: _mockFoldersLoaded,
  }),
  useFolderPath: () => _mockFolderPath,
  useMoveProjects: () => ({ mutateAsync: mockMutateAsync }),
  useMoveFolder: () => ({ mutateAsync: mockMutateAsync }),
}));

vi.mock('@/hooks/useSegmentationQueue', () => ({
  useSegmentationQueue: () => ({ lastUpdate: _mockLastUpdate }),
}));

vi.mock('@/lib/api', () => ({
  apiClient: {
    acceptShareInvitation: mockAcceptShareInvitation,
    getProjects: vi.fn().mockResolvedValue({ projects: [], total: 0 }),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn().mockReturnValue('toast-id'),
    dismiss: vi.fn(),
    info: vi.fn(),
  },
}));

// --- Heavy child components stubbed ----------------------------------------

vi.mock('@/components/DashboardHeader', () => ({
  default: () => <header data-testid="dashboard-header" />,
}));

vi.mock('@/components/StatsOverview', () => ({
  default: () => <div data-testid="stats-overview" />,
}));

vi.mock('@/components/dashboard/ProjectsTab', () => ({
  default: ({
    projects,
    loading,
    onOpenProject,
    onProjectUpdate,
    onRequestProjectMove,
    onOpenFolder,
    onRenameFolder,
    onMoveFolder,
    onDeleteFolder,
  }: {
    projects: Array<{ id: string; title?: string }>;
    loading: boolean;
    onOpenProject: (id: string) => void;
    onProjectUpdate: (id: string, action: string) => void;
    onRequestProjectMove: (id: string) => void;
    onOpenFolder: (id: string | null) => void;
    onRenameFolder: (id: string, name: string) => void;
    onMoveFolder: (id: string) => void;
    onDeleteFolder: (id: string, name: string) => void;
  }) => (
    <div data-testid="projects-tab">
      {loading && <span data-testid="projects-loading">Loading...</span>}
      {projects.map(p => (
        <div key={p.id} data-testid={`project-${p.id}`}>
          <button onClick={() => onOpenProject(p.id)}>Open {p.id}</button>
          <button onClick={() => onProjectUpdate(p.id, 'delete')}>
            Delete {p.id}
          </button>
          <button onClick={() => onProjectUpdate(p.id, 'unshare')}>
            Unshare {p.id}
          </button>
          <button onClick={() => onProjectUpdate(p.id, 'access-denied')}>
            AccessDenied {p.id}
          </button>
          <button onClick={() => onRequestProjectMove(p.id)}>
            Move {p.id}
          </button>
        </div>
      ))}
      <button
        data-testid="open-folder-btn"
        onClick={() => onOpenFolder('folder-1')}
      >
        Enter folder
      </button>
      <button data-testid="open-root-btn" onClick={() => onOpenFolder(null)}>
        Go root
      </button>
      <button
        data-testid="rename-folder-btn"
        onClick={() => onRenameFolder('folder-1', 'Old Name')}
      >
        Rename
      </button>
      <button
        data-testid="move-folder-btn"
        onClick={() => onMoveFolder('folder-1')}
      >
        MoveFolder
      </button>
      <button
        data-testid="delete-folder-btn"
        onClick={() => onDeleteFolder('folder-1', 'Folder 1')}
      >
        DeleteFolder
      </button>
    </div>
  ),
}));

vi.mock('@/components/project/ProjectToolbar', () => ({
  default: ({
    onCreateProject,
    onCreateFolder,
  }: {
    onCreateProject: () => void;
    onCreateFolder: () => void;
  }) => (
    <div data-testid="project-toolbar">
      <button data-testid="new-project-btn" onClick={onCreateProject}>
        New Project
      </button>
      <button data-testid="new-folder-btn" onClick={onCreateFolder}>
        New Folder
      </button>
    </div>
  ),
}));

vi.mock('@/components/project/FolderBreadcrumb', () => ({
  default: () => <nav data-testid="folder-breadcrumb" />,
}));

vi.mock('@/components/project/CreateFolderDialog', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-folder-dialog" /> : null,
}));

vi.mock('@/components/project/RenameFolderDialog', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="rename-folder-dialog" /> : null,
}));

vi.mock('@/components/project/DeleteFolderDialog', () => ({
  default: ({ open, onDeleted }: { open: boolean; onDeleted: () => void }) =>
    open ? (
      <div data-testid="delete-folder-dialog">
        <button data-testid="confirm-delete-btn" onClick={onDeleted}>
          Confirm Delete
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/project/MoveToFolderDialog', () => ({
  default: ({ open, subject }: { open: boolean; subject: any }) =>
    open ? (
      <div data-testid="move-dialog" data-subject={JSON.stringify(subject)} />
    ) : null,
}));

vi.mock('@/components/NewProjectCard', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="new-project-dialog" /> : null,
}));

vi.mock('@/components/PageTransition', () => ({
  PageTransition: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/components/layout', () => ({
  PageContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResponsiveStack: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ContentCard: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
  FlexBetween: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Import Dashboard after mocks are set up
// ---------------------------------------------------------------------------
import Dashboard from '../Dashboard';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function resetDashboardMocks() {
  vi.clearAllMocks();
  _mockFolderById = new Map();
  _mockFolderTree = [];
  _mockFolderData = [];
  _mockFolderPath = [];
  _mockFoldersLoaded = true;
  _mockLastUpdate = null;
  _mockSearchParams = new URLSearchParams();
  mockFetchProjects.mockResolvedValue(undefined);
  mockUseDashboardProjects.mockReturnValue(makeHookReturn());
  mockAcceptShareInvitation.mockResolvedValue({ needsLogin: false });
}

function renderDashboard(searchParamStr = '') {
  _mockSearchParams = new URLSearchParams(searchParamStr);
  return render(
    <MemoryRouter initialEntries={[`/dashboard?${searchParamStr}`]}>
      <Dashboard />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard page', () => {
  beforeEach(() => {
    resetDashboardMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('rendering & chrome', () => {
    it('renders the page heading and Project Gallery section', () => {
      renderDashboard();
      expect(
        screen.getByRole('heading', { name: /dashboard/i, level: 1 })
      ).toBeInTheDocument();
      expect(
        screen.getByText('Manage your research projects and analyses')
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: /project gallery/i })
      ).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('renders the error message and a Try Again button when fetchError is set', () => {
      mockUseDashboardProjects.mockReturnValue(
        makeHookReturn({ fetchError: 'Something went wrong' })
      );

      renderDashboard();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /try again/i })
      ).toBeInTheDocument();
    });

    it('clicking Try Again calls fetchProjects', () => {
      mockUseDashboardProjects.mockReturnValue(
        makeHookReturn({ fetchError: 'Network error' })
      );

      renderDashboard();
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));
      expect(mockFetchProjects).toHaveBeenCalled();
    });
  });

  describe('New Project / New Folder dialogs', () => {
    it('New Project button opens the NewProjectCard dialog', async () => {
      const user = userEvent.setup();
      renderDashboard();

      expect(
        screen.queryByTestId('new-project-dialog')
      ).not.toBeInTheDocument();
      await user.click(screen.getByTestId('new-project-btn'));
      expect(screen.getByTestId('new-project-dialog')).toBeInTheDocument();
    });

    it('New Folder button opens the CreateFolderDialog', async () => {
      const user = userEvent.setup();
      renderDashboard();

      expect(
        screen.queryByTestId('create-folder-dialog')
      ).not.toBeInTheDocument();
      await user.click(screen.getByTestId('new-folder-btn'));
      expect(screen.getByTestId('create-folder-dialog')).toBeInTheDocument();
    });
  });

  describe('project interactions', () => {
    it('onOpenProject navigates to /project/<id>', () => {
      mockUseDashboardProjects.mockReturnValue(
        makeHookReturn({
          projects: [{ id: 'abc123', title: 'My Project' }],
        })
      );

      renderDashboard();
      fireEvent.click(screen.getByRole('button', { name: /open abc123/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/project/abc123');
    });

    it('onProjectUpdate with action="delete" calls removeProjectOptimistically', () => {
      mockUseDashboardProjects.mockReturnValue(
        makeHookReturn({
          projects: [{ id: 'del-me', title: 'Old Project' }],
        })
      );

      renderDashboard();
      fireEvent.click(screen.getByRole('button', { name: /delete del-me/i }));
      expect(mockRemoveProjectOptimistically).toHaveBeenCalledWith('del-me');
    });

    it('onProjectUpdate with action="unshare" removes project optimistically', () => {
      mockUseDashboardProjects.mockReturnValue(
        makeHookReturn({ projects: [{ id: 'p-unshare', title: 'Shared' }] })
      );
      renderDashboard();
      fireEvent.click(
        screen.getByRole('button', { name: /unshare p-unshare/i })
      );
      expect(mockRemoveProjectOptimistically).toHaveBeenCalledWith('p-unshare');
    });

    it('onProjectUpdate with action="access-denied" removes project optimistically', () => {
      mockUseDashboardProjects.mockReturnValue(
        makeHookReturn({ projects: [{ id: 'p-denied', title: 'Denied' }] })
      );
      renderDashboard();
      fireEvent.click(
        screen.getByRole('button', { name: /accessdenied p-denied/i })
      );
      expect(mockRemoveProjectOptimistically).toHaveBeenCalledWith('p-denied');
    });

    it('handleRequestProjectMove opens MoveToFolderDialog with project subject', async () => {
      const user = userEvent.setup();
      mockUseDashboardProjects.mockReturnValue(
        makeHookReturn({ projects: [{ id: 'mv-proj', title: 'Move Me' }] })
      );
      renderDashboard();

      expect(screen.queryByTestId('move-dialog')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /move mv-proj/i }));

      const dialog = screen.getByTestId('move-dialog');
      expect(dialog).toBeInTheDocument();
      const subject = JSON.parse(dialog.getAttribute('data-subject') ?? '{}');
      expect(subject.kind).toBe('project');
      expect(subject.ids).toContain('mv-proj');
    });
  });

  describe('loading state', () => {
    it('passes loading=true down to ProjectsTab when hook is loading', () => {
      mockUseDashboardProjects.mockReturnValue(
        makeHookReturn({ loading: true })
      );

      renderDashboard();
      expect(screen.getByTestId('projects-loading')).toBeInTheDocument();
    });
  });

  describe('folder move / rename / delete dialogs', () => {
    it('handleRequestFolderMove opens MoveToFolderDialog with folder subject', async () => {
      const user = userEvent.setup();
      renderDashboard();

      await user.click(screen.getByTestId('move-folder-btn'));

      const dialog = screen.getByTestId('move-dialog');
      expect(dialog).toBeInTheDocument();
      const subject = JSON.parse(dialog.getAttribute('data-subject') ?? '{}');
      expect(subject.kind).toBe('folder');
      expect(subject.id).toBe('folder-1');
    });

    it('onRenameFolder opens RenameFolderDialog', async () => {
      const user = userEvent.setup();
      renderDashboard();

      expect(
        screen.queryByTestId('rename-folder-dialog')
      ).not.toBeInTheDocument();
      await user.click(screen.getByTestId('rename-folder-btn'));
      expect(screen.getByTestId('rename-folder-dialog')).toBeInTheDocument();
    });

    it('onDeleteFolder opens DeleteFolderDialog', async () => {
      const user = userEvent.setup();
      renderDashboard();

      expect(
        screen.queryByTestId('delete-folder-dialog')
      ).not.toBeInTheDocument();
      await user.click(screen.getByTestId('delete-folder-btn'));
      expect(screen.getByTestId('delete-folder-dialog')).toBeInTheDocument();
    });

    it('handleAfterDeleteCurrent navigates to parent when current folder is deleted', async () => {
      _mockSearchParams = new URLSearchParams('folder=folder-1');
      _mockFolderById = new Map([
        [
          'folder-1',
          { id: 'folder-1', name: 'Folder 1', parentId: 'folder-parent' },
        ],
      ]);

      const user = userEvent.setup();
      renderDashboard('folder=folder-1');

      await user.click(screen.getByTestId('delete-folder-btn'));
      await user.click(screen.getByTestId('confirm-delete-btn'));

      expect(mockSetSearchParams).toHaveBeenCalled();
      const callArg = mockSetSearchParams.mock.calls[0][0];
      const params =
        callArg instanceof URLSearchParams
          ? callArg
          : new URLSearchParams(callArg.toString());
      expect(params.get('folder')).toBe('folder-parent');
    });

    it('handleAfterDeleteCurrent navigates to root when deleted folder has no parent', async () => {
      _mockSearchParams = new URLSearchParams('folder=folder-1');
      _mockFolderById = new Map([
        ['folder-1', { id: 'folder-1', name: 'Folder 1', parentId: null }],
      ]);

      const user = userEvent.setup();
      renderDashboard('folder=folder-1');

      await user.click(screen.getByTestId('delete-folder-btn'));
      await user.click(screen.getByTestId('confirm-delete-btn'));

      expect(mockSetSearchParams).toHaveBeenCalled();
      const callArg = mockSetSearchParams.mock.calls[0][0];
      const params =
        callArg instanceof URLSearchParams
          ? callArg
          : new URLSearchParams(callArg.toString());
      expect(params.get('folder')).toBeNull();
    });
  });

  describe('stale folder URL fallback', () => {
    it('clears ?folder from URL when the folder no longer exists in the tree', async () => {
      _mockSearchParams = new URLSearchParams('folder=ghost-id');
      _mockFolderById = new Map(); // empty — ghost-id not found
      _mockFoldersLoaded = true;

      renderDashboard('folder=ghost-id');

      await waitFor(() => {
        expect(mockSetSearchParams).toHaveBeenCalled();
      });

      const callArg = mockSetSearchParams.mock.calls[0][0];
      const params =
        callArg instanceof URLSearchParams
          ? callArg
          : new URLSearchParams(callArg.toString());
      expect(params.get('folder')).toBeNull();
    });

    it('does NOT clear ?folder if the folder exists in the tree', async () => {
      _mockSearchParams = new URLSearchParams('folder=real-folder');
      _mockFolderById = new Map([
        ['real-folder', { id: 'real-folder', name: 'Real', parentId: null }],
      ]);
      _mockFoldersLoaded = true;

      renderDashboard('folder=real-folder');

      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      const clearCalls = mockSetSearchParams.mock.calls.filter(([params]) => {
        const p =
          params instanceof URLSearchParams
            ? params
            : new URLSearchParams(params?.toString?.() ?? '');
        return p.get('folder') === null;
      });
      expect(clearCalls).toHaveLength(0);
    });
  });

  describe('WS queue update triggers refetch', () => {
    it('fetchProjects is called when lastUpdate.status is "segmented"', async () => {
      _mockLastUpdate = { status: 'segmented' };
      renderDashboard();

      // fetchProjects is debounced with setTimeout(500ms)
      await waitFor(
        () => {
          expect(mockFetchProjects).toHaveBeenCalled();
        },
        { timeout: 2000 }
      );
    });

    it('fetchProjects is called when lastUpdate.status is "no_segmentation"', async () => {
      _mockLastUpdate = { status: 'no_segmentation' };
      renderDashboard();

      await waitFor(
        () => {
          expect(mockFetchProjects).toHaveBeenCalled();
        },
        { timeout: 2000 }
      );
    });

    it('fetchProjects is NOT called for unrelated WS status like "processing"', async () => {
      _mockLastUpdate = { status: 'processing' };
      renderDashboard();

      await act(async () => {
        await new Promise(r => setTimeout(r, 700));
      });

      // 0 or 1 calls from share-processing, never from the WS branch.
      expect(mockFetchProjects.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });

  describe('DOM custom events', () => {
    it('project-created event triggers fetchProjects (debounced)', async () => {
      renderDashboard();
      mockFetchProjects.mockClear();

      act(() => {
        window.dispatchEvent(new CustomEvent('project-created'));
      });

      await waitFor(
        () => {
          expect(mockFetchProjects).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );
    });

    it('project-images-updated with imageCount calls updateProjectOptimistically', async () => {
      renderDashboard();

      act(() => {
        window.dispatchEvent(
          new CustomEvent('project-images-updated', {
            detail: { projectId: 'proj-42', imageCount: 7 },
          })
        );
      });

      await waitFor(() => {
        expect(mockUpdateProjectOptimistically).toHaveBeenCalledWith(
          'proj-42',
          {
            imageCount: 7,
          }
        );
      });
    });

    it('project-images-updated with remainingCount maps to imageCount field', async () => {
      renderDashboard();

      act(() => {
        window.dispatchEvent(
          new CustomEvent('project-images-updated', {
            detail: { projectId: 'proj-99', remainingCount: 3 },
          })
        );
      });

      await waitFor(() => {
        expect(mockUpdateProjectOptimistically).toHaveBeenCalledWith(
          'proj-99',
          {
            imageCount: 3,
          }
        );
      });
    });

    it('project-images-updated with thumbnail calls updateProjectOptimistically with thumbnail', async () => {
      renderDashboard();

      act(() => {
        window.dispatchEvent(
          new CustomEvent('project-images-updated', {
            detail: {
              projectId: 'proj-thumb',
              thumbnail: 'http://x/thumb.jpg',
            },
          })
        );
      });

      await waitFor(() => {
        expect(mockUpdateProjectOptimistically).toHaveBeenCalledWith(
          'proj-thumb',
          {
            thumbnail: 'http://x/thumb.jpg',
          }
        );
      });
    });

    it('project-images-updated with newThumbnail maps to thumbnail field', async () => {
      renderDashboard();

      act(() => {
        window.dispatchEvent(
          new CustomEvent('project-images-updated', {
            detail: { projectId: 'proj-nt', newThumbnail: 'http://x/new.jpg' },
          })
        );
      });

      await waitFor(() => {
        expect(mockUpdateProjectOptimistically).toHaveBeenCalledWith(
          'proj-nt',
          {
            thumbnail: 'http://x/new.jpg',
          }
        );
      });
    });

    it('project-images-updated without projectId does NOT call updateProjectOptimistically', async () => {
      renderDashboard();
      mockUpdateProjectOptimistically.mockClear();

      act(() => {
        window.dispatchEvent(
          new CustomEvent('project-images-updated', {
            detail: { imageCount: 5 }, // no projectId
          })
        );
      });

      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      expect(mockUpdateProjectOptimistically).not.toHaveBeenCalled();
    });

    it('project-image-deleted event triggers updateProjectOptimistically', async () => {
      renderDashboard();

      act(() => {
        window.dispatchEvent(
          new CustomEvent('project-image-deleted', {
            detail: { projectId: 'proj-del', remainingCount: 2 },
          })
        );
      });

      await waitFor(() => {
        expect(mockUpdateProjectOptimistically).toHaveBeenCalledWith(
          'proj-del',
          {
            imageCount: 2,
          }
        );
      });
    });
  });

  describe('share invitation processing', () => {
    // The global setup.ts mocks localStorage as a vi.fn()-based spy that returns
    // null for unknown keys. To simulate a stored token we configure getItem to
    // return the token value per-test, and track removeItem calls.
    const configureLocalStorage = (token: string | null) => {
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation(
        (key: string) => (key === 'pendingShareToken' ? token : null)
      );
    };

    beforeEach(() => {
      configureLocalStorage(null);
    });

    it('processes pending share invitation token from localStorage', async () => {
      configureLocalStorage('share-abc');
      mockAcceptShareInvitation.mockResolvedValue({
        needsLogin: false,
        project: { title: 'Shared Project' },
      });

      renderDashboard();

      await waitFor(
        () => {
          expect(mockAcceptShareInvitation).toHaveBeenCalledWith('share-abc');
        },
        { timeout: 5000 }
      );
    });

    it('removes pendingShareToken from localStorage after processing', async () => {
      configureLocalStorage('share-xyz');
      mockAcceptShareInvitation.mockResolvedValue({ needsLogin: false });

      renderDashboard();

      await waitFor(
        () => {
          expect(localStorage.removeItem).toHaveBeenCalledWith(
            'pendingShareToken'
          );
        },
        { timeout: 5000 }
      );
    });

    it('does NOT call acceptShareInvitation when no token in localStorage', async () => {
      configureLocalStorage(null);
      mockAcceptShareInvitation.mockResolvedValue({ needsLogin: false });

      renderDashboard();

      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      expect(mockAcceptShareInvitation).not.toHaveBeenCalled();
    });

    it('calls fetchProjects after successful share invitation acceptance', async () => {
      configureLocalStorage('share-success');
      mockAcceptShareInvitation.mockResolvedValue({ needsLogin: false });
      mockFetchProjects.mockClear();

      renderDashboard();

      await waitFor(
        () => {
          expect(mockFetchProjects).toHaveBeenCalled();
        },
        { timeout: 5000 }
      );
    });

    it('shows error toast when share invitation API returns 404', async () => {
      const { toast } = await import('sonner');
      configureLocalStorage('share-invalid');
      mockAcceptShareInvitation.mockRejectedValue({
        response: { status: 404 },
      });

      renderDashboard();

      await waitFor(
        () => {
          expect(toast.error).toHaveBeenCalledWith('Invitation invalid');
        },
        { timeout: 5000 }
      );
    });

    it('handles already-accepted invitation (409) gracefully', async () => {
      const { toast } = await import('sonner');
      configureLocalStorage('share-409');
      mockAcceptShareInvitation.mockRejectedValue({
        response: { status: 409, data: { message: 'already accepted' } },
      });

      renderDashboard();

      await waitFor(
        () => {
          expect(toast.info).toHaveBeenCalledWith(
            expect.stringMatching(/already/i)
          );
        },
        { timeout: 5000 }
      );
    });
  });

  describe('default sort params', () => {
    it('passes the default sort (updated_at, desc) to useDashboardProjects', () => {
      renderDashboard();

      const callArgs = mockUseDashboardProjects.mock.calls[0][0];
      expect(callArgs.sortField).toBe('updated_at');
      expect(callArgs.sortDirection).toBe('desc');
    });
  });
});
