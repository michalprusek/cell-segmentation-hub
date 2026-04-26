import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { cn } from '@/lib/utils';

/** Color-code each project type so disintegrated spheroids visually stand
 * out from the standard spheroid family. Tailwind classes; no inline style.
 */
const PROJECT_TYPE_BADGE: Record<ProjectType, string> = {
  spheroid:
    'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 border-blue-300 dark:border-blue-700',
  spheroid_invasive:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700 ring-1 ring-emerald-400/40',
  wound:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border-amber-300 dark:border-amber-700',
  sperm:
    'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200 border-purple-300 dark:border-purple-700',
};

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
                <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {t('projects.projectType')}:
                </span>
                {onTypeChange ? (
                  // Editable: dropdown trigger styled as a coloured pill that
                  // matches the badge palette. The pill background carries the
                  // type identity — no extra dot needed.
                  <Select
                    value={projectType}
                    onValueChange={(v: ProjectType) => onTypeChange(v)}
                  >
                    <SelectTrigger
                      aria-label={t('projects.changeProjectType')}
                      className={cn(
                        'h-8 min-w-[200px] text-xs font-medium border rounded-md pl-3 pr-2',
                        PROJECT_TYPE_BADGE[projectType]
                      )}
                    >
                      <span className="truncate">
                        {t(`projects.types.${projectType}`)}
                      </span>
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
                  // Read-only: same pill shape, no chevron.
                  <Badge
                    variant="outline"
                    className={cn(
                      'h-8 px-3 text-xs font-medium border',
                      PROJECT_TYPE_BADGE[projectType]
                    )}
                  >
                    {t(`projects.types.${projectType}`)}
                  </Badge>
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
