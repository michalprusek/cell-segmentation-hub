import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ProjectActions from '../ProjectActions';
import { toast } from 'sonner';
import apiClient from '@/lib/api';

vi.mock('@/lib/api', () => ({
  default: {
    getUserProfile: vi
      .fn()
      .mockResolvedValue({ preferred_theme: 'system', preferredLang: 'en' }),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    revokeProjectShare: vi.fn().mockResolvedValue(undefined),
    getProjects: vi
      .fn()
      .mockResolvedValue({ projects: [], total: 0, page: 1, totalPages: 1 }),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/project/ShareDialog', () => ({
  ShareDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
  }) =>
    open ? (
      <div data-testid="share-dialog">
        <button onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : null,
}));

const apiMock = apiClient as unknown as {
  deleteProject: ReturnType<typeof vi.fn>;
  revokeProjectShare: ReturnType<typeof vi.fn>;
};

// Track window listeners so a throwing test can't leak them into the next one.
const windowListeners: Array<[string, EventListener]> = [];
function spyOnWindowEvent(type: string) {
  const listener = vi.fn();
  window.addEventListener(type, listener);
  windowListeners.push([type, listener]);
  return listener;
}

// Render the component and open its dropdown — the entry point of every test.
async function openMenu(
  props: Partial<React.ComponentProps<typeof ProjectActions>> = {}
) {
  const user = userEvent.setup();
  render(<ProjectActions projectId="proj-1" {...props} />);
  await user.click(screen.getByRole('button'));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const [type, listener] of windowListeners) {
    window.removeEventListener(type, listener);
  }
  windowListeners.length = 0;
});

describe('ProjectActions', () => {
  describe('menu items by ownership', () => {
    it('shows Share and Delete for an owned project', async () => {
      await openMenu({ isShared: false });
      expect(
        screen.getByRole('menuitem', { name: /share/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('menuitem', { name: /delete/i })
      ).toBeInTheDocument();
    });

    it('shows Remove instead of Delete for a shared project', async () => {
      await openMenu({ isShared: true, shareId: 'share-1' });
      expect(
        screen.queryByRole('menuitem', { name: /^delete$/i })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('menuitem', { name: /remove/i })
      ).toBeInTheDocument();
    });
  });

  describe('share dialog', () => {
    it('opens the share dialog when Share is clicked', async () => {
      const user = await openMenu({ isShared: false });
      await user.click(screen.getByRole('menuitem', { name: /share/i }));
      await waitFor(() => {
        expect(screen.getByTestId('share-dialog')).toBeInTheDocument();
      });
    });

    it('notifies onDialogStateChange(true) when the share dialog opens', async () => {
      const onDialogStateChange = vi.fn();
      const user = await openMenu({ isShared: false, onDialogStateChange });
      await user.click(screen.getByRole('menuitem', { name: /share/i }));
      // Dialog opens behind a 100ms setTimeout that lets the dropdown close first.
      await waitFor(
        () => expect(onDialogStateChange).toHaveBeenCalledWith(true),
        { timeout: 500 }
      );
    });
  });

  describe('delete', () => {
    it('optimistically updates, calls deleteProject, and dispatches project-deleted on success', async () => {
      const onProjectUpdate = vi.fn();
      const deleted = spyOnWindowEvent('project-deleted');

      const user = await openMenu({ isShared: false, onProjectUpdate });
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));

      // Optimistic removal fires synchronously, before the API resolves.
      expect(onProjectUpdate).toHaveBeenCalledWith('proj-1', 'delete');
      await waitFor(() =>
        expect(apiMock.deleteProject).toHaveBeenCalledWith('proj-1')
      );
      await waitFor(() => expect(deleted).toHaveBeenCalled());
    });

    it('shows an error toast and dispatches project-refetch-needed on failure', async () => {
      apiMock.deleteProject.mockRejectedValueOnce(new Error('Server error'));
      const refetch = spyOnWindowEvent('project-refetch-needed');

      const user = await openMenu({ projectId: 'proj-err', isShared: false });
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));

      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      await waitFor(() => expect(refetch).toHaveBeenCalled());
    });
  });

  describe('unshare', () => {
    it('optimistically updates, revokes the share, shows a toast, and dispatches project-unshared on success', async () => {
      apiMock.revokeProjectShare.mockResolvedValueOnce(undefined);
      const onProjectUpdate = vi.fn();
      const unshared = spyOnWindowEvent('project-unshared');

      const user = await openMenu({
        projectId: 'proj-shared',
        isShared: true,
        shareId: 'share-abc',
        onProjectUpdate,
      });
      await user.click(screen.getByRole('menuitem', { name: /remove/i }));

      expect(onProjectUpdate).toHaveBeenCalledWith('proj-shared', 'unshare');
      await waitFor(() =>
        expect(apiMock.revokeProjectShare).toHaveBeenCalledWith(
          'proj-shared',
          'share-abc'
        )
      );
      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      await waitFor(() => expect(unshared).toHaveBeenCalled());
    });

    it('skips revokeProjectShare when shareId is undefined but still succeeds', async () => {
      const user = await openMenu({
        projectId: 'proj-no-share-id',
        isShared: true,
        shareId: undefined,
      });
      await user.click(screen.getByRole('menuitem', { name: /remove/i }));

      // The API call is guarded by `if (shareId)`.
      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      expect(apiMock.revokeProjectShare).not.toHaveBeenCalled();
    });

    it('shows an error toast and dispatches project-refetch-needed on failure', async () => {
      apiMock.revokeProjectShare.mockRejectedValueOnce(new Error('Forbidden'));
      const refetch = spyOnWindowEvent('project-refetch-needed');

      const user = await openMenu({
        projectId: 'proj-unshare-fail',
        isShared: true,
        shareId: 'share-fail',
      });
      await user.click(screen.getByRole('menuitem', { name: /remove/i }));

      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      await waitFor(() => expect(refetch).toHaveBeenCalled());
    });
  });

  describe('move to folder', () => {
    it('calls onRequestMove with the projectId when Move is clicked', async () => {
      const onRequestMove = vi.fn();
      const user = await openMenu({
        projectId: 'proj-move-click',
        isShared: false,
        hasAnyFolder: true,
        onRequestMove,
      });
      await user.click(screen.getByRole('menuitem', { name: /move/i }));
      expect(onRequestMove).toHaveBeenCalledWith('proj-move-click');
    });

    it('hides Move when hasAnyFolder is false', async () => {
      await openMenu({
        isShared: false,
        hasAnyFolder: false,
        onRequestMove: vi.fn(),
      });
      expect(screen.queryByRole('menuitem', { name: /move/i })).toBeNull();
    });

    it('hides Move when onRequestMove is undefined', async () => {
      await openMenu({
        isShared: false,
        hasAnyFolder: true,
        onRequestMove: undefined,
      });
      expect(screen.queryByRole('menuitem', { name: /move/i })).toBeNull();
    });
  });
});
