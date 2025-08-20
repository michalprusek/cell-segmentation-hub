import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import DashboardActions from '@/components/DashboardActions';

describe('DashboardActions', () => {
  const mockSetViewMode = vi.fn();
  const mockOnSort = vi.fn();

  const defaultProps = {
    viewMode: 'grid' as const,
    setViewMode: mockSetViewMode,
  };

  const sortOptions = [
    { field: 'createdAt', label: 'Date Created' },
    { field: 'name', label: 'Name' },
    { field: 'updatedAt', label: 'Last Modified' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders grid and list view mode buttons', () => {
    render(<DashboardActions {...defaultProps} />);

    const gridButton = screen.getByRole('button', { name: /grid/i });
    const listButton = screen.getByRole('button', { name: /list/i });

    expect(gridButton).toBeInTheDocument();
    expect(listButton).toBeInTheDocument();
  });

  it('shows grid button as selected when viewMode is grid', () => {
    render(<DashboardActions {...defaultProps} viewMode="grid" />);

    const gridButton = screen.getByRole('button', { name: /grid/i });
    const listButton = screen.getByRole('button', { name: /list/i });

    // Grid button should have "default" variant styling (selected)
    expect(gridButton).toHaveClass('bg-primary', 'text-primary-foreground');
    // List button should have "ghost" variant styling (not selected)
    expect(listButton).not.toHaveClass('bg-primary');
  });

  it('shows list button as selected when viewMode is list', () => {
    render(<DashboardActions {...defaultProps} viewMode="list" />);

    const gridButton = screen.getByRole('button', { name: /grid/i });
    const listButton = screen.getByRole('button', { name: /list/i });

    // List button should have "default" variant styling (selected)
    expect(listButton).toHaveClass('bg-primary', 'text-primary-foreground');
    // Grid button should have "ghost" variant styling (not selected)
    expect(gridButton).not.toHaveClass('bg-primary');
  });

  it('calls setViewMode with "grid" when grid button is clicked', async () => {
    const user = userEvent.setup();
    render(<DashboardActions {...defaultProps} viewMode="list" />);

    const gridButton = screen.getByRole('button', { name: /grid/i });
    await user.click(gridButton);

    expect(mockSetViewMode).toHaveBeenCalledWith('grid');
    expect(mockSetViewMode).toHaveBeenCalledTimes(1);
  });

  it('calls setViewMode with "list" when list button is clicked', async () => {
    const user = userEvent.setup();
    render(<DashboardActions {...defaultProps} viewMode="grid" />);

    const listButton = screen.getByRole('button', { name: /list/i });
    await user.click(listButton);

    expect(mockSetViewMode).toHaveBeenCalledWith('list');
    expect(mockSetViewMode).toHaveBeenCalledTimes(1);
  });

  it('has proper styling for button container', () => {
    render(<DashboardActions {...defaultProps} />);

    const buttonContainer = document.querySelector(
      '.flex.items-center.h-9.border.rounded-md.bg-background'
    );
    expect(buttonContainer).toBeInTheDocument();
  });

  it('buttons have proper styling classes', () => {
    render(<DashboardActions {...defaultProps} />);

    const gridButton = screen.getByRole('button', { name: /grid/i });
    const listButton = screen.getByRole('button', { name: /list/i });

    expect(gridButton).toHaveClass('h-9', 'px-2.5', 'rounded-r-none');
    expect(listButton).toHaveClass('h-9', 'px-2.5', 'rounded-l-none');
  });

  it('renders grid icon in grid button', () => {
    render(<DashboardActions {...defaultProps} />);

    const gridButton = screen.getByRole('button', { name: /grid/i });
    const gridIcon = gridButton.querySelector('svg');

    expect(gridIcon).toBeInTheDocument();
    expect(gridIcon).toHaveClass('h-4', 'w-4');
  });

  it('renders list icon in list button', () => {
    render(<DashboardActions {...defaultProps} />);

    const listButton = screen.getByRole('button', { name: /list/i });
    const listIcon = listButton.querySelector('svg');

    expect(listIcon).toBeInTheDocument();
    expect(listIcon).toHaveClass('h-4', 'w-4');
  });

  it('handles rapid clicking without issues', async () => {
    const user = userEvent.setup();
    render(<DashboardActions {...defaultProps} />);

    const gridButton = screen.getByRole('button', { name: /grid/i });
    const listButton = screen.getByRole('button', { name: /list/i });

    // Click buttons rapidly
    await user.click(listButton);
    await user.click(gridButton);
    await user.click(listButton);
    await user.click(gridButton);

    expect(mockSetViewMode).toHaveBeenCalledTimes(4);
    expect(mockSetViewMode).toHaveBeenNthCalledWith(1, 'list');
    expect(mockSetViewMode).toHaveBeenNthCalledWith(2, 'grid');
    expect(mockSetViewMode).toHaveBeenNthCalledWith(3, 'list');
    expect(mockSetViewMode).toHaveBeenNthCalledWith(4, 'grid');
  });

  it('maintains button state consistency', () => {
    const { rerender } = render(
      <DashboardActions {...defaultProps} viewMode="grid" />
    );

    let gridButton = screen.getByRole('button', { name: /grid/i });
    let listButton = screen.getByRole('button', { name: /list/i });

    expect(gridButton).toHaveClass('bg-primary');
    expect(listButton).not.toHaveClass('bg-primary');

    rerender(<DashboardActions {...defaultProps} viewMode="list" />);

    gridButton = screen.getByRole('button', { name: /grid/i });
    listButton = screen.getByRole('button', { name: /list/i });

    expect(listButton).toHaveClass('bg-primary');
    expect(gridButton).not.toHaveClass('bg-primary');
  });

  it('has proper accessible button structure', () => {
    render(<DashboardActions {...defaultProps} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);

    buttons.forEach(button => {
      expect(button).toBeEnabled();
      expect(button).toBeVisible();
    });
  });

  it('responds to keyboard navigation', async () => {
    const user = userEvent.setup();
    render(<DashboardActions {...defaultProps} />);

    const gridButton = screen.getByRole('button', { name: /grid/i });

    // Focus and activate with Enter
    gridButton.focus();
    expect(gridButton).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(mockSetViewMode).toHaveBeenCalledWith('grid');
  });

  it('responds to Space key activation', async () => {
    const user = userEvent.setup();
    render(<DashboardActions {...defaultProps} />);

    const listButton = screen.getByRole('button', { name: /list/i });

    listButton.focus();
    await user.keyboard(' ');
    expect(mockSetViewMode).toHaveBeenCalledWith('list');
  });

  it('has proper component structure', () => {
    const { container } = render(<DashboardActions {...defaultProps} />);

    const outerDiv = container.firstChild;
    expect(outerDiv).toHaveClass('flex', 'items-center', 'space-x-2');

    const buttonContainer = container.querySelector(
      '.flex.items-center.h-9.border'
    );
    expect(buttonContainer).toBeInTheDocument();
    expect(buttonContainer?.children).toHaveLength(2);
  });

  it('maintains size prop on buttons', () => {
    render(<DashboardActions {...defaultProps} />);

    const buttons = screen.getAllByRole('button');
    buttons.forEach(button => {
      expect(button).toHaveClass('h-9');
    });
  });

  it('handles props with default sortOptions', () => {
    render(<DashboardActions {...defaultProps} />);

    // Component should render without sort options
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('handles onSort prop when provided', () => {
    render(
      <DashboardActions
        {...defaultProps}
        onSort={mockOnSort}
        sortOptions={sortOptions}
      />
    );

    // Should still render view mode buttons
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('handles empty sortOptions array', () => {
    render(
      <DashboardActions
        {...defaultProps}
        onSort={mockOnSort}
        sortOptions={[]}
      />
    );

    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
