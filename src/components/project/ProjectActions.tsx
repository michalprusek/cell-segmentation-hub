import { logger } from '@/lib/logger';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MoreVertical, Trash, Share } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { getErrorMessage } from '@/types';
import { useLanguage } from '@/contexts/LanguageContext';
import { ShareDialog } from '@/components/project/ShareDialog';

interface ProjectActionsProps {
  projectId: string;
  projectTitle?: string;
}

const ProjectActions = ({
  projectId,
  projectTitle = 'Unknown Project',
}: ProjectActionsProps) => {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);

  const handleDeleteProject = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    setLoading(true);

    try {
      // Delete project using API
      await apiClient.deleteProject(projectId);

      toast.success(t('toast.project.deleted'));

      // Refresh projects list instead of page reload
      const event = new CustomEvent('project-deleted', {
        detail: { projectId },
      });
      window.dispatchEvent(event);
    } catch (error: unknown) {
      logger.error('Error deleting project:', error);
      const errorMessage =
        getErrorMessage(error, t) || t('errors.operations.deleteProject');
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // ShareDialog will handle the sharing logic
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 bg-white/80 backdrop-blur-sm rounded-full shadow-sm hover:bg-white"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <ShareDialog
          projectId={projectId}
          projectTitle={projectTitle}
          trigger={
            <DropdownMenuItem onSelect={e => e.preventDefault()}>
              <Share className="h-4 w-4 mr-2" />
              {t('sharing.share')}
            </DropdownMenuItem>
          }
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-red-600"
          onClick={handleDeleteProject}
          disabled={loading}
        >
          <Trash className="h-4 w-4 mr-2" />
          {t('common.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ProjectActions;
