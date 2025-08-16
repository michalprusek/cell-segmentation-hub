import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  MousePointer,
  Edit3,
  Plus,
  PenTool,
  Scissors,
  Trash2,
  Undo,
  Redo,
  Save,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import { EditMode } from '../types';
import { useLanguage } from '@/contexts/LanguageContext';

interface EnhancedEditorToolbarProps {
  // Current state
  editMode: EditMode;
  selectedPolygonId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  hasUnsavedChanges: boolean;

  // Mode setters
  setEditMode: (mode: EditMode) => void;

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
 * Enhanced editor toolbar with SpheroSeg-inspired mode selection
 */
const EnhancedEditorToolbar: React.FC<EnhancedEditorToolbarProps> = ({
  editMode,
  selectedPolygonId,
  canUndo,
  canRedo,
  hasUnsavedChanges,
  setEditMode,
  handleUndo,
  handleRedo,
  handleSave,
  handleZoomIn,
  handleZoomOut,
  handleResetView,
  disabled = false,
  isSaving = false,
}) => {
  const { t } = useLanguage();

  const getModeIcon = (mode: EditMode) => {
    switch (mode) {
      case EditMode.View:
        return MousePointer;
      case EditMode.EditVertices:
        return Edit3;
      case EditMode.AddPoints:
        return Plus;
      case EditMode.CreatePolygon:
        return PenTool;
      case EditMode.Slice:
        return Scissors;
      case EditMode.DeletePolygon:
        return Trash2;
      default:
        return MousePointer;
    }
  };

  const getModeColor = (mode: EditMode) => {
    switch (mode) {
      case EditMode.View:
        return 'bg-gray-100 text-gray-700 border-gray-300';
      case EditMode.EditVertices:
        return 'bg-purple-100 text-purple-700 border-purple-300';
      case EditMode.AddPoints:
        return 'bg-emerald-100 text-emerald-700 border-emerald-300';
      case EditMode.CreatePolygon:
        return 'bg-blue-100 text-blue-700 border-blue-300';
      case EditMode.Slice:
        return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      case EditMode.DeletePolygon:
        return 'bg-red-100 text-red-700 border-red-300';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-300';
    }
  };

  const getModeLabel = (mode: EditMode) => {
    switch (mode) {
      case EditMode.View:
        return t('segmentation.mode.view');
      case EditMode.EditVertices:
        return t('segmentation.mode.edit');
      case EditMode.AddPoints:
        return t('segmentation.mode.addPoints');
      case EditMode.CreatePolygon:
        return t('segmentation.mode.create');
      case EditMode.Slice:
        return t('segmentation.mode.slice');
      case EditMode.DeletePolygon:
        return t('segmentation.mode.delete');
      default:
        return t('segmentation.mode.unknown');
    }
  };

  const getModeDescription = (mode: EditMode) => {
    switch (mode) {
      case EditMode.View:
        return t('segmentation.modeDescription.view');
      case EditMode.EditVertices:
        return t('segmentation.modeDescription.edit');
      case EditMode.AddPoints:
        return t('segmentation.modeDescription.addPoints');
      case EditMode.CreatePolygon:
        return t('segmentation.modeDescription.create');
      case EditMode.Slice:
        return t('segmentation.modeDescription.slice');
      case EditMode.DeletePolygon:
        return t('segmentation.modeDescription.delete');
      default:
        return '';
    }
  };

  const isRequiredSelectionMode = (mode: EditMode) => {
    return (
      mode === EditMode.EditVertices ||
      mode === EditMode.AddPoints ||
      mode === EditMode.Slice
    );
  };

  const canActivateMode = (mode: EditMode) => {
    if (disabled) return false;
    if (isRequiredSelectionMode(mode) && !selectedPolygonId) return false;
    return true;
  };

  const ModeButton: React.FC<{ mode: EditMode }> = ({ mode }) => {
    const Icon = getModeIcon(mode);
    const isActive = editMode === mode;
    const canActivate = canActivateMode(mode);
    const requiresSelection = isRequiredSelectionMode(mode);

    return (
      <div className="relative group">
        <Button
          variant={isActive ? 'default' : 'outline'}
          size="sm"
          disabled={!canActivate}
          onClick={() => canActivate && setEditMode(mode)}
          className={`flex items-center gap-2 transition-all duration-200 ${
            isActive ? getModeColor(mode) : 'hover:bg-gray-50'
          }`}
          title={getModeDescription(mode)}
        >
          <Icon size={16} />
          <span className="hidden sm:inline">{getModeLabel(mode)}</span>
          {requiresSelection && !selectedPolygonId && (
            <Badge variant="secondary" className="text-xs ml-1">
              {t('segmentation.toolbar.select')}
            </Badge>
          )}
        </Button>

        {/* Tooltip */}
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-black text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
          {getModeDescription(mode)}
          {requiresSelection && !selectedPolygonId && (
            <div className="text-gray-300">
              {t('segmentation.toolbar.requiresPolygonSelection')}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      {/* Mode Selection */}
      <div className="flex items-center gap-1 mr-4">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mr-2">
          {t('segmentation.toolbar.mode')}:
        </span>
        <div className="flex items-center gap-1">
          <ModeButton mode={EditMode.View} />
          <ModeButton mode={EditMode.EditVertices} />
          <ModeButton mode={EditMode.AddPoints} />
          <ModeButton mode={EditMode.CreatePolygon} />
          <ModeButton mode={EditMode.Slice} />
          <ModeButton mode={EditMode.DeletePolygon} />
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />

      {/* History Controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={!canUndo || disabled}
          onClick={handleUndo}
          title={t('segmentation.toolbar.undoTooltip')}
        >
          <Undo size={16} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canRedo || disabled}
          onClick={handleRedo}
          title={t('segmentation.toolbar.redoTooltip')}
        >
          <Redo size={16} />
        </Button>
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />

      {/* View Controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={handleZoomIn}
          title={t('segmentation.toolbar.zoomInTooltip')}
        >
          <ZoomIn size={16} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={handleZoomOut}
          title={t('segmentation.toolbar.zoomOutTooltip')}
        >
          <ZoomOut size={16} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={handleResetView}
          title={t('segmentation.toolbar.resetViewTooltip')}
        >
          <RotateCcw size={16} />
        </Button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Save Button */}
      <div className="flex items-center gap-2">
        {hasUnsavedChanges && (
          <Badge variant="secondary" className="text-xs">
            {t('segmentation.toolbar.unsavedChanges')}
          </Badge>
        )}
        <Button
          variant={hasUnsavedChanges ? 'default' : 'ghost'}
          size="sm"
          disabled={disabled || isSaving}
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

      {/* Keyboard Shortcuts Hint */}
      <div className="hidden lg:block text-xs text-gray-500 dark:text-gray-400 ml-2">
        <div>{t('segmentation.toolbar.keyboardShortcuts')}</div>
      </div>
    </div>
  );
};

export default EnhancedEditorToolbar;
