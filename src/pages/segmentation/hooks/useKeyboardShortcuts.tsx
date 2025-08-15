import { useEffect, useCallback, useRef } from 'react';
import { EditMode } from '../types';

interface UseKeyboardShortcutsProps {
  // Current state
  editMode: EditMode;
  canUndo: boolean;
  canRedo: boolean;
  selectedPolygonId: string | null;
  
  // Actions
  setEditMode: (mode: EditMode) => void;
  handleUndo: () => void;
  handleRedo: () => void;
  handleSave: () => Promise<void>;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleResetView: () => void;
  handleDeletePolygon?: () => void;
  
  // Optional callbacks
  onEscape?: () => void;
  onKeyDown?: (key: string, event: KeyboardEvent) => void;
}

/**
 * Comprehensive keyboard shortcuts for polygon editing
 * Inspired by SpheroSeg and professional CAD tools
 */
export const useKeyboardShortcuts = ({
  editMode,
  canUndo,
  canRedo,
  selectedPolygonId,
  setEditMode,
  handleUndo,
  handleRedo,
  handleSave,
  handleZoomIn,
  handleZoomOut,
  handleResetView,
  handleDeletePolygon,
  onEscape,
  onKeyDown
}: UseKeyboardShortcutsProps) => {

  const isShiftPressed = useRef(false);
  const isCtrlPressed = useRef(false);
  const isAltPressed = useRef(false);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Update modifier key states
    isShiftPressed.current = event.shiftKey;
    isCtrlPressed.current = event.ctrlKey || event.metaKey;
    isAltPressed.current = event.altKey;

    // Don't process shortcuts when typing in inputs
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    const key = event.key.toLowerCase();
    
    // Call optional callback
    if (onKeyDown) {
      onKeyDown(key, event);
    }

    // Handle shortcuts
    switch (key) {
      // Mode switching shortcuts
      case 'v':
        if (!isCtrlPressed.current) {
          event.preventDefault();
          setEditMode(EditMode.View);
        }
        break;

      case 'e':
        if (!isCtrlPressed.current && selectedPolygonId) {
          event.preventDefault();
          setEditMode(EditMode.EditVertices);
        }
        break;

      case 'a':
        if (!isCtrlPressed.current && selectedPolygonId) {
          event.preventDefault();
          setEditMode(EditMode.AddPoints);
        }
        break;

      case 'n':
        if (!isCtrlPressed.current) {
          event.preventDefault();
          setEditMode(EditMode.CreatePolygon);
        }
        break;

      case 's':
        if (isCtrlPressed.current) {
          // Ctrl+S: Save
          event.preventDefault();
          handleSave();
        } else if (selectedPolygonId) {
          // S: Slice mode
          event.preventDefault();
          setEditMode(EditMode.Slice);
        }
        break;

      case 'd':
        if (!isCtrlPressed.current) {
          event.preventDefault();
          setEditMode(EditMode.DeletePolygon);
        }
        break;

      // History shortcuts
      case 'z':
        if (isCtrlPressed.current && !isShiftPressed.current && canUndo) {
          event.preventDefault();
          handleUndo();
        } else if (isCtrlPressed.current && isShiftPressed.current && canRedo) {
          // Ctrl+Shift+Z: Redo (alternative)
          event.preventDefault();
          handleRedo();
        }
        break;

      case 'y':
        if (isCtrlPressed.current && canRedo) {
          event.preventDefault();
          handleRedo();
        }
        break;

      // View shortcuts
      case '+':
      case '=':
        event.preventDefault();
        handleZoomIn();
        break;

      case '-':
      case '_':
        event.preventDefault();
        handleZoomOut();
        break;

      case 'r':
        if (!isCtrlPressed.current) {
          event.preventDefault();
          handleResetView();
        }
        break;

      case '0':
        if (!isCtrlPressed.current) {
          event.preventDefault();
          handleResetView();
        }
        break;

      // Delete shortcuts
      case 'delete':
      case 'backspace':
        if (selectedPolygonId && handleDeletePolygon && 
            (editMode === EditMode.View || editMode === EditMode.EditVertices)) {
          event.preventDefault();
          handleDeletePolygon();
        }
        break;

      // Cancel/Escape
      case 'escape':
        event.preventDefault();
        if (onEscape) {
          onEscape();
        } else {
          // Default escape behavior - return to view mode
          setEditMode(EditMode.View);
        }
        break;

      // Quick mode cycling
      case 'tab':
        if (!isCtrlPressed.current) {
          event.preventDefault();
          cycleEditMode(editMode, setEditMode, selectedPolygonId, isShiftPressed.current);
        }
        break;

      // Help shortcut
      case 'h':
      case '?':
        if (!isCtrlPressed.current) {
          event.preventDefault();
          showKeyboardHelp();
        }
        break;
    }
  }, [
    editMode,
    selectedPolygonId,
    canUndo,
    canRedo,
    setEditMode,
    handleUndo,
    handleRedo,
    handleSave,
    handleZoomIn,
    handleZoomOut,
    handleResetView,
    handleDeletePolygon,
    onEscape,
    onKeyDown
  ]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    // Update modifier key states
    isShiftPressed.current = event.shiftKey;
    isCtrlPressed.current = event.ctrlKey || event.metaKey;
    isAltPressed.current = event.altKey;
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  return {
    isShiftPressed: isShiftPressed.current,
    isCtrlPressed: isCtrlPressed.current,
    isAltPressed: isAltPressed.current
  };
};

/**
 * Cycle through edit modes with Tab/Shift+Tab
 */
function cycleEditMode(
  currentMode: EditMode, 
  setEditMode: (mode: EditMode) => void, 
  selectedPolygonId: string | null,
  reverse: boolean = false
) {
  const allModes = [
    EditMode.View,
    EditMode.CreatePolygon,
    EditMode.DeletePolygon
  ];

  // Add selection-dependent modes if polygon is selected
  if (selectedPolygonId) {
    allModes.splice(1, 0, EditMode.EditVertices, EditMode.AddPoints, EditMode.Slice);
  }

  const currentIndex = allModes.indexOf(currentMode);
  let nextIndex;

  if (reverse) {
    nextIndex = currentIndex <= 0 ? allModes.length - 1 : currentIndex - 1;
  } else {
    nextIndex = currentIndex >= allModes.length - 1 ? 0 : currentIndex + 1;
  }

  setEditMode(allModes[nextIndex]);
}

/**
 * Show keyboard shortcuts help
 */
function showKeyboardHelp() {
  // This could show a modal or tooltip with all shortcuts
  console.log('Keyboard Shortcuts:', {
    'V': 'View mode',
    'E': 'Edit vertices (requires selection)',
    'A': 'Add points (requires selection)',
    'N': 'Create new polygon',
    'S': 'Slice mode (requires selection)',
    'D': 'Delete polygon mode',
    'Ctrl+S': 'Save',
    'Ctrl+Z': 'Undo',
    'Ctrl+Y': 'Redo',
    '+/-': 'Zoom in/out',
    'R': 'Reset view',
    'Delete': 'Delete selected polygon',
    'Escape': 'Cancel/View mode',
    'Tab': 'Cycle modes',
    'Shift+Tab': 'Cycle modes (reverse)',
    'H/?': 'Show this help'
  });
}

/**
 * Get keyboard shortcut description for a given mode
 */
export const getShortcutForMode = (mode: EditMode): string => {
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