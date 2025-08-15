
import React, { useEffect, ReactNode } from 'react';

interface KeyboardEventHandlerProps {
  children: ReactNode;
  onUndo: () => void;
  onRedo: () => void;
  toggleEditMode: () => void;
  toggleSlicingMode: () => void;
  togglePointAddingMode: () => void;
  exitAllEditModes: () => void;
}

/**
 * Komponenta pro zachycení a zpracování klávesových zkratek
 */
const KeyboardEventHandler = ({
  children,
  onUndo,
  onRedo,
  toggleEditMode,
  toggleSlicingMode,
  togglePointAddingMode,
  exitAllEditModes
}: KeyboardEventHandlerProps) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        exitAllEditModes();
        return;
      }
      
      if (e.key === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        toggleEditMode();
      }
      
      if (e.key === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        toggleSlicingMode();
      }
      
      if (e.key === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        togglePointAddingMode();
      }
      
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onUndo();
      }
      
      if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) ||
          (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
        e.preventDefault();
        onRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleEditMode, toggleSlicingMode, togglePointAddingMode, onUndo, onRedo, exitAllEditModes]);

  return <>{children}</>;
};

export default KeyboardEventHandler;
