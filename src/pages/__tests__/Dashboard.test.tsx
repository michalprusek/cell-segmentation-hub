/**
 * Dashboard page unit tests.
 *
 * Tested behaviors:
 * - Heading "Dashboard" and subtitle rendered
 * - "Project Gallery" section heading rendered
 * - fetchError state renders an error message + Try Again button
 * - Try Again button calls fetchProjects
 * - New Project button opens NewProjectCard dialog (setNewProjectOpen(true))
 * - New Folder button opens CreateFolderDialog (setCreateOpen(true))
 * - ProjectsTab renders with the projects returned by the hook
 * - Navigate to project fires navigate('/project/<id>')
 * - handleProjectUpdate with action='delete' calls removeProjectOptimistically
 * - Loading spinner shown when hook returns loading=true
 *
 * NOT tested (legitimately):
 * - Drag-and-drop (HTML5 native DnD is not simulated in jsdom)
 * - WebSocket segmentation queue updates (async WS infra, tested elsewhere)
 * - FolderBreadcrumb / RenameFolderDialog / DeleteFolderDialog / MoveToFolderDialog
 *   — separate component trees, mocked to null here.
 * - StatsOverview / DashboardHeader — mocked to avoid heavy sub-trees.
 * - Share invitation processing — requires localStorage + async API round-trip,
 *   separately testable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const {
  mockNavigate,
  mockFetchProjects,
  mockRemoveProjectOptimistically,
  mockUpdateProjectOptimistically,
  mockUseDashboardProjects,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockFetchProjects: vi.fn(),
  mockRemoveProjectOptimistically: vi.fn(),
  mockUpdateProjectOptimistically: vi.fn(),
  mockUseDashboardProjects: vi.fn(),
}));

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
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts/exports', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'alice@example.com' },
  }),
  useLanguage: () => ({
    t: (key: string) => {
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
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock('@/hooks/useDashboardProjects', () => ({
  useDashboardProjects: mockUseDashboardProjects,
}));

vi.mock('@/hooks/useFolders', () => ({
  useFolders: () => ({
    data: [],
    tree: [],
    byId: new Map(),
    isSuccess: true,
  }),
  useFolderPath: () => [],
  useMoveProjects: () => ({ mutateAsync: vi.fn() }),
  useMoveFolder: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/hooks/useSegmentationQueue', () => ({
  useSegmentationQueue: () => ({ lastUpdate: null }),
}));

vi.mock('@/lib/api', () => ({
  apiClient: {
    acceptShareInvitation: vi.fn().mockResolvedValue({ needsLogin: false }),
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
  }: {
    projects: Array<{ id: string; title?: string }>;
    loading: boolean;
    onOpenProject: (id: string) => void;
    onProjectUpdate: (id: string, action: string) => void;
  }) => (
    <div data-testid="projects-tab">
      {loading && <span data-testid="projects-loading">Loading...</span>}
      {projects.map(p => (
        <div key={p.id} data-testid={`project-${p.id}`}>
          <button onClick={() => onOpenProject(p.id)}>Open {p.id}</button>
          <button onClick={() => onProjectUpdate(p.id, 'delete')}>
            Delete {p.id}
          </button>
        </div>
      ))}
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
  default: () => null,
}));

vi.mock('@/components/project/DeleteFolderDialog', () => ({
  default: () => null,
}));

vi.mock('@/components/project/MoveToFolderDialog', () => ({
  default: () => null,
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
// Helpers
// ---------------------------------------------------------------------------

// Import Dashboard after mocks are set up
import Dashboard from '../Dashboard';

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Dashboard />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset hook to default return every test
    mockUseDashboardProjects.mockReturnValue(makeHookReturn());
  });

  afterEach(() => {
    cleanup();
  });

  describe('Rendering', () => {
    it('renders main heading "Dashboard"', () => {
      renderDashboard();
      expect(
        screen.getByRole('heading', { name: /dashboard/i, level: 1 })
      ).toBeInTheDocument();
    });

    it('renders subtitle text', () => {
      renderDashboard();
      expect(
        screen.getByText('Manage your research projects and analyses')
      ).toBeInTheDocument();
    });

    it('renders "Project Gallery" section heading', () => {
      renderDashboard();
      expect(
        screen.getByRole('heading', { name: /project gallery/i })
      ).toBeInTheDocument();
    });

    it('renders StatsOverview widget', () => {
      renderDashboard();
      expect(screen.getByTestId('stats-overview')).toBeInTheDocument();
    });

    it('renders ProjectsTab', () => {
      renderDashboard();
      expect(screen.getByTestId('projects-tab')).toBeInTheDocument();
    });

    it('renders DashboardHeader', () => {
      renderDashboard();
      expect(screen.getByTestId('dashboard-header')).toBeInTheDocument();
    });
  });

  describe('Error state', () => {
    it('renders error message when fetchError is set', () => {
      mockUseDashboardProjects.mockReturnValue(
        makeHookReturn({ fetchError: 'Something went wrong' })
      );

      renderDashboard();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('renders Try Again button when fetchError is set', () => {
      mockUseDashboardProjects.mockReturnValue(
        makeHookReturn({ fetchError: 'Network error' })
      );

      renderDashboard();
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

  describe('Project interactions', () => {
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

    it('multiple projects all render in the tab', () => {
      mockUseDashboardProjects.mockReturnValue(
        makeHookReturn({
          projects: [
            { id: 'p1', title: 'Project 1' },
            { id: 'p2', title: 'Project 2' },
            { id: 'p3', title: 'Project 3' },
          ],
        })
      );

      renderDashboard();
      expect(screen.getByTestId('project-p1')).toBeInTheDocument();
      expect(screen.getByTestId('project-p2')).toBeInTheDocument();
      expect(screen.getByTestId('project-p3')).toBeInTheDocument();
    });
  });

  describe('Loading state', () => {
    it('passes loading=true down to ProjectsTab when hook is loading', () => {
      mockUseDashboardProjects.mockReturnValue(
        makeHookReturn({ loading: true })
      );

      renderDashboard();
      expect(screen.getByTestId('projects-loading')).toBeInTheDocument();
    });

    it('no loading indicator when hook returns loading=false', () => {
      mockUseDashboardProjects.mockReturnValue(
        makeHookReturn({ loading: false })
      );

      renderDashboard();
      expect(screen.queryByTestId('projects-loading')).not.toBeInTheDocument();
    });
  });
});
