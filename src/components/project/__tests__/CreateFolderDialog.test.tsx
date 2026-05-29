import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import CreateFolderDialog from '@/components/project/CreateFolderDialog';

const mockMutateAsync = vi.fn();

vi.mock('@/hooks/useFolders', () => ({
  useCreateFolder: vi.fn(() => ({
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

import { useCreateFolder } from '@/hooks/useFolders';
import { toast } from 'sonner';

const mockUseCreateFolder = vi.mocked(useCreateFolder);

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  parentId: null as string | null,
};

describe('CreateFolderDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseCreateFolder.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as any);
  });

  // ── Rendering ─────────────────────────────────────────────────────────────

  describe('Rendering', () => {
    it('renders the dialog title', () => {
      render(<CreateFolderDialog {...baseProps} />);
      expect(screen.getByText('Create folder')).toBeInTheDocument();
    });

    it('renders the Folder name label', () => {
      render(<CreateFolderDialog {...baseProps} />);
      expect(screen.getByText('Folder name')).toBeInTheDocument();
    });

    it('renders an empty input on first open', () => {
      render(<CreateFolderDialog {...baseProps} />);
      expect(screen.getByRole('textbox')).toHaveValue('');
    });

    it('renders the placeholder text on the input', () => {
      render(<CreateFolderDialog {...baseProps} />);
      expect(screen.getByRole('textbox')).toHaveAttribute(
        'placeholder',
        'e.g. Experiment A'
      );
    });

    it('renders the Cancel button', () => {
      render(<CreateFolderDialog {...baseProps} />);
      expect(
        screen.getByRole('button', { name: 'Cancel' })
      ).toBeInTheDocument();
    });

    it('renders the Create button', () => {
      render(<CreateFolderDialog {...baseProps} />);
      expect(
        screen.getByRole('button', { name: 'Create' })
      ).toBeInTheDocument();
    });

    it('does NOT render when open=false', () => {
      render(<CreateFolderDialog {...baseProps} open={false} />);
      expect(screen.queryByText('Create folder')).not.toBeInTheDocument();
    });
  });

  // ── Validation: Create button disabled when blank ─────────────────────────

  describe('Validation', () => {
    it('Create button is disabled when input is empty', () => {
      render(<CreateFolderDialog {...baseProps} />);
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    });

    it('Create button is disabled when input contains only whitespace', async () => {
      const user = userEvent.setup({ delay: null });
      render(<CreateFolderDialog {...baseProps} />);
      await user.type(screen.getByRole('textbox'), '   ');
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    });

    it('Create button becomes enabled when a non-blank name is entered', async () => {
      const user = userEvent.setup({ delay: null });
      render(<CreateFolderDialog {...baseProps} />);
      await user.type(screen.getByRole('textbox'), 'New Folder');
      expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
    });
  });

  // ── Reset on reopen ───────────────────────────────────────────────────────

  describe('State reset', () => {
    it('clears the input when dialog is reopened after being closed', async () => {
      const user = userEvent.setup({ delay: null });
      const { rerender } = render(<CreateFolderDialog {...baseProps} />);
      await user.type(screen.getByRole('textbox'), 'Typed name');
      // close
      rerender(<CreateFolderDialog {...baseProps} open={false} />);
      // reopen
      rerender(<CreateFolderDialog {...baseProps} open />);
      expect(screen.getByRole('textbox')).toHaveValue('');
    });
  });

  // ── Successful create (root) ──────────────────────────────────────────────

  describe('Successful creation at root', () => {
    beforeEach(() => {
      mockMutateAsync.mockResolvedValue({
        id: 'new-folder-id',
        name: 'Batch A',
      });
    });

    it('calls mutateAsync with trimmed name and parentId=null', async () => {
      const user = userEvent.setup({ delay: null });
      render(<CreateFolderDialog {...baseProps} parentId={null} />);
      await user.type(screen.getByRole('textbox'), '  Batch A  ');
      await user.click(screen.getByRole('button', { name: 'Create' }));
      await waitFor(() =>
        expect(mockMutateAsync).toHaveBeenCalledWith({
          name: 'Batch A',
          parentId: null,
        })
      );
    });

    it('shows a success toast on creation', async () => {
      const user = userEvent.setup({ delay: null });
      render(<CreateFolderDialog {...baseProps} />);
      await user.type(screen.getByRole('textbox'), 'Batch A');
      await user.click(screen.getByRole('button', { name: 'Create' }));
      await waitFor(() => expect(toast.success).toHaveBeenCalled());
    });

    it('calls onOpenChange(false) after creation', async () => {
      const user = userEvent.setup({ delay: null });
      render(<CreateFolderDialog {...baseProps} />);
      await user.type(screen.getByRole('textbox'), 'Batch A');
      await user.click(screen.getByRole('button', { name: 'Create' }));
      await waitFor(() =>
        expect(baseProps.onOpenChange).toHaveBeenCalledWith(false)
      );
    });
  });

  // ── Successful create (with parentId) ────────────────────────────────────

  it('passes parentId to mutateAsync when creating nested folder', async () => {
    const user = userEvent.setup({ delay: null });
    mockMutateAsync.mockResolvedValue({ id: 'child-folder', name: 'Sub' });
    render(<CreateFolderDialog {...baseProps} parentId="parent-folder-id" />);
    await user.type(screen.getByRole('textbox'), 'Sub');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        name: 'Sub',
        parentId: 'parent-folder-id',
      })
    );
  });

  // ── Cancel ────────────────────────────────────────────────────────────────

  it('calls onOpenChange(false) when Cancel is clicked', async () => {
    const user = userEvent.setup({ delay: null });
    render(<CreateFolderDialog {...baseProps} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(baseProps.onOpenChange).toHaveBeenCalledWith(false);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  // ── isPending state ───────────────────────────────────────────────────────

  describe('Pending state', () => {
    it('disables Cancel button while mutation is pending', () => {
      mockUseCreateFolder.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
      } as any);
      render(<CreateFolderDialog {...baseProps} />);
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });

    it('disables Create button while mutation is pending even when name is filled', async () => {
      const user = userEvent.setup({ delay: null });
      mockUseCreateFolder.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      } as any);
      render(<CreateFolderDialog {...baseProps} />);
      await user.type(screen.getByRole('textbox'), 'Name');
      // Now simulate isPending
      mockUseCreateFolder.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: true,
      } as any);
      // Re-render to pick up new hook return
      const { rerender } = render(<CreateFolderDialog {...baseProps} />);
      rerender(<CreateFolderDialog {...baseProps} />);
      await user.type(screen.getByRole('textbox'), 'Name');
      expect(
        screen.getAllByRole('button', { name: 'Create' })[0]
      ).toBeDisabled();
    });
  });

  // ── Input constraints ─────────────────────────────────────────────────────

  it('enforces maxLength 100 on the input', () => {
    render(<CreateFolderDialog {...baseProps} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', '100');
  });

  // ── Form submission via Enter key ─────────────────────────────────────────

  it('submits the form when Enter is pressed inside the input', async () => {
    const user = userEvent.setup({ delay: null });
    mockMutateAsync.mockResolvedValue({ id: 'f', name: 'KeyEnter' });
    render(<CreateFolderDialog {...baseProps} />);
    await user.type(screen.getByRole('textbox'), 'KeyEnter');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        name: 'KeyEnter',
        parentId: null,
      })
    );
  });
});
