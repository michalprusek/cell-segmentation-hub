
import { SegmentationResult, Point } from '@/lib/segmentation';
import { useEditModeCore } from './editMode/useEditModeCore';
import { useSlicingMode } from './editMode/useSlicingMode';
import { usePointAddingMode } from './editMode/usePointAddingMode';
import { useDeleteMode } from './editMode/useDeleteMode';
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
  setSelectedPolygonId: (id: string | null) => void,
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

  // Režim mazání polygonů
  const deleteMode = useDeleteMode(
    segmentation,
    setSegmentation,
    setSelectedPolygonId
  );

  const { distance, isPointInPolygon } = useGeometryUtils();
  
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
    toggleDeleteMode,
    exitAllEditModes
  } = useEditModeSwitcher({
    editModeCore,
    slicingMode,
    pointAddingMode,
    deleteMode
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
    deleteMode: {
      deleteMode: deleteMode.deleteMode,
      handleDeleteClick: deleteMode.handleDeleteClick
    },
    segmentation,
    isPointInPolygon,
    resetLastAutoAddedPoint
  });

  // Determine if any edit mode is active
  const isAnyEditModeActive = useCallback(() => {
    return editModeCore.editMode || slicingMode.slicingMode || pointAddingMode.pointAddingMode || deleteMode.deleteMode;
  }, [editModeCore.editMode, slicingMode.slicingMode, pointAddingMode.pointAddingMode, deleteMode.deleteMode]);

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
    
    // Režim mazání polygonů
    deleteMode: deleteMode.deleteMode,
    toggleDeleteMode,
    handleDeleteClick: deleteMode.handleDeleteClick,
    
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
