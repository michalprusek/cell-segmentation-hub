
import { usePolygonDetection } from './polygonInteraction/usePolygonDetection';
import { usePolygonState } from './polygonInteraction/usePolygonState';
import { usePolygonEventHandlers } from './polygonInteraction/usePolygonEventHandlers';
import { useEditModesManager } from './polygonInteraction/useEditModesManager';
import { usePolygonActions } from './polygonInteraction/usePolygonActions';
import { SegmentationResult } from '@/lib/segmentation';
import { useCallback } from 'react';

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
  
  // Režimy editace polygonu
  const editModes = useEditModesManager(
    segmentation,
    setSegmentation,
    selectedPolygonId,
    zoom,
    offset
  );
  
  // Akce nad polygony
  const polygonActions = usePolygonActions(
    segmentation,
    setSegmentation,
    selectedPolygonId,
    setSelectedPolygonId,
    editModes.togglePointAddingMode,
    editModes.toggleSlicingMode
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
    editModes.isAnyEditModeActive,
    editModes.handleEditModeClick,
    editModes.handleEditMouseMove
  );
  
  return {
    // State
    selectedPolygonId,
    hoveredVertex,
    dragState,
    vertexDragState,
    
    // Edit modes
    ...editModes,
    
    // Event handlers
    setSelectedPolygonId,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    
    // Polygon actions
    ...polygonActions,
    
    // Detection utilities
    isPointInPolygon,
    
    // Explicitly expose source polygon ID for point adding mode
    sourcePolygonId: editModes.sourcePolygonId
  };
};
