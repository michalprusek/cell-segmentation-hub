
import { useState, useCallback, useRef } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { TempPointsState } from '@/pages/segmentation/types';
import { useGeometryUtils } from './useGeometryUtils';
import { usePathModification } from './usePathModification';
import { toast } from '@/components/ui/use-toast';

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
   * Find polygon by id
   */
  const findPolygonById = useCallback((polygonId: string | null) => {
    if (!polygonId || !segmentation) return null;
    return segmentation.polygons.find(p => p.id === polygonId);
  }, [segmentation]);
  
  /**
   * Detect any vertex on any polygon under cursor
   */
  const detectVertexUnderCursor = useCallback((x: number, y: number) => {
    if (!pointAddingMode || !segmentation) return;
    
    const cursorPoint = { x, y };
    
    // Check for vertices on all polygons
    for (const polygon of segmentation.polygons) {
      const points = polygon.points;
      
      // If we've already selected a start vertex
      if (selectedVertexIndex !== null && sourcePolygonId !== null) {
        // Only highlight vertices of the same polygon where we started
        if (polygon.id !== sourcePolygonId) continue;
        
        // Skip highlighting the starting vertex
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
    
    // If not near any vertex, set projectedPoint to cursor position
    // This helps with drawing the temporary path line
    if (selectedVertexIndex !== null && sourcePolygonId !== null) {
      setHoveredSegment({
        polygonId: null,
        segmentIndex: null,
        projectedPoint: cursorPoint
      });
      return;
    }
    
    // Clear hover state if no vertex selected yet
    setHoveredSegment({
      polygonId: null,
      segmentIndex: null,
      projectedPoint: null
    });
  }, [pointAddingMode, segmentation, selectedVertexIndex, sourcePolygonId, distance]);
  
  /**
   * Find the shortest path between two points in a polygon
   */
  const findOptimalPath = useCallback((polygon: any, startIdx: number, endIdx: number) => {
    // Find the two possible paths between start and end
    const points = polygon.points;
    const totalPoints = points.length;
    
    // Path 1: Going forward from start to end
    let path1: number[] = [];
    let idx = startIdx;
    while (idx !== endIdx) {
      path1.push(idx);
      idx = (idx + 1) % totalPoints;
    }
    path1.push(endIdx);
    
    // Path 2: Going backward from start to end
    let path2: number[] = [];
    idx = startIdx;
    while (idx !== endIdx) {
      path2.push(idx);
      idx = (idx - 1 + totalPoints) % totalPoints;
    }
    path2.push(endIdx);
    
    // Calculate path lengths
    const calculatePathLength = (pathIndices: number[]) => {
      let length = 0;
      for (let i = 0; i < pathIndices.length - 1; i++) {
        const p1 = points[pathIndices[i]];
        const p2 = points[pathIndices[i + 1]];
        length += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
      }
      return length;
    };
    
    const path1Length = calculatePathLength(path1);
    const path2Length = calculatePathLength(path2);
    
    // Return the path with indices to replace
    return path1Length <= path2Length ? 
      { indices: path1, start: startIdx, end: endIdx } : 
      { indices: path2, start: endIdx, end: startIdx };
  }, []);

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
        
        const polygon = findPolygonById(sourcePolygonId);
        if (polygon) {
          const startIndex = selectedVertexIndex;
          const endIndex = hoveredSegment.segmentIndex;
          
          // Find the optimal path to replace
          const { indices, start, end } = findOptimalPath(polygon, startIndex, endIndex);
          
          // Apply the modification with the new path
          const success = modifyPolygonPath(
            sourcePolygonId,
            start,
            end,
            tempPoints
          );
          
          if (success) {
            toast({
              title: "Body přidány",
              description: "Body byly úspěšně přidány do polygonu",
              variant: "default"
            });
            // Auto-exit the point adding mode after successful addition
            setPointAddingMode(false);
            resetPointAddingState();
          } else {
            toast({
              title: "Chyba",
              description: "Přidání bodů selhalo",
              variant: "destructive"
            });
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
    findPolygonById,
    findOptimalPath,
    modifyPolygonPath,
    resetPointAddingState,
    toast
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
