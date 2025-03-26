
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import DashboardHeader from "@/components/DashboardHeader";
import StatsOverview from "@/components/StatsOverview";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from '@/contexts/LanguageContext';
import DashboardTabs from "@/components/dashboard/DashboardTabs";
import ProjectsTab from "@/components/dashboard/ProjectsTab";
import UploadTab from "@/components/dashboard/UploadTab";
import { useDashboardProjects } from "@/hooks/useDashboardProjects";

const Dashboard = () => {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortField, setSortField] = useState<string>("updated_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [activeTab, setActiveTab] = useState("projects");
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();
  
  const { 
    projects, 
    loading, 
    fetchError, 
    fetchProjects 
  } = useDashboardProjects({
    sortField,
    sortDirection,
    userId: user?.id
  });
  
  useEffect(() => {
    // Poslouchej události pro aktualizaci seznamu projektů
    const handleProjectCreated = () => fetchProjects();
    const handleProjectDeleted = () => fetchProjects();
    
    window.addEventListener('project-created', handleProjectCreated);
    window.addEventListener('project-deleted', handleProjectDeleted);
    
    return () => {
      window.removeEventListener('project-created', handleProjectCreated);
      window.removeEventListener('project-deleted', handleProjectDeleted);
    };
  }, [fetchProjects]);

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
          <DashboardTabs 
            activeTab={activeTab} 
            onTabChange={setActiveTab}
            viewMode={viewMode}
            setViewMode={setViewMode}
            onSort={handleSort}
            sortField="name"
            sortDirection="asc"
          >
            <TabsContent value="projects" className="mt-6">
              <ProjectsTab 
                projects={projects}
                viewMode={viewMode}
                loading={loading}
                onOpenProject={handleOpenProject}
              />
            </TabsContent>
            
            <TabsContent value="upload" className="mt-6">
              <UploadTab />
            </TabsContent>
          </DashboardTabs>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
