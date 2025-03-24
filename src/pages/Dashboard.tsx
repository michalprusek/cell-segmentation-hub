
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

import DashboardHeader from "@/components/DashboardHeader";
import DashboardActions from "@/components/DashboardActions";
import StatsOverview from "@/components/StatsOverview";
import ProjectsList from "@/components/ProjectsList";
import ImageUploader from "@/components/ImageUploader";
import NewProject from "@/components/NewProject";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Project {
  id: string;
  title: string;
  description: string;
  thumbnail?: string;
  date?: string;
  imageCount?: number;
}

const Dashboard = () => {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { user } = useAuth();
  
  useEffect(() => {
    fetchProjects();
  }, [user]);

  const fetchProjects = async () => {
    if (!user) return;

    try {
      setLoading(true);
      
      // Fetch projects
      const { data: projectsData, error: projectsError } = await supabase
        .from("projects")
        .select("*")
        .order("updated_at", { ascending: false });

      if (projectsError) {
        throw projectsError;
      }

      // Fetch image counts for each project
      const projectsWithDetails = await Promise.all(
        (projectsData || []).map(async (project) => {
          const { count, error: countError } = await supabase
            .from("images")
            .select("id", { count: "exact" })
            .eq("project_id", project.id);

          if (countError) {
            console.error("Error fetching image count:", countError);
          }

          return {
            ...project,
            thumbnail: "/placeholder.svg", // Default thumbnail
            date: formatDate(project.updated_at),
            imageCount: count || 0
          };
        })
      );

      setProjects(projectsWithDetails);
    } catch (error) {
      console.error("Error fetching projects:", error);
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
  
  const handleProjectCreated = (projectId: string) => {
    // Refresh projects list
    fetchProjects();
    
    // Redirect to the new project
    setTimeout(() => {
      navigate(`/project/${projectId}`);
    }, 500);
  };
  
  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardHeader />
      
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
            <p className="text-gray-500">Manage your research projects and analyses</p>
          </div>
          <div className="mt-4 md:mt-0">
            <NewProject onProjectCreated={handleProjectCreated} />
          </div>
        </div>
        
        <div className="mb-8 animate-fade-in">
          <StatsOverview />
        </div>
        
        <Tabs defaultValue="projects" className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6">
            <TabsList className="mb-4 sm:mb-0">
              <TabsTrigger value="projects">Projects</TabsTrigger>
              <TabsTrigger value="upload">Upload Images</TabsTrigger>
              <TabsTrigger value="recent">Recent Analyses</TabsTrigger>
            </TabsList>
            
            <DashboardActions viewMode={viewMode} setViewMode={setViewMode} />
          </div>
          
          <TabsContent value="projects" className="mt-0">
            <ProjectsList 
              projects={projects} 
              viewMode={viewMode} 
              onOpenProject={handleOpenProject}
              loading={loading}
            />
          </TabsContent>
          
          <TabsContent value="upload" className="mt-0">
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <ImageUploader />
            </div>
          </TabsContent>
          
          <TabsContent value="recent" className="mt-0">
            <div className="bg-white p-6 rounded-lg border border-gray-200 text-center py-12">
              <div className="max-w-md mx-auto">
                <h3 className="text-lg font-medium mb-2">No Recent Analyses</h3>
                <p className="text-gray-500 mb-6">
                  Your recently processed images and analyses will appear here.
                </p>
                <Button>Upload Images to Analyze</Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Dashboard;
