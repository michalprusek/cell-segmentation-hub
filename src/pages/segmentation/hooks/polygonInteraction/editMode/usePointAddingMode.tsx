
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
  
  const { distance, findClosestPointOnSegment } = useGeometryUtils();
  const { addPointsToPolygon } = usePathModification(segmentation, setSegmentation);
  
  /**
   * Toggle point adding mode on/off
   */
  const togglePointAddingMode = useCallback(() => {
    setPointAddingMode(prev => !prev);
    setSelectedVertexIndex(null);
    setTempPoints([]);
    setHoveredSegment({
      polygonId: null,
      segmentIndex: null,
      projectedPoint: null
    });
  }, []);

  /**
   * Reset point adding state
   */
  const resetPointAddingState = useCallback(() => {
    setSelectedVertexIndex(null);
    setTempPoints([]);
    setHoveredSegment({
      polygonId: null,
      segmentIndex: null,
      projectedPoint: null
    });
  }, []);
  
  /**
   * Detect polygon segment under cursor to show preview where point would be added
   */
  const detectSegmentUnderCursor = useCallback((x: number, y: number) => {
    if (!pointAddingMode || !segmentation || !selectedPolygonId) return;
    
    const polygon = segmentation.polygons.find(p => p.id === selectedPolygonId);
    if (!polygon) return;
    
    const cursorPoint = { x, y };
    const points = polygon.points;
    
    // If we've already selected a start vertex, we're looking for an end vertex
    if (selectedVertexIndex !== null) {
      // Check if we're hovering near any vertex (except the start vertex)
      for (let i = 0; i < points.length; i++) {
        if (i === selectedVertexIndex) continue; // Skip the starting vertex
        
        const point = points[i];
        if (distance(cursorPoint, point) < 15) {
          setHoveredSegment({
            polygonId: selectedPolygonId,
            segmentIndex: i,
            projectedPoint: point
          });
          return;
        }
      }
      
      // If not near any vertex, clear hover state
      setHoveredSegment({
        polygonId: null,
        segmentIndex: null,
        projectedPoint: null
      });
      return;
    }
    
    // If we haven't selected a start vertex yet, look for vertices to start from
    let closestVertexIndex = -1;
    let minDistance = Infinity;
    
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const dist = distance(cursorPoint, point);
      
      if (dist < minDistance && dist < 15) {
        minDistance = dist;
        closestVertexIndex = i;
      }
    }
    
    if (closestVertexIndex !== -1) {
      setHoveredSegment({
        polygonId: selectedPolygonId,
        segmentIndex: closestVertexIndex,
        projectedPoint: points[closestVertexIndex]
      });
    } else {
      setHoveredSegment({
        polygonId: null,
        segmentIndex: null,
        projectedPoint: null
      });
    }
  }, [pointAddingMode, segmentation, selectedPolygonId, selectedVertexIndex, distance]);

  /**
   * Handle click during point adding mode
   */
  const handlePointAddingClick = useCallback(() => {
    if (!pointAddingMode || !segmentation || !selectedPolygonId) return false;
    
    const polygon = segmentation.polygons.find(p => p.id === selectedPolygonId);
    if (!polygon) return false;
    
    // If we have a hovered vertex/segment
    if (hoveredSegment.polygonId && hoveredSegment.segmentIndex !== null) {
      // If we haven't selected a start vertex yet
      if (selectedVertexIndex === null) {
        // Set this as our start vertex
        setSelectedVertexIndex(hoveredSegment.segmentIndex);
        // Clear temp points
        setTempPoints([]);
        return true;
      } 
      // If we've already selected a start vertex and have a valid end vertex
      else if (hoveredSegment.segmentIndex !== selectedVertexIndex) {
        // Complete the point sequence addition
        const startIndex = selectedVertexIndex;
        const endIndex = hoveredSegment.segmentIndex;
        
        // We need to include both the start and end points from the polygon
        const allPoints = [
          polygon.points[startIndex],
          ...tempPoints,
          polygon.points[endIndex]
        ];
        
        // Add the point sequence to the polygon
        const success = addPointsToPolygon(
          selectedPolygonId,
          startIndex,
          endIndex,
          allPoints
        );
        
        if (success) {
          toast.success("Body byly úspěšně přidány do polygonu");
          resetPointAddingState();
          // Exit point adding mode automatically after completion
          setPointAddingMode(false);
        } else {
          toast.error("Přidání bodů selhalo");
          resetPointAddingState();
        }
        
        return true;
      }
    } 
    // If we've selected a start vertex but clicked elsewhere (not on an end vertex)
    else if (selectedVertexIndex !== null) {
      // Add a point to our temporary sequence
      if (hoveredSegment.projectedPoint) {
        setTempPoints(prev => [...prev, hoveredSegment.projectedPoint]);
      } else {
        // Use current cursor position if no projected point
        const cursorPosition = { 
          x: window.event ? (window.event as MouseEvent).offsetX : 0,
          y: window.event ? (window.event as MouseEvent).offsetY : 0
        };
        setTempPoints(prev => [...prev, cursorPosition]);
      }
      return true;
    }
    
    return false;
  }, [
    pointAddingMode, 
    segmentation, 
    selectedPolygonId, 
    hoveredSegment, 
    selectedVertexIndex,
    tempPoints,
    addPointsToPolygon,
    resetPointAddingState
  ]);

  return {
    pointAddingMode,
    setPointAddingMode,
    hoveredSegment,
    tempPoints,
    selectedVertexIndex,
    togglePointAddingMode,
    detectSegmentUnderCursor,
    handlePointAddingClick,
    resetPointAddingState
  };
};
