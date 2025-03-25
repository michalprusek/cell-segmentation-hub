
import React from "react";
import ProjectCard from "@/components/ProjectCard";
import NewProjectCard from "@/components/NewProjectCard";
import { useLanguage } from '@/contexts/LanguageContext';

export interface Project {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  date: string;
  imageCount: number;
}

export interface ProjectsListProps {
  projects: Project[];
  viewMode: "grid" | "list";
  onOpenProject: (id: string) => void;
  loading: boolean;
  showCreateCard?: boolean;
}

const ProjectsList = ({ 
  projects, 
  viewMode, 
  onOpenProject, 
  loading, 
  showCreateCard = false 
}: ProjectsListProps) => {
  const { t } = useLanguage();
  
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div 
            key={index} 
            className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm h-64 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (projects.length === 0 && !showCreateCard) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">
          {t('projects.noProjects')}
        </p>
      </div>
    );
  }

  return (
    <div className={
      viewMode === "grid" 
        ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        : "flex flex-col space-y-4"
    }>
      {showCreateCard && <NewProjectCard />}
      
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          id={project.id}
          title={project.title}
          description={project.description}
          thumbnail={project.thumbnail}
          date={project.date}
          imageCount={project.imageCount}
          onClick={() => onOpenProject(project.id)}
        />
      ))}
    </div>
  );
};

export default ProjectsList;
