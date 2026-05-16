import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { DragItem } from '@/utils/dashboardDrag';

import DashboardHeader from '@/components/DashboardHeader';
import StatsOverview from '@/components/StatsOverview';
import { useAuth, useLanguage } from '@/contexts/exports';
import ProjectToolbar from '@/components/project/ProjectToolbar';
import ProjectsTab from '@/components/dashboard/ProjectsTab';
import FolderBreadcrumb from '@/components/project/FolderBreadcrumb';
import CreateFolderDialog from '@/components/project/CreateFolderDialog';
import RenameFolderDialog from '@/components/project/RenameFolderDialog';
import DeleteFolderDialog from '@/components/project/DeleteFolderDialog';
import MoveToFolderDialog, {
  type MoveSubject,
} from '@/components/project/MoveToFolderDialog';
import NewProjectCard from '@/components/NewProjectCard';
import { useDashboardProjects } from '@/hooks/useDashboardProjects';
import {
  useFolders,
  useFolderPath,
  useMoveProjects,
  useMoveFolder,
} from '@/hooks/useFolders';
import { apiClient } from '@/lib/api';
import { logger } from '@/lib/logger';
import { useSegmentationQueue } from '@/hooks/useSegmentationQueue';
import { PageTransition } from '@/components/PageTransition';
import {
  PageContainer,
  ResponsiveStack,
  ContentCard,
  FlexBetween,
} from '@/components/layout';

// Configuration for share propagation delay (in milliseconds)
// This delay ensures database and cache have time to update after share acceptance
const SHARE_PROPAGATION_DELAY = import.meta.env.VITE_SHARE_PROPAGATION_DELAY
  ? parseInt(import.meta.env.VITE_SHARE_PROPAGATION_DELAY, 10)
  : 1500;

