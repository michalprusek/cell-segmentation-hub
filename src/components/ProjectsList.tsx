import React, { useState } from 'react';
import ProjectCard from '@/components/ProjectCard';
import ProjectListItem from '@/components/ProjectListItem';
import NewProjectCard from '@/components/NewProjectCard';
import NewProjectListItem from '@/components/NewProjectListItem';
import FolderCard from '@/components/project/FolderCard';
import FolderListItem from '@/components/project/FolderListItem';
import { useLanguage } from '@/contexts/useLanguage';
import { SkeletonProjectCard } from '@/components/ui/skeleton-variants';
import { cn } from '@/lib/utils';
import { ProjectsGrid } from '@/components/layout';
import type { DragItem } from '@/utils/dashboardDrag';

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

/**
 * Minimal shape ProjectsList needs to render a folder tile. Defined locally
 * rather than re-exporting hook types so the visual layer doesn't depend on
 * React Query internals.
 */
export interface FolderViewItem {
  id: string;
  name: string;
}

export interface ProjectsListProps {
  projects: Project[];
  /** Folders to render before projects (file-explorer convention). */
  folders?: FolderViewItem[];
  viewMode: 'grid' | 'list';
  onOpenProject: (id: string) => void;
  loading: boolean;
  showCreateCard?: boolean;
  onProjectUpdate?: (projectId: string, action: string) => void;
  /** Per-project move trigger. When undefined, project menu hides "Move to…". */
  onRequestProjectMove?: (projectId: string) => void;
  hasAnyFolder?: boolean;
  /** Folder operations. When undefined, folder cards are not interactive. */
  onOpenFolder?: (folderId: string) => void;
  onRenameFolder?: (folderId: string, currentName: string) => void;
  onMoveFolder?: (folderId: string) => void;
  onDeleteFolder?: (folderId: string, name: string) => void;
  /** Forwarded to FolderCard / FolderListItem so drops route up to Dashboard. */
  onDropItem?: (item: DragItem, targetFolderId: string | null) => void;
}

const ProjectsList = ({
  projects,
  folders = [],
  viewMode,
  onOpenProject,
  loading,
  showCreateCard = false,
  onProjectUpdate,
  onRequestProjectMove,
  hasAnyFolder,
  onOpenFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onDropItem,
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

  if (projects.length === 0 && folders.length === 0 && !showCreateCard) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">
          {t('projects.noProjects')}
        </p>
      </div>
    );
  }

  if (viewMode === 'list') {
    const folderItems = folders.map(folder => (
      <div
        key={`folder-${folder.id}`}
        className="animate-in fade-in slide-in-from-bottom-2 duration-500"
      >
        <FolderListItem
          id={folder.id}
          name={folder.name}
          onOpen={() => onOpenFolder?.(folder.id)}
          onRename={() => onRenameFolder?.(folder.id, folder.name)}
          onMove={() => onMoveFolder?.(folder.id)}
          onDelete={() => onDeleteFolder?.(folder.id, folder.name)}
          onDropItem={
            onDropItem
              ? (item, targetId) => onDropItem(item, targetId)
              : undefined
          }
        />
      </div>
    ));
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
          owner={project.owner}
          shareId={project.shareId}
          onProjectUpdate={onProjectUpdate}
          onRequestMove={onRequestProjectMove}
          hasAnyFolder={hasAnyFolder}
        />
      </div>
    ));

    const allItems = showCreateCard
      ? [
          ...folderItems,
          ...projectItems,
          <NewProjectListItem
            key="new-project"
            onClick={() => setNewProjectDialogOpen(true)}
          />,
        ]
      : [...folderItems, ...projectItems];

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

  // Grid mode — folders first, projects second; matches Windows / macOS Finder.
  const folderCards = folders.map(folder => (
    <div
      key={`folder-${folder.id}`}
      className="animate-in fade-in zoom-in-95 duration-500"
    >
      <FolderCard
        id={folder.id}
        name={folder.name}
        onOpen={() => onOpenFolder?.(folder.id)}
        onRename={() => onRenameFolder?.(folder.id, folder.name)}
        onMove={() => onMoveFolder?.(folder.id)}
        onDelete={() => onDeleteFolder?.(folder.id, folder.name)}
        onDropItem={
          onDropItem
            ? (item, targetId) => onDropItem(item, targetId)
            : undefined
        }
      />
    </div>
  ));
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
        onRequestMove={onRequestProjectMove}
        hasAnyFolder={hasAnyFolder}
      />
    </div>
  ));

  const allItems = showCreateCard
    ? [...folderCards, ...projectItems, <NewProjectCard key="new-project" />]
    : [...folderCards, ...projectItems];

  return <ProjectsGrid>{allItems}</ProjectsGrid>;
};

export default ProjectsList;
