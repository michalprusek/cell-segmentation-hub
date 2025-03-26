
import React from "react";
import ProjectsList, { Project } from "@/components/ProjectsList";

interface ProjectsTabProps {
  projects: Project[];
  viewMode: "grid" | "list";
  loading: boolean;
  onOpenProject: (id: string) => void;
}

const ProjectsTab = ({ 
  projects, 
  viewMode, 
  loading, 
  onOpenProject 
}: ProjectsTabProps) => {
  return (
    <ProjectsList 
      projects={projects} 
      viewMode={viewMode} 
      onOpenProject={onOpenProject}
      loading={loading}
      showCreateCard={true}
    />
  );
};

export default ProjectsTab;
