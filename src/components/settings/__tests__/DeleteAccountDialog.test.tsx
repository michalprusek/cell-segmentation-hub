import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { DeleteAccountDialog } from '../DeleteAccountDialog';
import * as api from '@/lib/api';

// Mock the API module
vi.mock('@/lib/api', () => ({
  deleteAccount: vi.fn(),
}));

// Mock the toast module
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock the router
const mockPush = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockPush,
}));

describe('DeleteAccountDialog', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    userEmail: 'test@example.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the dialog when open', () => {
    render(<DeleteAccountDialog {...defaultProps} />);

    expect(screen.getByText('Delete Account')).toBeInTheDocument();
    expect(
      screen.getByText(/This action cannot be undone/)
    ).toBeInTheDocument();
  });

  it('should display user email in confirmation prompt', () => {
    render(<DeleteAccountDialog {...defaultProps} />);

    expect(screen.getByText(/test@example.com/)).toBeInTheDocument();
  });

  it('should display what will be deleted', () => {
    render(<DeleteAccountDialog {...defaultProps} />);

    expect(
      screen.getByText(/Your user account and profile/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/All your projects and images/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/All segmentation data and results/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Account settings and preferences/)
    ).toBeInTheDocument();
  });

  it('should disable delete button when confirmation text does not match', () => {
    render(<DeleteAccountDialog {...defaultProps} />);

    const deleteButton = screen.getByRole('button', {
      name: /Delete Account/i,
    });
    expect(deleteButton).toBeDisabled();
  });

  it('should enable delete button when confirmation text matches email', () => {
    render(<DeleteAccountDialog {...defaultProps} />);

    const input = screen.getByPlaceholderText('test@example.com');
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    const deleteButton = screen.getByRole('button', {
      name: /Delete Account/i,
    });
    expect(deleteButton).not.toBeDisabled();
  });

  it('should require exact email match (case sensitive)', () => {
    render(<DeleteAccountDialog {...defaultProps} />);

    const input = screen.getByPlaceholderText('test@example.com');
    fireEvent.change(input, { target: { value: 'TEST@EXAMPLE.COM' } });

    const deleteButton = screen.getByRole('button', {
      name: /Delete Account/i,
    });
    expect(deleteButton).toBeDisabled();
  });

  it('should call deleteAccount API when confirmed', async () => {
    const mockDeleteAccount = vi.mocked(api.deleteAccount);
    mockDeleteAccount.mockResolvedValue({ success: true });

    render(<DeleteAccountDialog {...defaultProps} />);

    const input = screen.getByPlaceholderText('test@example.com');
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    const deleteButton = screen.getByRole('button', {
      name: /Delete Account/i,
    });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    });
  });

  it('should redirect to home after successful deletion', async () => {
    const mockDeleteAccount = vi.mocked(api.deleteAccount);
    mockDeleteAccount.mockResolvedValue({ success: true });

    render(<DeleteAccountDialog {...defaultProps} />);

    const input = screen.getByPlaceholderText('test@example.com');
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    const deleteButton = screen.getByRole('button', {
      name: /Delete Account/i,
    });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('should show error toast on deletion failure', async () => {
    const mockDeleteAccount = vi.mocked(api.deleteAccount);
    mockDeleteAccount.mockRejectedValue(new Error('Network error'));

    const { toast } = await import('sonner');

    render(<DeleteAccountDialog {...defaultProps} />);

    const input = screen.getByPlaceholderText('test@example.com');
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    const deleteButton = screen.getByRole('button', {
      name: /Delete Account/i,
    });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete account')
      );
    });
  });

  it('should disable input and button during deletion', async () => {
    const mockDeleteAccount = vi.mocked(api.deleteAccount);
    mockDeleteAccount.mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 100))
    );

    render(<DeleteAccountDialog {...defaultProps} />);

    const input = screen.getByPlaceholderText('test@example.com');
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    const deleteButton = screen.getByRole('button', {
      name: /Delete Account/i,
    });
    fireEvent.click(deleteButton);

    // Check that input and button are disabled during deletion
    expect(input).toBeDisabled();
    expect(deleteButton).toBeDisabled();
  });

  it('should call onClose when cancel button is clicked', () => {
    render(<DeleteAccountDialog {...defaultProps} />);

    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelButton);

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('should reset confirmation text when dialog is closed and reopened', () => {
    const { rerender } = render(<DeleteAccountDialog {...defaultProps} />);

    const input = screen.getByPlaceholderText('test@example.com');
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    // Close dialog
    rerender(<DeleteAccountDialog {...defaultProps} isOpen={false} />);

    // Reopen dialog
    rerender(<DeleteAccountDialog {...defaultProps} isOpen={true} />);

    const newInput = screen.getByPlaceholderText('test@example.com');
    expect(newInput).toHaveValue('');
  });

  it('should not render when isOpen is false', () => {
    render(<DeleteAccountDialog {...defaultProps} isOpen={false} />);

    expect(screen.queryByText('Delete Account')).not.toBeInTheDocument();
  });
});
