import React, { useState } from 'react';
import ProjectCard from '@/components/ProjectCard';
import ProjectListItem from '@/components/ProjectListItem';
import NewProjectCard from '@/components/NewProjectCard';
import NewProjectListItem from '@/components/NewProjectListItem';
import { useLanguage } from '@/contexts/useLanguage';
import { SkeletonProjectCard } from '@/components/ui/skeleton-variants';
import { cn } from '@/lib/utils';
import { ProjectsGrid } from '@/components/layout';

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
  onProjectUpdate?: (projectId: string, action: string) => void;
}

const ProjectsList = ({
  projects,
  viewMode,
  onOpenProject,
  loading,
  showCreateCard = false,
  onProjectUpdate,
}: ProjectsListProps) => {
  const { t } = useLanguage();
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);

  if (loading) {
    return (
      <div
        className={cn(
          viewMode === 'grid' ? '' : 'flex flex-col space-y-3 w-full'
        )}
      >
        {viewMode === 'grid' ? (
          <ProjectsGrid>
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="animate-in fade-in duration-500"
                style={{ animationDelay: `${index * 75}ms` }}
              >
                <SkeletonProjectCard />
              </div>
            ))}
          </ProjectsGrid>
        ) : (
          Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="animate-in fade-in duration-500"
              style={{ animationDelay: `${index * 75}ms` }}
            >
              <SkeletonProjectCard />
            </div>
          ))
        )}
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
    const projectItems = projects.map((project, index) => (
      <div
        key={project.id}
        className="animate-in fade-in slide-in-from-bottom-2 duration-500"
        style={{ animationDelay: `${index * 50}ms` }}
      >
        <ProjectListItem
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
          onProjectUpdate={onProjectUpdate}
        />
      </div>
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
  const projectItems = projects.map((project, index) => (
    <div
      key={project.id}
      className="animate-in fade-in zoom-in-95 duration-500"
      style={{ animationDelay: `${index * 75}ms` }}
    >
      <ProjectCard
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
        onProjectUpdate={onProjectUpdate}
      />
    </div>
  ));

  const allItems = showCreateCard
    ? [...projectItems, <NewProjectCard key="new-project" />]
    : projectItems;

  return <ProjectsGrid>{allItems}</ProjectsGrid>;
};

export default ProjectsList;
