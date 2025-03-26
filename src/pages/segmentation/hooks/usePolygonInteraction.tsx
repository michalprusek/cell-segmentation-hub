
import { usePolygonDetection } from './polygonInteraction/usePolygonDetection';
import { usePolygonState } from './polygonInteraction/usePolygonState';
import { usePolygonModification } from './polygonInteraction/usePolygonModification';
import { usePolygonEventHandlers } from './polygonInteraction/usePolygonEventHandlers';
import { usePolygonEditMode } from './polygonInteraction/usePolygonEditMode';
import { SegmentationResult } from '@/lib/segmentation';
import { usePointEditor } from './polygonInteraction/geometry/usePointEditor';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';

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
    exitAllEditModes,
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

  /**
   * Handler pro smazání vrcholu polygonu
   */
  const handleDeleteVertex = useCallback((polygonId: string, vertexIndex: number) => {
    const success = pointEditor.removePoint(polygonId, vertexIndex);
    if (success) {
      toast.success("Bod byl úspěšně odstraněn");
    } else {
      toast.error("Odstranění bodu selhalo");
    }
  }, [pointEditor]);
  
  /**
   * Handler pro duplikaci vrcholu polygonu
   */
  const handleDuplicateVertex = useCallback((polygonId: string, vertexIndex: number) => {
    const success = pointEditor.duplicatePoint(polygonId, vertexIndex);
    if (success) {
      toast.success("Bod byl úspěšně duplikován");
    } else {
      toast.error("Duplikace bodu selhala");
    }
  }, [pointEditor]);
  
  /**
   * Handler pro zahájení režimu krájení polygonu
   */
  const handleSlicePolygon = useCallback((polygonId: string) => {
    setSelectedPolygonId(polygonId);
    toggleSlicingMode();
  }, [setSelectedPolygonId, toggleSlicingMode]);

  /**
   * Handler pro zahájení editace polygonu
   */
  const handleEditPolygon = useCallback((polygonId: string) => {
    setSelectedPolygonId(polygonId);
    togglePointAddingMode();
  }, [setSelectedPolygonId, togglePointAddingMode]);

  /**
   * Handler pro duplikaci polygonu
   */
  const handleDuplicatePolygon = useCallback((polygonId: string) => {
    if (!segmentation) return;
    
    const polygon = segmentation.polygons.find(p => p.id === polygonId);
    if (!polygon) return;
    
    // Create a new polygon with slightly offset points
    const offsetX = 20;
    const offsetY = 20;
    const newPolygon = {
      ...polygon,
      id: uuidv4(),
      points: polygon.points.map(p => ({
        x: p.x + offsetX,
        y: p.y + offsetY
      }))
    };
    
    // Add the new polygon to the segmentation
    setSegmentation({
      ...segmentation,
      polygons: [...segmentation.polygons, newPolygon]
    });
    
    setSelectedPolygonId(newPolygon.id);
    toast.success("Polygon byl úspěšně duplikován");
  }, [segmentation, setSegmentation, setSelectedPolygonId]);
  
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
    handleDeleteVertex,
    handleDuplicateVertex,
    handleSlicePolygon,
    handleEditPolygon,
    handleDuplicatePolygon,
    isPointInPolygon,
    toggleEditMode,
    toggleSlicingMode,
    togglePointAddingMode,
    exitAllEditModes,
    simplifySelectedPolygon,
    // Exportujeme potřebné funkce z pointEditor
    addPointToPolygon: pointEditor.addPoint,
    removePointFromPolygon: pointEditor.removePoint
  };
};
