import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import DashboardHeader from '@/components/DashboardHeader';
import StatsOverview from '@/components/StatsOverview';
import { useAuth, useLanguage } from '@/contexts/exports';
import ProjectToolbar from '@/components/project/ProjectToolbar';
import ProjectsTab from '@/components/dashboard/ProjectsTab';
import { useDashboardProjects } from '@/hooks/useDashboardProjects';
import { apiClient } from '@/lib/api';
import { logger } from '@/lib/logger';
import { useSegmentationQueue } from '@/hooks/useSegmentationQueue';

const Dashboard = () => {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortField, setSortField] = useState<string>('updated_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();

  const { projects, loading, fetchError, fetchProjects } = useDashboardProjects(
    {
      sortField,
      sortDirection,
      userId: user?.id,
      userEmail: user?.email,
    }
  );

  // Listen for WebSocket segmentation updates to refresh project cards
  const { lastUpdate } = useSegmentationQueue('DISABLE_GLOBAL');

  // Process pending share invitation after login or registration
  const processPendingShareInvitation = useCallback(async () => {
    const pendingToken = localStorage.getItem('pendingShareToken');
    if (!pendingToken || !user) return;

    try {
      logger.debug(
        'Processing pending share invitation with token:',
        pendingToken
      );

      // Show loading toast
      const loadingToastId = toast.loading(t('sharing.processingInvitation'));

      const result = await apiClient.acceptShareInvitation(pendingToken);

      // Dismiss loading toast
      toast.dismiss(loadingToastId);

      if (!result.needsLogin) {
        toast.success(t('sharing.invitationAccepted'), {
          description: result.project?.title
            ? `${t('common.project')}: ${result.project.title}`
            : undefined,
        });

        // Small delay to ensure database propagation
        await new Promise(resolve => setTimeout(resolve, 500));

        // Refresh projects list to show the newly shared project
        await fetchProjects();
      }
    } catch (error: any) {
      logger.error('Failed to process pending share invitation:', error);

      // Check if the error is because invitation was already accepted
      if (
        error?.response?.status === 409 ||
        error?.response?.data?.message?.includes('already')
      ) {
        // Invitation was already accepted, just refresh the projects
        await fetchProjects();
      } else if (error?.response?.status === 404) {
        // Invalid or expired invitation
        toast.error(t('sharing.invitationInvalid'));
      }
      // For other errors, don't show toast as it might confuse the user
    } finally {
      // Always remove the pending token after processing
      localStorage.removeItem('pendingShareToken');
    }
  }, [user, t, fetchProjects]);

  useEffect(() => {
    // Process pending share invitation when user is authenticated
    if (user) {
      processPendingShareInvitation();
    }
  }, [user, processPendingShareInvitation]);

  useEffect(() => {
    // Poslouchej události pro aktualizaci seznamu projektů
    const handleProjectCreated = () => fetchProjects();
    const handleProjectDeleted = () => fetchProjects();
    const handleProjectUnshared = () => fetchProjects();
    const handleImageUpdated = () => fetchProjects();
    const handleImageDeleted = () => fetchProjects();

    window.addEventListener('project-created', handleProjectCreated);
    window.addEventListener('project-deleted', handleProjectDeleted);
    window.addEventListener('project-unshared', handleProjectUnshared);
    window.addEventListener('project-images-updated', handleImageUpdated);
    window.addEventListener('project-image-deleted', handleImageDeleted);

    return () => {
      window.removeEventListener('project-created', handleProjectCreated);
      window.removeEventListener('project-deleted', handleProjectDeleted);
      window.removeEventListener('project-unshared', handleProjectUnshared);
      window.removeEventListener('project-images-updated', handleImageUpdated);
      window.removeEventListener('project-image-deleted', handleImageDeleted);
    };
  }, [fetchProjects]);

  // Refresh projects when WebSocket reports segmentation completion
  useEffect(() => {
    if (
      lastUpdate &&
      (lastUpdate.status === 'segmented' ||
        lastUpdate.status === 'no_segmentation')
    ) {
      // Delay slightly to ensure backend has updated the image count
      const timer = setTimeout(() => {
        fetchProjects();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [lastUpdate, fetchProjects]);

  const handleOpenProject = (id: string) => {
    navigate(`/project/${id}`);
  };

  const handleSort = (field: 'name' | 'updatedAt' | 'segmentationStatus') => {
    let frontendField = field;

    // Map field names to frontend fields (API client already handles backend mapping)
    if (field === 'name')
      frontendField = 'name'; // Now sort by 'name' directly
    else if (field === 'updatedAt') frontendField = 'updated_at';

    // Toggle direction if same field
    const newDirection =
      frontendField === sortField
        ? sortDirection === 'asc'
          ? 'desc'
          : 'asc'
        : 'desc';

    setSortField(frontendField);
    setSortDirection(newDirection);
  };

  if (fetchError) {
    return (
      <div className="min-h-screen bg-gray-50">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8">
          <div className="bg-white p-6 rounded-lg border border-red-200 text-center">
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
    <div className="min-h-screen bg-gray-50">
      <DashboardHeader />

      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-1">{t('common.dashboard')}</h1>
            <p className="text-gray-500">{t('dashboard.manageProjects')}</p>
          </div>
        </div>

        <div className="mb-8 animate-fade-in">
          <StatsOverview />
        </div>

        <div className="animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex flex-col sm:flex-row items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
                  {t('dashboard.projectGallery')}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('dashboard.projectGalleryDescription')}
                </p>
              </div>

              <ProjectToolbar
                sortField={
                  sortField as 'name' | 'updatedAt' | 'segmentationStatus'
                }
                sortDirection={sortDirection}
                onSort={handleSort}
                viewMode={viewMode}
                setViewMode={setViewMode}
                showSearchBar={false}
                showUploadButton={false}
                showExportButton={false}
              />
            </div>

            <ProjectsTab
              projects={projects}
              viewMode={viewMode}
              loading={loading}
              onOpenProject={handleOpenProject}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
