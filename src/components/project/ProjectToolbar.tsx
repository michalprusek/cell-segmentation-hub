
import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Upload, Download, SlidersHorizontal } from "lucide-react";
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface ProjectToolbarProps {
  searchTerm: string;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sortField: 'name' | 'updatedAt' | 'segmentationStatus';
  sortDirection: 'asc' | 'desc';
  onSort: (field: 'name' | 'updatedAt' | 'segmentationStatus') => void;
  onToggleUploader: () => void;
  viewMode: "grid" | "list";
  setViewMode: (mode: "grid" | "list") => void;
}

const ProjectToolbar = ({ 
  searchTerm, 
  onSearchChange, 
  sortField, 
  sortDirection, 
  onSort,
  onToggleUploader,
  viewMode,
  setViewMode
}: ProjectToolbarProps) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { id: projectId } = useParams<{ id: string }>();
  
  const handleExport = () => {
    if (projectId) {
      navigate(`/project/${projectId}/export`);
    }
  };

  return (
    <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
      <div className="relative flex-grow max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" />
        <Input
          className="pl-10 pr-4 w-full dark:bg-gray-800 dark:border-gray-700 dark:text-white"
          placeholder={t('dashboard.searchImagesPlaceholder')}
          value={searchTerm}
          onChange={onSearchChange}
        />
      </div>
      
      <div className="flex gap-2 items-center">
        <Button variant="outline" size="sm" className="flex items-center h-9" onClick={onToggleUploader}>
          <Upload className="mr-1 h-4 w-4" />
          {t('common.uploadImages')}
        </Button>
        
        <Button variant="outline" size="sm" className="flex items-center h-9" onClick={handleExport}>
          <Download className="mr-1 h-4 w-4" />
          Export
        </Button>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="flex items-center h-9">
              <SlidersHorizontal className="mr-1 h-4 w-4" />
              Seřadit
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onSort('name')}>
              <div className="flex justify-between w-full items-center">
                <span>{t('common.name')}</span>
                {sortField === 'name' && (
                  <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                )}
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onSort('updatedAt')}>
              <div className="flex justify-between w-full items-center">
                <span>{t('dashboard.lastChange')}</span>
                {sortField === 'updatedAt' && (
                  <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                )}
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onSort('segmentationStatus')}>
              <div className="flex justify-between w-full items-center">
                <span>{t('common.status')}</span>
                {sortField === 'segmentationStatus' && (
                  <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                )}
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        
        {/* View mode buttons now included in the toolbar */}
        <div className="flex items-center h-9 border rounded-md bg-background">
          <Button 
            variant={viewMode === "grid" ? "default" : "ghost"}
            size="sm" 
            className="h-9 px-2.5 rounded-r-none"
            onClick={() => setViewMode("grid")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-grid-2x2">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M3 12h18" />
              <path d="M12 3v18" />
            </svg>
          </Button>
          <Button 
            variant={viewMode === "list" ? "default" : "ghost"}
            size="sm" 
            className="h-9 px-2.5 rounded-l-none"
            onClick={() => setViewMode("list")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-list">
              <line x1="8" x2="21" y1="6" y2="6" />
              <line x1="8" x2="21" y1="12" y2="12" />
              <line x1="8" x2="21" y1="18" y2="18" />
              <line x1="3" x2="3.01" y1="6" y2="6" />
              <line x1="3" x2="3.01" y1="12" y2="12" />
              <line x1="3" x2="3.01" y1="18" y2="18" />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProjectToolbar;
