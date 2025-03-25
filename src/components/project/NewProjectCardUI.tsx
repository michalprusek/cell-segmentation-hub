
import React from 'react';
import { Plus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface NewProjectCardUIProps {
  onClick: () => void;
}

const NewProjectCardUI = ({ onClick }: NewProjectCardUIProps) => {
  const { t } = useLanguage();

  return (
    <div 
      className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden h-full hover:shadow-md transition-shadow cursor-pointer"
      onClick={onClick}
    >
      <div className="p-6 flex flex-col items-center justify-center h-full min-h-[200px]">
        <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mb-4">
          <Plus className="h-8 w-8 text-blue-500 dark:text-blue-400" />
        </div>
        <h3 className="text-lg font-medium text-center mb-1">{t('projects.createProject')}</h3>
        <p className="text-gray-500 dark:text-gray-400 text-center text-sm mb-4">
          {t('projects.createProjectDesc')}
        </p>
      </div>
    </div>
  );
};

export default NewProjectCardUI;
