import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Undo, Redo, Save } from 'lucide-react';
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
  disabled = false,
  isSaving = false,
}) => {
  const { t } = useLanguage();

  return (
    <div className="flex items-center justify-between gap-4 p-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
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
