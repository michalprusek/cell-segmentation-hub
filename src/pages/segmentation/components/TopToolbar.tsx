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

  return (
    <div className="flex items-center justify-between gap-4 p-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      {/* Left side - History Controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={!canUndo || disabled}
          onClick={handleUndo}
          title="Zpět (Ctrl+Z)"
          className="flex items-center gap-2"
        >
          <Undo size={16} />
          <span className="hidden sm:inline">Zpět</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canRedo || disabled}
          onClick={handleRedo}
          title="Znovu (Ctrl+Y)"
          className="flex items-center gap-2"
        >
          <Redo size={16} />
          <span className="hidden sm:inline">Znovu</span>
        </Button>
      </div>

      {/* Center - View Controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={handleZoomIn}
          title="Přiblížit (+)"
          className="flex items-center gap-2"
        >
          <ZoomIn size={16} />
          <span className="hidden md:inline">Přiblížit</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={handleZoomOut}
          title="Oddálit (-)"
          className="flex items-center gap-2"
        >
          <ZoomOut size={16} />
          <span className="hidden md:inline">Oddálit</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={handleResetView}
          title="Resetovat pohled (R)"
          className="flex items-center gap-2"
        >
          <RotateCcw size={16} />
          <span className="hidden md:inline">Reset</span>
        </Button>
      </div>

      {/* Right side - Save Button */}
      <div className="flex items-center gap-2">
        {hasUnsavedChanges && (
          <Badge variant="secondary" className="text-xs">
            Neuložené změny
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
          <span>{isSaving ? 'Ukládání...' : 'Uložit'}</span>
        </Button>
      </div>
    </div>
  );
};

export default TopToolbar;