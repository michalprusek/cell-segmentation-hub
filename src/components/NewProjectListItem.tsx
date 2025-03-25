
import React from 'react';
import { Card } from "@/components/ui/card";
import { Plus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface NewProjectListItemProps {
  onClick: () => void;
}

const NewProjectListItem = ({ onClick }: NewProjectListItemProps) => {
  const { t } = useLanguage();

  return (
    <Card 
      className="overflow-hidden cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-300 w-full"
      onClick={onClick}
    >
      <div className="flex items-center p-4">
        <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mr-4">
          <Plus className="h-8 w-8 text-blue-500 dark:text-blue-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-medium">{t('projects.createProject')}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('projects.createProjectDesc')}
          </p>
        </div>
      </div>
    </Card>
  );
};

export default NewProjectListItem;
