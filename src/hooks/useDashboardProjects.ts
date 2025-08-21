import { useState, useEffect, useCallback } from 'react';
import { Project } from '@/components/ProjectsList';
import { ProjectImage } from '@/types';
import apiClient from '@/lib/api';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { getLocalizedErrorMessage } from '@/lib/errorUtils';
import { useLanguage } from '@/contexts/LanguageContext';
import config from '@/lib/config';

export interface DashboardProjectsOptions {
  sortField: string;
  sortDirection: 'asc' | 'desc';
  userId: string | undefined;
}

// Interface for project data from API including optional images
interface ApiProject extends Project {
  images?: ProjectImage[];
}

// Interface for shared project response
interface SharedProjectResponse {
  project: ApiProject;
  sharedBy: { id: string; email: string };
  status: string;
}

export const useDashboardProjects = ({
  sortField,
  sortDirection,
  userId,
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
      } catch (shareError) {
        logger.warn('Failed to fetch shared projects:', shareError);
        // Continue with just owned projects
      }

      const ownedProjects = ownedResponse.projects || [];
      const sharedProjects = sharedResponse || [];

      // Combine owned and shared projects - mark shared ones
      const allProjects = [
        ...ownedProjects.map((p: ApiProject) => ({
          ...p,
          isOwned: true,
          isShared: false,
        })),
        ...sharedProjects.map((p: SharedProjectResponse) => ({
          ...p.project,
          isOwned: false,
          isShared: true,
          sharedBy: p.sharedBy,
          shareStatus: p.status,
        })),
      ];

      // Process all projects
      const projectsWithDetails = allProjects.map(
        (project: ApiProject & { isOwned?: boolean; isShared?: boolean }) => {
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
  }, [userId, sortField, sortDirection, t]);

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
