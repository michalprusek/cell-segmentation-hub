import React, { useState, useEffect } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { EditMode } from '../../types';

interface CanvasContainerProps {
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: (e: React.MouseEvent) => void;
  onWheel?: (e: React.WheelEvent) => void;
  children: React.ReactNode;
  loading: boolean;
  editMode: EditMode;
  // Legacy props for backward compatibility - will be removed
  slicingMode?: boolean;
  pointAddingMode?: boolean;
  deleteMode?: boolean;
}

/**
 * Kontejner pro plátno
 */
const CanvasContainer = React.forwardRef<HTMLDivElement, CanvasContainerProps>(
  (
    {
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onWheel,
      children,
      loading,
      editMode,
      // Legacy props for backward compatibility
      slicingMode = false,
      pointAddingMode = false,
      deleteMode = false,
    },
    ref
  ) => {
    const { theme } = useTheme();
    const [isAltPressed, setIsAltPressed] = useState(false);

    // Listen for Alt key press/release
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.altKey && !isAltPressed) {
          setIsAltPressed(true);
        }
      };

      const handleKeyUp = (e: KeyboardEvent) => {
        if (!e.altKey && isAltPressed) {
          setIsAltPressed(false);
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);

      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
      };
    }, [isAltPressed]);

    // Theme-aware dot colors for grid
    const dotColor = theme === 'dark' ? '#6b7280' : '#9ca3af'; // gray-500 for dark, gray-400 for light

    // Get border color based on active mode
    const getBorderColor = () => {
      switch (editMode) {
        case EditMode.EditVertices:
          return 'border-purple-500'; // Purple for edit vertices mode
        case EditMode.Slice:
          return 'border-red-500'; // Red for slicing mode
        case EditMode.AddPoints:
          return 'border-emerald-500'; // Green for add points mode
        case EditMode.CreatePolygon:
          return 'border-blue-500'; // Blue for create polygon mode
        case EditMode.DeletePolygon:
          return 'border-orange-500'; // Orange for delete mode
        case EditMode.View:
        default:
          return 'border-gray-200 dark:border-gray-700'; // Default border
      }
    };

    // Get cursor style based on mode and Alt key
    const getCursorStyle = () => {
      // If Alt is pressed, always show grab cursor for panning
      if (isAltPressed) {
        return 'grab';
      }

      switch (editMode) {
        case EditMode.View:
          return 'grab';
        case EditMode.EditVertices:
          return 'crosshair';
        case EditMode.AddPoints:
          return 'cell';
        case EditMode.CreatePolygon:
          return 'crosshair';
        case EditMode.Slice:
          return 'crosshair';
        case EditMode.DeletePolygon:
          return 'pointer';
        default:
          return 'default';
      }
    };

    return (
      <div
        ref={ref}
        className={`flex-1 overflow-hidden relative bg-gray-50 dark:bg-gray-800 min-h-[400px] h-full rounded-lg border-4 transition-all duration-200 select-none ${getBorderColor()}`}
        style={{
          cursor: getCursorStyle(),
          backgroundImage: `radial-gradient(circle, ${dotColor} 1px, transparent 1px)`,
          backgroundSize: '20px 20px',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        data-testid="canvas-container"
        data-edit-mode={editMode}
      >
        {children}
      </div>
    );
  }
);

CanvasContainer.displayName = 'CanvasContainer';

export default CanvasContainer;
