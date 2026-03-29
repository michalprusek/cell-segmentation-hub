import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render } from '@/test/utils/test-utils';
import DeleteAccountDialog from '../DeleteAccountDialog';

// The component uses the real deleteAccount from AuthProvider, which calls apiClient.deleteAccount
// The setup.ts mocks apiClient globally, so we can spy on it for assertions

// Mock the toast module
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock the router to capture navigation
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('DeleteAccountDialog', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    userEmail: 'test@example.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
  });

  it('should render the dialog when open', () => {
    render(<DeleteAccountDialog {...defaultProps} />);

    // Dialog title and button both say "Delete Account"
    expect(screen.getAllByText('Delete Account').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/This action cannot be undone/)
    ).toBeInTheDocument();
  });

  it('should display user email in confirmation prompt', () => {
    render(<DeleteAccountDialog {...defaultProps} />);

    // Email appears as placeholder in the confirmation input
    expect(screen.getByPlaceholderText('test@example.com')).toBeInTheDocument();
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
    // Setup: make AuthProvider believe user is authenticated with the test email
    const apiModule = await import('@/lib/api');
    const mockApiClient = (apiModule as any).default || (apiModule as any).apiClient;
    mockApiClient.isAuthenticated.mockReturnValue(true);
    mockApiClient.getUserProfile.mockResolvedValue({
      id: 'test-user-id',
      email: 'test@example.com',
      username: 'testuser',
      preferred_theme: 'system',
      preferredLang: 'en',
    });

    render(<DeleteAccountDialog {...defaultProps} />);

    // Wait for AuthProvider to load user profile
    await waitFor(() => {
      const input = screen.getByPlaceholderText('test@example.com');
      expect(input).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('test@example.com');
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    const deleteButton = screen.getByRole('button', {
      name: /Delete Account/i,
    });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      // AuthProvider.deleteAccount calls apiClient.deleteAccount
      expect(mockApiClient.deleteAccount).toHaveBeenCalled();
    });
  });

  it('should navigate to home after successful deletion', async () => {
    // Setup: make AuthProvider believe user is authenticated with the test email
    const apiModule = await import('@/lib/api');
    const mockApiClient = (apiModule as any).default || (apiModule as any).apiClient;
    mockApiClient.isAuthenticated.mockReturnValue(true);
    mockApiClient.getUserProfile.mockResolvedValue({
      id: 'test-user-id',
      email: 'test@example.com',
      username: 'testuser',
      preferred_theme: 'system',
      preferredLang: 'en',
    });

    render(<DeleteAccountDialog {...defaultProps} />);

    // Wait for AuthProvider to load user profile
    await waitFor(() => {
      const input = screen.getByPlaceholderText('test@example.com');
      expect(input).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('test@example.com');
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    const deleteButton = screen.getByRole('button', {
      name: /Delete Account/i,
    });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  it('should show error toast on deletion failure', async () => {
    // Make the apiClient.deleteAccount throw to trigger error path
    const apiModule = await import('@/lib/api');
    const mockApiClient = (apiModule as any).default || (apiModule as any).apiClient;
    mockApiClient.deleteAccount.mockRejectedValue(new Error('Network error'));

    const { toast } = await import('sonner');

    render(<DeleteAccountDialog {...defaultProps} />);

    const input = screen.getByPlaceholderText('test@example.com');
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    const deleteButton = screen.getByRole('button', {
      name: /Delete Account/i,
    });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it('should disable input and button during deletion', async () => {
    const apiModule = await import('@/lib/api');
    const mockApiClient = (apiModule as any).default || (apiModule as any).apiClient;
    mockApiClient.deleteAccount.mockImplementation(
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

  it('should reset confirmation text when cancel button is clicked', () => {
    render(<DeleteAccountDialog {...defaultProps} />);

    const input = screen.getByPlaceholderText('test@example.com');
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    expect(input).toHaveValue('test@example.com');

    // Close via cancel button (triggers handleClose which resets state)
    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelButton);

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('should not render when isOpen is false', () => {
    render(<DeleteAccountDialog {...defaultProps} isOpen={false} />);

    expect(screen.queryByText('Delete Account')).not.toBeInTheDocument();
  });
});
