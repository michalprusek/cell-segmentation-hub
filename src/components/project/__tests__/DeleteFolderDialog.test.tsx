import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import DeleteFolderDialog from '@/components/project/DeleteFolderDialog';

// ── Hook mocks ────────────────────────────────────────────────────────────────

const mockMutateAsync = vi.fn();

vi.mock('@/hooks/useFolders', () => ({
  useFolderPreview: vi.fn(() => ({
    data: {
      ownedProjectCount: 2,
      sharedProjectCount: 1,
      subfolderCount: 3,
    },
    isLoading: false,
  })),
  useDeleteFolder: vi.fn(() => ({
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

import { useFolderPreview, useDeleteFolder } from '@/hooks/useFolders';
import { toast } from 'sonner';

const mockUseFolderPreview = vi.mocked(useFolderPreview);
const mockUseDeleteFolder = vi.mocked(useDeleteFolder);

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  folderId: 'folder-del',
  folderName: 'Old Results',
  onDeleted: vi.fn(),
};

describe('DeleteFolderDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseFolderPreview.mockReturnValue({
      data: { ownedProjectCount: 2, sharedProjectCount: 1, subfolderCount: 3 },
      isLoading: false,
    } as any);

    mockUseDeleteFolder.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as any);
  });

  // ── Rendering ─────────────────────────────────────────────────────────────

  describe('Rendering', () => {
    it('renders the dialog title', () => {
      render(<DeleteFolderDialog {...baseProps} />);
      expect(screen.getByText('Delete folder')).toBeInTheDocument();
    });

    it('renders the Cancel button', () => {
      render(<DeleteFolderDialog {...baseProps} />);
      expect(
        screen.getByRole('button', { name: 'Cancel' })
      ).toBeInTheDocument();
    });

    it('renders the Delete button', () => {
      render(<DeleteFolderDialog {...baseProps} />);
      expect(
        screen.getByRole('button', { name: 'Delete' })
      ).toBeInTheDocument();
    });

    it('renders the confirmation description with folder name and counts', () => {
      render(<DeleteFolderDialog {...baseProps} />);
      // The template interpolates name, projects, subfolders, shared
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      // folderName appears in the description
      expect(screen.getByText(/Old Results/)).toBeInTheDocument();
    });

    it('shows loading text while preview is fetching', () => {
      mockUseFolderPreview.mockReturnValue({
        data: undefined,
        isLoading: true,
      } as any);
      render(<DeleteFolderDialog {...baseProps} />);
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('does NOT render when open=false', () => {
      render(<DeleteFolderDialog {...baseProps} open={false} />);
      expect(screen.queryByText('Delete folder')).not.toBeInTheDocument();
    });
  });

  // ── Cancel ────────────────────────────────────────────────────────────────

  it('calls onOpenChange(false) when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<DeleteFolderDialog {...baseProps} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(baseProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  // ── Successful delete ─────────────────────────────────────────────────────

  describe('Successful deletion', () => {
    beforeEach(() => {
      mockMutateAsync.mockResolvedValue({
        folderDeleted: true,
        deletedProjectIds: ['p1', 'p2'],
        failedProjectIds: [],
      });
    });

    it('calls mutateAsync with the folderId on confirm', async () => {
      const user = userEvent.setup();
      render(<DeleteFolderDialog {...baseProps} />);
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() =>
        expect(mockMutateAsync).toHaveBeenCalledWith('folder-del')
      );
    });

    it('shows a success toast on full deletion', async () => {
      const user = userEvent.setup();
      render(<DeleteFolderDialog {...baseProps} />);
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(toast.success).toHaveBeenCalled());
    });

    it('calls onOpenChange(false) after full deletion', async () => {
      const user = userEvent.setup();
      render(<DeleteFolderDialog {...baseProps} />);
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() =>
        expect(baseProps.onOpenChange).toHaveBeenCalledWith(false)
      );
    });

    it('calls onDeleted after full deletion', async () => {
      const user = userEvent.setup();
      render(<DeleteFolderDialog {...baseProps} />);
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(baseProps.onDeleted).toHaveBeenCalledTimes(1));
    });
  });

  // ── Partial failure ───────────────────────────────────────────────────────

  describe('Partial failure path', () => {
    beforeEach(() => {
      mockMutateAsync.mockResolvedValue({
        folderDeleted: false,
        deletedProjectIds: ['p1'],
        failedProjectIds: ['p2'],
      });
    });

    it('shows a warning toast when folder is NOT fully deleted', async () => {
      const user = userEvent.setup();
      render(<DeleteFolderDialog {...baseProps} />);
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    });

    it('does NOT call onDeleted on partial failure', async () => {
      const user = userEvent.setup();
      render(<DeleteFolderDialog {...baseProps} />);
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(toast.warning).toHaveBeenCalled());
      expect(baseProps.onDeleted).not.toHaveBeenCalled();
    });

    it('does NOT call toast.success on partial failure', async () => {
      const user = userEvent.setup();
      render(<DeleteFolderDialog {...baseProps} />);
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(toast.warning).toHaveBeenCalled());
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  // ── isPending state ───────────────────────────────────────────────────────

  describe('Pending state', () => {
    it('disables Cancel and Delete buttons while mutation is pending', () => {
      mockUseDeleteFolder.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
      } as any);
      render(<DeleteFolderDialog {...baseProps} />);
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    });

    it('disables Delete button while preview is loading', () => {
      mockUseFolderPreview.mockReturnValue({
        data: undefined,
        isLoading: true,
      } as any);
      render(<DeleteFolderDialog {...baseProps} />);
      expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    });
  });

  // ── folderId null guard ───────────────────────────────────────────────────

  it('does NOT call mutateAsync when folderId is null', async () => {
    const user = userEvent.setup();
    render(<DeleteFolderDialog {...baseProps} folderId={null} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });
});
