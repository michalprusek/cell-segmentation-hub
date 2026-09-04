/**
 * The create cards INSIDE the project list must file a new project into the
 * folder the user is browsing — not at the root.
 *
 * `useProjectForm` has done the placement since 2026-09-03 and is unit-tested
 * on its own, but for months only the dashboard HEADER button was wired to it:
 * `ProjectsList` never received a folder id, so the in-grid "+" card and the
 * list-mode create card both filed at the root. Three buttons, two of them
 * wrong — exactly the inconsistency the bug report described.
 *
 * These tests therefore exercise the REAL chain, mocking only the HTTP client:
 *
 *   ProjectsTab -> ProjectsList -> NewProjectCard -> ProjectDialogForm
 *               -> useProjectForm -> apiClient.moveProjectsToFolder
 *
 * A test that stubs any link in that chain would keep passing with the
 * prop-drill removed, which is the whole thing being asserted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import apiClient from '@/lib/api';
import ProjectsTab from '@/components/dashboard/ProjectsTab';

vi.mock('@/lib/api', () => ({
  default: {
    getUserProfile: vi
      .fn()
      .mockResolvedValue({ preferred_theme: 'system', preferredLang: 'en' }),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUserProfile: vi.fn(),
    deleteAccount: vi.fn(),
    createProject: vi.fn(),
    moveProjectsToFolder: vi.fn(),
    getProjectImages: vi.fn(),
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

vi.mock('@/lib/authEvents', () => ({
  authEventEmitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('@/lib/tokenRefresh', () => ({
  tokenRefreshManager: {
    startTokenRefreshManager: vi.fn(),
    stopTokenRefreshManager: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <AuthProvider>
      <LanguageProvider>{children}</LanguageProvider>
    </AuthProvider>
  </MemoryRouter>
);

const renderTab = (props: {
  viewMode: 'grid' | 'list';
  folderId?: string | null;
}) =>
  render(
    <ProjectsTab
      projects={[]}
      folders={[]}
      viewMode={props.viewMode}
      loading={false}
      onOpenProject={vi.fn()}
      folderId={props.folderId}
    />,
    { wrapper }
  );

/**
 * Open the create dialog, name the project, submit. Both view modes reach the
 * same dialog: the grid card opens its own, the list item opens the sibling
 * dialog-only NewProjectCard.
 */
const createProjectNamed = async (name: string) => {
  const user = userEvent.setup();

  // Before the dialog opens there is exactly one "Create New Project" heading:
  // the create card itself. (The dialog adds a second one.)
  await user.click(screen.getByRole('heading', { name: 'Create New Project' }));

  const nameInput = await screen.findByLabelText('Project Name');
  await user.type(nameInput, name);
  await user.click(screen.getByRole('button', { name: 'Create New Project' }));
};

describe('creating a project from inside a folder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Cookie-auth: AuthProvider only probes /auth/profile when this non-secret
    // hint cookie is present, and useProjectForm bails out with a login error
    // while `user` is still null.
    document.cookie = 'authenticated=1';
    vi.mocked(apiClient.getUserProfile).mockResolvedValue({
      id: 'user-1',
      email: 'test@test.com',
      preferred_theme: 'system',
      preferredLang: 'en',
    } as never);
    vi.mocked(apiClient.createProject).mockResolvedValue({
      id: 'proj-new',
      name: 'Inside Folder',
    } as never);
    vi.mocked(apiClient.moveProjectsToFolder).mockResolvedValue({
      movedProjectIds: ['proj-new'],
      skippedProjectIds: [],
    });
  });

  it('files a project created from the in-grid "+" card into that folder', async () => {
    renderTab({ viewMode: 'grid', folderId: 'folder-7' });
    await waitFor(() => expect(apiClient.getUserProfile).toHaveBeenCalled());

    await createProjectNamed('Inside Folder');

    await waitFor(() => {
      expect(apiClient.moveProjectsToFolder).toHaveBeenCalledWith('folder-7', [
        'proj-new',
      ]);
    });
  });

  it('files a project created from the list-mode create card into that folder', async () => {
    renderTab({ viewMode: 'list', folderId: 'folder-7' });
    await waitFor(() => expect(apiClient.getUserProfile).toHaveBeenCalled());

    await createProjectNamed('Inside Folder');

    await waitFor(() => {
      expect(apiClient.moveProjectsToFolder).toHaveBeenCalledWith('folder-7', [
        'proj-new',
      ]);
    });
  });

  it.each(['grid', 'list'] as const)(
    'does not move the project at the root (%s view)',
    async viewMode => {
      renderTab({ viewMode, folderId: null });
      await waitFor(() => expect(apiClient.getUserProfile).toHaveBeenCalled());

      await createProjectNamed('At Root');

      await waitFor(() => expect(apiClient.createProject).toHaveBeenCalled());
      // A project with no placement is already at the root; posting a move
      // would be a pointless round trip that can only fail.
      expect(apiClient.moveProjectsToFolder).not.toHaveBeenCalled();
    }
  );

  it.each(['grid', 'list'] as const)(
    'treats an omitted folderId as the root (%s view)',
    async viewMode => {
      // ProjectsList defaults folderId to null, so a caller that has not
      // adopted the prop keeps the old root behaviour rather than crashing.
      renderTab({ viewMode });
      await waitFor(() => expect(apiClient.getUserProfile).toHaveBeenCalled());

      await createProjectNamed('At Root');

      await waitFor(() => expect(apiClient.createProject).toHaveBeenCalled());
      expect(apiClient.moveProjectsToFolder).not.toHaveBeenCalled();
    }
  );
});
