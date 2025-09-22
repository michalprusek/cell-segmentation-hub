import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
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
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center">
            <Button
              variant="outline"
              size="sm"
              className="mr-4"
              onClick={() => navigate('/dashboard')}
            >
              {t('common.back')}
            </Button>
            <div>
              <h1 className="text-xl font-semibold dark:text-white">
                {projectTitle}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
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
