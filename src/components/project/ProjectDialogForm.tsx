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
import { cn } from '@/lib/utils';

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
    projectTypeError,
    projectTypeRef,
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
            {/* Nothing is preselected: the type decides the model, the editor
                and the export, so it must be a choice the user made. `''`
                (never `undefined`) is what keeps Radix CONTROLLED while it
                shows the placeholder — `undefined` would switch it to
                uncontrolled and the reset after a create would not clear it.
                No native `required`: Radix would put it on a hidden <select>
                and the browser's bubble would point at nothing visible. */}
            <Select
              value={projectType ?? ''}
              onValueChange={(v: ProjectType) => setProjectType(v)}
            >
              <SelectTrigger
                id="projectType"
                ref={projectTypeRef}
                aria-required="true"
                aria-invalid={projectTypeError || undefined}
                aria-describedby={
                  projectTypeError ? 'projectType-error' : undefined
                }
                className={cn(
                  'data-[placeholder]:text-muted-foreground',
                  projectTypeError &&
                    'border-destructive focus:border-destructive focus:ring-destructive'
                )}
              >
                <SelectValue placeholder={t('projects.selectProjectType')} />
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
            {projectTypeError && (
              <p
                id="projectType-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {t('errors.validationErrors.projectTypeRequired')}
              </p>
            )}
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
