
import { useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { useMouseInteractions } from './useMouseInteractions';

/**
 * Hook pro zpracování událostí polygonu
 */
export const usePolygonEventHandlers = (
  zoom: number,
  offset: { x: number; y: number },
  setOffset: (offset: { x: number; y: number }) => void,
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null,
  setSelectedPolygonId: (id: string | null) => void,
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null },
  setHoveredVertex: (state: { polygonId: string | null, vertexIndex: number | null }) => void,
  dragState: React.MutableRefObject<{
    isDragging: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  }>,
  vertexDragState: React.MutableRefObject<{
    isDragging: boolean;
    polygonId: string | null;
    vertexIndex: number | null;
  }>
) => {
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
  
  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp
  };
};
