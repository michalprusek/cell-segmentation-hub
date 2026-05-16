import React from 'react';
import ProjectsList, {
  Project,
  FolderViewItem,
} from '@/components/ProjectsList';
import type { DragItem } from '@/utils/dashboardDrag';

interface ProjectsTabProps {
  projects: Project[];
  folders?: FolderViewItem[];
  viewMode: 'grid' | 'list';
  loading: boolean;
  onOpenProject: (id: string) => void;
  onProjectUpdate?: (projectId: string, action: string) => void;
  onRequestProjectMove?: (projectId: string) => void;
  hasAnyFolder?: boolean;
  onOpenFolder?: (folderId: string) => void;
  onRenameFolder?: (folderId: string, currentName: string) => void;
  onMoveFolder?: (folderId: string) => void;
  onDeleteFolder?: (folderId: string, name: string) => void;
  onDropItem?: (item: DragItem, targetFolderId: string | null) => void;
}

const ProjectsTab = ({
  projects,
  folders,
  viewMode,
  loading,
  onOpenProject,
  onProjectUpdate,
  onRequestProjectMove,
  hasAnyFolder,
  onOpenFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onDropItem,
}: ProjectsTabProps) => {
  return (
    <ProjectsList
      projects={projects}
      folders={folders}
      viewMode={viewMode}
      onOpenProject={onOpenProject}
      loading={loading}
      showCreateCard={true}
      onProjectUpdate={onProjectUpdate}
      onRequestProjectMove={onRequestProjectMove}
      hasAnyFolder={hasAnyFolder}
      onOpenFolder={onOpenFolder}
      onRenameFolder={onRenameFolder}
      onMoveFolder={onMoveFolder}
      onDeleteFolder={onDeleteFolder}
      onDropItem={onDropItem}
    />
  );
};

export default ProjectsTab;
