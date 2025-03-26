
import { useState, useEffect } from "react";
import { Project } from "@/components/ProjectsList";
import { supabase } from "@/integrations/supabase/client";
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

  useEffect(() => {
    if (userId) {
      fetchProjects();
    }
  }, [userId, sortField, sortDirection]);

  const fetchProjects = async () => {
    if (!userId) return;

    try {
      setLoading(true);
      setFetchError(null);
      
      const { data: projectsData, error: projectsError } = await supabase
        .from("projects")
        .select("*")
        .eq("user_id", userId)
        .order(sortField, { ascending: sortDirection === "asc" });

      if (projectsError) {
        throw projectsError;
      }

      const projectsWithDetails = await Promise.all(
        (projectsData || []).map(async (project) => {
          // Get image count
          const { count, error: countError } = await supabase
            .from("images")
            .select("id", { count: "exact" })
            .eq("project_id", project.id);

          if (countError) {
            console.error("Error fetching image count:", countError);
          }

          // Get the first image for thumbnail
          const { data: imageData, error: imageError } = await supabase
            .from("images")
            .select("thumbnail_url")
            .eq("project_id", project.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          const thumbnail = imageData?.thumbnail_url || "/placeholder.svg";

          return {
            ...project,
            thumbnail,
            date: formatDate(project.updated_at),
            imageCount: count || 0
          };
        })
      );

      setProjects(projectsWithDetails);
    } catch (error) {
      console.error("Error fetching projects:", error);
      setFetchError("Failed to load projects. Please try again.");
      toast.error("Failed to load projects");
    } finally {
      setLoading(false);
    }
  };

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
