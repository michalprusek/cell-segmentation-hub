
import { SegmentationResult } from '@/lib/segmentation';
import { useEditModeCore } from './editMode/useEditModeCore';
import { useSlicingMode } from './editMode/useSlicingMode';
import { usePointAddingMode } from './editMode/usePointAddingMode';

/**
 * Hook for managing polygon edit modes (adding/modifying vertices, slicing)
 */
export const usePolygonEditMode = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null
) => {
  // Základní režim editace (přidávání vrcholů do nového polygonu)
  const editModeCore = useEditModeCore(
    segmentation,
    setSegmentation,
    selectedPolygonId
  );
  
  // Režim rozdělování polygonů (slicing)
  const slicingMode = useSlicingMode(
    segmentation,
    setSegmentation,
    selectedPolygonId
  );
  
  // Režim přidávání bodů do existujícího polygonu
  const pointAddingMode = usePointAddingMode(
    segmentation,
    setSegmentation, 
    selectedPolygonId
  );

  // Kombinované handlery pro kliknutí v různých režimech editace
  const handleEditModeClick = (x: number, y: number) => {
    if (slicingMode.slicingMode) {
      return slicingMode.handleSlicingClick(x, y);
    } else if (pointAddingMode.pointAddingMode) {
      return pointAddingMode.handlePointAddingClick(x, y);
    } else if (editModeCore.editMode) {
      return editModeCore.handleEditModeClick(x, y);
    }
    return false;
  };
  
  // Kombinované handlery pro pohyb myši v různých režimech editace
  const handleEditMouseMove = (x: number, y: number) => {
    if (slicingMode.slicingMode) {
      slicingMode.updateCursorPosition(x, y);
    } else if (pointAddingMode.pointAddingMode) {
      pointAddingMode.detectSegmentUnderCursor(x, y);
    }
    // Standardní editMode nepotřebuje speciální handler pro pohyb myši
  };

  return {
    // Základní editační režim
    editMode: editModeCore.editMode,
    tempPoints: editModeCore.tempPoints,
    cursorPosition: editModeCore.cursorPosition || slicingMode.cursorPosition,
    toggleEditMode: editModeCore.toggleEditMode,
    
    // Slicing režim
    slicingMode: slicingMode.slicingMode,
    sliceStartPoint: slicingMode.sliceStartPoint,
    toggleSlicingMode: slicingMode.toggleSlicingMode,
    
    // Režim přidávání bodů
    pointAddingMode: pointAddingMode.pointAddingMode,
    hoveredSegment: pointAddingMode.hoveredSegment,
    togglePointAddingMode: pointAddingMode.togglePointAddingMode,
    
    // Kombinované handlery
    handleEditModeClick,
    handleEditMouseMove
  };
};
