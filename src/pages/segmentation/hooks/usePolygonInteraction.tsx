
import { usePolygonDetection } from './polygonInteraction/usePolygonDetection';
import { usePolygonState } from './polygonInteraction/usePolygonState';
import { usePolygonModification } from './polygonInteraction/usePolygonModification';
import { usePolygonEventHandlers } from './polygonInteraction/usePolygonEventHandlers';
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
    vertexDragState
  );
  
  return {
    selectedPolygonId,
    hoveredVertex,
    dragState,
    vertexDragState,
    setSelectedPolygonId,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleDeletePolygon,
    isPointInPolygon
  };
};
