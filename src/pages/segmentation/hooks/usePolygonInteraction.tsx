
import { useState, useRef, useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { DragState, VertexDragState } from '../types';
import { useMouseInteractions } from './polygonInteraction/useMouseInteractions';
import { usePolygonDetection } from './polygonInteraction/usePolygonDetection';

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
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null);
  const [hoveredVertex, setHoveredVertex] = useState<{ polygonId: string | null, vertexIndex: number | null }>({
    polygonId: null,
    vertexIndex: null
  });
  
  const dragState = useRef<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0
  });
  
  const vertexDragState = useRef<VertexDragState>({
    isDragging: false,
    polygonId: null,
    vertexIndex: null
  });
  
  const { isPointInPolygon } = usePolygonDetection();
  
  // Mouse interakce
  const { 
    handleMouseMove, 
    handleMouseDown, 
    handleMouseUp 
  } = useMouseInteractions(
    zoom,
    offset,
    setOffset,
    segmentation,
    setSegmentation,
    setSelectedPolygonId,
    setHoveredVertex,
    dragState,
    vertexDragState,
    hoveredVertex
  );
  
  // Smazání polygonu
  const handleDeletePolygon = useCallback(() => {
    if (!selectedPolygonId || !segmentation) return;
    
    // Odebrání vybraného polygonu
    setSegmentation({
      ...segmentation,
      polygons: segmentation.polygons.filter(polygon => polygon.id !== selectedPolygonId)
    });
    
    setSelectedPolygonId(null);
  }, [selectedPolygonId, segmentation, setSegmentation]);
  
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
