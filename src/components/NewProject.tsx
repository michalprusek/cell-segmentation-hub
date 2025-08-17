import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { PlusCircle } from 'lucide-react';
import apiClient from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { getErrorMessage } from '@/types';
import { logger } from '@/lib/logger';

interface NewProjectProps {
  onProjectCreated?: (projectId: string) => void;
}

const NewProject = ({ onProjectCreated }: NewProjectProps) => {
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const { t } = useLanguage();

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!projectName.trim()) {
      toast.error(t('projects.projectNameRequired'));
      return;
    }

    if (!user) {
      toast.error(t('projects.mustBeLoggedIn'));
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
        toast.error(t('projects.failedToCreateProject'), {
          description: t('projects.serverResponseInvalid'),
        });
        return;
      }

      toast.success(t('projects.projectCreated'), {
        description: t('projects.projectCreatedDesc', { name: projectName }),
      });

      setOpen(false);
      setProjectName('');
      setProjectDescription('');

      // Notify parent component about creation but don't redirect
      if (onProjectCreated && projectData) {
        onProjectCreated(projectData.id);
      }

      // Also dispatch global event for dashboard refresh
      const event = new CustomEvent('project-created', {
        detail: { projectId: projectData.id },
      });
      window.dispatchEvent(event);
    } catch (error: unknown) {
      logger.error('Error creating project:', error);
      const errorMessage = getErrorMessage(error) || t('projects.failedToCreateProject');
      toast.error(t('projects.failedToCreateProject') + ': ' + errorMessage);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-md">
          <PlusCircle size={18} className="mr-2" />
          {t('common.newProject')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t('projects.createProject')}</DialogTitle>
          <DialogDescription>
            {t('projects.createProjectDesc')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleCreateProject}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="projectName" className="text-right">
                {t('common.projectName')}
              </Label>
              <Input
                id="projectName"
                placeholder={t('projects.projectNamePlaceholder')}
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="projectDescription" className="text-right">
                {t('projects.descriptionOptional')}
              </Label>
              <Input
                id="projectDescription"
                placeholder={t('projects.projectDescPlaceholder')}
                value={projectDescription}
                onChange={e => setProjectDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? t('projects.creatingProject') : t('projects.createProject')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NewProject;
