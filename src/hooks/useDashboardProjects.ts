import { useState, useEffect, useCallback, useRef } from 'react';
import { Project } from '@/components/ProjectsList';
import { ProjectImage } from '@/types';
import apiClient from '@/lib/api';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { getLocalizedErrorMessage } from '@/lib/errorUtils';
import { useLanguage } from '@/contexts/useLanguage';
import { useAuth } from '@/contexts/useAuth';
import { useNavigate } from 'react-router-dom';
import { useDebounce } from '@/hooks/useDebounce';
import config from '@/lib/config';

export interface DashboardProjectsOptions {
  sortField: string;
  sortDirection: 'asc' | 'desc';
  userId: string | undefined;
  userEmail?: string;
}

// Interface for project data from API including optional images
interface ApiProject extends Project {
  images?: ProjectImage[];
}

export const useDashboardProjects = ({
  sortField,
  sortDirection,
  userId,
  userEmail,
}: DashboardProjectsOptions) => {
  const { t } = useLanguage();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Debounce the fetch requests to prevent rapid-fire calls
  const debouncedUserId = useDebounce(userId, 300);
  const debouncedSortField = useDebounce(sortField, 200);
  const debouncedSortDirection = useDebounce(sortDirection, 200);

  const fetchProjects = useCallback(
    async (force = false) => {
      if (!userId && !force) return;

      // Cancel previous request if it exists
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new AbortController for this request
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        // Clear state before fetching new data to prevent race conditions
        if (!force) {
          setProjects([]);
        }
        setLoading(true);
        setFetchError(null);

        // Check if request was aborted before making API calls
        if (controller.signal.aborted) return;

        // Add cache-busting timestamp to prevent browser cache
        const timestamp = Date.now();

        // Fetch owned projects first
        const ownedResponse = await apiClient.getProjects({ _t: timestamp });

        // Try to fetch shared projects, but don't fail if it errors
        let sharedResponse = [];
        try {
          const response = await apiClient.getSharedProjects({ _t: timestamp });
          // Handle both array and wrapped response formats
          if (Array.isArray(response)) {
            sharedResponse = response;
          } else if (response && typeof response === 'object') {
            // Check for data property or projects property
            sharedResponse = response.data || response.projects || [];
          } else {
            sharedResponse = [];
          }
          logger.debug('Shared projects response loaded', 'Dashboard', {
            count: Array.isArray(sharedResponse) ? sharedResponse.length : 0,
          });
        } catch (shareError) {
          logger.error('Failed to fetch shared projects', shareError);
          logger.warn('Failed to fetch shared projects:', shareError);
          sharedResponse = [];
          // Continue with just owned projects
        }

        const ownedProjects = ownedResponse.projects || [];
        const sharedProjects = Array.isArray(sharedResponse)
          ? sharedResponse
          : [];

        logger.debug(`Owned projects count: ${ownedProjects.length}`);
        logger.debug(`Shared projects count: ${sharedProjects.length}`);

        // Get current user info for owned projects
        const _currentUser = { email: userEmail || 'Unknown' };

        // Create a map to track unique projects and avoid duplicates
        const projectMap = new Map();

        // First, collect all project IDs from shared projects to exclude them from owned
        const sharedProjectIds = new Set(
          sharedProjects.map((p: any) => p.project?.id || p.id)
        );

        logger.debug('Shared project IDs:', Array.from(sharedProjectIds));

        // Add owned projects (but skip if they're in the shared list)
        ownedProjects.forEach((p: ApiProject) => {
          // Skip this "owned" project if it's actually shared with us
          if (sharedProjectIds.has(p.id)) {
            logger.debug(
              `Skipping project ${p.id} from owned list as it's in shared list`
            );
            return;
          }

          projectMap.set(p.id, {
            ...p,
            isOwned: true,
            isShared: false,
            owner: p.user || p.owner || { email: userEmail || 'Unknown' }, // For owned projects, the owner is the current user
          });
        });

        // Add shared projects (these take priority)
        sharedProjects.forEach((p: any) => {
          // Handle the nested structure from the backend
          const project = p.project || p;
          const projectId = project.id;

          // Debug log to check shared project data
          logger.debug('Processing shared project:', {
            projectId,
            hasOwner: !!project.owner,
            ownerEmail: project.owner?.email,
            sharedByEmail: p.sharedBy?.email,
            projectStructure: {
              hasProject: !!p.project,
              hasOwnerInProject: !!project.owner,
              ownerData: project.owner,
            },
          });

          // Always add shared projects (they override any "owned" entry)
          // Ensure we preserve the owner information correctly
          const sharedProjectData = {
            ...project,
            name: project.name || project.title, // Ensure name field exists
            title: project.title || project.name, // Ensure title field exists
            isOwned: false,
            isShared: true,
            sharedBy: p.sharedBy,
            owner: project.owner, // The backend sends owner directly as 'owner'
            shareStatus: p.status,
            shareId: p.shareId, // Add shareId for unshare functionality
          };

          // Extra validation to ensure owner is preserved
          if (!sharedProjectData.owner && project.owner) {
            logger.error('Owner data lost during mapping!', {
              originalOwner: project.owner,
              mappedOwner: sharedProjectData.owner,
            });
          }

          projectMap.set(projectId, sharedProjectData);
        });

        // Convert map back to array
        const allProjects = Array.from(projectMap.values());

        // Debug log the raw project data before processing
        logger.debug('All projects before processing:', {
          count: allProjects.length,
          projects: allProjects.map(p => ({
            id: p.id,
            title: p.title || p.name,
            isShared: p.isShared,
            isOwned: p.isOwned,
            owner: p.owner,
            hasOwner: !!p.owner,
            ownerEmail: p.owner?.email,
          })),
        });

        // Process all projects
        const projectsWithDetails = allProjects.map(
          (
            project: ApiProject & {
              isOwned?: boolean;
              isShared?: boolean;
              sharedBy?: { email: string };
              owner?: { email: string; name?: string };
            }
          ) => {
            // Extract thumbnail from backend data (first image if available)
            let thumbnail = '/placeholder.svg';
            const imageCount = project.image_count || 0;

            // If project has associated image data from backend
            if (project.images && project.images.length > 0) {
              const firstImage = project.images[0];
              thumbnail =
                firstImage.thumbnailPath ||
                firstImage.originalPath ||
                '/placeholder.svg';

              // Ensure URL is absolute for Docker environment
              if (thumbnail && !thumbnail.startsWith('http')) {
                const baseUrl = config.apiBaseUrl
                  .replace('/api', '')
                  .replace(/\/+$/, '');
                const cleanThumbnail = thumbnail.replace(/^\/+/, '');
                thumbnail = `${baseUrl}/${cleanThumbnail}`;
              }
            }

            const processedProject = {
              ...project,
              title: project.name || project.title, // Map backend 'name' to frontend 'title'
              description: project.description,
              thumbnail,
              date: formatDate(project.updated_at),
              imageCount,
              isOwned: project.isOwned,
              isShared: project.isShared,
              sharedBy: project.sharedBy,
              owner: project.owner,
              shareId: project.shareId, // Pass through shareId for unshare functionality
            };

            // Debug log for shared projects
            if (project.isShared) {
              logger.debug('Processing shared project details:', {
                id: processedProject.id,
                title: processedProject.title,
                owner: processedProject.owner,
                ownerEmail: processedProject.owner?.email,
                isShared: processedProject.isShared,
                sharedBy: processedProject.sharedBy,
              });
            }

            return processedProject;
          }
        );

        // Sort projects based on sortField and sortDirection
        const sortedProjects = projectsWithDetails.sort((a, b) => {
          const aValue: unknown = a[sortField as keyof typeof a];
          const bValue: unknown = b[sortField as keyof typeof b];

          // Handle date fields
          if (sortField === 'created_at' || sortField === 'updated_at') {
            const aTime = new Date(aValue).getTime();
            const bTime = new Date(bValue).getTime();

            // Handle invalid dates as lowest priority
            const aNum = isNaN(aTime) ? -Infinity : aTime;
            const bNum = isNaN(bTime) ? -Infinity : bTime;

            if (aNum === bNum) return 0;
            return sortDirection === 'asc'
              ? aNum > bNum
                ? 1
                : -1
              : aNum < bNum
                ? 1
                : -1;
          }

          // Handle null/undefined values
          if (aValue == null && bValue == null) return 0;
          if (aValue == null) return sortDirection === 'asc' ? 1 : -1;
          if (bValue == null) return sortDirection === 'asc' ? -1 : 1;

          // Handle string comparison
          if (typeof aValue === 'string' && typeof bValue === 'string') {
            const result = aValue.localeCompare(bValue);
            return sortDirection === 'asc' ? result : -result;
          }

          // Handle numeric comparison
          if (typeof aValue === 'number' && typeof bValue === 'number') {
            // Handle NaN values
            if (isNaN(aValue) && isNaN(bValue)) return 0;
            if (isNaN(aValue)) return sortDirection === 'asc' ? 1 : -1;
            if (isNaN(bValue)) return sortDirection === 'asc' ? -1 : 1;

            if (aValue === bValue) return 0;
            return sortDirection === 'asc'
              ? aValue > bValue
                ? 1
                : -1
              : aValue < bValue
                ? 1
                : -1;
          }

          // Fallback comparison
          const aStr = String(aValue);
          const bStr = String(bValue);
          const result = aStr.localeCompare(bStr);
          return sortDirection === 'asc' ? result : -result;
        });

        // Final check before setting state
        if (!controller.signal.aborted) {
          setProjects(sortedProjects);
        }
      } catch (error) {
        // Don't handle errors for aborted requests
        if (controller.signal.aborted) return;

        logger.error('Error fetching projects:', error);

        // Check for missing token error
        if (
          error &&
          typeof error === 'object' &&
          'response' in error &&
          'data' in (error as any).response &&
          (error as any).response?.data?.message === 'Chybí autentizační token'
        ) {
          // Missing authentication token - sign out and redirect
          await signOut();
          navigate('/sign-in');
          return;
        }

        const errorMessage = getLocalizedErrorMessage(
          error,
          t,
          'errors.operations.loadProject'
        );
        setFetchError(errorMessage);
        toast.error(errorMessage);
      } finally {
        // Only update loading state if this is still the active request
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [userId, userEmail, sortField, sortDirection, t, navigate, signOut]
  );

  // Use debounced values to prevent excessive API calls
  useEffect(() => {
    if (debouncedUserId) {
      fetchProjects();
    }
  }, [
    debouncedUserId,
    debouncedSortField,
    debouncedSortDirection,
    fetchProjects,
  ]);

  // Handle optimistic updates for project removal
  const removeProjectOptimistically = useCallback((projectId: string) => {
    setProjects(prevProjects =>
      prevProjects.filter(project => project.id !== projectId)
    );
  }, []);

  // Handle optimistic updates for project properties (thumbnail, imageCount, etc.)
  const updateProjectOptimistically = useCallback(
    (projectId: string, updates: Partial<Project>) => {
      setProjects(prevProjects =>
        prevProjects.map(project =>
          project.id === projectId ? { ...project, ...updates } : project
        )
      );
    },
    []
  );

  // Handle refetch events from failed operations
  useEffect(() => {
    const handleRefetchNeeded = () => {
      fetchProjects(true); // Force refetch
    };

    window.addEventListener('project-refetch-needed', handleRefetchNeeded);

    return () => {
      window.removeEventListener('project-refetch-needed', handleRefetchNeeded);
    };
  }, [fetchProjects]);

  // Cleanup function to abort ongoing requests when component unmounts
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Updated today';
    } else if (diffDays === 1) {
      return 'Updated yesterday';
    } else if (diffDays < 7) {
      return `Updated ${diffDays} days ago`;
    } else if (diffDays < 30) {
      const diffWeeks = Math.floor(diffDays / 7);
      return `Updated ${diffWeeks} ${diffWeeks === 1 ? 'week' : 'weeks'} ago`;
    } else {
      const diffMonths = Math.floor(diffDays / 30);
      return `Updated ${diffMonths} ${diffMonths === 1 ? 'month' : 'months'} ago`;
    }
  };

  return {
    projects,
    loading,
    fetchError,
    fetchProjects,
    removeProjectOptimistically,
    updateProjectOptimistically,
  };
};
