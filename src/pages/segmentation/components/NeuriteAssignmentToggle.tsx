import React from 'react';
import { Palette } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/useLanguage';

export interface NeuriteAssignmentToggleProps {
  colorBySoma: boolean;
  onSetColorBySoma: (on: boolean) => void;
  /** Neurites carrying no `somaId`. Shown because it is a MEASUREMENT. */
  unassignedCount: number;
}

/**
 * Switches the canvas between the two colourings a neurite frame can have.
 *
 * OFF (default) is by CLASS — every neurite cyan, every soma magenta — which
 * answers "is this segmentation right". ON is by CELL, which answers "is this
 * assignment right". They cannot share a stroke, so this is a switch rather
 * than an overlay.
 *
 * The unassigned count is not decoration either. A neurite with no soma is a
 * result, not a gap: the pipeline reports an owner for every polygon a skeleton
 * branch reaches, so an absent one means no branch of it was credited to any
 * soma the classifier accepted. Without the number a user would have to hunt
 * for the cyan strokes among the coloured ones to find out how much of the
 * frame the assignment could not resolve.
 */
const NeuriteAssignmentToggle: React.FC<NeuriteAssignmentToggleProps> = ({
  colorBySoma,
  onSetColorBySoma,
  unassignedCount,
}) => {
  const { t } = useLanguage();

  return (
    <div className="border-b border-gray-200 p-3 dark:border-gray-700">
      <div className="flex items-center justify-between gap-3">
        <Label
          htmlFor="neurite-color-by-soma"
          className="flex cursor-pointer items-center gap-2 text-sm font-normal"
        >
          <Palette className="h-4 w-4 shrink-0" />
          {t('segmentation.neurite.colorBySoma')}
        </Label>
        <Switch
          id="neurite-color-by-soma"
          checked={colorBySoma}
          onCheckedChange={onSetColorBySoma}
        />
      </div>
      {colorBySoma && unassignedCount > 0 && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {t('segmentation.neurite.unassignedCount', {
            count: unassignedCount,
          })}
        </p>
      )}
    </div>
  );
};

export default NeuriteAssignmentToggle;
