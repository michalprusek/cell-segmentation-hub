import React from 'react';
import { Cpu, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import SpecimenHoverCard from '@/components/specimens/SpecimenHoverCard';
import { useLanguage } from '@/contexts/useLanguage';
import { useProjectModel } from '@/hooks/useProjectModel';
import type { ModelType } from '@/lib/models/modelRegistry';
import type { ProjectType } from '@/types';
import { cn } from '@/lib/utils';

interface ProjectModelSelectorProps {
  projectType: ProjectType | undefined;
  /** The project's RAW stored model (`null` = never chosen). */
  storedModel: string | null | undefined;
  /** Persist a new choice. Omitted when the viewer may not change it (a
   *  shared project is read-only for the annotator), which renders the pill
   *  as a static label — same convention as the project-type pill beside it. */
  onModelChange?: (model: ModelType) => void | Promise<void>;
  /** Whether mask holes become polygon holes. Global per user, not per
   *  project — see the comment on the checkbox below. */
  detectHoles: boolean;
  onDetectHolesChange: (detectHoles: boolean) => void;
}

/**
 * The project's segmentation model, shown next to its type because the two
 * are one decision: the type decides which models may run at all, and six of
 * the seven types leave exactly one candidate.
 *
 * A DropdownMenu rather than the `Select` the type pill uses, for one reason:
 * `detectHoles` has to live somewhere. It is a real ML parameter — it reaches
 * `model_loader.py` as `detect_holes` and decides whether an internal hole
 * becomes a hole polygon or is filled in — and its only control used to be the
 * Settings → Models section this change deletes. A `Select` cannot hold a
 * checkbox; a menu can hold both, and they belong together as "how this
 * project segments".
 */
const ProjectModelSelector = ({
  projectType,
  storedModel,
  onModelChange,
  detectHoles,
  onDetectHolesChange,
}: ProjectModelSelectorProps) => {
  const { t } = useLanguage();
  const { model, modelInfo, compatibleModels, isLocked } = useProjectModel(
    projectType,
    storedModel
  );

  // Nothing to show until the project type is known — rendering a picker for a
  // guessed type would offer the wrong five models, and the user can click
  // during that window.
  if (!projectType || !model || !modelInfo) {
    return null;
  }

  const label = (
    <>
      <Cpu className="mr-1.5 h-3.5 w-3.5 flex-shrink-0" />
      <span className="truncate">{modelInfo.name}</span>
    </>
  );

  // Read-only viewer: same pill shape, no chevron, no menu. Matches how the
  // type pill degrades for an annotator on a shared project.
  if (!onModelChange) {
    return (
      <div
        className="flex h-9 min-w-0 max-w-[14rem] items-center rounded-md border border-gray-300 bg-gray-50 px-3 text-xs font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 sm:h-8"
        title={modelInfo.description}
        data-testid="project-model-readonly"
      >
        {label}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={String(t('project.changeSegmentationModel'))}
          data-testid="project-model-trigger"
          className={cn(
            // Deliberately neutral, where the type pill next to it is colour-
            // coded: the type carries the project's identity, and two coloured
            // pills side by side would compete for it.
            'h-9 w-auto min-w-[9rem] max-w-[14rem] justify-start rounded-md border px-3 text-xs font-medium sm:h-8'
          )}
        >
          {label}
          <ChevronDown className="ml-auto h-3.5 w-3.5 flex-shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-gray-500 dark:text-gray-400">
          {isLocked
            ? t('project.modelOnlyOptionForType')
            : t('project.modelChoiceForType')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={model}
          // Radix's MenuRadioItem calls `onValueChange` UNCONDITIONALLY on
          // select — unlike `Select`, it has no equality guard (see
          // `@radix-ui/react-menu` MenuRadioItem.handleSelect). Without this
          // check, clicking the already-checked row writes the RESOLVED
          // default into a column that was NULL, which is exactly the backfill
          // the migration refuses to do: the row stops tracking the registry
          // and freezes on today's answer. It would also toast "model
          // updated" for a no-op.
          onValueChange={v => {
            if (v === model) return;
            void onModelChange(v as ModelType);
          }}
        >
          {compatibleModels.map(m => (
            <SpecimenHoverCard
              key={m.id}
              kind="model"
              value={m.id}
              side="left"
              align="start"
            >
              {/* `disabled` only when it is the sole option: the click would
                  be a no-op PUT, but the row must stay visible so the user can
                  see WHICH model their project runs. */}
              <DropdownMenuRadioItem
                value={m.id}
                disabled={isLocked}
                className="text-xs"
                data-testid={`project-model-option-${m.id}`}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">
                    {m.description}
                  </span>
                </div>
              </DropdownMenuRadioItem>
            </SpecimenHoverCard>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {/* `onSelect={e => e.preventDefault()}` keeps the menu open: this is a
            toggle the user may want to flip while reading the model list, and
            Radix closes the menu on select by default. */}
        <DropdownMenuCheckboxItem
          checked={detectHoles}
          onCheckedChange={onDetectHolesChange}
          onSelect={e => e.preventDefault()}
          className="text-xs"
          data-testid="project-model-detect-holes"
        >
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{t('settings.detectHoles')}</span>
            <span className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">
              {t('settings.detectHolesDescription')}
            </span>
          </div>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ProjectModelSelector;
