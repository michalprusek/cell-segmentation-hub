/**
 * ProjectActions — gap coverage
 *
 * Existing test covers: render, open dropdown, share, delete (success),
 * onProjectUpdate optimistic call.
 *
 * Uncovered: lines 71-174 (handleUnshare success/error, handleDeleteProject
 * error, onDialogStateChange callback, onRequestMove / hasAnyFolder menu item,
 * window events dispatched, isShared + no shareId path).
 *
 * All tests use userEvent.setup() for reliable Radix dropdown interaction.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ProjectActions from '../ProjectActions';
import { toast } from 'sonner';

vi.mock('@/lib/api', () => ({
  default: {
    isAuthenticated: vi.fn(() => false),
    getAccessToken: vi.fn(() => null),
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

import apiClient from '@/lib/api';
const apiMock = apiClient as unknown as {
  deleteProject: ReturnType<typeof vi.fn>;
  revokeProjectShare: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// handleDeleteProject — API error path
// ---------------------------------------------------------------------------

describe('ProjectActions — delete error', () => {
  it('shows error toast and dispatches project-refetch-needed on API failure', async () => {
    apiMock.deleteProject.mockRejectedValueOnce(new Error('Server error'));

    const refetchListener = vi.fn();
    window.addEventListener('project-refetch-needed', refetchListener);

    const user = userEvent.setup();
    render(<ProjectActions projectId="proj-err" isShared={false} />);
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(refetchListener).toHaveBeenCalled();
    });

    window.removeEventListener('project-refetch-needed', refetchListener);
  });
});

// ---------------------------------------------------------------------------
// handleDeleteProject — success dispatches project-deleted event
// ---------------------------------------------------------------------------

describe('ProjectActions — delete success dispatches event', () => {
  it('dispatches project-deleted custom event on successful delete', async () => {
    apiMock.deleteProject.mockResolvedValueOnce(undefined);

    const deleteListener = vi.fn();
    window.addEventListener('project-deleted', deleteListener);

    const user = userEvent.setup();
    render(<ProjectActions projectId="proj-del-event" isShared={false} />);
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));

    await waitFor(() => {
      expect(deleteListener).toHaveBeenCalled();
    });

    window.removeEventListener('project-deleted', deleteListener);
  });
});

// ---------------------------------------------------------------------------
// handleUnshare — success path
// ---------------------------------------------------------------------------

describe('ProjectActions — unshare success', () => {
  it('calls revokeProjectShare and shows success toast', async () => {
    apiMock.revokeProjectShare.mockResolvedValueOnce(undefined);

    const onProjectUpdate = vi.fn();
    const user = userEvent.setup();
    render(
      <ProjectActions
        projectId="proj-shared"
        isShared={true}
        shareId="share-abc"
        onProjectUpdate={onProjectUpdate}
      />
    );

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('menuitem', { name: /remove/i }));

    await waitFor(() => {
      expect(apiMock.revokeProjectShare).toHaveBeenCalledWith(
        'proj-shared',
        'share-abc'
      );
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
    // Optimistic update fired immediately
    expect(onProjectUpdate).toHaveBeenCalledWith('proj-shared', 'unshare');
  });

  it('dispatches project-unshared event on success', async () => {
    apiMock.revokeProjectShare.mockResolvedValueOnce(undefined);

    const unshareListener = vi.fn();
    window.addEventListener('project-unshared', unshareListener);

    const user = userEvent.setup();
    render(
      <ProjectActions
        projectId="proj-unshare-event"
        isShared={true}
        shareId="share-xyz"
      />
    );

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('menuitem', { name: /remove/i }));

    await waitFor(() => {
      expect(unshareListener).toHaveBeenCalled();
    });

    window.removeEventListener('project-unshared', unshareListener);
  });
});

// ---------------------------------------------------------------------------
// handleUnshare — no shareId (skip revokeProjectShare call)
// ---------------------------------------------------------------------------

describe('ProjectActions — unshare with no shareId', () => {
  it('does not call revokeProjectShare when shareId is undefined', async () => {
    apiMock.revokeProjectShare.mockResolvedValueOnce(undefined);

    const user = userEvent.setup();
    render(
      <ProjectActions
        projectId="proj-no-share-id"
        isShared={true}
        shareId={undefined}
      />
    );

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('menuitem', { name: /remove/i }));

    // revokeProjectShare is guarded by if (shareId)
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
    expect(apiMock.revokeProjectShare).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleUnshare — error path
// ---------------------------------------------------------------------------

describe('ProjectActions — unshare error', () => {
  it('shows error toast and dispatches project-refetch-needed on unshare failure', async () => {
    // Ensure the mock is set up fresh (not consumed by a previous test)
    apiMock.revokeProjectShare.mockReset();
    apiMock.revokeProjectShare.mockRejectedValueOnce(new Error('Forbidden'));

    const refetchListener = vi.fn();
    window.addEventListener('project-refetch-needed', refetchListener);

    const user = userEvent.setup();
    render(
      <ProjectActions
        projectId="proj-unshare-fail"
        isShared={true}
        shareId="share-fail"
      />
    );

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('menuitem', { name: /remove/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(refetchListener).toHaveBeenCalled();
    });

    window.removeEventListener('project-refetch-needed', refetchListener);
  });
});

// ---------------------------------------------------------------------------
// onDialogStateChange callback
// ---------------------------------------------------------------------------

describe('ProjectActions — onDialogStateChange', () => {
  it('calls onDialogStateChange(true) when share dialog opens', async () => {
    const onDialogStateChange = vi.fn();
    const user = userEvent.setup();

    render(
      <ProjectActions
        projectId="proj-dialog"
        isShared={false}
        onDialogStateChange={onDialogStateChange}
      />
    );

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('menuitem', { name: /share/i }));

    // Dialog opens after 100ms setTimeout
    await waitFor(
      () => {
        expect(onDialogStateChange).toHaveBeenCalledWith(true);
      },
      { timeout: 500 }
    );
  });
});

// ---------------------------------------------------------------------------
// Move-to-folder menu item (hasAnyFolder + onRequestMove)
// ---------------------------------------------------------------------------

describe('ProjectActions — Move to folder', () => {
  it('renders Move to folder item when hasAnyFolder=true and onRequestMove provided', async () => {
    const onRequestMove = vi.fn();
    const user = userEvent.setup();

    render(
      <ProjectActions
        projectId="proj-move"
        isShared={false}
        hasAnyFolder={true}
        onRequestMove={onRequestMove}
      />
    );

    await user.click(screen.getByRole('button'));
    const moveItem = await screen.findByRole('menuitem', { name: /move/i });
    expect(moveItem).toBeInTheDocument();
  });

  it('calls onRequestMove with projectId when Move item is clicked', async () => {
    const onRequestMove = vi.fn();
    const user = userEvent.setup();

    render(
      <ProjectActions
        projectId="proj-move-click"
        isShared={false}
        hasAnyFolder={true}
        onRequestMove={onRequestMove}
      />
    );

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('menuitem', { name: /move/i }));

    expect(onRequestMove).toHaveBeenCalledWith('proj-move-click');
  });

  it('does NOT render Move item when hasAnyFolder=false', async () => {
    const user = userEvent.setup();

    render(
      <ProjectActions
        projectId="proj-no-folder"
        isShared={false}
        hasAnyFolder={false}
        onRequestMove={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button'));
    expect(screen.queryByRole('menuitem', { name: /move/i })).toBeNull();
  });

  it('does NOT render Move item when onRequestMove is undefined', async () => {
    const user = userEvent.setup();

    render(
      <ProjectActions
        projectId="proj-no-handler"
        isShared={false}
        hasAnyFolder={true}
        onRequestMove={undefined}
      />
    );

    await user.click(screen.getByRole('button'));
    expect(screen.queryByRole('menuitem', { name: /move/i })).toBeNull();
  });
});
