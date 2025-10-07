import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import DashboardHeader from '@/components/DashboardHeader';

interface ProjectHeaderProps {
  projectTitle: string;
  imagesCount: number;
  loading: boolean;
}

const ProjectHeader = ({
  projectTitle,
  imagesCount,
  loading,
}: ProjectHeaderProps) => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <>
      <DashboardHeader />
      <div className="bg-white dark:bg-gray-800 shadow-sm border-b dark:border-gray-700">
        <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center gap-2 sm:gap-4">
            <Button
              variant="ghost"
              size="sm"
              className="min-w-[44px] h-10 sm:h-9"
              onClick={() => navigate('/dashboard')}
            >
              <ArrowLeft className="mr-1 sm:mr-2 h-4 w-4" />
              <span className="hidden sm:inline">{t('common.back')}</span>
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg sm:text-xl font-semibold dark:text-white truncate">
                {projectTitle}
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                {loading
                  ? t('common.loading')
                  : `${imagesCount} ${t('common.images').toLowerCase()}`}
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default ProjectHeader;