const Dashboard = () => {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortField, setSortField] = useState<string>('updated_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();

  // Folder navigation lives in the URL so reloads and shareable links keep
  // their position. `?folder=<uuid>` => inside that folder; no query => root.
  const [searchParams, setSearchParams] = useSearchParams();
  const currentFolderId = searchParams.get('folder');

  // Effective folderId passed to the project list query. The backend accepts
  // "root" as the literal "show projects with no placement"; mapping null →
  // "root" makes that contract explicit in one place.
  const projectFolderQuery: string | 'root' = currentFolderId ?? 'root';

  const {
    projects,
    loading,
    fetchError,
    fetchProjects,
    removeProjectOptimistically,
    updateProjectOptimistically,
  } = useDashboardProjects({
    sortField,
    sortDirection,
    userId: user?.id,
    userEmail: user?.email,
    folderId: projectFolderQuery,
  });

  const {
    data: flatFolders = [],
    tree: folderTree,
    byId: folderById,
    isSuccess: foldersLoaded,
  } = useFolders();
  const path = useFolderPath(currentFolderId, folderById);

  // Folders shown in the current view = direct children of currentFolderId.
  const visibleFolders = useMemo(() => {
    if (currentFolderId === null) {
      return folderTree.map(n => ({ id: n.id, name: n.name }));
    }
    const node = (function findNode(
      nodes: typeof folderTree
    ): (typeof folderTree)[number] | null {
      for (const n of nodes) {
        if (n.id === currentFolderId) return n;
        const found = findNode(n.children);
        if (found) return found;
      }
      return null;
    })(folderTree);
    return (node?.children ?? []).map(n => ({ id: n.id, name: n.name }));
  }, [folderTree, currentFolderId]);

  const hasAnyFolder = flatFolders.length > 0;

  // Fallback: if the URL points at a folder that no longer exists in our
  // tree (someone deleted it, bookmarked URL, etc.) we'd otherwise filter
  // projects to an empty set and confuse the user with a blank gallery.
  // Wait until the folders query *successfully resolves* (foldersLoaded =
  // useQuery.isSuccess) before deciding — checking `flatFolders.length`
  // alone false-positives during the initial loading phase AND when the
  // user simply has zero folders.
  useEffect(() => {
    if (currentFolderId && foldersLoaded && !folderById.has(currentFolderId)) {
      const next = new URLSearchParams(searchParams);
      next.delete('folder');
      setSearchParams(next, { replace: true });
    }
  }, [
    currentFolderId,
    foldersLoaded,
    folderById,
    searchParams,
    setSearchParams,
  ]);

  // ----- Dialog state -----------------------------------------------------
  const [createOpen, setCreateOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [moveSubject, setMoveSubject] = useState<MoveSubject | null>(null);

  // ----- DnD: HTML5 native ------------------------------------------------
  // We use plain draggable + onDragOver/onDrop because @dnd-kit's sensors
  // call preventDefault on pointerdown, which silently breaks click events
  // on the same element. Native HTML5 drag and click are separate event
  // chains, so cards stay clickable AND draggable.
  const moveProjectsMutation = useMoveProjects();
  const moveFolderMutation = useMoveFolder();

  const handleDropOnTarget = useCallback(
    async (item: DragItem, destFolderId: string | null) => {
      try {
        if (item.type === 'project') {
          await moveProjectsMutation.mutateAsync({
            folderId: destFolderId,
            projectIds: [item.id],
          });
          toast.success(String(t('folders.moved')));
          // Current view is folder-scoped — drop a project out of it and the
          // project should immediately disappear from the grid.
          if (destFolderId !== currentFolderId) {
            removeProjectOptimistically(item.id);
          }
        } else if (item.type === 'folder') {
          if (item.id === destFolderId) return;
          await moveFolderMutation.mutateAsync({
            id: item.id,
            parentId: destFolderId,
          });
          toast.success(String(t('folders.moved')));
        }
      } catch (err) {
        logger.error('DnD move failed', err);
      }
    },
    [
      moveProjectsMutation,
      moveFolderMutation,
      removeProjectOptimistically,
      currentFolderId,
      t,
    ]
  );

  // Listen for WebSocket segmentation updates to refresh project cards
  const { lastUpdate } = useSegmentationQueue('DISABLE_GLOBAL');

  // Process pending share invitation after login or registration
  const processPendingShareInvitation = useCallback(async () => {
    const pendingToken = localStorage.getItem('pendingShareToken');
    if (!pendingToken || !user) return;

    localStorage.removeItem('pendingShareToken');

    let loadingToastId: string | number | undefined;

    try {
      logger.debug(
        'Processing pending share invitation with token:',
        pendingToken
      );

      loadingToastId = toast.loading(t('sharing.processingInvitation'));

      const result = await apiClient.acceptShareInvitation(pendingToken);

      if (loadingToastId) toast.dismiss(loadingToastId);

      if (!result.needsLogin) {
        toast.success(t('sharing.invitationAccepted'), {
          description: result.project?.title
            ? `${t('common.project')}: ${result.project.title}`
            : undefined,
        });

        await new Promise(resolve =>
          setTimeout(resolve, SHARE_PROPAGATION_DELAY)
        );

        await fetchProjects();
      }
    } catch (error: any) {
      if (loadingToastId) toast.dismiss(loadingToastId);

      logger.error('Failed to process pending share invitation:', error);

      if (
        error?.response?.status === 409 ||
        error?.response?.data?.message?.includes('already')
      ) {
        logger.debug(
          'Share invitation was already accepted, refreshing projects'
        );
        toast.info(
          t(
            'sharing.invitationAlreadyAccepted',
            'Share invitation was already accepted'
          )
        );
        await new Promise(resolve =>
          setTimeout(resolve, SHARE_PROPAGATION_DELAY)
        );
        await fetchProjects();
      } else if (error?.response?.status === 404) {
        toast.error(t('sharing.invitationInvalid'));
      } else {
        toast.error(
          t('sharing.invitationError', 'Failed to process share invitation')
        );
      }
    }
  }, [user, t, fetchProjects]);

  useEffect(() => {
    if (user) {
      processPendingShareInvitation();
    }
  }, [user, processPendingShareInvitation]);

  useEffect(() => {
    const debouncedFetchProjects = (() => {
      let timeoutId: NodeJS.Timeout;
      return () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          fetchProjects();
        }, 300);
      };
    })();

    const handleImageUpdate = (event: Event) => {
      const customEvent = event as CustomEvent;
      const detail = customEvent.detail;

      if (!detail?.projectId) return;

      const updates: Record<string, any> = {};

      if (detail.imageCount !== undefined) {
        updates.imageCount = detail.imageCount;
      }
      if (detail.remainingCount !== undefined) {
        updates.imageCount = detail.remainingCount;
      }
      if (detail.thumbnail !== undefined) {
        updates.thumbnail = detail.thumbnail;
      }
      if (detail.newThumbnail !== undefined) {
        updates.thumbnail = detail.newThumbnail;
      }

      if (Object.keys(updates).length > 0) {
        updateProjectOptimistically(detail.projectId, updates);
      }
    };

    window.addEventListener('project-created', debouncedFetchProjects);
    window.addEventListener('project-images-updated', handleImageUpdate);
    window.addEventListener('project-image-deleted', handleImageUpdate);

    return () => {
      window.removeEventListener('project-created', debouncedFetchProjects);
      window.removeEventListener('project-images-updated', handleImageUpdate);
      window.removeEventListener('project-image-deleted', handleImageUpdate);
    };
  }, [fetchProjects, updateProjectOptimistically]);

  useEffect(() => {
    if (
      lastUpdate &&
      (lastUpdate.status === 'segmented' ||
        lastUpdate.status === 'no_segmentation')
    ) {
      const timer = setTimeout(() => {
        fetchProjects();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [lastUpdate, fetchProjects]);

  const handleOpenProject = useCallback(
    (id: string) => {
      navigate(`/project/${id}`);
    },
    [navigate]
  );

  const handleNavigateToFolder = useCallback(
    (folderId: string | null) => {
      // Manipulate the query string in place so we keep any unrelated params
      // the rest of the app may have set.
      const next = new URLSearchParams(searchParams);
      if (folderId === null) next.delete('folder');
      else next.set('folder', folderId);
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams]
  );

  // If the user just deleted the folder they were standing in, jump back to
  // its parent (or root). Wired via DeleteFolderDialog's onDeleted callback.
  const handleAfterDeleteCurrent = useCallback(() => {
    if (!deleteTarget) return;
    if (deleteTarget.id === currentFolderId) {
      const me = folderById.get(currentFolderId);
      handleNavigateToFolder(me?.parentId ?? null);
    }
  }, [deleteTarget, currentFolderId, folderById, handleNavigateToFolder]);

  const handleSort = useCallback(
    (field: 'name' | 'updatedAt' | 'segmentationStatus') => {
      let frontendField = field;

      if (field === 'name') frontendField = 'name';
      else if (field === 'updatedAt') frontendField = 'updated_at';

      const newDirection =
        frontendField === sortField
          ? sortDirection === 'asc'
            ? 'desc'
            : 'asc'
          : 'desc';

      setSortField(frontendField);
      setSortDirection(newDirection);
    },
    [sortField, sortDirection]
  );

  const handleProjectUpdate = useCallback(
    (projectId: string, action: string) => {
      if (
        action === 'delete' ||
        action === 'unshare' ||
        action === 'access-denied'
      ) {
        removeProjectOptimistically(projectId);
      }
    },
    [removeProjectOptimistically]
  );

  const handleRequestProjectMove = useCallback((projectId: string) => {
    setMoveSubject({ kind: 'project', ids: [projectId] });
  }, []);

  const handleRequestFolderMove = useCallback((folderId: string) => {
    setMoveSubject({ kind: 'folder', id: folderId });
  }, []);

  const statsOverview = useMemo(() => <StatsOverview />, []);

  const projectToolbar = useMemo(
    () => (
      <ProjectToolbar
        sortField={sortField as 'name' | 'updatedAt' | 'segmentationStatus'}
        sortDirection={sortDirection}
        onSort={handleSort}
        viewMode={viewMode}
        setViewMode={setViewMode}
        showSearchBar={false}
        showUploadButton={false}
        showExportButton={false}
        onCreateProject={() => setNewProjectOpen(true)}
        onCreateFolder={() => setCreateOpen(true)}
      />
    ),
    [sortField, sortDirection, handleSort, viewMode]
  );

  if (fetchError) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8">
          <div className="bg-white p-6 rounded-lg border border-red-200 text-center dark:bg-gray-900">
            <p className="text-red-500 mb-4">{fetchError}</p>
            <button
              onClick={fetchProjects}
              className="bg-blue-500 text-white px-4 py-2 rounded"
            >
              {t('common.tryAgain')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PageTransition mode="fade">
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <DashboardHeader />

        <PageContainer>
          <ResponsiveStack
            direction="vertical"
            breakpoint="md"
            align="start"
            justify="between"
            className="mb-8"
          >
            <div>
              <h1 className="text-2xl font-bold mb-1">
                {t('common.dashboard')}
              </h1>
              <p className="text-gray-500">{t('dashboard.manageProjects')}</p>
            </div>
          </ResponsiveStack>

          <div className="mb-8 animate-fade-in">{statsOverview}</div>

          <div className="animate-fade-in" style={{ animationDelay: '0.1s' }}>
            <ContentCard className="p-6">
              <FlexBetween align="center" className="flex-col sm:flex-row mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1 dark:text-gray-100">
                    {t('dashboard.projectGallery')}
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t('dashboard.projectGalleryDescription')}
                  </p>
                </div>

                {projectToolbar}
              </FlexBetween>

              <div className="mb-4">
                <FolderBreadcrumb
                  path={path}
                  onNavigate={handleNavigateToFolder}
                  onDropToTarget={handleDropOnTarget}
                />
              </div>

              <ProjectsTab
                projects={projects}
                folders={visibleFolders}
                viewMode={viewMode}
                loading={loading}
                onOpenProject={handleOpenProject}
                onProjectUpdate={handleProjectUpdate}
                onRequestProjectMove={handleRequestProjectMove}
                hasAnyFolder={hasAnyFolder}
                onOpenFolder={handleNavigateToFolder}
                onRenameFolder={(id, name) => setRenameTarget({ id, name })}
                onMoveFolder={handleRequestFolderMove}
                onDeleteFolder={(id, name) => setDeleteTarget({ id, name })}
                onDropItem={handleDropOnTarget}
              />
            </ContentCard>
          </div>
        </PageContainer>

        {/* Folder dialogs are mounted at Dashboard level so opening one
         *  from a nested grid card doesn't fight the card's own state. */}
        <CreateFolderDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          parentId={currentFolderId}
        />
        <RenameFolderDialog
          open={renameTarget !== null}
          onOpenChange={open => !open && setRenameTarget(null)}
          folderId={renameTarget?.id ?? ''}
          currentName={renameTarget?.name ?? ''}
        />
        <DeleteFolderDialog
          open={deleteTarget !== null}
          onOpenChange={open => !open && setDeleteTarget(null)}
          folderId={deleteTarget?.id ?? null}
          folderName={deleteTarget?.name ?? ''}
          onDeleted={handleAfterDeleteCurrent}
        />
        <MoveToFolderDialog
          open={moveSubject !== null}
          onOpenChange={open => !open && setMoveSubject(null)}
          subject={moveSubject}
        />
        <NewProjectCard
          isOpen={newProjectOpen}
          onOpenChange={setNewProjectOpen}
        />
      </div>
    </PageTransition>
  );
};

export default Dashboard;
