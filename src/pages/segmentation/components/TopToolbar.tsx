import React from 'react';
import { Button } from '@/components/ui/button';
import { Undo, Redo, Save, RotateCw, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';

interface TopToolbarProps {
  // Current state
  canUndo: boolean;
  canRedo: boolean;
  hasUnsavedChanges: boolean;

  // Actions
  handleUndo: () => void;
  handleRedo: () => void;
  handleSave: () => Promise<void>;

  // Resegment action — rendered to the right of Undo/Redo when
  // provided. While `isResegmenting` is true the button is disabled
  // and shows a spinner; the polyline result re-flows through the
  // parent's `reloadSegmentation` once the batch returns.
  onResegment?: () => void;
  isResegmenting?: boolean;

  // Optional props
  disabled?: boolean;
  isSaving?: boolean;
}

/**
 * Horizontální toolbar s ovládacími prvky (bez mode selection).
 *
 * Three groups, left to right: history (Undo/Redo), the model run
 * (Resegment), and the commit (Save). Resegment is separated by a rule
 * because it is not a history operation — it discards manual work and
 * costs seconds of GPU time, so it should not read as a third arrow next
 * to Undo/Redo.
 */
const TopToolbar: React.FC<TopToolbarProps> = ({
  canUndo,
  canRedo,
  hasUnsavedChanges,
  handleUndo,
  handleRedo,
  handleSave,
  onResegment,
  isResegmenting = false,
  disabled = false,
  isSaving = false,
}) => {
  const { t } = useLanguage();

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
      {/* Left side - History Controls */}
      <div className="flex min-w-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={!canUndo || disabled}
          onClick={handleUndo}
          title={String(t('segmentation.toolbar.undoTooltip'))}
          className="flex items-center gap-2"
        >
          <Undo size={16} />
          <span className="hidden sm:inline">
            {t('segmentation.toolbar.undo')}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canRedo || disabled}
          onClick={handleRedo}
          title={String(t('segmentation.toolbar.redoTooltip'))}
          className="flex items-center gap-2"
        >
          <Redo size={16} />
          <span className="hidden sm:inline">
            {t('segmentation.toolbar.redo')}
          </span>
        </Button>
        {onResegment && (
          <>
            <span
              aria-hidden
              className="mx-1 h-6 w-px shrink-0 bg-gray-200 dark:bg-gray-700"
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled || isResegmenting}
              aria-busy={isResegmenting}
              onClick={onResegment}
              title={String(t('segmentation.toolbar.resegment'))}
              className="flex items-center gap-2 text-blue-700 hover:bg-blue-50 hover:text-blue-800 disabled:opacity-60 dark:text-blue-300 dark:hover:bg-blue-950/50 dark:hover:text-blue-200"
            >
              {isResegmenting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RotateCw size={16} />
              )}
              <span className="hidden truncate sm:inline">
                {t('segmentation.toolbar.resegment')}
              </span>
            </Button>
          </>
        )}
      </div>

      {/* Right side - Save Button. The pending state is spelled out three
          ways — an amber dot, the word, and a spinner on the button — because
          "did my edit register?" is the question this toolbar exists to
          answer. */}
      <div className="flex shrink-0 items-center gap-2">
        {hasUnsavedChanges ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-amber-500"
            />
            <span className="hidden sm:inline">
              {t('segmentation.toolbar.unsavedChanges')}
            </span>
          </span>
        ) : (
          <span className="hidden text-xs text-gray-500 sm:inline dark:text-gray-400">
            {t('segmentation.toolbar.nothingToSave')}
          </span>
        )}
        <Button
          variant={hasUnsavedChanges ? 'default' : 'ghost'}
          size="sm"
          disabled={disabled || isSaving || !hasUnsavedChanges}
          aria-busy={isSaving}
          onClick={handleSave}
          className="flex items-center gap-2"
        >
          {isSaving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          <span>
            {isSaving
              ? t('segmentation.toolbar.saving')
              : t('segmentation.toolbar.save')}
          </span>
        </Button>
      </div>
    </div>
  );
};

export default TopToolbar;
