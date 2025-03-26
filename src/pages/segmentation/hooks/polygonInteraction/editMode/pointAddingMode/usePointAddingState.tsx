
import { useState, useCallback } from 'react';
import { Point } from '@/lib/segmentation';

/**
 * Hook pro správu stavů režimu přidávání bodů do polygonu
 */
export const usePointAddingState = () => {
  // Stav režimu přidávání bodů
  const [pointAddingMode, setPointAddingMode] = useState(false);
  
  // Vybraný vrchol jako počáteční bod sekvence
  const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | null>(null);
  
  // ID polygonu, do kterého přidáváme body
  const [sourcePolygonId, setSourcePolygonId] = useState<string | null>(null);
  
  // Informace o aktuálně zvýrazněném segmentu/vrcholu
  const [hoveredSegment, setHoveredSegment] = useState<{
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  }>({
    polygonId: null,
    segmentIndex: null,
    projectedPoint: null
  });
  
  // Dočasné body tvořící novou sekvenci
  const [tempPoints, setTempPoints] = useState<Point[]>([]);
  
  /**
   * Reset všech stavů režimu přidávání bodů
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
  }, []);

  /**
   * Přepnutí režimu přidávání bodů
   */
  const togglePointAddingMode = useCallback(() => {
    setPointAddingMode(prev => !prev);
    resetPointAddingState();
  }, [resetPointAddingState]);

  return {
    // Stavy
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
    
    // Akce
    togglePointAddingMode,
    resetPointAddingState
  };
};
