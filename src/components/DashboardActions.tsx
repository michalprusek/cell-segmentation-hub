
import React from "react";
import {
  Grid2X2,
  List as ListIcon,
  ArrowUpDown
} from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

interface DashboardActionsProps {
  viewMode: "grid" | "list";
  setViewMode: (mode: "grid" | "list") => void;
  onSort?: (field: string, direction: 'asc' | 'desc') => void;
  sortOptions?: Array<{field: string, label: string}>;
}

const DashboardActions = ({ 
  viewMode, 
  setViewMode, 
  onSort,
  sortOptions = [] 
}: DashboardActionsProps) => {
  const { t } = useLanguage();

  return (
    <div className="flex items-center space-x-2">
      {onSort && sortOptions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1">
              <ArrowUpDown className="h-4 w-4" />
              <span className="hidden sm:inline">{t('common.sort')}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {sortOptions.map((option) => (
              <DropdownMenuItem 
                key={option.field}
                onClick={() => onSort(option.field, 'asc')}
                className="flex justify-between"
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      
      <ToggleGroup 
        type="single" 
        value={viewMode} 
        onValueChange={(value) => {
          if (value) setViewMode(value as "grid" | "list");
        }} 
        className="flex items-center h-9"
      >
        <ToggleGroupItem value="grid" aria-label="Grid view" className="h-9 px-2 flex items-center justify-center">
          <Grid2X2 className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="list" aria-label="List view" className="h-9 px-2 flex items-center justify-center">
          <ListIcon className="h-4 w-4" />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
};

export default DashboardActions;
