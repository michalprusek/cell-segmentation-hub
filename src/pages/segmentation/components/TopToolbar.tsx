import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Undo,
  Redo,
  Save,
  ZoomIn,
  ZoomOut,
  RotateCcw
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface TopToolbarProps {
  // Current state
  canUndo: boolean;
  canRedo: boolean;
  hasUnsavedChanges: boolean;
  
  // Actions
  handleUndo: () => void;
  handleRedo: () => void;
  handleSave: () => Promise<void>;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleResetView: () => void;
  
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
  handleZoomIn,
  handleZoomOut,
  handleResetView,
  disabled = false,
  isSaving = false
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
          <span className="hidden sm:inline">{t('segmentation.toolbar.undo')}</span>
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
          <span className="hidden sm:inline">{t('segmentation.toolbar.redo')}</span>
        </Button>
      </div>

      {/* Center - View Controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={handleZoomIn}
          title={t('segmentation.toolbar.zoomInTooltip')}
          className="flex items-center gap-2"
        >
          <ZoomIn size={16} />
          <span className="hidden md:inline">{t('segmentation.toolbar.zoomIn')}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={handleZoomOut}
          title={t('segmentation.toolbar.zoomOutTooltip')}
          className="flex items-center gap-2"
        >
          <ZoomOut size={16} />
          <span className="hidden md:inline">{t('segmentation.toolbar.zoomOut')}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={handleResetView}
          title={t('segmentation.toolbar.resetViewTooltip')}
          className="flex items-center gap-2"
        >
          <RotateCcw size={16} />
          <span className="hidden md:inline">{t('segmentation.toolbar.resetView')}</span>
        </Button>
      </div>

      {/* Right side - Save Button */}
      <div className="flex items-center gap-2">
        {hasUnsavedChanges && (
          <Badge variant="secondary" className="text-xs">
            {t('segmentation.toolbar.unsavedChanges')}
          </Badge>
        )}
        <Button
          variant={hasUnsavedChanges ? "default" : "ghost"}
          size="sm"
          disabled={disabled || isSaving}
          onClick={handleSave}
          className="flex items-center gap-2"
        >
          <Save size={16} />
          <span>{isSaving ? t('segmentation.toolbar.saving') : t('segmentation.toolbar.save')}</span>
        </Button>
      </div>
    </div>
  );
};

export default TopToolbar;