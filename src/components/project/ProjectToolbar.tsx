
import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ArrowUp, ArrowDown, ArrowUpDown, Upload } from "lucide-react";
import { useLanguage } from '@/contexts/LanguageContext';

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

  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 space-y-4 md:space-y-0">
      <div className="relative w-full md:w-auto">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" />
        <Input
          className="pl-10 pr-4 w-full md:w-80 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
          placeholder={t('dashboard.searchImagesPlaceholder')}
          value={searchTerm}
          onChange={onSearchChange}
        />
      </div>
      
      <div className="flex space-x-2">
        <Button variant="outline" size="sm" className="flex items-center h-9" onClick={onToggleUploader}>
          <Upload className="mr-1 h-4 w-4" />
          {t('common.uploadImages')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSort('name')}
          className="flex items-center h-9 dark:text-gray-300 dark:border-gray-700"
        >
          {t('common.name')}
          {sortField === 'name' && (
            sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
          )}
          {sortField !== 'name' && <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSort('updatedAt')}
          className="flex items-center h-9 dark:text-gray-300 dark:border-gray-700"
        >
          {t('dashboard.lastChange')}
          {sortField === 'updatedAt' && (
            sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
          )}
          {sortField !== 'updatedAt' && <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSort('segmentationStatus')}
          className="flex items-center h-9 dark:text-gray-300 dark:border-gray-700"
        >
          {t('common.status')}
          {sortField === 'segmentationStatus' && (
            sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
          )}
          {sortField !== 'segmentationStatus' && <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />}
        </Button>
      </div>
    </div>
  );
};

export default ProjectToolbar;
