
import { useState, useRef } from 'react';
import { DragState, VertexDragState } from '@/pages/segmentation/types';

/**
 * Hook pro správu stavu polygonu v segmentačním editoru
 */
export const usePolygonState = () => {
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

  return {
    selectedPolygonId,
    setSelectedPolygonId,
    hoveredVertex,
    setHoveredVertex,
    dragState,
    vertexDragState
  };
};
