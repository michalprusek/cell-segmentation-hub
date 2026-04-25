import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/contexts/useLanguage';
import DashboardHeader from '@/components/DashboardHeader';
import { PROJECT_TYPES, type ProjectType } from '@/types';

interface ProjectHeaderProps {
  projectTitle: string;
  imagesCount: number;
  loading: boolean;
  projectType?: ProjectType;
  onTypeChange?: (type: ProjectType) => void;
}

const ProjectHeader = ({
  projectTitle,
  imagesCount,
  loading,
  projectType,
  onTypeChange,
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
            {projectType && (
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t('projects.projectType')}:
                </span>
                {onTypeChange ? (
                  <Select
                    value={projectType}
                    onValueChange={(v: ProjectType) => onTypeChange(v)}
                  >
                    <SelectTrigger className="h-8 w-[180px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_TYPES.map(pt => (
                        <SelectItem key={pt} value={pt} className="text-xs">
                          {t(`projects.types.${pt}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-sm font-medium">
                    {t(`projects.types.${projectType}`)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default ProjectHeader;
