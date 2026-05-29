import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import MoveToFolderDialog, {
  type MoveSubject,
} from '@/components/project/MoveToFolderDialog';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockMutateAsync = vi.fn();

vi.mock('@/hooks/useFolders', () => ({
  useFolders: vi.fn(() => ({
    tree: [
      {
        id: 'folder-1',
        name: 'Experiments',
        parentId: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        children: [
          {
            id: 'folder-1-1',
            name: 'Sub Experiment',
            parentId: 'folder-1',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            children: [],
          },
        ],
      },
      {
        id: 'folder-2',
        name: 'Archive',
        parentId: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        children: [],
      },
    ],
    isLoading: false,
  })),
  useMoveProjects: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
  useMoveFolder: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from 'sonner';
import { useMoveProjects, useMoveFolder } from '@/hooks/useFolders';

describe('MoveToFolderDialog', () => {
  const onOpenChange = vi.fn();

  const projectSubject: MoveSubject = {
    kind: 'project',
    ids: ['proj-1', 'proj-2'],
  };

  const folderSubject: MoveSubject = {
    kind: 'folder',
    id: 'folder-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({
      movedProjectIds: ['proj-1', 'proj-2'],
      skippedProjectIds: [],
    });
    vi.mocked(useMoveProjects).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as ReturnType<typeof useMoveProjects>);
    vi.mocked(useMoveFolder).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as ReturnType<typeof useMoveFolder>);
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  it('renders when open=true', () => {
    render(
      <MoveToFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        subject={projectSubject}
      />
    );
    expect(screen.getByText('Move to…')).toBeInTheDocument();
  });

  it('shows the Root option', () => {
    render(
      <MoveToFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        subject={projectSubject}
      />
    );
    expect(screen.getByText('Root (no folder)')).toBeInTheDocument();
  });

  it('renders folder tree from useFolders', () => {
    render(
      <MoveToFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        subject={projectSubject}
      />
    );
    expect(screen.getByText('Experiments')).toBeInTheDocument();
    expect(screen.getByText('Archive')).toBeInTheDocument();
    expect(screen.getByText('Sub Experiment')).toBeInTheDocument();
  });

  it('renders Cancel and Save buttons', () => {
    render(
      <MoveToFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        subject={projectSubject}
      />
    );
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  // ── Folder selection ─────────────────────────────────────────────────────

  it('selecting a folder highlights it', async () => {
    const user = userEvent.setup();
    render(
      <MoveToFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        subject={projectSubject}
      />
    );

    const archiveBtn = screen.getByRole('button', { name: /archive/i });
    await user.click(archiveBtn);

    // After click the button should get the selected styling class
    expect(archiveBtn.className).toMatch(/blue/);
  });

  it('Cancel button calls onOpenChange(false)', async () => {
    const user = userEvent.setup();
    render(
      <MoveToFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        subject={projectSubject}
      />
    );
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // ── Subject: project ─────────────────────────────────────────────────────

  it('Save calls moveProjects.mutateAsync with selected folderId and projectIds', async () => {
    const user = userEvent.setup();
    render(
      <MoveToFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        subject={projectSubject}
      />
    );

    await user.click(screen.getByRole('button', { name: /archive/i }));
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        folderId: 'folder-2',
        projectIds: ['proj-1', 'proj-2'],
      });
    });
  });

  it('shows success toast and closes dialog after successful move', async () => {
    const user = userEvent.setup();
    render(
      <MoveToFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        subject={projectSubject}
      />
    );

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Moved successfully');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('shows warning toast when some projects were skipped', async () => {
    mockMutateAsync.mockResolvedValue({
      movedProjectIds: ['proj-1'],
      skippedProjectIds: ['proj-2'],
    });

    const user = userEvent.setup();
    render(
      <MoveToFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        subject={projectSubject}
      />
    );

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalled();
    });
  });

  it('shows full-skip warning when all projects were skipped', async () => {
    mockMutateAsync.mockResolvedValue({
      movedProjectIds: [],
      skippedProjectIds: ['proj-1', 'proj-2'],
    });

    const user = userEvent.setup();
    render(
      <MoveToFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        subject={projectSubject}
      />
    );

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalled();
    });
  });

  // ── Subject: folder — disabled self/descendants ──────────────────────────

  it('disables the subject folder and its children when subject is a folder', () => {
    render(
      <MoveToFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        subject={folderSubject}
      />
    );

    // "Experiments" = folder-1 = the subject folder → must be disabled
    const experimentsBtn = screen.getByRole('button', { name: /experiments/i });
    expect(experimentsBtn).toBeDisabled();

    // "Sub Experiment" = folder-1-1 (child of subject) → must also be disabled
    const subBtn = screen.getByRole('button', { name: /sub experiment/i });
    expect(subBtn).toBeDisabled();
  });

  it('does NOT disable unrelated folders when subject is a folder', () => {
    render(
      <MoveToFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        subject={folderSubject}
      />
    );

    const archiveBtn = screen.getByRole('button', { name: /archive/i });
    expect(archiveBtn).not.toBeDisabled();
  });

  // ── Subject: folder — move action ────────────────────────────────────────

  it('Save calls moveFolder.mutateAsync with folderId and parentId', async () => {
    const user = userEvent.setup();
    render(
      <MoveToFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        subject={folderSubject}
      />
    );

    await user.click(screen.getByRole('button', { name: /archive/i }));
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        id: 'folder-1',
        parentId: 'folder-2',
      });
    });
  });

  // ── Pending state ────────────────────────────────────────────────────────

  it('disables buttons while a move is pending', () => {
    vi.mocked(useMoveProjects).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: true,
    } as ReturnType<typeof useMoveProjects>);

    render(
      <MoveToFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        subject={projectSubject}
      />
    );

    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  // ── Closed dialog ────────────────────────────────────────────────────────

  it('renders nothing visible when open=false', () => {
    render(
      <MoveToFolderDialog
        open={false}
        onOpenChange={onOpenChange}
        subject={projectSubject}
      />
    );
    expect(screen.queryByText('Move to…')).not.toBeInTheDocument();
  });
});
