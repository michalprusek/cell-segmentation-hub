import React, { useState, useEffect } from 'react';
import { SlidersHorizontal, Package, Trash2, Loader2, X } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AdvancedExportDialog } from '@/pages/export/AdvancedExportDialog';
import ExportStateManager from '@/lib/exportStateManager';
import { useAdvancedExport } from '@/pages/export/hooks/useAdvancedExport';
import { toast } from 'sonner';

interface ProjectToolbarProps {
  searchTerm?: string;
  onSearchChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sortField: 'name' | 'updatedAt' | 'segmentationStatus';
  sortDirection: 'asc' | 'desc';
  onSort: (field: 'name' | 'updatedAt' | 'segmentationStatus') => void;
  onToggleUploader?: () => void;
  viewMode: 'grid' | 'list';
  setViewMode: (mode: 'grid' | 'list') => void;
  showSearchBar?: boolean;
  showUploadButton?: boolean;
  showExportButton?: boolean;
  projectName?: string;
  images?: unknown[];
  selectedImageIds?: string[];
  // Selection props
  selectedCount?: number;
  isAllSelected?: boolean;
  isPartiallySelected?: boolean;
  onSelectAllToggle?: () => void;
  onBatchDelete?: () => void;
  showSelectAll?: boolean;
}

const ProjectToolbar = ({
  searchTerm,
  onSearchChange,
  sortField,
  sortDirection,
  onSort,
  onToggleUploader,
  viewMode,
  setViewMode,
  showSearchBar = true,
  showUploadButton = true,
  showExportButton = true,
  projectName = 'Project',
  images = [],
  selectedImageIds,
  selectedCount = 0,
  isAllSelected = false,
  isPartiallySelected = false,
  onSelectAllToggle,
  onBatchDelete,
  showSelectAll = false,
}: ProjectToolbarProps) => {
  const { t } = useLanguage();
  const _navigate = useNavigate();
  const { id: projectId } = useParams<{ id: string }>();
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Use the advanced export hook for cancellation functionality
  const { cancelExport, currentJob: _currentJob } = useAdvancedExport(
    projectId || ''
  );

  // Check for persisted export state on mount
  useEffect(() => {
    if (projectId) {
      const persistedState = ExportStateManager.getExportState(projectId);
      if (persistedState) {
        if (
          persistedState.status === 'exporting' ||
          persistedState.status === 'processing'
        ) {
          setIsExporting(true);
        } else if (persistedState.status === 'downloading') {
          setIsDownloading(true);
        }
      }
    }
  }, [projectId]);

  // Subscribe to cross-tab storage changes
  useEffect(() => {
    if (!projectId) return;

    const unsubscribe = ExportStateManager.subscribeToChanges(
      projectId,
      state => {
        if (state) {
          if (state.status === 'exporting' || state.status === 'processing') {
            setIsExporting(true);
            setIsDownloading(false);
          } else if (state.status === 'downloading') {
            setIsExporting(false);
            setIsDownloading(true);
          }
        } else {
          // State was cleared
          setIsExporting(false);
          setIsDownloading(false);
        }
      }
    );

    return unsubscribe;
  }, [projectId]);

  const handleExport = () => {
    setShowExportDialog(true);
  };

  const handleCancelExport = async () => {
    try {
      await cancelExport();
      toast.success(t('export.cancelled'));
    } catch (error) {
      console.error('Failed to cancel export:', error);
      toast.error(t('export.cancelFailed'));
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between mb-6 gap-4">
      {/* Selection bar - left side */}
      <div className="flex items-center gap-3">
        {/* Select All checkbox - only show when showSelectAll is true */}
        {showSelectAll && (
          <label className="flex items-center gap-2 px-3 py-1.5 border border-gray-200 rounded-lg bg-white dark:bg-gray-800 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            <Checkbox
              checked={isAllSelected}
              indeterminate={isPartiallySelected}
              onCheckedChange={onSelectAllToggle}
              className="h-4 w-4"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 select-none">
              {t('export.selectAll')}
            </span>
          </label>
        )}

        {selectedCount > 0 && (
          <>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('project.selected', { count: selectedCount })}
            </span>
            <Button
              onClick={onBatchDelete}
              size="sm"
              variant="destructive"
              className="ml-2"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {t('project.deleteSelected')}
            </Button>
          </>
        )}
      </div>

      {/* Toolbar actions - right side */}
      <div className="flex gap-2 items-center">
        {/* Vyhledávací pole zobrazit pouze pokud je požadováno */}
        {showSearchBar && searchTerm !== undefined && onSearchChange && (
          <div className="relative flex-grow max-w-md">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              className="pl-10 pr-4 w-full border rounded-md h-9 text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              placeholder={t('dashboard.searchImagesPlaceholder')}
              value={searchTerm}
              onChange={onSearchChange}
            />
          </div>
        )}

        {/* Upload tlačítko zobrazit pouze pokud je požadováno */}
        {showUploadButton && onToggleUploader && (
          <Button
            variant="outline"
            size="sm"
            className="flex items-center h-9"
            onClick={onToggleUploader}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mr-1 h-4 w-4"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" x2="12" y1="3" y2="15" />
            </svg>
            {t('common.uploadImages')}
          </Button>
        )}

        {/* Export/Cancel Export tlačítko zobrazit pouze pokud je požadováno */}
        {showExportButton && projectId && (
          <Button
            variant={isExporting ? 'destructive' : 'outline'}
            size="sm"
            className="flex items-center h-9"
            onClick={isExporting ? handleCancelExport : handleExport}
            disabled={isDownloading}
          >
            {isExporting ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                <X className="mr-1 h-4 w-4" />
                {t('export.cancelExport')}
              </>
            ) : isDownloading ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                {t('export.downloading')}
              </>
            ) : (
              <>
                <Package className="mr-1 h-4 w-4" />
                {t('export.advancedExport')}
              </>
            )}
          </Button>
        )}

        {/* Sort dropdown menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center h-9"
            >
              <SlidersHorizontal className="mr-1 h-4 w-4" />
              {t('common.sort')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onSort('name')}>
              <div className="flex justify-between w-full items-center">
                <span>{t('common.name')}</span>
                {sortField === 'name' && (
                  <span className="text-xs">
                    {sortDirection === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onSort('updatedAt')}>
              <div className="flex justify-between w-full items-center">
                <span>{t('dashboard.lastChange')}</span>
                {sortField === 'updatedAt' && (
                  <span className="text-xs">
                    {sortDirection === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onSort('segmentationStatus')}>
              <div className="flex justify-between w-full items-center">
                <span>{t('common.status')}</span>
                {sortField === 'segmentationStatus' && (
                  <span className="text-xs">
                    {sortDirection === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* View mode buttons */}
        <div className="flex items-center h-9 border rounded-md bg-background">
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size="sm"
            className="h-9 px-2.5 rounded-r-none"
            onClick={() => setViewMode('grid')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-grid-2x2"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M3 12h18" />
              <path d="M12 3v18" />
            </svg>
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            size="sm"
            className="h-9 px-2.5 rounded-l-none"
            onClick={() => setViewMode('list')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-list"
            >
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

      {/* Export Dialog */}
      {projectId && (
        <AdvancedExportDialog
          open={showExportDialog}
          onClose={() => setShowExportDialog(false)}
          projectId={projectId}
          projectName={projectName}
          images={images}
          selectedImageIds={selectedImageIds}
          onExportingChange={setIsExporting}
          onDownloadingChange={setIsDownloading}
        />
      )}
    </div>
  );
};

export default ProjectToolbar;
