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

interface ProjectActionsProps {
  projectId: string;
}

const ProjectActions = ({ projectId }: ProjectActionsProps) => {
  const [loading, setLoading] = useState(false);

  const handleDeleteProject = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    setLoading(true);

    try {
      // Delete project using API
      await apiClient.deleteProject(projectId);

      toast.success('Project deleted successfully');

      // Refresh projects list instead of page reload
      const event = new CustomEvent('project-deleted', {
        detail: { projectId },
      });
      window.dispatchEvent(event);
    } catch (error: unknown) {
      logger.error('Error deleting project:', error);
      const errorMessage = getErrorMessage(error) || 'Failed to delete project';
      toast.error('Failed to delete project: ' + errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // Copy the project URL to clipboard
    const projectUrl = `${window.location.origin}/project/${projectId}`;
    navigator.clipboard.writeText(projectUrl);

    toast.success('Project URL copied to clipboard');
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
        <DropdownMenuItem onClick={handleShare}>
          <Share className="h-4 w-4 mr-2" />
          Share
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-red-600"
          onClick={handleDeleteProject}
          disabled={loading}
        >
          <Trash className="h-4 w-4 mr-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ProjectActions;
