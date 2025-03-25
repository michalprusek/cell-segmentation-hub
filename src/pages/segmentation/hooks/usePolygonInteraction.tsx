
import { usePolygonDetection } from './polygonInteraction/usePolygonDetection';
import { usePolygonState } from './polygonInteraction/usePolygonState';
import { usePolygonModification } from './polygonInteraction/usePolygonModification';
import { usePolygonEventHandlers } from './polygonInteraction/usePolygonEventHandlers';
import { usePolygonEditMode } from './polygonInteraction/usePolygonEditMode';
import { SegmentationResult } from '@/lib/segmentation';
import { usePointEditor } from './polygonInteraction/geometry/usePointEditor';
import { useCallback } from 'react';
import { toast } from 'sonner';

/**
 * Hook pro práci s polygony v segmentačním editoru
 */
export const usePolygonInteraction = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  zoom: number,
  offset: { x: number; y: number },
  setOffset: (offset: { x: number; y: number }) => void
) => {
  // Stav polygonu
  const {
    selectedPolygonId,
    setSelectedPolygonId,
    hoveredVertex,
    setHoveredVertex,
    dragState,
    vertexDragState
  } = usePolygonState();
  
  // Metody pro detekci bodů v polygonu
  const { isPointInPolygon } = usePolygonDetection();
  
  // Pokročilý editor bodů
  const pointEditor = usePointEditor(segmentation, setSegmentation);
  
  // Metody pro modifikaci polygonů
  const { handleDeletePolygon } = usePolygonModification(
    segmentation,
    setSegmentation,
    selectedPolygonId,
    setSelectedPolygonId
  );
  
  // Metody pro režimy úprav polygonu
  const { 
    toggleEditMode,
    toggleSlicingMode,
    togglePointAddingMode,
    handleEditModeClick,
    handleEditMouseMove,
    tempPoints,
    editMode,
    slicingMode,
    pointAddingMode,
    cursorPosition,
    sliceStartPoint,
    hoveredSegment,
    isShiftPressed
  } = usePolygonEditMode(
    segmentation,
    setSegmentation,
    selectedPolygonId,
    zoom,
    offset
  );
  
  // Event handlery pro práci s polygony
  const { 
    handleMouseDown, 
    handleMouseMove, 
    handleMouseUp 
  } = usePolygonEventHandlers(
    zoom,
    offset,
    setOffset,
    segmentation,
    setSegmentation,
    selectedPolygonId,
    setSelectedPolygonId,
    hoveredVertex,
    setHoveredVertex,
    dragState,
    vertexDragState,
    editMode || slicingMode || pointAddingMode,
    handleEditModeClick,
    handleEditMouseMove
  );
  
  /**
   * Zjednodušení polygonu - wrapper pro pointEditor.simplifyPolygon
   */
  const simplifySelectedPolygon = useCallback((tolerance: number = 1.0) => {
    if (!selectedPolygonId) {
      toast.error("Nejprve vyberte polygon");
      return false;
    }
    
    const success = pointEditor.simplifyPolygon(selectedPolygonId, tolerance);
    
    if (success) {
      toast.success("Polygon byl úspěšně zjednodušen");
    } else {
      toast.error("Zjednodušení polygonu selhalo");
    }
    
    return success;
  }, [selectedPolygonId, pointEditor]);
  
  return {
    selectedPolygonId,
    hoveredVertex,
    dragState,
    vertexDragState,
    tempPoints,
    editMode,
    slicingMode,
    pointAddingMode,
    cursorPosition,
    sliceStartPoint,
    hoveredSegment,
    isShiftPressed,
    setSelectedPolygonId,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleDeletePolygon,
    isPointInPolygon,
    toggleEditMode,
    toggleSlicingMode,
    togglePointAddingMode,
    simplifySelectedPolygon,
    // Exportujeme potřebné funkce z pointEditor
    addPointToPolygon: pointEditor.addPoint,
    removePointFromPolygon: pointEditor.removePoint
  };
};
