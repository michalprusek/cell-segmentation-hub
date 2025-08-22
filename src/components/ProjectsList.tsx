import React, { useState } from 'react';
import ProjectCard from '@/components/ProjectCard';
import ProjectListItem from '@/components/ProjectListItem';
import NewProjectCard from '@/components/NewProjectCard';
import NewProjectListItem from '@/components/NewProjectListItem';
import { useLanguage } from '@/contexts/LanguageContext';

export interface Project {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  date: string;
  imageCount: number;
  isOwned?: boolean;
  isShared?: boolean;
  sharedBy?: { email: string };
  owner?: { email: string; name?: string };
  shareId?: string;
}

export interface ProjectsListProps {
  projects: Project[];
  viewMode: 'grid' | 'list';
  onOpenProject: (id: string) => void;
  loading: boolean;
  showCreateCard?: boolean;
}

const ProjectsList = ({
  projects,
  viewMode,
  onOpenProject,
  loading,
  showCreateCard = false,
}: ProjectsListProps) => {
  const { t } = useLanguage();
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);

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

  if (viewMode === 'list') {
    const projectItems = projects.map(project => (
      <ProjectListItem
        key={project.id}
        id={project.id}
        title={project.title}
        description={project.description}
        thumbnail={project.thumbnail}
        date={project.date}
        imageCount={project.imageCount}
        onClick={() => onOpenProject(project.id)}
        isShared={project.isShared}
        sharedBy={project.sharedBy}
        owner={project.owner}
        shareId={project.shareId}
      />
    ));

    const allItems = showCreateCard
      ? [
          ...projectItems,
          <NewProjectListItem
            key="new-project"
            onClick={() => setNewProjectDialogOpen(true)}
          />,
        ]
      : projectItems;

    return (
      <div className="flex flex-col space-y-3 w-full">
        {allItems}
        {showCreateCard && (
          <NewProjectCard
            isOpen={newProjectDialogOpen}
            onOpenChange={setNewProjectDialogOpen}
          />
        )}
      </div>
    );
  }

  // Grid mode
  const projectItems = projects.map(project => (
    <ProjectCard
      key={project.id}
      id={project.id}
      title={project.title}
      description={project.description}
      thumbnail={project.thumbnail}
      date={project.date}
      imageCount={project.imageCount}
      onClick={() => onOpenProject(project.id)}
      isShared={project.isShared}
      sharedBy={project.sharedBy}
      owner={project.owner}
      shareId={project.shareId}
    />
  ));

  const allItems = showCreateCard
    ? [...projectItems, <NewProjectCard key="new-project" />]
    : projectItems;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {allItems}
    </div>
  );
};

export default ProjectsList;
