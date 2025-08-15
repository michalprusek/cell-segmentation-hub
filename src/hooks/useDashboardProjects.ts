import { useState, useEffect, useCallback } from "react";
import { Project } from "@/components/ProjectsList";
import apiClient from "@/lib/api";
import { toast } from "sonner";

export interface DashboardProjectsOptions {
  sortField: string;
  sortDirection: "asc" | "desc";
  userId: string | undefined;
}

export const useDashboardProjects = ({ sortField, sortDirection, userId }: DashboardProjectsOptions) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      setFetchError(null);
      
      const response = await apiClient.getProjects();
      const projectsData = response.projects;

      // No need for additional API calls - backend now includes image data
      const projectsWithDetails = (projectsData || []).map((project) => {
        // Extract thumbnail from backend data (first image if available)
        let thumbnail = "/placeholder.svg";
        const imageCount = project.image_count || 0;
        
        // If project has associated image data from backend
        if ((project as any).images && (project as any).images.length > 0) {
          const firstImage = (project as any).images[0];
          thumbnail = firstImage.thumbnailPath || firstImage.originalPath || "/placeholder.svg";
          
          // Ensure URL is absolute for Docker environment
          if (thumbnail && !thumbnail.startsWith('http')) {
            const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace('/api', '') || 'http://localhost:3001';
            thumbnail = `${baseUrl}${thumbnail.startsWith('/') ? '' : '/'}${thumbnail}`;
          }
        }

        return {
          ...project,
          thumbnail,
          date: formatDate(project.updated_at),
          imageCount
        };
      });

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
          return sortDirection === 'asc' ? 
            (aNum > bNum ? 1 : -1) : 
            (aNum < bNum ? 1 : -1);
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
          return sortDirection === 'asc' ? 
            (aValue > bValue ? 1 : -1) : 
            (aValue < bValue ? 1 : -1);
        }

        // Fallback comparison
        const aStr = String(aValue);
        const bStr = String(bValue);
        const result = aStr.localeCompare(bStr);
        return sortDirection === 'asc' ? result : -result;
      });

      setProjects(sortedProjects);
    } catch (error) {
      console.error("Error fetching projects:", error);
      setFetchError("Failed to load projects. Please try again.");
      toast.error("Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [userId, sortField, sortDirection]);

  useEffect(() => {
    if (userId) {
      fetchProjects();
    }
  }, [fetchProjects, userId, sortField, sortDirection]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return "Updated today";
    } else if (diffDays === 1) {
      return "Updated yesterday";
    } else if (diffDays < 7) {
      return `Updated ${diffDays} days ago`;
    } else if (diffDays < 30) {
      const diffWeeks = Math.floor(diffDays / 7);
      return `Updated ${diffWeeks} ${diffWeeks === 1 ? "week" : "weeks"} ago`;
    } else {
      const diffMonths = Math.floor(diffDays / 30);
      return `Updated ${diffMonths} ${diffMonths === 1 ? "month" : "months"} ago`;
    }
  };

  return {
    projects,
    loading,
    fetchError,
    fetchProjects
  };
};