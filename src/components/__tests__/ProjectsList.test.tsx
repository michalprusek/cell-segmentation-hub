import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ProjectsList, { Project } from '@/components/ProjectsList';

// Mock child components
vi.mock('@/components/ProjectCard', () => ({
  default: ({ title, onClick }: { title: string; onClick: () => void }) => (
    <div data-testid="project-card" onClick={onClick}>
      {title}
    </div>
  ),
}));

vi.mock('@/components/ProjectListItem', () => ({
  default: ({ title, onClick }: { title: string; onClick: () => void }) => (
    <div data-testid="project-list-item" onClick={onClick}>
      {title}
    </div>
  ),
}));

vi.mock('@/components/NewProjectCard', () => ({
  default: ({
    isOpen,
    onOpenChange: _onOpenChange,
  }: {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div data-testid="new-project-card">
      New Project Card - {isOpen ? 'Open' : 'Closed'}
    </div>
  ),
}));

vi.mock('@/components/NewProjectListItem', () => ({
  default: ({ onClick }: { onClick: () => void }) => (
    <div data-testid="new-project-list-item" onClick={onClick}>
      Create New Project
    </div>
  ),
}));

describe('ProjectsList', () => {
  const mockOnOpenProject = vi.fn();

  const mockProjects: Project[] = [
    {
      id: '1',
      title: 'Project 1',
      description: 'First test project',
      thumbnail: '/thumb1.jpg',
      date: '2023-12-01',
      imageCount: 5,
    },
    {
      id: '2',
      title: 'Project 2',
      description: 'Second test project',
      thumbnail: '/thumb2.jpg',
      date: '2023-12-02',
      imageCount: 3,
    },
    {
      id: '3',
      title: 'Project 3',
      description: 'Third test project',
      thumbnail: '/thumb3.jpg',
      date: '2023-12-03',
      imageCount: 8,
    },
  ];

  const defaultProps = {
    projects: mockProjects,
    viewMode: 'grid' as const,
    onOpenProject: mockOnOpenProject,
    loading: false,
    showCreateCard: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Grid View', () => {
    it('renders projects in grid mode', () => {
      render(<ProjectsList {...defaultProps} />);

      expect(screen.getByText('Project 1')).toBeInTheDocument();
      expect(screen.getByText('Project 2')).toBeInTheDocument();
      expect(screen.getByText('Project 3')).toBeInTheDocument();

      const projectCards = screen.getAllByTestId('project-card');
      expect(projectCards).toHaveLength(3);
    });

    it('calls onOpenProject when project card is clicked', async () => {
      const user = userEvent.setup();
      render(<ProjectsList {...defaultProps} />);

      const firstProject = screen.getByText('Project 1');
      await user.click(firstProject);

      expect(mockOnOpenProject).toHaveBeenCalledWith('1');
    });

    it('shows new project card when showCreateCard is true', () => {
      render(<ProjectsList {...defaultProps} showCreateCard />);

      expect(screen.getByTestId('new-project-card')).toBeInTheDocument();
    });

    it('does not show new project card when showCreateCard is false', () => {
      render(<ProjectsList {...defaultProps} showCreateCard={false} />);

      expect(screen.queryByTestId('new-project-card')).not.toBeInTheDocument();
    });
  });

  describe('List View', () => {
    it('renders projects in list mode', () => {
      render(<ProjectsList {...defaultProps} viewMode="list" />);

      expect(screen.getByText('Project 1')).toBeInTheDocument();
      expect(screen.getByText('Project 2')).toBeInTheDocument();
      expect(screen.getByText('Project 3')).toBeInTheDocument();

      const projectListItems = screen.getAllByTestId('project-list-item');
      expect(projectListItems).toHaveLength(3);
    });

    it('shows new project list item when showCreateCard is true', () => {
      render(<ProjectsList {...defaultProps} viewMode="list" showCreateCard />);

      expect(screen.getByTestId('new-project-list-item')).toBeInTheDocument();
      expect(screen.getByText('Create New Project')).toBeInTheDocument();
    });

    it('opens new project dialog when new project list item is clicked', async () => {
      const user = userEvent.setup();
      render(<ProjectsList {...defaultProps} viewMode="list" showCreateCard />);

      const newProjectItem = screen.getByTestId('new-project-list-item');
      await user.click(newProjectItem);

      // Check that the dialog state changes (indirectly via the card component)
      expect(screen.getByText(/New Project Card - Open/)).toBeInTheDocument();
    });

    it('applies correct layout classes for list view', () => {
      render(<ProjectsList {...defaultProps} viewMode="list" />);

      const listContainer = document.querySelector('.flex.flex-col.space-y-3');
      expect(listContainer).toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('shows loading skeleton when loading is true', () => {
      render(<ProjectsList {...defaultProps} loading />);

      const skeletonItems = document.querySelectorAll('.animate-pulse');
      expect(skeletonItems).toHaveLength(6);

      expect(screen.queryByText('Project 1')).not.toBeInTheDocument();
    });

    it('applies correct grid layout for loading skeleton', () => {
      render(<ProjectsList {...defaultProps} loading />);

      const gridContainer = document.querySelector(
        '.grid.grid-cols-1.md\\:grid-cols-2.lg\\:grid-cols-3'
      );
      expect(gridContainer).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('shows empty message when no projects and no create card', () => {
      render(
        <ProjectsList {...defaultProps} projects={[]} showCreateCard={false} />
      );

      expect(screen.getByText('No projects found')).toBeInTheDocument();
    });

    it('does not show empty message when no projects but create card is shown', () => {
      render(<ProjectsList {...defaultProps} projects={[]} showCreateCard />);

      expect(screen.queryByText('No projects found')).not.toBeInTheDocument();
      expect(screen.getByTestId('new-project-card')).toBeInTheDocument();
    });
  });

  describe('New Project Dialog Management', () => {
    it('manages new project dialog state correctly', async () => {
      const user = userEvent.setup();
      render(<ProjectsList {...defaultProps} viewMode="list" showCreateCard />);

      // Initially closed
      expect(screen.getByText(/New Project Card - Closed/)).toBeInTheDocument();

      // Click to open
      const newProjectItem = screen.getByTestId('new-project-list-item');
      await user.click(newProjectItem);

      // Should be open now
      expect(screen.getByText(/New Project Card - Open/)).toBeInTheDocument();
    });
  });

  describe('Responsive Behavior', () => {
    it('applies responsive grid classes in grid view', () => {
      render(<ProjectsList {...defaultProps} viewMode="grid" />);

      // Check for responsive grid classes
      const gridContainer = document.querySelector('.grid');
      expect(gridContainer).toHaveClass(
        'grid-cols-1',
        'md:grid-cols-2',
        'lg:grid-cols-3'
      );
    });

    it('uses full width layout in list view', () => {
      render(<ProjectsList {...defaultProps} viewMode="list" />);

      const listContainer = document.querySelector('.w-full');
      expect(listContainer).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('renders projects with proper structure', () => {
      render(<ProjectsList {...defaultProps} />);

      const projectCards = screen.getAllByTestId('project-card');
      expect(projectCards).toHaveLength(3);

      projectCards.forEach(card => {
        expect(card).toBeInTheDocument();
      });
    });

    it('maintains proper focus management for interactive elements', async () => {
      const user = userEvent.setup();
      render(<ProjectsList {...defaultProps} />);

      const firstProject = screen.getByText('Project 1');

      // Should be able to click and interact
      await user.click(firstProject);
      expect(mockOnOpenProject).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('handles single project correctly', () => {
      const singleProject = [mockProjects[0]];
      render(<ProjectsList {...defaultProps} projects={singleProject} />);

      expect(screen.getByText('Project 1')).toBeInTheDocument();
      expect(screen.queryByText('Project 2')).not.toBeInTheDocument();

      const projectCards = screen.getAllByTestId('project-card');
      expect(projectCards).toHaveLength(1);
    });

    it('handles projects with missing or empty data gracefully', () => {
      const projectsWithEmptyData: Project[] = [
        {
          id: 'empty-1',
          title: '',
          description: '',
          thumbnail: '',
          date: '',
          imageCount: 0,
        },
      ];

      render(
        <ProjectsList {...defaultProps} projects={projectsWithEmptyData} />
      );

      const projectCards = screen.getAllByTestId('project-card');
      expect(projectCards).toHaveLength(1);
    });
  });
});
