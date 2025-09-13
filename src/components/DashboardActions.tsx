import React from 'react';
import { Grid2X2, List as ListIcon } from 'lucide-react';
// ArrowUpDown unused - available for future use
// ToggleGroup, ToggleGroupItem unused - available for future use
import { useLanguage } from '@/contexts/useLanguage';
import { Button } from './ui/button';
// DropdownMenu components unused - available for future use

interface DashboardActionsProps {
  viewMode: 'grid' | 'list';
  setViewMode: (mode: 'grid' | 'list') => void;
  onSort?: (field: string, direction: 'asc' | 'desc') => void;
  sortOptions?: Array<{ field: string; label: string }>;
}

const DashboardActions = ({
  viewMode,
  setViewMode,
  onSort: _onSort,
  sortOptions: _sortOptions = [],
}: DashboardActionsProps) => {
  const { t: _t } = useLanguage();

  return (
    <div className="flex items-center space-x-2">
      <div className="flex items-center h-9 border rounded-md bg-background">
        <Button
          variant={viewMode === 'grid' ? 'default' : 'ghost'}
          size="sm"
          className="h-9 px-2.5 rounded-r-none"
          onClick={() => setViewMode('grid')}
          aria-label="Grid view"
        >
          <Grid2X2 className="h-4 w-4" />
        </Button>
        <Button
          variant={viewMode === 'list' ? 'default' : 'ghost'}
          size="sm"
          className="h-9 px-2.5 rounded-l-none"
          onClick={() => setViewMode('list')}
          aria-label="List view"
        >
          <ListIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default DashboardActions;
