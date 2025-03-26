
import { useEffect } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { useGeometryUtils } from './useGeometryUtils';
import { usePathModification } from './usePathModification';
import { usePointAddingState } from './pointAddingMode/usePointAddingState';
import { useVertexDetection } from './pointAddingMode/useVertexDetection';
import { usePointAddingHandlers } from './pointAddingMode/usePointAddingHandlers';
import { usePolygonFinder } from './pointAddingMode/usePolygonFinder';

/**
 * Hook pro přidávání bodů do existujících polygonů
 */
export const usePointAddingMode = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null
) => {
  // Základní stav režimu přidávání bodů
  const {
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
  } = usePointAddingState();
  
  // Utility pro geometrické výpočty a hledání polygonů
  const { distance } = useGeometryUtils();
  const { modifyPolygonPath } = usePathModification(segmentation, setSegmentation);
  const { findPolygonById } = usePolygonFinder(segmentation);
  
  // Detekce vrcholů při pohybu myši
  const { detectVertexUnderCursor } = useVertexDetection({
    pointAddingMode,
    segmentation,
    selectedVertexIndex,
    sourcePolygonId,
    setHoveredSegment,
    distance
  });
  
  // Obsluha interakcí v režimu přidávání bodů
  const { handlePointAddingClick } = usePointAddingHandlers({
    pointAddingMode,
    segmentation,
    selectedVertexIndex,
    setSelectedVertexIndex,
    sourcePolygonId,
    setSourcePolygonId,
    hoveredSegment,
    tempPoints,
    setTempPoints,
    resetPointAddingState,
    setPointAddingMode,
    modifyPolygonPath,
    findPolygonById
  });
  
  // Logování pro debugování
  useEffect(() => {
    if (pointAddingMode) {
      console.log("PointAddingMode state:", { 
        selectedVertexIndex, 
        sourcePolygonId, 
        tempPoints: tempPoints.length,
        hoveredSegment
      });
    }
  }, [pointAddingMode, selectedVertexIndex, sourcePolygonId, tempPoints, hoveredSegment]);

  return {
    pointAddingMode,
    setPointAddingMode,
    hoveredSegment,
    tempPoints,
    selectedVertexIndex,
    sourcePolygonId,
    togglePointAddingMode,
    detectVertexUnderCursor,
    handlePointAddingClick,
    resetPointAddingState
  };
};
