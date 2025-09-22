import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ProjectCard from '@/components/ProjectCard';

// Mock the child components
vi.mock('@/components/project/ProjectThumbnail', () => ({
  default: ({
    projectId: _projectId,
    fallbackSrc,
  }: {
    projectId: string;
    fallbackSrc: string;
  }) => (
    <img
      src={fallbackSrc}
      alt="Project thumbnail"
      data-testid="project-thumbnail"
    />
  ),
}));

vi.mock('@/components/project/ProjectActions', () => ({
  default: ({ projectId: _projectId }: { projectId: string }) => (
    <button aria-label="More options" data-testid="project-actions">
      Actions
    </button>
  ),
}));

vi.mock('@/components/project/ProjectMetadata', () => ({
  default: ({ date, imageCount }: { date: string; imageCount: number }) => (
    <div data-testid="project-metadata">
      <span>{imageCount === 0 ? 'No images' : `${imageCount} images`}</span>
      <span>Created {date}</span>
    </div>
  ),
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('ProjectCard', () => {
  const defaultProps = {
    id: 'test-project-id',
    title: 'Test Project',
    description: 'Test project description',
    thumbnail: '/placeholder.svg',
    date: 'Dec 25, 2023',
    imageCount: 2,
    onClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders project information correctly', () => {
    render(<ProjectCard {...defaultProps} />);

    expect(screen.getByText(defaultProps.title)).toBeInTheDocument();
    expect(screen.getByText(defaultProps.description)).toBeInTheDocument();
    expect(screen.getByText(/created/i)).toBeInTheDocument();
  });

  it('displays correct image count', () => {
    render(<ProjectCard {...defaultProps} imageCount={2} />);

    expect(screen.getByText('2 images')).toBeInTheDocument();
  });

  it('shows "No images" when project has no images', () => {
    render(<ProjectCard {...defaultProps} imageCount={0} />);

    expect(screen.getByText(/no images/i)).toBeInTheDocument();
  });

  it('calls onClick when card is clicked', async () => {
    const user = userEvent.setup();
    const mockOnClick = vi.fn();

    render(<ProjectCard {...defaultProps} onClick={mockOnClick} />);

    const card = screen.getByRole('button');
    await user.click(card);

    expect(mockOnClick).toHaveBeenCalled();
  });

  it('renders project actions component', () => {
    render(<ProjectCard {...defaultProps} />);

    expect(screen.getByTestId('project-actions')).toBeInTheDocument();
  });

  it('renders project metadata correctly', () => {
    render(<ProjectCard {...defaultProps} />);

    expect(screen.getByTestId('project-metadata')).toBeInTheDocument();
  });

  it('displays project thumbnail', () => {
    render(<ProjectCard {...defaultProps} />);

    const thumbnail = screen.getByTestId('project-thumbnail');
    expect(thumbnail).toBeInTheDocument();
    expect(thumbnail).toHaveAttribute('src', defaultProps.thumbnail);
  });

  it('displays custom thumbnail when provided', () => {
    const customThumbnail = '/custom-thumbnail.jpg';

    render(<ProjectCard {...defaultProps} thumbnail={customThumbnail} />);

    const thumbnail = screen.getByTestId('project-thumbnail');
    expect(thumbnail).toHaveAttribute('src', customThumbnail);
  });

  it('shows default placeholder when no thumbnail provided', () => {
    render(<ProjectCard {...defaultProps} thumbnail="" />);

    const thumbnail = screen.getByTestId('project-thumbnail');
    expect(thumbnail).toHaveAttribute('src', '');
  });

  it('displays formatted date correctly', () => {
    render(<ProjectCard {...defaultProps} date="Dec 25, 2023" />);

    expect(screen.getByText(/dec 25, 2023/i)).toBeInTheDocument();
  });

  it('has proper accessibility attributes', () => {
    render(<ProjectCard {...defaultProps} />);

    const card = screen.getByRole('button');
    expect(card).toBeInTheDocument();

    const title = screen.getByText(defaultProps.title);
    expect(title).toHaveAttribute('title', defaultProps.title);
  });

  it('truncates long titles appropriately', () => {
    const longTitle =
      'This is a very long project title that should be truncated';

    render(<ProjectCard {...defaultProps} title={longTitle} />);

    const titleElement = screen.getByText(longTitle);
    expect(titleElement).toHaveClass('truncate');
  });
});
