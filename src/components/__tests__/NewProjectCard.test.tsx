import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import NewProjectCard from '@/components/NewProjectCard';

// Mock child components
vi.mock('@/components/project/NewProjectCardUI', () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <div data-testid="new-project-card-ui" onClick={onClick}>
      Create New Project
    </div>
  ),
}));

vi.mock('@/components/project/ProjectDialogForm', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="project-dialog-form">
      <h2>Project Dialog Form</h2>
      <button onClick={onClose} data-testid="close-form">
        Close
      </button>
    </div>
  ),
}));

describe('NewProjectCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders NewProjectCardUI when used as standalone component', () => {
    render(<NewProjectCard />);

    expect(screen.getByTestId('new-project-card-ui')).toBeInTheDocument();
    expect(screen.getByText('Create New Project')).toBeInTheDocument();
  });

  it('opens dialog when NewProjectCardUI is clicked', async () => {
    const user = userEvent.setup();
    render(<NewProjectCard />);

    const cardUI = screen.getByTestId('new-project-card-ui');
    await user.click(cardUI);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('project-dialog-form')).toBeInTheDocument();
  });

  it('closes dialog when ProjectDialogForm calls onClose', async () => {
    const user = userEvent.setup();
    render(<NewProjectCard />);

    // Open dialog
    const cardUI = screen.getByTestId('new-project-card-ui');
    await user.click(cardUI);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Close dialog
    const closeButton = screen.getByTestId('close-form');
    await user.click(closeButton);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses external state when isOpen and onOpenChange are provided', () => {
    const mockOnOpenChange = vi.fn();
    render(<NewProjectCard isOpen={true} onOpenChange={mockOnOpenChange} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('project-dialog-form')).toBeInTheDocument();
    expect(screen.queryByTestId('new-project-card-ui')).not.toBeInTheDocument();
  });

  it('calls onOpenChange when dialog state changes with external control', async () => {
    const mockOnOpenChange = vi.fn();
    const user = userEvent.setup();

    render(<NewProjectCard isOpen={true} onOpenChange={mockOnOpenChange} />);

    // Close dialog via form
    const closeButton = screen.getByTestId('close-form');
    await user.click(closeButton);

    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  it('starts with closed dialog when isOpen is false', () => {
    const mockOnOpenChange = vi.fn();
    render(<NewProjectCard isOpen={false} onOpenChange={mockOnOpenChange} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-project-card-ui')).not.toBeInTheDocument();
  });

  it('maintains internal state when not externally controlled', async () => {
    const user = userEvent.setup();
    render(<NewProjectCard />);

    // Initially closed
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Open dialog
    const cardUI = screen.getByTestId('new-project-card-ui');
    await user.click(cardUI);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Close dialog
    const closeButton = screen.getByTestId('close-form');
    await user.click(closeButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders only dialog content when externally controlled', () => {
    const mockOnOpenChange = vi.fn();
    render(<NewProjectCard isOpen={true} onOpenChange={mockOnOpenChange} />);

    // Should not render the card UI
    expect(screen.queryByTestId('new-project-card-ui')).not.toBeInTheDocument();

    // Should render dialog content
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('project-dialog-form')).toBeInTheDocument();
  });

  it('has proper dialog structure with maxWidth', () => {
    render(<NewProjectCard />);

    // Open dialog first
    fireEvent.click(screen.getByTestId('new-project-card-ui'));

    const dialogContent = document.querySelector('.sm\\:max-w-\\[425px\\]');
    expect(dialogContent).toBeInTheDocument();
  });

  it('handles mixed internal and external state correctly', () => {
    const mockOnOpenChange = vi.fn();
    const { rerender } = render(<NewProjectCard />);

    // Initially using internal state
    expect(screen.getByTestId('new-project-card-ui')).toBeInTheDocument();

    // Switch to external control
    rerender(<NewProjectCard isOpen={true} onOpenChange={mockOnOpenChange} />);

    expect(screen.queryByTestId('new-project-card-ui')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('handles dialog close via escape key or backdrop click', async () => {
    const user = userEvent.setup();
    render(<NewProjectCard />);

    // Open dialog
    const cardUI = screen.getByTestId('new-project-card-ui');
    await user.click(cardUI);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Close via escape key
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('respects external onOpenChange when closing dialog', async () => {
    const mockOnOpenChange = vi.fn();
    const user = userEvent.setup();

    render(<NewProjectCard isOpen={true} onOpenChange={mockOnOpenChange} />);

    // Close dialog by pressing escape
    await user.keyboard('{Escape}');

    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  it('maintains accessibility with proper dialog attributes', async () => {
    const user = userEvent.setup();
    render(<NewProjectCard />);

    // Open dialog
    const cardUI = screen.getByTestId('new-project-card-ui');
    await user.click(cardUI);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
  });

  it('handles rapid open/close operations correctly', async () => {
    const user = userEvent.setup();
    render(<NewProjectCard />);

    const cardUI = screen.getByTestId('new-project-card-ui');

    // Rapid clicking
    await user.click(cardUI);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const closeButton = screen.getByTestId('close-form');
    await user.click(closeButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(cardUI);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('properly initializes internal state', () => {
    render(<NewProjectCard />);

    // Should start closed
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('new-project-card-ui')).toBeInTheDocument();
  });

  it('handles undefined onOpenChange gracefully', () => {
    render(<NewProjectCard isOpen={false} />);

    // Should render in controlled mode but without callback
    expect(screen.queryByTestId('new-project-card-ui')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('works correctly when switching from controlled to uncontrolled', () => {
    const mockOnOpenChange = vi.fn();
    const { rerender } = render(
      <NewProjectCard isOpen={false} onOpenChange={mockOnOpenChange} />
    );

    expect(screen.queryByTestId('new-project-card-ui')).not.toBeInTheDocument();

    // Switch to uncontrolled
    rerender(<NewProjectCard />);

    expect(screen.getByTestId('new-project-card-ui')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
