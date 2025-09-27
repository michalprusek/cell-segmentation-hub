import React from 'react';
import ProjectsList, { Project } from '@/components/ProjectsList';

interface ProjectsTabProps {
  projects: Project[];
  viewMode: 'grid' | 'list';
  loading: boolean;
  onOpenProject: (id: string) => void;
  onProjectUpdate?: (projectId: string, action: string) => void;
}

const ProjectsTab = ({
  projects,
  viewMode,
  loading,
  onOpenProject,
  onProjectUpdate,
}: ProjectsTabProps) => {
  return (
    <ProjectsList
      projects={projects}
      viewMode={viewMode}
      onOpenProject={onOpenProject}
      loading={loading}
      showCreateCard={true}
      onProjectUpdate={onProjectUpdate}
    />
  );
};

export default ProjectsTab;
