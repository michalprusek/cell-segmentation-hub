import React from 'react';
import { Button } from '@/components/ui/button';
import {
  MousePointer,
  Edit3,
  Plus,
  PenTool,
  Scissors,
  Trash2,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { EditMode } from '../types';

interface VerticalToolbarProps {
  editMode: EditMode;
  selectedPolygonId: string | null;
  setEditMode: (mode: EditMode) => void;
  disabled?: boolean;
}

/**
 * Vertikální toolbar s ikonkami pro jednotlivé edit modes
 */
const VerticalToolbar: React.FC<VerticalToolbarProps> = ({
  editMode,
  selectedPolygonId,
  setEditMode,
  disabled = false,
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
        return 'hover:bg-gray-100 dark:hover:bg-gray-700';
      case EditMode.EditVertices:
        return 'hover:bg-purple-100 dark:hover:bg-purple-900/30';
      case EditMode.AddPoints:
        return 'hover:bg-emerald-100 dark:hover:bg-emerald-900/30';
      case EditMode.CreatePolygon:
        return 'hover:bg-blue-100 dark:hover:bg-blue-900/30';
      case EditMode.Slice:
        return 'hover:bg-yellow-100 dark:hover:bg-yellow-900/30';
      case EditMode.DeletePolygon:
        return 'hover:bg-red-100 dark:hover:bg-red-900/30';
      default:
        return 'hover:bg-gray-100 dark:hover:bg-gray-700';
    }
  };

  const getActiveColor = (mode: EditMode) => {
    switch (mode) {
      case EditMode.View:
        return 'bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200';
      case EditMode.EditVertices:
        return 'bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200';
      case EditMode.AddPoints:
        return 'bg-emerald-200 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-200';
      case EditMode.CreatePolygon:
        return 'bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200';
      case EditMode.Slice:
        return 'bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200';
      case EditMode.DeletePolygon:
        return 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200';
      default:
        return 'bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200';
    }
  };

  const getModeLabel = (mode: EditMode) => {
    switch (mode) {
      case EditMode.View:
        return t('segmentation.mode.view');
      case EditMode.EditVertices:
        return t('segmentation.mode.editVertices');
      case EditMode.AddPoints:
        return t('segmentation.mode.addPoints');
      case EditMode.CreatePolygon:
        return t('segmentation.mode.createPolygon');
      case EditMode.Slice:
        return t('segmentation.mode.slice');
      case EditMode.DeletePolygon:
        return t('segmentation.mode.deletePolygon');
      default:
        return '';
    }
  };

  const getKeyboardShortcut = (mode: EditMode) => {
    switch (mode) {
      case EditMode.View:
        return 'V';
      case EditMode.EditVertices:
        return 'E';
      case EditMode.AddPoints:
        return 'A';
      case EditMode.CreatePolygon:
        return 'N';
      case EditMode.Slice:
        return 'S';
      case EditMode.DeletePolygon:
        return 'D';
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
          variant="ghost"
          size="icon"
          disabled={!canActivate}
          onClick={() => canActivate && setEditMode(mode)}
          className={`
            w-12 h-12 rounded-lg transition-all duration-200 relative
            ${isActive ? getActiveColor(mode) : getModeColor(mode)}
            ${!canActivate ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          <Icon size={20} />
          {requiresSelection && !selectedPolygonId && (
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full animate-pulse" />
          )}
        </Button>

        {/* Tooltip */}
        <div className="absolute left-full ml-2 top-1/2 transform -translate-y-1/2 px-3 py-2 bg-black text-white text-sm rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
          <div className="font-medium">{getModeLabel(mode)}</div>
          <div className="text-xs text-gray-300 mt-1">
            {t('segmentation.toolbar.keyboard', {
              key: getKeyboardShortcut(mode),
            })}
          </div>
          {requiresSelection && !selectedPolygonId && (
            <div className="text-xs text-orange-300 mt-1">
              {t('segmentation.toolbar.requiresSelection')}
            </div>
          )}

          {/* Arrow */}
          <div className="absolute right-full top-1/2 transform -translate-y-1/2 border-4 border-transparent border-r-black" />
        </div>
      </div>
    );
  };

  return (
    <div className="w-14 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col items-center py-4 gap-2">
      <ModeButton mode={EditMode.View} />
      <ModeButton mode={EditMode.EditVertices} />
      <ModeButton mode={EditMode.AddPoints} />
      <ModeButton mode={EditMode.CreatePolygon} />
      <ModeButton mode={EditMode.Slice} />
      <ModeButton mode={EditMode.DeletePolygon} />
    </div>
  );
};

export default VerticalToolbar;
