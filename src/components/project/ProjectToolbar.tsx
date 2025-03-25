
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
}

const ProjectToolbar = ({ 
  searchTerm, 
  onSearchChange, 
  sortField, 
  sortDirection, 
  onSort,
  onToggleUploader
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
      
      <div className="flex gap-2">
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
      </div>
    </div>
  );
};

export default ProjectToolbar;
