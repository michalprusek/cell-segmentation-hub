import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import ProjectDialogForm from '../ProjectDialogForm';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock the useProjectForm hook — factories are hoisted, so use vi.fn() inline
const mockHandleCreateProject = vi.fn((e: React.FormEvent) => e.preventDefault());
const _mockOnClose = vi.fn();

vi.mock('@/hooks/useProjectForm', () => ({
  useProjectForm: vi.fn(() => ({
    projectName: '',
    setProjectName: vi.fn(),
    projectDescription: '',
    setProjectDescription: vi.fn(),
    isCreating: false,
    handleCreateProject: mockHandleCreateProject,
  })),
}));

// Mock Dialog UI components since they need Dialog context
vi.mock('@/components/ui/dialog', () => ({
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('ProjectDialogForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleCreateProject.mockImplementation((e: React.FormEvent) => e.preventDefault());
  });

  it('renders project name input', () => {
    render(<ProjectDialogForm onClose={vi.fn()} />);
    expect(screen.getByLabelText(/project name/i)).toBeInTheDocument();
  });

  it('renders description input', () => {
    render(<ProjectDialogForm onClose={vi.fn()} />);
    // Two text inputs: name + description
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it('renders a submit button', () => {
    render(<ProjectDialogForm onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  it('shows dialog heading', () => {
    render(<ProjectDialogForm onClose={vi.fn()} />);
    expect(screen.getByRole('heading')).toBeInTheDocument();
  });

  it('form has a submit button that triggers form submission', async () => {
    const handleCreate = vi.fn((e: React.FormEvent) => e.preventDefault());
    const { useProjectForm } = await import('@/hooks/useProjectForm');
    vi.mocked(useProjectForm).mockReturnValueOnce({
      projectName: '',
      setProjectName: vi.fn(),
      projectDescription: '',
      setProjectDescription: vi.fn(),
      isCreating: false,
      handleCreateProject: handleCreate,
    });

    render(<ProjectDialogForm onClose={vi.fn()} />);
    // Submit the form directly using fireEvent
    const form = document.querySelector('form');
    expect(form).toBeInTheDocument();
    if (form) fireEvent.submit(form);
    expect(handleCreate).toHaveBeenCalled();
  });

  it('submit button is disabled when isCreating is true', async () => {
    const { useProjectForm } = await import('@/hooks/useProjectForm');
    vi.mocked(useProjectForm).mockReturnValueOnce({
      projectName: 'Test',
      setProjectName: vi.fn(),
      projectDescription: '',
      setProjectDescription: vi.fn(),
      isCreating: true,
      handleCreateProject: vi.fn(),
    });

    render(<ProjectDialogForm onClose={vi.fn()} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('passes onSuccess and onClose to useProjectForm', async () => {
    const { useProjectForm } = await import('@/hooks/useProjectForm');
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<ProjectDialogForm onSuccess={onSuccess} onClose={onClose} />);
    expect(useProjectForm).toHaveBeenCalledWith(
      expect.objectContaining({ onSuccess, onClose })
    );
  });
});
