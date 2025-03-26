
import { useState, useCallback } from 'react';
import { Point } from '@/lib/segmentation';

/**
 * Hook pro správu stavu režimu přidávání bodů
 */
export const usePointAddingState = () => {
  const [pointAddingMode, setPointAddingMode] = useState<boolean>(false);
  const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | null>(null);
  const [sourcePolygonId, setSourcePolygonId] = useState<string | null>(null);
  const [tempPoints, setTempPoints] = useState<Point[]>([]);
  const [hoveredSegment, setHoveredSegment] = useState<{
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  }>({
    polygonId: null,
    segmentIndex: null,
    projectedPoint: null
  });

  /**
   * Přepíná režim přidávání bodů
   */
  const togglePointAddingMode = useCallback(() => {
    setPointAddingMode(prev => !prev);
    
    // Pokud vypínáme režim, resetujeme stav
    if (pointAddingMode) {
      resetPointAddingState();
    } else {
      console.log("Entering point adding mode");
    }
  }, [pointAddingMode]);

  /**
   * Resetuje stav přidávání bodů
   */
  const resetPointAddingState = useCallback(() => {
    setSelectedVertexIndex(null);
    setSourcePolygonId(null);
    setTempPoints([]);
    setHoveredSegment({
      polygonId: null,
      segmentIndex: null,
      projectedPoint: null
    });
    
    console.log("Point adding state has been reset");
  }, []);

  return {
    pointAddingMode,
    setPointAddingMode,
    selectedVertexIndex,
    setSelectedVertexIndex,
    sourcePolygonId,
    setSourcePolygonId,
    hoveredSegment,
    setHoveredSegment,
    tempPoints,
    setTempPoints,
    togglePointAddingMode,
    resetPointAddingState
  };
};
