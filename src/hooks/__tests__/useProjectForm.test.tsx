import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReactNode } from 'react';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { useProjectForm } from '@/hooks/useProjectForm';

// ---- module mocks ----------------------------------------------------------

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
    getProject: vi.fn(),
    getProjectImages: vi.fn(),
    getSegmentationResults: vi.fn(),
    getBatchSegmentationResults: vi.fn(),
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

vi.mock('@/lib/errorUtils', () => ({
  getLocalizedErrorMessage: vi.fn(
    (_error: unknown, _t: (k: string) => string, context?: string) =>
      context ? `localized:${context}` : 'localized:error'
  ),
}));

// ---- test helpers ----------------------------------------------------------

import { AuthProvider } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/contexts/LanguageContext';

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <AuthProvider>
      <LanguageProvider>{children}</LanguageProvider>
    </AuthProvider>
  </MemoryRouter>
);

const makeFormEvent = () =>
  ({ preventDefault: vi.fn() }) as unknown as React.FormEvent;

// ---- tests -----------------------------------------------------------------

describe('useProjectForm', () => {
  const onSuccess = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Cookie-auth: AuthProvider only probes /auth/profile when the non-secret
    // `authenticated` hint cookie is present. Set it so the provider hydrates
    // the user (the getUserProfile mock then decides authed vs signed-out).
    document.cookie = 'authenticated=1';
  });

  describe('initial state', () => {
    it('starts with empty name, empty description, and isCreating false', () => {
      const { result } = renderHook(
        () => useProjectForm({ onSuccess, onClose }),
        { wrapper }
      );

      expect(result.current.projectName).toBe('');
      expect(result.current.projectDescription).toBe('');
      expect(result.current.isCreating).toBe(false);
    });
  });

  describe('state setters', () => {
    it('setProjectName updates projectName', () => {
      const { result } = renderHook(
        () => useProjectForm({ onSuccess, onClose }),
        { wrapper }
      );

      act(() => {
        result.current.setProjectName('My New Project');
      });

      expect(result.current.projectName).toBe('My New Project');
    });

    it('setProjectDescription updates projectDescription', () => {
      const { result } = renderHook(
        () => useProjectForm({ onSuccess, onClose }),
        { wrapper }
      );

      act(() => {
        result.current.setProjectDescription('Some description');
      });

      expect(result.current.projectDescription).toBe('Some description');
    });
  });

  describe('handleCreateProject — validation', () => {
    it('shows a toast error and makes no API call when name is empty', async () => {
      const { result } = renderHook(
        () => useProjectForm({ onSuccess, onClose }),
        { wrapper }
      );

      await act(async () => {
        await result.current.handleCreateProject(makeFormEvent());
      });

      expect(toast.error).toHaveBeenCalled();
      expect(apiClient.createProject).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('shows a toast error and makes no API call when name is whitespace only', async () => {
      const { result } = renderHook(
        () => useProjectForm({ onSuccess, onClose }),
        { wrapper }
      );

      act(() => {
        result.current.setProjectName('   ');
      });

      await act(async () => {
        await result.current.handleCreateProject(makeFormEvent());
      });

      expect(toast.error).toHaveBeenCalled();
      expect(apiClient.createProject).not.toHaveBeenCalled();
    });
  });

  describe('handleCreateProject — no authenticated user', () => {
    it('shows a login-required error when there is no user in AuthContext', async () => {
      // AuthProvider starts unauthenticated, so this tests the no-user branch.
      const { result } = renderHook(
        () => useProjectForm({ onSuccess, onClose }),
        { wrapper }
      );

      act(() => {
        result.current.setProjectName('Valid Name');
      });

      await act(async () => {
        await result.current.handleCreateProject(makeFormEvent());
      });

      expect(toast.error).toHaveBeenCalled();
      expect(apiClient.createProject).not.toHaveBeenCalled();
    });
  });

  describe('handleCreateProject — API success (mocked user via apiClient)', () => {
    it('calls onSuccess and onClose after a successful API call', async () => {
      // Simulate an authenticated user by making isAuthenticated return true
      // and getUserProfile resolve so AuthProvider considers the user logged in.
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        preferred_theme: 'system',
        preferredLang: 'en',
      } as any);
      vi.mocked(apiClient.createProject).mockResolvedValue({
        id: 'proj-new',
        name: 'New Project',
      } as any);

      const { result } = renderHook(
        () => useProjectForm({ onSuccess, onClose }),
        { wrapper }
      );

      // Wait for AuthProvider to populate the user from getUserProfile
      await waitFor(() => {
        // The user should have been loaded; we set a project name and submit
      });

      act(() => {
        result.current.setProjectName('New Project');
      });

      await act(async () => {
        await result.current.handleCreateProject(makeFormEvent());
      });

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });

      expect(toast.success).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalledWith('proj-new');
    });

    // Requested by a user (Institut Curie, 2026-09-03): "when I create a new
    // project, the project will always go directly to the homepage and not into
    // the folder that I currently am in."
    //
    // `POST /projects` has no folder field, so the placement is a second call
    // to the existing (already tested) move endpoint. The tests below pin the
    // three things that matter: it happens, it does NOT happen at the root, and
    // a failed move never presents as a failed creation.
    it('files the new project into the folder the user is currently in', async () => {
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        preferred_theme: 'system',
        preferredLang: 'en',
      } as any);
      vi.mocked(apiClient.createProject).mockResolvedValue({
        id: 'proj-new',
        name: 'New Project',
      } as any);
      vi.mocked(apiClient.moveProjectsToFolder).mockResolvedValue({
        movedProjectIds: ['proj-new'],
        skippedProjectIds: [],
      });

      const { result } = renderHook(
        () => useProjectForm({ onSuccess, onClose, folderId: 'folder-7' }),
        { wrapper }
      );
      // Let AuthProvider's getUserProfile settle — the hook bails out with a
      // login error while `user` is still null.
      await waitFor(() => expect(apiClient.getUserProfile).toHaveBeenCalled());
      act(() => result.current.setProjectName('New Project'));
      await act(async () => {
        await result.current.handleCreateProject(makeFormEvent());
      });

      await waitFor(() => {
        expect(apiClient.moveProjectsToFolder).toHaveBeenCalledWith(
          'folder-7',
          ['proj-new']
        );
      });
      expect(onSuccess).toHaveBeenCalledWith('proj-new');
    });

    it('does not call the move endpoint at the dashboard root', async () => {
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        preferred_theme: 'system',
        preferredLang: 'en',
      } as any);
      vi.mocked(apiClient.createProject).mockResolvedValue({
        id: 'proj-new',
        name: 'New Project',
      } as any);

      const { result } = renderHook(
        () => useProjectForm({ onSuccess, onClose, folderId: null }),
        { wrapper }
      );
      // Let AuthProvider's getUserProfile settle — the hook bails out with a
      // login error while `user` is still null.
      await waitFor(() => expect(apiClient.getUserProfile).toHaveBeenCalled());
      act(() => result.current.setProjectName('New Project'));
      await act(async () => {
        await result.current.handleCreateProject(makeFormEvent());
      });

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      // A project with no placement is already at the root; posting a move
      // would be a pointless round trip that can only fail.
      expect(apiClient.moveProjectsToFolder).not.toHaveBeenCalled();
    });

    it('keeps the project when only the filing fails', async () => {
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        preferred_theme: 'system',
        preferredLang: 'en',
      } as any);
      vi.mocked(apiClient.createProject).mockResolvedValue({
        id: 'proj-new',
        name: 'New Project',
      } as any);
      vi.mocked(apiClient.moveProjectsToFolder).mockRejectedValue(
        new Error('folder vanished')
      );

      const { result } = renderHook(
        () => useProjectForm({ onSuccess, onClose, folderId: 'folder-7' }),
        { wrapper }
      );
      // Let AuthProvider's getUserProfile settle — the hook bails out with a
      // login error while `user` is still null.
      await waitFor(() => expect(apiClient.getUserProfile).toHaveBeenCalled());
      act(() => result.current.setProjectName('New Project'));
      await act(async () => {
        await result.current.handleCreateProject(makeFormEvent());
      });

      // The project EXISTS — it is merely at the root. Reporting a failure
      // would send the user hunting for a project that is already there.
      await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('proj-new'));
      expect(onClose).toHaveBeenCalled();
      expect(toast.warning).toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('resets projectName and projectDescription after successful creation', async () => {
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        preferred_theme: 'system',
        preferredLang: 'en',
      } as any);
      vi.mocked(apiClient.createProject).mockResolvedValue({
        id: 'proj-reset',
        name: 'Reset Project',
      } as any);

      const { result } = renderHook(
        () => useProjectForm({ onSuccess, onClose }),
        { wrapper }
      );

      await waitFor(() => {});

      act(() => {
        result.current.setProjectName('Reset Project');
        result.current.setProjectDescription('Some desc');
      });

      await act(async () => {
        await result.current.handleCreateProject(makeFormEvent());
      });

      await waitFor(() => {
        expect(result.current.projectName).toBe('');
        expect(result.current.projectDescription).toBe('');
      });
    });

    it('isCreating is false after successful creation', async () => {
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
        preferred_theme: 'system',
        preferredLang: 'en',
      } as any);
      vi.mocked(apiClient.createProject).mockResolvedValue({
        id: 'proj-check',
        name: 'Check Project',
      } as any);

      const { result } = renderHook(
        () => useProjectForm({ onSuccess, onClose }),
        { wrapper }
      );

      await waitFor(() => {});

      act(() => {
        result.current.setProjectName('Check Project');
      });

      await act(async () => {
        await result.current.handleCreateProject(makeFormEvent());
      });

      await waitFor(() => {
        expect(result.current.isCreating).toBe(false);
      });
    });
  });

  describe('handleCreateProject — API error', () => {
    it('shows a localized error toast when apiClient.createProject throws', async () => {
      vi.mocked(apiClient.getUserProfile).mockResolvedValue({
        id: 'user-2',
        email: 'fail@test.com',
        preferred_theme: 'system',
        preferredLang: 'en',
      } as any);
      vi.mocked(apiClient.createProject).mockRejectedValue(
        new Error('Network error')
      );

      const { result } = renderHook(
        () => useProjectForm({ onSuccess, onClose }),
        { wrapper }
      );

      await waitFor(() => {});

      act(() => {
        result.current.setProjectName('Failing Project');
      });

      await act(async () => {
        await result.current.handleCreateProject(makeFormEvent());
      });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });

      expect(onClose).not.toHaveBeenCalled();
      expect(result.current.isCreating).toBe(false);
    });
  });
});
