import { logger } from '@/lib/logger';
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { MoreVertical, Trash, Share, UserMinus } from 'lucide-react';
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
  onDialogStateChange?: (isOpen: boolean) => void;
  isShared?: boolean;
  shareId?: string;
}

const ProjectActions = ({
  projectId,
  projectTitle = 'Unknown Project',
  onDialogStateChange,
  isShared = false,
  shareId,
}: ProjectActionsProps) => {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Notify parent when dialog state changes
  useEffect(() => {
    onDialogStateChange?.(shareDialogOpen);
  }, [shareDialogOpen, onDialogStateChange]);

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
    setDropdownOpen(false);
    // Small delay to ensure dropdown closes before dialog opens
    setTimeout(() => {
      setShareDialogOpen(true);
    }, 100);
  };

  const handleUnshare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    setLoading(true);

    try {
      // Remove shared project from user's list
      // This doesn't delete the project, just removes the share
      if (shareId) {
        await apiClient.revokeProjectShare(projectId, shareId);
      }

      toast.success(t('toast.project.unshared'));

      // Refresh projects list
      const event = new CustomEvent('project-unshared', {
        detail: { projectId, shareId },
      });
      window.dispatchEvent(event);
    } catch (error: unknown) {
      logger.error('Error unsharing project:', error);
      const errorMessage =
        getErrorMessage(error, t) || t('errors.operations.unshareProject');
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div onClick={e => e.stopPropagation()}>
        <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 bg-white/80 backdrop-blur-sm rounded-full shadow-sm hover:bg-white"
              onClick={e => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-48"
            onClick={e => e.stopPropagation()}
          >
            {!isShared && (
              <>
                <DropdownMenuItem onClick={handleShare}>
                  <Share className="h-4 w-4 mr-2" />
                  {t('sharing.share')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600"
                  onClick={e => {
                    e.stopPropagation();
                    handleDeleteProject(e);
                  }}
                  disabled={loading}
                >
                  <Trash className="h-4 w-4 mr-2" />
                  {t('common.delete')}
                </DropdownMenuItem>
              </>
            )}
            {isShared && (
              <DropdownMenuItem
                className="text-red-600"
                onClick={e => {
                  e.stopPropagation();
                  handleUnshare(e);
                }}
                disabled={loading}
              >
                <UserMinus className="h-4 w-4 mr-2" />
                {t('sharing.removeFromShared')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ShareDialog
        projectId={projectId}
        projectTitle={projectTitle}
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
      />
    </>
  );
};

export default ProjectActions;
