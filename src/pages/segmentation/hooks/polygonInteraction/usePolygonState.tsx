
import { useState, useRef } from 'react';
import { DragState, VertexDragState, TempPointsState } from '@/pages/segmentation/types';

/**
 * Hook pro správu stavu polygonu v segmentačním editoru
 */
export const usePolygonState = () => {
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null);
  const [hoveredVertex, setHoveredVertex] = useState<{ polygonId: string | null, vertexIndex: number | null }>({
    polygonId: null,
    vertexIndex: null
  });
  
  // We're not using these directly anymore as they're managed by usePolygonEditMode
  const [editMode, setEditMode] = useState<boolean>(false);
  const [tempPoints, setTempPoints] = useState<TempPointsState>({
    points: [],
    startIndex: null,
    endIndex: null,
    polygonId: null
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
    editMode,
    setEditMode,
    tempPoints,
    setTempPoints,
    dragState,
    vertexDragState
  };
};
