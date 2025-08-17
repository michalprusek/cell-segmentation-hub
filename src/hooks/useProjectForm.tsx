import { useState } from 'react';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { getErrorMessage } from '@/types';
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
      toast.error(t('errors.validation.projectNameRequired'));
      return;
    }

    if (!user) {
      toast.error(t('errors.validation.loginRequired'));
      return;
    }

    setIsCreating(true);

    try {
      const projectData = await apiClient.createProject({
        name: projectName,
        description: projectDescription || 'No description provided',
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
      const errorMessage = getErrorMessage(error) || 'Failed to create project';
      toast.error('Failed to create project: ' + errorMessage);
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
