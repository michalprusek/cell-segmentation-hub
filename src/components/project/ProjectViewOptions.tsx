import React from 'react';
import { Grid2X2, List as ListIcon } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useLanguage } from '@/contexts/useLanguage';

interface ProjectViewOptionsProps {
  viewMode: 'grid' | 'list';
  setViewMode: (mode: 'grid' | 'list') => void;
}

const ProjectViewOptions = ({
  viewMode,
  setViewMode,
}: ProjectViewOptionsProps) => {
  const { t } = useLanguage();

  return (
    <ToggleGroup
      type="single"
      value={viewMode}
      onValueChange={value => {
        if (value) setViewMode(value as 'grid' | 'list');
      }}
      className="flex items-center h-9"
    >
      <ToggleGroupItem
        value="grid"
        aria-label={t('accessibility.gridView')}
        className="h-9 px-2 flex items-center justify-center"
      >
        <Grid2X2 className="h-4 w-4" />
      </ToggleGroupItem>
      <ToggleGroupItem
        value="list"
        aria-label={t('accessibility.listView')}
        className="h-9 px-2 flex items-center justify-center"
      >
        <ListIcon className="h-4 w-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
};

export default ProjectViewOptions;
