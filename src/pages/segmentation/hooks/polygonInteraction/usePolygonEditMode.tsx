
import { SegmentationResult } from '@/lib/segmentation';
import { useEditModeCore } from './editMode/useEditModeCore';
import { useSlicingMode } from './editMode/useSlicingMode';
import { usePointAddingMode } from './editMode/usePointAddingMode';
import { useCallback } from 'react';

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

  // Zajištění, že je aktivní vždy jen jeden režim
  const toggleEditMode = useCallback(() => {
    if (editModeCore.editMode) {
      // Pokud je již aktivní, deaktivujeme
      editModeCore.toggleEditMode();
    } else {
      // Jinak deaktivujeme ostatní režimy a aktivujeme tento
      if (slicingMode.slicingMode) slicingMode.toggleSlicingMode();
      if (pointAddingMode.pointAddingMode) pointAddingMode.togglePointAddingMode();
      editModeCore.toggleEditMode();
    }
  }, [editModeCore, slicingMode, pointAddingMode]);

  const toggleSlicingMode = useCallback(() => {
    if (slicingMode.slicingMode) {
      // Pokud je již aktivní, deaktivujeme
      slicingMode.toggleSlicingMode();
    } else {
      // Jinak deaktivujeme ostatní režimy a aktivujeme tento
      if (editModeCore.editMode) editModeCore.toggleEditMode();
      if (pointAddingMode.pointAddingMode) pointAddingMode.togglePointAddingMode();
      slicingMode.toggleSlicingMode();
    }
  }, [editModeCore, slicingMode, pointAddingMode]);

  const togglePointAddingMode = useCallback(() => {
    if (pointAddingMode.pointAddingMode) {
      // Pokud je již aktivní, deaktivujeme
      pointAddingMode.togglePointAddingMode();
    } else {
      // Jinak deaktivujeme ostatní režimy a aktivujeme tento
      if (editModeCore.editMode) editModeCore.toggleEditMode();
      if (slicingMode.slicingMode) slicingMode.toggleSlicingMode();
      pointAddingMode.togglePointAddingMode();
    }
  }, [editModeCore, slicingMode, pointAddingMode]);

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
    toggleEditMode,
    
    // Slicing režim
    slicingMode: slicingMode.slicingMode,
    sliceStartPoint: slicingMode.sliceStartPoint,
    toggleSlicingMode,
    
    // Režim přidávání bodů
    pointAddingMode: pointAddingMode.pointAddingMode,
    hoveredSegment: pointAddingMode.hoveredSegment,
    togglePointAddingMode,
    
    // Kombinované handlery
    handleEditModeClick,
    handleEditMouseMove
  };
};
