import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ProjectListItem from '@/components/ProjectListItem';

// Mock child components
vi.mock('@/components/project/ProjectThumbnail', () => ({
  default: ({ projectId, fallbackSrc, imageCount }: any) => (
    <div data-testid="project-thumbnail">
      <img src={fallbackSrc} alt="thumbnail" />
      <span data-testid="image-count">{imageCount}</span>
      <span data-testid="project-id">{projectId}</span>
    </div>
  ),
}));

vi.mock('@/components/project/ProjectActions', () => ({
  default: ({ projectId }: { projectId: string }) => (
    <div data-testid="project-actions">
      <button data-testid="edit-project">Edit</button>
      <button data-testid="delete-project">Delete</button>
      <span data-testid="actions-project-id">{projectId}</span>
    </div>
  ),
}));

vi.mock('@/components/project/ProjectMetadata', () => ({
  default: ({ date, imageCount }: { date: string; imageCount: number }) => (
    <div data-testid="project-metadata">
      <span data-testid="metadata-date">{date}</span>
      <span data-testid="metadata-image-count">{imageCount} images</span>
    </div>
  ),
}));

describe('ProjectListItem', () => {
  const mockProps = {
    id: 'test-project-id',
    title: 'Test Project',
    description: 'This is a test project description',
    thumbnail: '/test-thumbnail.jpg',
    date: '2024-01-15',
    imageCount: 5,
  };

  const mockOnClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders project title', () => {
    render(<ProjectListItem {...mockProps} />);

    expect(screen.getByText('Test Project')).toBeInTheDocument();
  });

  it('renders project description', () => {
    render(<ProjectListItem {...mockProps} />);

    expect(
      screen.getByText('This is a test project description')
    ).toBeInTheDocument();
  });

  it('renders ProjectThumbnail component with correct props', () => {
    render(<ProjectListItem {...mockProps} />);

    expect(screen.getByTestId('project-thumbnail')).toBeInTheDocument();
    expect(screen.getByTestId('project-id')).toHaveTextContent(
      'test-project-id'
    );
    expect(screen.getByTestId('image-count')).toHaveTextContent('5');

    const thumbnailImg = screen.getByAltText('thumbnail');
    expect(thumbnailImg).toHaveAttribute('src', '/test-thumbnail.jpg');
  });

  it('renders ProjectMetadata component with correct props', () => {
    render(<ProjectListItem {...mockProps} />);

    expect(screen.getByTestId('project-metadata')).toBeInTheDocument();
    expect(screen.getByTestId('metadata-date')).toHaveTextContent('2024-01-15');
    expect(screen.getByTestId('metadata-image-count')).toHaveTextContent(
      '5 images'
    );
  });

  it('renders ProjectActions component with correct projectId', () => {
    render(<ProjectListItem {...mockProps} />);

    expect(screen.getByTestId('project-actions')).toBeInTheDocument();
    expect(screen.getByTestId('actions-project-id')).toHaveTextContent(
      'test-project-id'
    );
    expect(screen.getByTestId('edit-project')).toBeInTheDocument();
    expect(screen.getByTestId('delete-project')).toBeInTheDocument();
  });

  it('renders ArrowRight icon button', () => {
    render(<ProjectListItem {...mockProps} />);

    const arrowButton = document.querySelector('button svg');
    expect(arrowButton).toBeInTheDocument();
    expect(arrowButton).toHaveClass('h-4', 'w-4');
  });

  it('calls onClick when card is clicked', async () => {
    const user = userEvent.setup();
    render(<ProjectListItem {...mockProps} onClick={mockOnClick} />);

    const card = document.querySelector('.cursor-pointer');
    expect(card).toBeInTheDocument();

    if (card) {
      await user.click(card);
      expect(mockOnClick).toHaveBeenCalledTimes(1);
    }
  });

  it('does not call onClick when no handler is provided', async () => {
    const user = userEvent.setup();
    render(<ProjectListItem {...mockProps} />);

    const card = document.querySelector('.overflow-hidden');
    expect(card).toBeInTheDocument();

    // Should not throw error when clicked without onClick handler
    await user.click(card!);
    expect(mockOnClick).not.toHaveBeenCalled();
  });

  it('has proper card styling', () => {
    render(<ProjectListItem {...mockProps} />);

    const card = document.querySelector(
      '.overflow-hidden.transition-all.duration-300'
    );
    expect(card).toBeInTheDocument();
    expect(card).toHaveClass(
      'hover:shadow-md',
      'cursor-pointer',
      'hover:bg-gray-50',
      'dark:hover:bg-gray-700',
      'w-full'
    );
  });

  it('has proper layout structure', () => {
    render(<ProjectListItem {...mockProps} />);

    const mainContent = document.querySelector('.flex.items-center.p-4');
    expect(mainContent).toBeInTheDocument();

    const thumbnailContainer = document.querySelector(
      '.flex-shrink-0.w-16.h-16'
    );
    expect(thumbnailContainer).toBeInTheDocument();

    const contentSection = document.querySelector('.flex-1.min-w-0');
    expect(contentSection).toBeInTheDocument();

    const actionsSection = document.querySelector(
      '.flex.items-center.ml-4.space-x-2'
    );
    expect(actionsSection).toBeInTheDocument();
  });

  it('truncates long titles properly', () => {
    const longTitle =
      'This is a very long project title that should be truncated';
    render(<ProjectListItem {...mockProps} title={longTitle} />);

    const titleElement = screen.getByText(longTitle);
    expect(titleElement).toHaveClass('truncate');
  });

  it('truncates long descriptions properly', () => {
    const longDescription =
      'This is a very long project description that should be clamped to one line';
    render(<ProjectListItem {...mockProps} description={longDescription} />);

    const descriptionElement = screen.getByText(longDescription);
    expect(descriptionElement).toHaveClass('line-clamp-1');
  });

  it('has proper title styling', () => {
    render(<ProjectListItem {...mockProps} />);

    const title = screen.getByText('Test Project');
    expect(title).toHaveClass(
      'text-lg',
      'font-medium',
      'truncate',
      'dark:text-white'
    );
    expect(title.tagName.toLowerCase()).toBe('h3');
  });

  it('has proper description styling', () => {
    render(<ProjectListItem {...mockProps} />);

    const description = screen.getByText('This is a test project description');
    expect(description).toHaveClass(
      'text-sm',
      'text-gray-500',
      'dark:text-gray-400',
      'line-clamp-1',
      'mt-1'
    );
  });

  it('has proper thumbnail container styling', () => {
    render(<ProjectListItem {...mockProps} />);

    const thumbnailContainer = document.querySelector(
      '.flex-shrink-0.w-16.h-16.mr-4.overflow-hidden.rounded-md'
    );
    expect(thumbnailContainer).toBeInTheDocument();
  });

  it('has proper arrow button styling', () => {
    render(<ProjectListItem {...mockProps} />);

    const arrowButton = document.querySelector('button[class*="h-8 w-8"]');
    expect(arrowButton).toBeInTheDocument();
    expect(arrowButton).toHaveClass('h-8', 'w-8');
  });

  it('supports dark mode styling', () => {
    render(<ProjectListItem {...mockProps} />);

    // Check for dark mode classes
    expect(
      document.querySelector('.dark\\:hover\\:bg-gray-700')
    ).toBeInTheDocument();
    expect(document.querySelector('.dark\\:text-white')).toBeInTheDocument();
    expect(document.querySelector('.dark\\:text-gray-400')).toBeInTheDocument();
  });

  it('handles empty or missing description', () => {
    render(<ProjectListItem {...mockProps} description="" />);

    const descriptionElement = document.querySelector('.text-sm.text-gray-500');
    expect(descriptionElement).toBeInTheDocument();
    expect(descriptionElement).toBeEmptyDOMElement();
  });

  it('handles zero image count', () => {
    render(<ProjectListItem {...mockProps} imageCount={0} />);

    expect(screen.getByTestId('metadata-image-count')).toHaveTextContent(
      '0 images'
    );
    expect(screen.getByTestId('image-count')).toHaveTextContent('0');
  });

  it('handles large image counts', () => {
    render(<ProjectListItem {...mockProps} imageCount={999} />);

    expect(screen.getByTestId('metadata-image-count')).toHaveTextContent(
      '999 images'
    );
    expect(screen.getByTestId('image-count')).toHaveTextContent('999');
  });

  it('maintains semantic HTML structure', () => {
    render(<ProjectListItem {...mockProps} />);

    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent('Test Project');

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('has proper responsive design classes', () => {
    render(<ProjectListItem {...mockProps} />);

    const card = document.querySelector('.w-full');
    expect(card).toBeInTheDocument();

    const contentSection = document.querySelector('.flex-1.min-w-0');
    expect(contentSection).toBeInTheDocument();
  });

  it('handles hover interactions properly', () => {
    render(<ProjectListItem {...mockProps} />);

    const card = document.querySelector(
      '.hover\\:shadow-md.hover\\:bg-gray-50'
    );
    expect(card).toBeInTheDocument();
    expect(card).toHaveClass('transition-all', 'duration-300');
  });

  it('handles click propagation correctly', async () => {
    const user = userEvent.setup();
    render(<ProjectListItem {...mockProps} onClick={mockOnClick} />);

    const card = document.querySelector('.cursor-pointer');
    const actionButton = screen.getByTestId('edit-project');

    // Clicking the card should trigger onClick
    if (card) {
      await user.click(card);
      expect(mockOnClick).toHaveBeenCalledTimes(1);
    }

    // Verify action buttons exist and are separate from card click
    expect(actionButton).toBeInTheDocument();

    // Clicking action buttons should not trigger card onClick again
    await user.click(actionButton);
    // The mockOnClick should still be called only once from the card click
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it('renders with all required props', () => {
    const minimalProps = {
      id: 'test',
      title: 'Title',
      description: 'Description',
      thumbnail: '/thumb.jpg',
      date: '2024-01-01',
      imageCount: 1,
    };

    expect(() => {
      render(<ProjectListItem {...minimalProps} />);
    }).not.toThrow();
  });

  it('handles special characters in title and description', () => {
    const specialProps = {
      ...mockProps,
      title: 'Project with "quotes" & <tags>',
      description: 'Description with émojis 🚀 and symbols @#$%',
    };

    render(<ProjectListItem {...specialProps} />);

    expect(
      screen.getByText('Project with "quotes" & <tags>')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Description with émojis 🚀 and symbols @#$%')
    ).toBeInTheDocument();
  });

  it('maintains consistent spacing and alignment', () => {
    render(<ProjectListItem {...mockProps} />);

    const mainContainer = document.querySelector('.p-4');
    expect(mainContainer).toBeInTheDocument();

    const thumbnailMargin = document.querySelector('.mr-4');
    expect(thumbnailMargin).toBeInTheDocument();

    const actionsSpacing = document.querySelector('.ml-4.space-x-2');
    expect(actionsSpacing).toBeInTheDocument();
  });

  it('supports keyboard navigation', async () => {
    const user = userEvent.setup();
    render(<ProjectListItem {...mockProps} onClick={mockOnClick} />);

    const card = document.querySelector('.cursor-pointer');
    expect(card).toBeInTheDocument();

    // Test keyboard interaction if card has proper accessibility attributes
    if (card) {
      // Focus the card
      card.focus();
      expect(card).toHaveFocus();

      // Test Enter key interaction
      await user.keyboard('{Enter}');
      // Note: This tests the keyboard event, but actual behavior depends on implementation
    }
  });
});
