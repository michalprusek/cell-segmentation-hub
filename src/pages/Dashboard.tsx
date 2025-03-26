import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

import DashboardHeader from "@/components/DashboardHeader";
import StatsOverview from "@/components/StatsOverview";
import ProjectsList, { Project } from "@/components/ProjectsList";
import ImageUploader from "@/components/ImageUploader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from '@/contexts/LanguageContext';
import ProjectToolbar from "@/components/project/ProjectToolbar"; 

const Dashboard = () => {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<string>("updated_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();
  
  useEffect(() => {
    if (user) {
      fetchProjects();
    }
    
    // Poslouchej události pro aktualizaci seznamu projektů
    const handleProjectCreated = () => fetchProjects();
    const handleProjectDeleted = () => fetchProjects();
    
    window.addEventListener('project-created', handleProjectCreated);
    window.addEventListener('project-deleted', handleProjectDeleted);
    
    return () => {
      window.removeEventListener('project-created', handleProjectCreated);
      window.removeEventListener('project-deleted', handleProjectDeleted);
    };
  }, [user, sortField, sortDirection]);

  const fetchProjects = async () => {
    if (!user) return;

    try {
      setLoading(true);
      setFetchError(null);
      
      const { data: projectsData, error: projectsError } = await supabase
        .from("projects")
        .select("*")
        .eq("user_id", user.id)
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
  
  const handleOpenProject = (id: string) => {
    navigate(`/project/${id}`);
  };

  const handleSort = (field: 'name' | 'updatedAt' | 'segmentationStatus') => {
    let dbField = sortField;
    
    // Map field names to database fields
    if (field === 'name') dbField = 'title';
    else if (field === 'updatedAt') dbField = 'updated_at';
    
    // Toggle direction if same field
    const newDirection = 
      dbField === sortField ? (sortDirection === 'asc' ? 'desc' : 'asc') : 'desc';
    
    setSortField(dbField);
    setSortDirection(newDirection);
  };

  const handleToggleUploader = () => {
    // Fix the TypeScript error by casting the element to HTMLElement
    const uploadTab = document.querySelector('[data-state="inactive"][value="upload"]') as HTMLElement;
    if (uploadTab) {
      uploadTab.click();
    }
  };

  if (fetchError) {
    return (
      <div className="min-h-screen bg-gray-50">
        <DashboardHeader />
        <div className="container mx-auto px-4 py-8">
          <div className="bg-white p-6 rounded-lg border border-red-200 text-center">
            <p className="text-red-500 mb-4">{fetchError}</p>
            <button onClick={fetchProjects} className="bg-blue-500 text-white px-4 py-2 rounded">
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
        
        <div className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6">
            <div className="flex-grow"></div> {/* Spacer */}
            <ProjectToolbar
              sortField="name" 
              sortDirection="asc" 
              onSort={handleSort}
              viewMode={viewMode}
              setViewMode={setViewMode}
              showSearchBar={false}
              showUploadButton={false}
              showExportButton={false}
            />
          </div>
          
          <div className="mt-0">
            <ProjectsList 
              projects={projects} 
              viewMode={viewMode} 
              onOpenProject={handleOpenProject}
              loading={loading}
              showCreateCard={true}
            />
          </div>
          
          <div className="hidden">
            <div id="uploader-container">
              <ImageUploader />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
