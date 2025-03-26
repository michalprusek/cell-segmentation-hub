
import { useState, useCallback, useRef } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { TempPointsState } from '@/pages/segmentation/types';
import { useGeometryUtils } from './useGeometryUtils';
import { usePathModification } from './usePathModification';
import { toast } from 'sonner';

/**
 * Hook for adding points to existing polygons
 */
export const usePointAddingMode = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null
) => {
  const [pointAddingMode, setPointAddingMode] = useState(false);
  const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | null>(null);
  const [sourcePolygonId, setSourcePolygonId] = useState<string | null>(null);
  const [hoveredSegment, setHoveredSegment] = useState<{
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  }>({
    polygonId: null,
    segmentIndex: null,
    projectedPoint: null
  });
  
  // Temporary points being added
  const [tempPoints, setTempPoints] = useState<Point[]>([]);
  
  const { distance, findClosestPointOnSegment, findShortestPath } = useGeometryUtils();
  const { modifyPolygonPath } = usePathModification(segmentation, setSegmentation);
  
  /**
   * Toggle point adding mode on/off
   */
  const togglePointAddingMode = useCallback(() => {
    setPointAddingMode(prev => !prev);
    resetPointAddingState();
  }, []);

  /**
   * Reset point adding state
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
   * Detect any vertex on any polygon under cursor
   */
  const detectVertexUnderCursor = useCallback((x: number, y: number) => {
    if (!pointAddingMode || !segmentation) return;
    
    const cursorPoint = { x, y };
    
    // Check for vertices on all polygons, not just selected one
    for (const polygon of segmentation.polygons) {
      const points = polygon.points;
      
      // If we've already selected a start vertex
      if (selectedVertexIndex !== null && sourcePolygonId !== null) {
        // Only highlight vertices of the same polygon where we started
        if (polygon.id !== sourcePolygonId) continue;
        
        // Check if we're hovering near any vertex (except the start vertex)
        for (let i = 0; i < points.length; i++) {
          if (i === selectedVertexIndex) continue; // Skip the starting vertex
          
          const point = points[i];
          if (distance(cursorPoint, point) < 15) {
            setHoveredSegment({
              polygonId: polygon.id,
              segmentIndex: i,
              projectedPoint: point
            });
            return;
          }
        }
      } else {
        // If we haven't selected a start vertex yet, search on all polygons
        for (let i = 0; i < points.length; i++) {
          const point = points[i];
          const dist = distance(cursorPoint, point);
          
          if (dist < 15) {
            setHoveredSegment({
              polygonId: polygon.id,
              segmentIndex: i,
              projectedPoint: point
            });
            return;
          }
        }
      }
    }
    
    // If not near any vertex, clear hover state
    setHoveredSegment({
      polygonId: null,
      segmentIndex: null,
      projectedPoint: null
    });
  }, [pointAddingMode, segmentation, selectedVertexIndex, sourcePolygonId, distance]);

  /**
   * Handle click during point adding mode
   */
  const handlePointAddingClick = useCallback((x: number, y: number) => {
    if (!pointAddingMode || !segmentation) return false;
    
    // If we have a hovered vertex
    if (hoveredSegment.polygonId && hoveredSegment.segmentIndex !== null) {
      // If we haven't selected a start vertex yet
      if (selectedVertexIndex === null) {
        // Set this as our start vertex
        setSelectedVertexIndex(hoveredSegment.segmentIndex);
        setSourcePolygonId(hoveredSegment.polygonId);
        // Clear temp points
        setTempPoints([]);
        return true;
      } 
      // If we've already selected a start vertex and clicked on another vertex of the same polygon
      else if (hoveredSegment.polygonId === sourcePolygonId && 
               hoveredSegment.segmentIndex !== selectedVertexIndex) {
        
        const polygon = segmentation.polygons.find(p => p.id === sourcePolygonId);
        if (polygon) {
          const startIndex = selectedVertexIndex;
          const endIndex = hoveredSegment.segmentIndex;
          
          // Create path including new points
          const newPath = [...tempPoints];
          
          // Find the shortest path between start and end points
          const { path, replaceIndices } = findShortestPath(
            polygon.points, startIndex, endIndex
          );
          
          // Apply the modification with the new path
          const success = modifyPolygonPath(
            sourcePolygonId,
            replaceIndices.start,
            replaceIndices.end,
            newPath
          );
          
          if (success) {
            toast.success("Body byly úspěšně přidány do polygonu");
            resetPointAddingState();
          } else {
            toast.error("Přidání bodů selhalo");
            resetPointAddingState();
          }
        }
        return true;
      }
    } 
    // If we've selected a start vertex but clicked elsewhere (not on an end vertex)
    else if (selectedVertexIndex !== null && sourcePolygonId !== null) {
      // Add a point to our temporary sequence
      setTempPoints(prev => [...prev, { x, y }]);
      return true;
    }
    
    return false;
  }, [
    pointAddingMode, 
    segmentation, 
    hoveredSegment, 
    selectedVertexIndex,
    sourcePolygonId,
    tempPoints,
    findShortestPath,
    modifyPolygonPath,
    resetPointAddingState
  ]);

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
