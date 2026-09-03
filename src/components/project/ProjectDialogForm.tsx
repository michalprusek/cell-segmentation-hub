import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import SpecimenHoverCard from '@/components/specimens/SpecimenHoverCard';
import { useProjectForm } from '@/hooks/useProjectForm';
import { useLanguage } from '@/contexts/useLanguage';
import { PROJECT_TYPES, type ProjectType } from '@/types';

interface ProjectDialogFormProps {
  onSuccess?: (projectId: string) => void;
  onClose: () => void;
  /** Folder the dashboard is showing, so the project is created there rather
   *  than at the root. See `useProjectForm`. */
  folderId?: string | null;
}

const ProjectDialogForm = ({
  onSuccess,
  onClose,
  folderId,
}: ProjectDialogFormProps) => {
  const { t } = useLanguage();
  const {
    projectName,
    setProjectName,
    projectDescription,
    setProjectDescription,
    projectType,
    setProjectType,
    isCreating,
    handleCreateProject,
  } = useProjectForm({ onSuccess, onClose, folderId });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('projects.createProject')}</DialogTitle>
        <DialogDescription>{t('projects.createProjectDesc')}</DialogDescription>
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
          <div className="space-y-2">
            <Label htmlFor="projectType" className="text-right">
              {t('projects.projectType')}
            </Label>
            <Select
              value={projectType}
              onValueChange={(v: ProjectType) => setProjectType(v)}
            >
              <SelectTrigger id="projectType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Each option previews real frames of that project type on
                    hover — the type names alone ("spheroid", "microtubules")
                    do not tell a new user which one matches their images. */}
                {PROJECT_TYPES.map(pt => (
                  <SpecimenHoverCard
                    key={pt}
                    kind="projectType"
                    value={pt}
                    side="right"
                    align="start"
                  >
                    <SelectItem value={pt}>
                      {t(`projects.types.${pt}`)}
                    </SelectItem>
                  </SpecimenHoverCard>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={isCreating}>
            {isCreating
              ? t('projects.creatingProject')
              : t('projects.createProject')}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
};

export default ProjectDialogForm;
