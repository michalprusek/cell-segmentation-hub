
import React from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Folder, Upload } from "lucide-react";
import { useLanguage } from '@/contexts/LanguageContext';
import ProjectToolbar from "@/components/project/ProjectToolbar";

interface DashboardTabsProps {
  activeTab: string;
  onTabChange: (value: string) => void;
  viewMode: "grid" | "list";
  setViewMode: (mode: "grid" | "list") => void;
  onSort: (field: 'name' | 'updatedAt' | 'segmentationStatus') => void;
  sortField: 'name' | 'updatedAt' | 'segmentationStatus';
  sortDirection: 'asc' | 'desc';
  children: React.ReactNode;
}

const DashboardTabs = ({ 
  activeTab, 
  onTabChange, 
  viewMode, 
  setViewMode, 
  onSort, 
  sortField, 
  sortDirection, 
  children 
}: DashboardTabsProps) => {
  const { t } = useLanguage();

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-6">
        <TabsList className="mb-0">
          <TabsTrigger value="projects" className="flex items-center gap-2">
            <Folder className="h-4 w-4" />
            {t('common.projects')}
          </TabsTrigger>
          <TabsTrigger value="upload" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            {t('common.uploadImages')}
          </TabsTrigger>
        </TabsList>
        
        {activeTab === 'projects' && (
          <ProjectToolbar
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={onSort}
            viewMode={viewMode}
            setViewMode={setViewMode}
            showSearchBar={false}
            showUploadButton={false}
            showExportButton={false}
          />
        )}
      </div>
      
      {children}
    </Tabs>
  );
};

export default DashboardTabs;
