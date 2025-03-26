
import { SegmentationResult, Point } from '@/lib/segmentation';
import { useEditModeCore } from './editMode/useEditModeCore';
import { useSlicingMode } from './editMode/useSlicingMode';
import { usePointAddingMode } from './editMode/usePointAddingMode';
import { useGeometryUtils } from './editMode/useGeometryUtils';
import { useAutoPointAdding } from './editMode/useAutoPointAdding';
import { useEditModeSwitcher } from './editMode/useEditModeSwitcher';
import { useEditModeClickHandlers } from './editMode/useEditModeClickHandlers';
import { useCallback } from 'react';

/**
 * Hook that manages and coordinates all editing modes
 */
export const useEditModesManager = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null,
  zoom: number = 1,
  offset: { x: number; y: number } = { x: 0, y: 0 }
) => {
  // Základní režim editace (přidávání vrcholů do nového polygonu)
  const editModeCore = useEditModeCore(
    segmentation,
    setSegmentation,
    selectedPolygonId,
    zoom,
    offset
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

  const { distance } = useGeometryUtils();
  
  // Automatické přidávání bodů při držení Shift
  const { resetLastAutoAddedPoint } = useAutoPointAdding({
    editMode: editModeCore.editMode,
    cursorPosition: editModeCore.cursorPosition,
    isShiftPressed: editModeCore.isShiftPressed,
    tempPoints: editModeCore.tempPoints,
    addPointToTemp: editModeCore.addPointToTemp
  });

  // Get selected polygon points for visualization
  const selectedPolygonPoints = segmentation && selectedPolygonId
    ? segmentation.polygons.find(p => p.id === selectedPolygonId)?.points || null
    : null;
    
  // Get points for the active polygon in point adding mode
  const activePolygonPoints = segmentation && pointAddingMode.sourcePolygonId
    ? segmentation.polygons.find(p => p.id === pointAddingMode.sourcePolygonId)?.points || null
    : selectedPolygonPoints;

  // Přepínání mezi editačními režimy
  const {
    toggleEditMode,
    toggleSlicingMode,
    togglePointAddingMode,
    exitAllEditModes
  } = useEditModeSwitcher({
    editModeCore,
    slicingMode,
    pointAddingMode
  });

  // Obsluha kliknutí v editačních režimech
  const {
    handleEditModeClick,
    handleEditMouseMove
  } = useEditModeClickHandlers({
    slicingMode: {
      slicingMode: slicingMode.slicingMode,
      handleSlicingClick: slicingMode.handleSlicingClick,
      updateCursorPosition: slicingMode.updateCursorPosition
    },
    pointAddingMode: {
      pointAddingMode: pointAddingMode.pointAddingMode,
      handlePointAddingClick: pointAddingMode.handlePointAddingClick,
      detectVertexUnderCursor: pointAddingMode.detectVertexUnderCursor
    },
    editModeCore,
    resetLastAutoAddedPoint
  });

  // Determine if any edit mode is active
  const isAnyEditModeActive = useCallback(() => {
    return editModeCore.editMode || slicingMode.slicingMode || pointAddingMode.pointAddingMode;
  }, [editModeCore.editMode, slicingMode.slicingMode, pointAddingMode.pointAddingMode]);

  // Určete, který cursorPosition použít - podle aktivního režimu
  const activeCursorPosition = pointAddingMode.pointAddingMode 
    ? pointAddingMode.cursorPosition 
    : (editModeCore.cursorPosition || slicingMode.cursorPosition);

  return {
    // Základní editační režim
    editMode: editModeCore.editMode,
    tempPoints: editModeCore.tempPoints,
    cursorPosition: activeCursorPosition,
    isShiftPressed: editModeCore.isShiftPressed,
    toggleEditMode,
    
    // Slicing režim
    slicingMode: slicingMode.slicingMode,
    sliceStartPoint: slicingMode.sliceStartPoint,
    toggleSlicingMode,
    
    // Režim přidávání bodů
    pointAddingMode: pointAddingMode.pointAddingMode,
    hoveredSegment: pointAddingMode.hoveredSegment,
    pointAddingTempPoints: pointAddingMode.tempPoints,
    selectedVertexIndex: pointAddingMode.selectedVertexIndex,
    sourcePolygonId: pointAddingMode.sourcePolygonId,
    togglePointAddingMode,
    
    // Selected polygon data for visualization
    selectedPolygonPoints: activePolygonPoints,
    
    // Funkce pro ukončení všech editačních režimů
    exitAllEditModes,
    
    // Kombinované handlery
    handleEditModeClick,
    handleEditMouseMove,
    
    // Status indicator
    isAnyEditModeActive: isAnyEditModeActive()
  };
};
