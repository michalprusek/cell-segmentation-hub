
import { usePolygonDetection } from './polygonInteraction/usePolygonDetection';
import { usePolygonState } from './polygonInteraction/usePolygonState';
import { usePolygonModification } from './polygonInteraction/usePolygonModification';
import { usePolygonEventHandlers } from './polygonInteraction/usePolygonEventHandlers';
import { usePolygonEditMode } from './polygonInteraction/usePolygonEditMode';
import { SegmentationResult } from '@/lib/segmentation';

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
    hoveredSegment
  } = usePolygonEditMode(
    segmentation,
    setSegmentation,
    selectedPolygonId
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
    setSelectedPolygonId,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleDeletePolygon,
    isPointInPolygon,
    toggleEditMode,
    toggleSlicingMode,
    togglePointAddingMode
  };
};
