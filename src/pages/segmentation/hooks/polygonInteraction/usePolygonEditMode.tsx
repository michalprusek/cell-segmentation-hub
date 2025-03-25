
import { SegmentationResult } from '@/lib/segmentation';
import { useEditModeCore } from './editMode/useEditModeCore';

/**
 * Hook for managing polygon edit mode
 */
export const usePolygonEditMode = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null
) => {
  // Use the refactored core edit mode hook
  const editModeCore = useEditModeCore(
    segmentation,
    setSegmentation,
    selectedPolygonId
  );

  return {
    editMode: editModeCore.editMode,
    tempPoints: editModeCore.tempPoints,
    cursorPosition: editModeCore.cursorPosition,
    toggleEditMode: editModeCore.toggleEditMode,
    handleEditModeClick: editModeCore.handleEditModeClick
  };
};
