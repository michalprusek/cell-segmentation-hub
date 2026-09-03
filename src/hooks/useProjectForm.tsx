import { useState } from 'react';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { useAuth } from '@/contexts/useAuth';
import { getErrorMessage as _getErrorMessage, type ProjectType } from '@/types';
import { getLocalizedErrorMessage } from '@/lib/errorUtils';
import { logger } from '@/lib/logger';
import { useLanguage } from '@/contexts/useLanguage';

interface UseProjectFormProps {
  onSuccess?: (projectId: string) => void;
  onClose: () => void;
  /** Folder the dashboard is currently showing, or null at the root.
   *
   *  `POST /projects` has no folder field — placement is a separate
   *  `/folders/:id/items` call — so a project created while the user was
   *  inside a folder used to appear at the root instead, and had to be moved
   *  by hand (Institut Curie request, 2026-09-03). */
  folderId?: string | null;
}

export const useProjectForm = ({
  onSuccess,
  onClose,
  folderId = null,
}: UseProjectFormProps) => {
  const { t } = useLanguage();
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('spheroid');
  const [isCreating, setIsCreating] = useState(false);
  const { user } = useAuth();

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!projectName.trim()) {
      toast.error(t('errors.validationErrors.projectNameRequired'));
      return;
    }

    if (!user) {
      toast.error(t('errors.validationErrors.loginRequired'));
      return;
    }

    setIsCreating(true);

    try {
      const projectData = await apiClient.createProject({
        name: projectName,
        description: projectDescription || t('projects.noDescriptionProvided'),
        type: projectType,
      });

      // Validate response
      if (!projectData || !projectData.id) {
        logger.error('Invalid project creation response:', projectData);
        toast.error(t('toast.project.createFailed'), {
          description: t('toast.project.invalidResponse'),
        });
        return;
      }

      // File it where the user was looking. A separate call because the create
      // endpoint takes no folder; skipped at the root, where "no placement" is
      // already the answer and a move could only fail for nothing.
      if (folderId) {
        try {
          await apiClient.moveProjectsToFolder(folderId, [projectData.id]);
        } catch (moveError) {
          // The project EXISTS. Reporting this as a failed creation would send
          // the user hunting for something that is already there, one level up
          // — so it is a warning about the PLACEMENT, and the flow continues.
          logger.error('Failed to file new project into folder:', moveError);
          toast.warning(t('toast.project.createdAtRootInstead'), {
            description: t('toast.project.moveToFolderFailed'),
          });
        }
      }

      toast.success(t('toast.project.created'), {
        description: `"${projectName}" ${t('toast.project.readyForImages')}`,
      });

      onClose();
      setProjectName('');
      setProjectDescription('');
      setProjectType('spheroid');

      // Trigger refresh or callback
      if (onSuccess && projectData.id) {
        onSuccess(projectData.id);
      } else if (projectData.id) {
        // Trigger refresh
        const event = new CustomEvent('project-created', {
          detail: { projectId: projectData.id },
        });
        window.dispatchEvent(event);
      }
    } catch (error: unknown) {
      logger.error('Error creating project:', error);
      const errorMessage = getLocalizedErrorMessage(
        error,
        t,
        'errors.operations.saveProject'
      );
      toast.error(errorMessage);
    } finally {
      setIsCreating(false);
    }
  };

  return {
    projectName,
    setProjectName,
    projectDescription,
    setProjectDescription,
    projectType,
    setProjectType,
    isCreating,
    handleCreateProject,
  };
};
