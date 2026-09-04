import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, CheckCircle2, Pencil } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
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
  microtubules:
    'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200 border-cyan-300 dark:border-cyan-700',
  microcapsule:
    'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200 border-rose-300 dark:border-rose-700',
  neurite:
    'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200 border-indigo-300 dark:border-indigo-700',
};

interface ProjectHeaderProps {
  projectTitle: string;
  /** Rename the project. Omitted when the viewer may not rename it (a shared
   *  project is read-only for the annotator), which also hides the control. */
  onTitleChange?: (title: string) => void | Promise<void>;
  imagesCount: number;
  loading: boolean;
  projectType?: ProjectType;
  onTypeChange?: (type: ProjectType) => void;
  // "All annotations in the project have been reviewed and passed." Owner OR
  // an accepted-share annotator may toggle it — the handler is passed
  // unconditionally by ProjectDetail (same shape as onTypeChange); the
  // backend is the actual authorization boundary.
  verified?: boolean;
  onVerifiedChange?: (verified: boolean) => void;
}

const ProjectHeader = ({
  projectTitle,
  onTitleChange,
  imagesCount,
  loading,
  projectType,
  onTypeChange,
  verified,
  onVerifiedChange,
}: ProjectHeaderProps) => {
  // Inline rename, following the same gesture the microtubule panel uses:
  // Enter or blur commits, Escape cancels.
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(projectTitle);

  // No effect syncs the draft to `projectTitle`: `startRename` is the only way
  // into the editor and it seeds the draft itself, so an effect would be dead
  // code. That also means a refetch landing mid-edit cannot wipe what the user
  // has typed.
  const startRename = () => {
    setTitleDraft(projectTitle);
    setRenaming(true);
  };

  const commitRename = () => {
    setRenaming(false);
    const next = titleDraft.trim();
    // An empty name is not a rename, and neither is renaming to what it
    // already is — both would be a pointless PUT and a misleading toast.
    if (!next || next === projectTitle) {
      setTitleDraft(projectTitle);
      return;
    }
    void onTitleChange?.(next);
  };

  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <>
      <DashboardHeader />
      <div className="bg-white dark:bg-gray-800 shadow-sm border-b dark:border-gray-700 dark:bg-gray-900">
        <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4">
          {/* The type picker and the Verified toggle used to be `hidden
              sm:flex`, which removed the only way to change either one below
              640px. They now wrap onto a second line instead of disappearing:
              the title row keeps `basis-full` up to `sm`, so the controls fall
              underneath rather than crushing the heading. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-4">
            <Button
              variant="ghost"
              size="sm"
              className="min-w-[44px] h-10 sm:h-9"
              onClick={() => navigate('/dashboard')}
            >
              <ArrowLeft className="mr-1 sm:mr-2 h-4 w-4" />
              <span className="hidden sm:inline">{t('common.back')}</span>
            </Button>
            {/* `min-w-[10rem]` is what makes the wrap above actually happen:
                a `truncate` heading has zero min-content width, so without a
                floor it would shrink to nothing and the controls would stay
                crushed on line one instead of moving to line two. */}
            <div className="min-w-[10rem] flex-1">
              {renaming ? (
                <input
                  autoFocus
                  type="text"
                  value={titleDraft}
                  maxLength={255}
                  aria-label={t('projects.renameProject') as string}
                  data-testid="project-title-input"
                  onChange={e => setTitleDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setRenaming(false);
                    }
                  }}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-0.5 text-lg font-semibold dark:border-gray-600 dark:bg-gray-800 dark:text-white sm:text-xl"
                />
              ) : (
                <div className="flex items-center gap-1.5">
                  <h1
                    className="truncate text-lg font-semibold dark:text-white sm:text-xl"
                    // Double-click is the discoverable-by-habit gesture; the
                    // pencil is the discoverable-by-sight one. Both, because
                    // neither alone is obvious to every user.
                    onDoubleClick={onTitleChange ? startRename : undefined}
                    title={
                      onTitleChange
                        ? (t('projects.renameProject') as string)
                        : undefined
                    }
                  >
                    {projectTitle}
                  </h1>
                  {onTitleChange && (
                    <button
                      type="button"
                      onClick={startRename}
                      aria-label={t('projects.renameProject') as string}
                      data-testid="project-title-edit"
                      className="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                {loading
                  ? t('common.loading')
                  : `${imagesCount} ${t('common.images').toLowerCase()}`}
              </p>
            </div>
            {projectType && (
              <div className="flex min-w-0 items-center gap-2">
                <span className="hidden text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap sm:inline">
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
                        // `min-w-[200px]` could not shrink, so at 640-760px it
                        // forced the whole header row past the viewport right
                        // where it first became visible. A flexible width with
                        // a floor keeps the pill readable and lets the row fit.
                        'h-9 w-auto min-w-[9rem] max-w-[14rem] rounded-md border pl-3 pr-2 text-xs font-medium sm:h-8',
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
            {(onVerifiedChange || verified) && (
              <div className="flex shrink-0 items-center gap-2">
                {onVerifiedChange ? (
                  // Editable: owner OR an accepted-share annotator may toggle
                  // this — the backend, not this component, is the
                  // authorization boundary (see ProjectService.setVerified).
                  <label
                    className={cn(
                      'flex h-9 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-xs font-medium transition-colors sm:h-8',
                      verified
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 border-green-300 dark:border-green-700'
                        : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                    )}
                  >
                    <Checkbox
                      checked={!!verified}
                      onCheckedChange={checked =>
                        onVerifiedChange(checked === true)
                      }
                      aria-label={String(t('projects.toggleVerified'))}
                    />
                    {t('projects.verified')}
                  </label>
                ) : (
                  // Read-only: only rendered when true (same convention as
                  // the "shared" badge elsewhere — nothing to show for false).
                  <Badge
                    variant="outline"
                    className="h-8 px-3 text-xs font-medium border bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 border-green-300 dark:border-green-700"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    {t('projects.verified')}
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
