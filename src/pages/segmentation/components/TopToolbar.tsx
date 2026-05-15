import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

  // Resegment action — optional; rendered to the right of Undo/Redo
  // when provided. Parent decides whether to open a channel picker
  // first (for multi-channel video frames) before invoking.
  onResegment?: () => void;
  isResegmenting?: boolean;

  // Optional props
  disabled?: boolean;
  isSaving?: boolean;
}

/**
 * Horizontální toolbar s ovládacími prvky (bez mode selection)
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
    <div className="flex items-center justify-between gap-4 p-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 dark:bg-gray-900">
      {/* Left side - History Controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={!canUndo || disabled}
          onClick={handleUndo}
          title={t('segmentation.toolbar.undoTooltip')}
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
          title={t('segmentation.toolbar.redoTooltip')}
          className="flex items-center gap-2"
        >
          <Redo size={16} />
          <span className="hidden sm:inline">
            {t('segmentation.toolbar.redo')}
          </span>
        </Button>
        {onResegment && (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || isResegmenting}
            onClick={onResegment}
            title={t('segmentation.toolbar.resegment')}
            className="flex items-center gap-2"
          >
            {isResegmenting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RotateCw size={16} />
            )}
            <span className="hidden sm:inline">
              {t('segmentation.toolbar.resegment')}
            </span>
          </Button>
        )}
      </div>

      {/* Right side - Save Button */}
      <div className="flex items-center gap-2">
        {!hasUnsavedChanges && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t('segmentation.toolbar.nothingToSave')}
          </span>
        )}
        {hasUnsavedChanges && (
          <Badge variant="secondary" className="text-xs">
            {t('segmentation.toolbar.unsavedChanges')}
          </Badge>
        )}
        <Button
          variant={hasUnsavedChanges ? 'default' : 'ghost'}
          size="sm"
          disabled={disabled || isSaving || !hasUnsavedChanges}
          onClick={handleSave}
          className="flex items-center gap-2"
        >
          <Save size={16} />
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
