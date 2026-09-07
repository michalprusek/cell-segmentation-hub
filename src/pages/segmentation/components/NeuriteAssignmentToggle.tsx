import React from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/useLanguage';

/** What a stroke on a neurite frame MEANS. See the component docstring. */
export type NeuriteColorMode = 'class' | 'assignment';

export interface NeuriteAssignmentToggleProps {
  colorMode: NeuriteColorMode;
  onSetColorMode: (mode: NeuriteColorMode) => void;
  /** Neurites carrying no `somaId`. Shown because it is a MEASUREMENT. */
  unassignedCount: number;
  /** Run the pipeline on the CURRENT polygons and store the result. */
  onAssign: () => void;
  isAssigning: boolean;
  /** Nothing to assign — no neurite polygons on this frame. */
  canAssign: boolean;
}

/**
 * Switches the canvas between the two colourings a neurite frame can have.
 *
 * `class` (default) is by CLASS — every neurite cyan, every soma magenta —
 * which answers "is this segmentation right". `assignment` is by CELL, giving a
 * soma and every neurite credited to it one shared colour, which answers "is
 * this assignment right". They cannot share a stroke, so this is a switch
 * rather than an overlay.
 *
 * Two NAMED modes rather than an on/off switch, deliberately: "Colour by cell"
 * ON told the user what they were turning on and never what OFF meant, and the
 * two colourings answer different questions rather than one being the absence
 * of the other. It is the same control the microtubule panel already uses
 * (Instance / Label), so a user meets one pattern in both project types.
 *
 * The unassigned count is not decoration either. A neurite with no soma is a
 * result, not a gap: the pipeline reports an owner for every polygon a skeleton
 * branch reaches, so an absent one means no branch of it was credited to any
 * soma the classifier accepted. Without the number a user would have to hunt
 * for the cyan strokes among the coloured ones to find out how much of the
 * frame the assignment could not resolve.
 */
const NeuriteAssignmentToggle: React.FC<NeuriteAssignmentToggleProps> = ({
  colorMode,
  onSetColorMode,
  unassignedCount,
  onAssign,
  isAssigning,
  canAssign,
}) => {
  const { t } = useLanguage();

  return (
    <div className="border-b border-gray-200 p-3 dark:border-gray-700">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t('segmentation.neurite.color.label')}
        </span>
        <div className="inline-flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-600">
          {(['class', 'assignment'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => onSetColorMode(mode)}
              aria-pressed={colorMode === mode}
              className={`px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                colorMode === mode
                  ? 'bg-violet-600 font-medium text-white'
                  : 'bg-transparent text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {mode === 'class'
                ? t('segmentation.neurite.color.byClass')
                : t('segmentation.neurite.color.byCell')}
            </button>
          ))}
        </div>
      </div>
      {/* Only meaningful in the colouring that DISPLAYS an assignment: in
          `class` every neurite is cyan whether or not it has a soma, so the
          number would name something the user cannot see. */}
      {colorMode === 'assignment' && unassignedCount > 0 && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {t('segmentation.neurite.unassignedCount', {
            count: unassignedCount,
          })}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        className="mt-3 w-full"
        onClick={onAssign}
        disabled={isAssigning || !canAssign}
      >
        {isAssigning ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Wand2 className="mr-2 h-3.5 w-3.5" />
        )}
        {t('segmentation.neurite.assign')}
      </Button>
      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
        {t('segmentation.neurite.assignHint')}
      </p>
    </div>
  );
};

export default NeuriteAssignmentToggle;
