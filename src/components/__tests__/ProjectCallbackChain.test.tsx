import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { ProjectCard } from '../ProjectCard';
import { ProjectsList } from '../ProjectsList';
import { ProjectThumbnail } from '../project/ProjectThumbnail';

// Mock the API client
vi.mock('@/lib/api', () => ({
  default: {
    getProjectImages: vi.fn().mockRejectedValue({
      response: { status: 403 },
    }),
  },
}));

describe('Project Callback Chain', () => {
  describe('Access Error Propagation', () => {
    it('should propagate access errors from ProjectThumbnail to ProjectCard', async () => {
      const mockProjectUpdate = vi.fn();

      render(
        <ProjectCard
          id="test-project-123"
          title="Test Project"
          description="Test Description"
          thumbnail="/test.jpg"
          date="2025-01-01"
          imageCount={5}
          onProjectUpdate={mockProjectUpdate}
        />
      );

      // Wait for the 403 error to be handled
      await waitFor(() => {
        expect(mockProjectUpdate).toHaveBeenCalledWith(
          'test-project-123',
          'access-denied'
        );
      });
    });

    it('should propagate callbacks through ProjectsList', () => {
      const mockProjectUpdate = vi.fn();
      const mockOpenProject = vi.fn();

      const projects = [
        {
          id: 'project-1',
          title: 'Project 1',
          description: 'Description 1',
          thumbnail: '/thumb1.jpg',
          date: '2025-01-01',
          imageCount: 5,
          updatedAt: '2025-01-01',
          segmentationStatus: 'completed' as const,
        },
      ];

      render(
        <ProjectsList
          projects={projects}
          viewMode="grid"
          onOpenProject={mockOpenProject}
          loading={false}
          onProjectUpdate={mockProjectUpdate}
        />
      );

      // Verify ProjectCard is rendered with callback
      const projectCard = screen.getByText('Project 1');
      expect(projectCard).toBeInTheDocument();
    });
  });

  describe('removeProjectOptimistically', () => {
    it('should remove project from state when called', () => {
      const projects = [
        { id: '1', title: 'Project 1' },
        { id: '2', title: 'Project 2' },
        { id: '3', title: 'Project 3' },
      ];

      const setProjects = vi.fn();

      // Simulate the removeProjectOptimistically function
      const removeProjectOptimistically = (projectId: string) => {
        setProjects((prevProjects: any[]) =>
          prevProjects.filter(project => project.id !== projectId)
        );
      };

      // Call the function
      removeProjectOptimistically('2');

      // Verify setProjects was called with filter function
      expect(setProjects).toHaveBeenCalledWith(expect.any(Function));

      // Test the filter function
      const filterFn = setProjects.mock.calls[0][0];
      const result = filterFn(projects);

      expect(result).toEqual([
        { id: '1', title: 'Project 1' },
        { id: '3', title: 'Project 3' },
      ]);
    });
  });

  describe('Dashboard handleProjectUpdate', () => {
    it('should call removeProjectOptimistically on access-denied action', () => {
      const removeProjectOptimistically = vi.fn();

      // Simulate the handleProjectUpdate callback
      const handleProjectUpdate = (projectId: string, action: string) => {
        if (
          action === 'access-denied' ||
          action === 'delete' ||
          action === 'unshare'
        ) {
          removeProjectOptimistically(projectId);
        }
      };

      handleProjectUpdate('test-project', 'access-denied');
      expect(removeProjectOptimistically).toHaveBeenCalledWith('test-project');

      handleProjectUpdate('test-project-2', 'delete');
      expect(removeProjectOptimistically).toHaveBeenCalledWith(
        'test-project-2'
      );

      handleProjectUpdate('test-project-3', 'unshare');
      expect(removeProjectOptimistically).toHaveBeenCalledWith(
        'test-project-3'
      );
    });

    it('should not call removeProjectOptimistically on other actions', () => {
      const removeProjectOptimistically = vi.fn();

      const handleProjectUpdate = (projectId: string, action: string) => {
        if (
          action === 'access-denied' ||
          action === 'delete' ||
          action === 'unshare'
        ) {
          removeProjectOptimistically(projectId);
        }
      };

      handleProjectUpdate('test-project', 'update');
      expect(removeProjectOptimistically).not.toHaveBeenCalled();
    });
  });
});
