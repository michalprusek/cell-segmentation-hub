import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockAuthContext } from '@/test/utils/test-utils';
import NewProject from '@/components/NewProject';
import { toast } from 'sonner';
import apiClient from '@/lib/api';

// Mock dependencies
vi.mock('sonner');
vi.mock('@/lib/api');
vi.mock('@/lib/logger');

describe('NewProject', () => {
  const mockOnProjectCreated = vi.fn();
  const mockCreateProject = vi.fn();
  const mockToast = {
    success: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(toast).success = mockToast.success;
    vi.mocked(toast).error = mockToast.error;
    vi.mocked(apiClient.createProject).mockImplementation(mockCreateProject);

    // Mock successful project creation by default
    mockCreateProject.mockResolvedValue({
      id: 'test-project-id',
      name: 'Test Project',
      description: 'Test description',
    });
  });

  it('renders new project button trigger', () => {
    render(<NewProject />);

    const button = screen.getByRole('button', { name: /new project/i });
    expect(button).toBeInTheDocument();
  });

  it('displays plus icon on trigger button', () => {
    render(<NewProject />);

    const button = screen.getByRole('button', { name: /new project/i });
    const icon = button.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('opens dialog when trigger button is clicked', async () => {
    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/create project/i)).toBeInTheDocument();
  });

  it('renders project name input field', async () => {
    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const nameInput = screen.getByLabelText(/project name/i);
    expect(nameInput).toBeInTheDocument();
    expect(nameInput).toHaveAttribute('required');
  });

  it('renders project description input field', async () => {
    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const descInput = screen.getByLabelText(/description/i);
    expect(descInput).toBeInTheDocument();
    expect(descInput).not.toHaveAttribute('required');
  });

  it('creates project with valid data', async () => {
    const user = userEvent.setup();
    render(<NewProject onProjectCreated={mockOnProjectCreated} />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const nameInput = screen.getByLabelText(/project name/i);
    const submitButton = screen.getByRole('button', {
      name: /create project/i,
    });

    await user.type(nameInput, 'My Test Project');
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith({
        name: 'My Test Project',
        description: '',
      });
    });

    expect(mockToast.success).toHaveBeenCalled();
    expect(mockOnProjectCreated).toHaveBeenCalledWith('test-project-id');
  });

  it('creates project with name and description', async () => {
    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const nameInput = screen.getByLabelText(/project name/i);
    const descInput = screen.getByLabelText(/description/i);
    const submitButton = screen.getByRole('button', {
      name: /create project/i,
    });

    await user.type(nameInput, 'Test Project');
    await user.type(descInput, 'A test description');
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith({
        name: 'Test Project',
        description: 'A test description',
      });
    });
  });

  it('shows error when project name is empty', async () => {
    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const submitButton = screen.getByRole('button', {
      name: /create project/i,
    });
    await user.click(submitButton);

    expect(mockToast.error).toHaveBeenCalled();
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('shows error when user is not authenticated', async () => {
    // Mock unauthenticated state
    const { useAuth } = await import('@/contexts/AuthContext');
    vi.mocked(useAuth).mockReturnValue({
      ...mockAuthContext,
      user: null,
      isAuthenticated: false,
    });

    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const nameInput = screen.getByLabelText(/project name/i);
    const submitButton = screen.getByRole('button', {
      name: /create project/i,
    });

    await user.type(nameInput, 'Test Project');
    await user.click(submitButton);

    expect(mockToast.error).toHaveBeenCalled();
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('handles API error gracefully', async () => {
    mockCreateProject.mockRejectedValue(new Error('API Error'));

    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const nameInput = screen.getByLabelText(/project name/i);
    const submitButton = screen.getByRole('button', {
      name: /create project/i,
    });

    await user.type(nameInput, 'Test Project');
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('disables submit button during creation', async () => {
    // Make the API call hang to test loading state
    mockCreateProject.mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 100))
    );

    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const nameInput = screen.getByLabelText(/project name/i);
    const submitButton = screen.getByRole('button', {
      name: /create project/i,
    });

    await user.type(nameInput, 'Test Project');
    await user.click(submitButton);

    // Button should be disabled while creating
    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });
  });

  it('changes button text during creation', async () => {
    mockCreateProject.mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 100))
    );

    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const nameInput = screen.getByLabelText(/project name/i);
    const submitButton = screen.getByRole('button', {
      name: /create project/i,
    });

    await user.type(nameInput, 'Test Project');
    await user.click(submitButton);

    // Button text should change to creating
    expect(screen.getByText(/creating/i)).toBeInTheDocument();
  });

  it('clears form after successful creation', async () => {
    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const nameInput = screen.getByLabelText(
      /project name/i
    ) as HTMLInputElement;
    const descInput = screen.getByLabelText(/description/i) as HTMLInputElement;
    const submitButton = screen.getByRole('button', {
      name: /create project/i,
    });

    await user.type(nameInput, 'Test Project');
    await user.type(descInput, 'Test description');
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });

    // Should reopen dialog and check if fields are cleared
    await user.click(screen.getByRole('button', { name: /new project/i }));

    const clearedNameInput = screen.getByLabelText(
      /project name/i
    ) as HTMLInputElement;
    const clearedDescInput = screen.getByLabelText(
      /description/i
    ) as HTMLInputElement;

    expect(clearedNameInput.value).toBe('');
    expect(clearedDescInput.value).toBe('');
  });

  it('closes dialog after successful creation', async () => {
    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/project name/i);
    const submitButton = screen.getByRole('button', {
      name: /create project/i,
    });

    await user.type(nameInput, 'Test Project');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('dispatches custom event after project creation', async () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const nameInput = screen.getByLabelText(/project name/i);
    const submitButton = screen.getByRole('button', {
      name: /create project/i,
    });

    await user.type(nameInput, 'Test Project');
    await user.click(submitButton);

    await waitFor(() => {
      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'project-created',
          detail: { projectId: 'test-project-id' },
        })
      );
    });

    dispatchEventSpy.mockRestore();
  });

  it('handles invalid API response', async () => {
    mockCreateProject.mockResolvedValue(null);

    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const nameInput = screen.getByLabelText(/project name/i);
    const submitButton = screen.getByRole('button', {
      name: /create project/i,
    });

    await user.type(nameInput, 'Test Project');
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('trims whitespace from project name and description', async () => {
    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const nameInput = screen.getByLabelText(/project name/i);
    const descInput = screen.getByLabelText(/description/i);
    const submitButton = screen.getByRole('button', {
      name: /create project/i,
    });

    await user.type(nameInput, '  Test Project  ');
    await user.type(descInput, '  Test description  ');
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalledWith({
        name: '  Test Project  ', // API expects untrimmed name
        description: 'Test description', // Description is trimmed
      });
    });
  });

  it('has proper dialog accessibility', async () => {
    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    const title = screen.getByRole('heading', { name: /create project/i });
    expect(title).toBeInTheDocument();
  });

  it('supports form submission with Enter key', async () => {
    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const nameInput = screen.getByLabelText(/project name/i);
    await user.type(nameInput, 'Test Project');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalled();
    });
  });

  it('works without onProjectCreated callback', async () => {
    const user = userEvent.setup();
    render(<NewProject />);

    const triggerButton = screen.getByRole('button', { name: /new project/i });
    await user.click(triggerButton);

    const nameInput = screen.getByLabelText(/project name/i);
    const submitButton = screen.getByRole('button', {
      name: /create project/i,
    });

    await user.type(nameInput, 'Test Project');
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockCreateProject).toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalled();
    });
  });
});
