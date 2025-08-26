import { useState, useEffect, useCallback } from 'react';
import { Project } from '@/components/ProjectsList';
import { ProjectImage } from '@/types';
import apiClient from '@/lib/api';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { getLocalizedErrorMessage } from '@/lib/errorUtils';
import { useLanguage } from '@/contexts/useLanguage';
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      setFetchError(null);

      // Fetch owned projects first
      const ownedResponse = await apiClient.getProjects();

      // Try to fetch shared projects, but don't fail if it errors
      let sharedResponse = [];
      try {
        sharedResponse = await apiClient.getSharedProjects();
        logger.debug('Shared projects response loaded', 'Dashboard', {
          count: sharedResponse.data.length,
        });
      } catch (shareError) {
        console.error('Failed to fetch shared projects:', shareError);
        logger.warn('Failed to fetch shared projects:', shareError);
        // Continue with just owned projects
      }

      const ownedProjects = ownedResponse.projects || [];
      const sharedProjects = sharedResponse || [];

      logger.debug(`Owned projects count: ${ownedProjects.length}`);
      logger.debug(`Shared projects count: ${sharedProjects.length}`);

      // Get current user info for owned projects
      const currentUser = { email: userEmail || 'Unknown' };

      // Create a map to track unique projects and avoid duplicates
      const projectMap = new Map();

      // Add owned projects first
      ownedProjects.forEach((p: ApiProject) => {
        projectMap.set(p.id, {
          ...p,
          isOwned: true,
          isShared: false,
          owner: p.owner || currentUser, // Use owner from backend or current user
        });
      });

      // Add shared projects (skip if already in owned)
      sharedProjects.forEach((p: any) => {
        const projectId = p.project?.id || p.id;
        // Only add if not already owned by the user
        if (!projectMap.has(projectId)) {
          projectMap.set(projectId, {
            ...p.project,
            isOwned: false,
            isShared: true,
            sharedBy: p.sharedBy,
            owner: p.project?.owner || p.sharedBy, // Use project owner or sharedBy as fallback
            shareStatus: p.status,
            shareId: p.shareId, // Add shareId for unshare functionality
          });
        }
      });

      // Convert map back to array
      const allProjects = Array.from(projectMap.values());

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

          return {
            ...project,
            title: project.name, // Map backend 'name' to frontend 'title'
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

      setProjects(sortedProjects);
    } catch (error) {
      logger.error('Error fetching projects:', error);
      const errorMessage = getLocalizedErrorMessage(
        error,
        t,
        'errors.operations.loadProject'
      );
      setFetchError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [userId, userEmail, sortField, sortDirection, t]);

  useEffect(() => {
    if (userId) {
      fetchProjects();
    }
  }, [fetchProjects, userId]);

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
  };
};
