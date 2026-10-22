/**
 * Dashboard project search — the WIRING.
 *
 * Unlike Dashboard.test.tsx this suite uses the REAL router (`?q=` lives in
 * the URL) and the REAL ProjectToolbar (the input is what the user types
 * into), so what is tested is the path from a keystroke to the list shown:
 * which listing the hook is asked for, what the filter keeps, where Enter,
 * Escape and a folder click lead.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const { mockNavigate, mockUseDashboardProjects, tabProps } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseDashboardProjects: vi.fn(),
  tabProps: { current: null as null | Record<string, unknown> },
}));

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>(
      'react-router-dom'
    );
  return { ...actual, useNavigate: () => mockNavigate };
});

const T: Record<string, string> = {
  'dashboard.searchProjectsPlaceholder': 'Search projects and folders',
  'dashboard.searchNoResults': 'Nothing matches',
  'dashboard.clearSearch': 'Clear search',
};
const translate = (key: string, params?: Record<string, unknown>) => {
  if (key === 'dashboard.searchResults') {
    return `Found ${params?.count} for ${params?.query}`;
  }
  return T[key] ?? key;
};
vi.mock('@/contexts/exports', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'jana@example.com' } }),
  useLanguage: () => ({ t: translate }),
}));
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({ t: translate }),
}));

vi.mock('@/hooks/useDashboardProjects', () => ({
  useDashboardProjects: mockUseDashboardProjects,
}));

// Two folders; Jana's real names, accents included.
const FOLDERS = [
  { id: 'f-kanci', name: 'Kančí spermie', parentId: null },
  { id: 'f-ptaci', name: 'Ptáci', parentId: null },
];
vi.mock('@/hooks/useFolders', () => ({
  useFolders: () => ({
    data: FOLDERS,
    tree: FOLDERS.map(f => ({ ...f, children: [] })),
    byId: new Map(FOLDERS.map(f => [f.id, f])),
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
  apiClient: { acceptShareInvitation: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock('@/pages/export/AdvancedExportDialog', () => ({
  AdvancedExportDialog: () => null,
}));
vi.mock('@/lib/exportStateManager', () => ({
  default: {
    getExportState: vi.fn(() => null),
    subscribeToChanges: vi.fn(() => () => {}),
  },
}));
vi.mock('@/components/DashboardHeader', () => ({ default: () => null }));
vi.mock('@/components/StatsOverview', () => ({ default: () => null }));
vi.mock('@/components/project/FolderBreadcrumb', () => ({
  default: () => <nav data-testid="folder-breadcrumb" />,
}));
vi.mock('@/components/project/CreateFolderDialog', () => ({
  default: () => null,
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
vi.mock('@/components/NewProjectCard', () => ({ default: () => null }));
vi.mock('@/components/PageTransition', () => ({
  PageTransition: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/components/dashboard/ProjectsTab', () => ({
  default: (props: {
    projects: Array<{ id: string; title: string }>;
    folders: Array<{ id: string; name: string }>;
    onOpenFolder: (id: string) => void;
  }) => {
    tabProps.current = props as unknown as Record<string, unknown>;
    return (
      <div data-testid="projects-tab">
        {props.folders.map(f => (
          <button key={f.id} onClick={() => props.onOpenFolder(f.id)}>
            folder:{f.name}
          </button>
        ))}
        {props.projects.map(p => (
          <span key={p.id}>project:{p.title}</span>
        ))}
      </div>
    );
  },
}));

import Dashboard from '../Dashboard';

// What the server returns: the flat listing (no folder filter) has
// everything; the root listing only what is filed nowhere.
const ALL = [
  { id: 'p1', title: 'vlastovka_dvě rozlišení', folderId: 'f-ptaci' },
  { id: 'p2', title: 'COS26-662-test', folderId: 'f-kanci' },
  { id: 'p3', title: 'COS26-700', folderId: null },
  { id: 'p4', title: 'kanec 1360x1024', folderId: 'f-kanci' },
];

let location: { pathname: string; search: string };
function LocationProbe() {
  const loc = useLocation();
  location = loc;
  return null;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <>
              <Dashboard />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const shownProjects = () =>
  screen.queryAllByText(/^project:/).map(el => el.textContent);
const searchBox = () => screen.getByRole('searchbox');

describe('Dashboard project search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tabProps.current = null;
    mockUseDashboardProjects.mockImplementation(
      ({ folderId }: { folderId?: string }) => ({
        projects:
          folderId === undefined
            ? ALL
            : ALL.filter(p =>
                folderId === 'root'
                  ? p.folderId === null
                  : p.folderId === folderId
              ),
        loading: false,
        fetchError: null,
        fetchProjects: vi.fn(),
        removeProjectOptimistically: vi.fn(),
        updateProjectOptimistically: vi.fn(),
      })
    );
  });
  afterEach(cleanup);

  it('shows the folder on screen while nothing is typed', () => {
    renderAt('/dashboard');
    expect(mockUseDashboardProjects).toHaveBeenLastCalledWith(
      expect.objectContaining({ folderId: 'root' })
    );
    expect(shownProjects()).toEqual(['project:COS26-700']);
    expect(screen.getByTestId('folder-breadcrumb')).toBeInTheDocument();
  });

  it('finds a project filed in another folder, ignoring case and accents', async () => {
    const user = userEvent.setup();
    renderAt('/dashboard');
    await user.type(searchBox(), 'VLASTOVKA dve');

    // The flat listing, not the root's: p1 lives in a folder.
    expect(mockUseDashboardProjects).toHaveBeenLastCalledWith(
      expect.objectContaining({ folderId: undefined })
    );
    expect(shownProjects()).toEqual(['project:vlastovka_dvě rozlišení']);
    expect(location.search).toBe('?q=VLASTOVKA+dve');
    expect(screen.queryByTestId('folder-breadcrumb')).toBeNull();
    expect(screen.getByText('Found 1 for VLASTOVKA dve')).toBeInTheDocument();
  });

  it('requires every term (AND), in any order', () => {
    renderAt('/dashboard?q=test%20cos26');
    expect(shownProjects()).toEqual(['project:COS26-662-test']);
  });

  it('matches folder names too, and opening one ends the search', async () => {
    const user = userEvent.setup();
    renderAt('/dashboard?q=kanci');
    expect(screen.getByText('folder:Kančí spermie')).toBeInTheDocument();
    expect(screen.queryByText('folder:Ptáci')).toBeNull();

    await user.click(screen.getByText('folder:Kančí spermie'));
    expect(location.search).toBe('?folder=f-kanci');
  });

  it('keeps the results out of the create card and the drop targets', () => {
    renderAt('/dashboard?q=cos');
    expect(tabProps.current?.showCreateCard).toBe(false);
    expect(tabProps.current?.onDropItem).toBeUndefined();
  });

  it('opens the only match on Enter, and nothing when there are several', () => {
    renderAt('/dashboard?q=vlastovka');
    fireEvent.keyDown(searchBox(), { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith('/project/p1');

    cleanup();
    mockNavigate.mockClear();
    renderAt('/dashboard?q=cos26');
    fireEvent.keyDown(searchBox(), { key: 'Enter' });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('clears on Escape and on the clear button, back to the folder', async () => {
    const user = userEvent.setup();
    renderAt('/dashboard?folder=f-kanci&q=kanec');
    fireEvent.keyDown(searchBox(), { key: 'Escape' });
    expect(location.search).toBe('?folder=f-kanci');

    await user.type(searchBox(), 'zzz');
    expect(screen.getByText('Nothing matches')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(location.search).toBe('?folder=f-kanci');
    expect(shownProjects()).toEqual([
      'project:COS26-662-test',
      'project:kanec 1360x1024',
    ]);
  });
});
