import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import RenameFolderDialog from '@/components/project/RenameFolderDialog';

const mockMutateAsync = vi.fn();

vi.mock('@/hooks/useFolders', () => ({
  useRenameFolder: vi.fn(() => ({
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

import { useRenameFolder } from '@/hooks/useFolders';
import { toast } from 'sonner';

const mockUseRenameFolder = vi.mocked(useRenameFolder);

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  folderId: 'folder-ren',
  currentName: 'Original Name',
};

describe('RenameFolderDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseRenameFolder.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as any);
  });

  // ── Rendering ─────────────────────────────────────────────────────────────

  describe('Rendering', () => {
    it('renders the dialog title', () => {
      render(<RenameFolderDialog {...baseProps} />);
      expect(screen.getByText('Rename folder')).toBeInTheDocument();
    });

    it('renders the Folder name label', () => {
      render(<RenameFolderDialog {...baseProps} />);
      expect(screen.getByText('Folder name')).toBeInTheDocument();
    });

    it('pre-fills the input with currentName', () => {
      render(<RenameFolderDialog {...baseProps} />);
      expect(screen.getByRole('textbox')).toHaveValue('Original Name');
    });

    it('renders the Cancel button', () => {
      render(<RenameFolderDialog {...baseProps} />);
      expect(
        screen.getByRole('button', { name: 'Cancel' })
      ).toBeInTheDocument();
    });

    it('renders the Save button', () => {
      render(<RenameFolderDialog {...baseProps} />);
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });

    it('does NOT render when open=false', () => {
      render(<RenameFolderDialog {...baseProps} open={false} />);
      expect(screen.queryByText('Rename folder')).not.toBeInTheDocument();
    });
  });

  // ── Input updates ─────────────────────────────────────────────────────────

  describe('Input behaviour', () => {
    it('updates the input value as the user types', async () => {
      const user = userEvent.setup({ delay: null });
      render(<RenameFolderDialog {...baseProps} />);
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'New Name');
      expect(input).toHaveValue('New Name');
    });

    it('resets to currentName when dialog reopens', async () => {
      const user = userEvent.setup({ delay: null });
      const { rerender } = render(<RenameFolderDialog {...baseProps} />);
      await user.clear(screen.getByRole('textbox'));
      await user.type(screen.getByRole('textbox'), 'Tmp');
      // Close then reopen
      rerender(<RenameFolderDialog {...baseProps} open={false} />);
      rerender(<RenameFolderDialog {...baseProps} open />);
      expect(screen.getByRole('textbox')).toHaveValue('Original Name');
    });
  });

  // ── Submit: name unchanged ────────────────────────────────────────────────

  describe('Submit: unchanged name', () => {
    it('closes without calling mutateAsync when name is unchanged', async () => {
      const user = userEvent.setup({ delay: null });
      render(<RenameFolderDialog {...baseProps} />);
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(mockMutateAsync).not.toHaveBeenCalled();
      expect(baseProps.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  // ── Submit: blank name (trimmed) ──────────────────────────────────────────

  describe('Submit: blank name', () => {
    it('Save button is disabled when input is blank', async () => {
      const user = userEvent.setup({ delay: null });
      render(<RenameFolderDialog {...baseProps} />);
      const input = screen.getByRole('textbox');
      await user.clear(input);
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });
  });

  // ── Successful rename ─────────────────────────────────────────────────────

  describe('Successful rename', () => {
    beforeEach(() => {
      mockMutateAsync.mockResolvedValue({ id: 'folder-ren', name: 'Renamed' });
    });

    it('calls mutateAsync with id and trimmed name', async () => {
      const user = userEvent.setup({ delay: null });
      render(<RenameFolderDialog {...baseProps} />);
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, '  Renamed  ');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(mockMutateAsync).toHaveBeenCalledWith({
          id: 'folder-ren',
          name: 'Renamed',
        })
      );
    });

    it('shows a success toast after rename', async () => {
      const user = userEvent.setup({ delay: null });
      render(<RenameFolderDialog {...baseProps} />);
      await user.clear(screen.getByRole('textbox'));
      await user.type(screen.getByRole('textbox'), 'Renamed');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(toast.success).toHaveBeenCalled());
    });

    it('calls onOpenChange(false) after successful rename', async () => {
      const user = userEvent.setup({ delay: null });
      render(<RenameFolderDialog {...baseProps} />);
      await user.clear(screen.getByRole('textbox'));
      await user.type(screen.getByRole('textbox'), 'Renamed');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(baseProps.onOpenChange).toHaveBeenCalledWith(false)
      );
    });
  });

  // ── Cancel ────────────────────────────────────────────────────────────────

  it('calls onOpenChange(false) when Cancel is clicked', async () => {
    const user = userEvent.setup({ delay: null });
    render(<RenameFolderDialog {...baseProps} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(baseProps.onOpenChange).toHaveBeenCalledWith(false);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  // ── isPending state ───────────────────────────────────────────────────────

  it('disables Save and Cancel while mutation is pending', () => {
    mockUseRenameFolder.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: true,
    } as any);
    render(<RenameFolderDialog {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    // Save is also disabled because of `!name.trim() || mutation.isPending`
    // The pre-filled value is non-empty so isPending is the gating factor
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  // ── Input constraints ─────────────────────────────────────────────────────

  it('enforces maxLength 100 on the input', () => {
    render(<RenameFolderDialog {...baseProps} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', '100');
  });
});
