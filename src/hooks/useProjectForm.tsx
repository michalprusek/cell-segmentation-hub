import { useState } from 'react';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { getErrorMessage } from '@/types';
import { getLocalizedErrorMessage } from '@/lib/errorUtils';
import { logger } from '@/lib/logger';
import { useLanguage } from '@/contexts/LanguageContext';

interface UseProjectFormProps {
  onSuccess?: (projectId: string) => void;
  onClose: () => void;
}

export const useProjectForm = ({ onSuccess, onClose }: UseProjectFormProps) => {
  const { t } = useLanguage();
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
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
      });

      // Validate response
      if (!projectData || !projectData.id) {
        logger.error('Invalid project creation response:', projectData);
        toast.error(t('toast.project.createFailed'), {
          description: t('toast.project.invalidResponse'),
        });
        return;
      }

      toast.success(t('toast.project.created'), {
        description: `"${projectName}" ${t('toast.project.readyForImages')}`,
      });

      onClose();
      setProjectName('');
      setProjectDescription('');

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
    isCreating,
    handleCreateProject,
  };
};
