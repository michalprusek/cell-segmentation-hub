
import { useCallback } from 'react';

interface EditModeSwitcherProps {
  editModeCore: {
    editMode: boolean;
    toggleEditMode: () => void;
    setEditMode: (value: boolean) => void;
  };
  slicingMode: {
    slicingMode: boolean;
    toggleSlicingMode: () => void;
    setSlicingMode: (value: boolean) => void;
  };
  pointAddingMode: {
    pointAddingMode: boolean;
    togglePointAddingMode: () => void;
    setPointAddingMode: (value: boolean) => void;
  };
  deleteMode: {
    deleteMode: boolean;
    toggleDeleteMode: () => void;
    exitDeleteMode: () => void;
  };
}

/**
 * Hook pro správu přepínání mezi různými editačními režimy
 */
export const useEditModeSwitcher = ({
  editModeCore,
  slicingMode,
  pointAddingMode,
  deleteMode
}: EditModeSwitcherProps) => {
  // Zajištění, že je aktivní vždy jen jeden režim
  const toggleEditMode = useCallback(() => {
    if (editModeCore.editMode) {
      // Pokud je již aktivní, deaktivujeme
      editModeCore.toggleEditMode();
    } else {
      // Jinak deaktivujeme ostatní režimy a aktivujeme tento
      if (slicingMode.slicingMode) slicingMode.setSlicingMode(false);
      if (pointAddingMode.pointAddingMode) pointAddingMode.setPointAddingMode(false);
      if (deleteMode.deleteMode) deleteMode.exitDeleteMode();
      editModeCore.toggleEditMode();
    }
  }, [editModeCore, slicingMode, pointAddingMode, deleteMode]);

  const toggleSlicingMode = useCallback(() => {
    if (slicingMode.slicingMode) {
      // Pokud je již aktivní, deaktivujeme
      slicingMode.toggleSlicingMode();
    } else {
      // Jinak deaktivujeme ostatní režimy a aktivujeme tento
      if (editModeCore.editMode) editModeCore.setEditMode(false);
      if (pointAddingMode.pointAddingMode) pointAddingMode.setPointAddingMode(false);
      if (deleteMode.deleteMode) deleteMode.exitDeleteMode();
      slicingMode.toggleSlicingMode();
    }
  }, [editModeCore, slicingMode, pointAddingMode, deleteMode]);

  const togglePointAddingMode = useCallback(() => {
    if (pointAddingMode.pointAddingMode) {
      // Pokud je již aktivní, deaktivujeme
      pointAddingMode.togglePointAddingMode();
    } else {
      // Jinak deaktivujeme ostatní režimy a aktivujeme tento
      if (editModeCore.editMode) editModeCore.setEditMode(false);
      if (slicingMode.slicingMode) slicingMode.setSlicingMode(false);
      if (deleteMode.deleteMode) deleteMode.exitDeleteMode();
      pointAddingMode.togglePointAddingMode();
    }
  }, [editModeCore, slicingMode, pointAddingMode, deleteMode]);

  const toggleDeleteMode = useCallback(() => {
    if (deleteMode.deleteMode) {
      // Pokud je již aktivní, deaktivujeme
      deleteMode.exitDeleteMode();
    } else {
      // Jinak deaktivujeme ostatní režimy a aktivujeme tento
      if (editModeCore.editMode) editModeCore.setEditMode(false);
      if (slicingMode.slicingMode) slicingMode.setSlicingMode(false);
      if (pointAddingMode.pointAddingMode) pointAddingMode.setPointAddingMode(false);
      deleteMode.toggleDeleteMode();
    }
  }, [editModeCore, slicingMode, pointAddingMode, deleteMode]);

  // Exit all edit modes
  const exitAllEditModes = useCallback(() => {
    if (editModeCore.editMode) editModeCore.setEditMode(false);
    if (slicingMode.slicingMode) slicingMode.setSlicingMode(false);
    if (pointAddingMode.pointAddingMode) pointAddingMode.setPointAddingMode(false);
    if (deleteMode.deleteMode) deleteMode.exitDeleteMode();
  }, [editModeCore, slicingMode, pointAddingMode, deleteMode]);

  return {
    toggleEditMode,
    toggleSlicingMode,
    togglePointAddingMode,
    toggleDeleteMode,
    exitAllEditModes
  };
};
