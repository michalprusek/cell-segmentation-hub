
import { useState, useCallback } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { useGeometryUtils } from './useGeometryUtils';
import { toast } from 'sonner';

/**
 * Hook for adding points to an existing polygon
 */
export const usePointAddingMode = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null
) => {
  const [pointAddingMode, setPointAddingMode] = useState(false);
  const [hoveredSegment, setHoveredSegment] = useState<{
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  }>({
    polygonId: null,
    segmentIndex: null,
    projectedPoint: null
  });
  
  const { projectPointOnLineSegment, distance } = useGeometryUtils();
  
  /**
   * Toggle point adding mode on/off
   */
  const togglePointAddingMode = useCallback(() => {
    setPointAddingMode(prev => !prev);
    setHoveredSegment({
      polygonId: null,
      segmentIndex: null,
      projectedPoint: null
    });
  }, []);
  
  /**
   * Detect line segment under cursor and project point onto it
   */
  const detectSegmentUnderCursor = useCallback((x: number, y: number) => {
    if (!pointAddingMode || !selectedPolygonId || !segmentation) {
      setHoveredSegment({
        polygonId: null,
        segmentIndex: null,
        projectedPoint: null
      });
      return;
    }
    
    const polygon = segmentation.polygons.find(p => p.id === selectedPolygonId);
    if (!polygon || polygon.points.length < 2) return;
    
    const points = polygon.points;
    let closestSegmentIndex = -1;
    let closestDistance = Infinity;
    let closestProjectedPoint: Point = { x: 0, y: 0 };
    
    // Check each line segment of the polygon
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length]; // Wrap around to first point
      
      const projectedPoint = projectPointOnLineSegment(p1, p2, { x, y });
      if (!projectedPoint) continue;
      
      const dist = distance({ x, y }, projectedPoint);
      
      // If this segment is closer than previously found ones
      if (dist < closestDistance && dist < 20) { // Detection threshold
        closestDistance = dist;
        closestSegmentIndex = i;
        closestProjectedPoint = projectedPoint;
      }
    }
    
    if (closestSegmentIndex !== -1) {
      setHoveredSegment({
        polygonId: selectedPolygonId,
        segmentIndex: closestSegmentIndex,
        projectedPoint: closestProjectedPoint
      });
    } else {
      setHoveredSegment({
        polygonId: null,
        segmentIndex: null,
        projectedPoint: null
      });
    }
  }, [pointAddingMode, selectedPolygonId, segmentation, projectPointOnLineSegment, distance]);
  
  /**
   * Handle clicks in point adding mode
   */
  const handlePointAddingClick = useCallback(() => {
    if (!pointAddingMode || !hoveredSegment.polygonId || hoveredSegment.segmentIndex === null || !hoveredSegment.projectedPoint) {
      return false;
    }
    
    if (!segmentation) return false;
    
    const polygon = segmentation.polygons.find(p => p.id === hoveredSegment.polygonId);
    if (!polygon) return false;
    
    // Insert new point after the segment's start point
    const newPoints = [...polygon.points];
    newPoints.splice(hoveredSegment.segmentIndex + 1, 0, hoveredSegment.projectedPoint);
    
    const updatedPolygons = segmentation.polygons.map(p => 
      p.id === hoveredSegment.polygonId ? { ...p, points: newPoints } : p
    );
    
    setSegmentation({
      ...segmentation,
      polygons: updatedPolygons
    });
    
    toast.success("Bod byl úspěšně přidán");
    
    // Exit point adding mode automatically after adding a point
    setPointAddingMode(false);
    
    return true;
  }, [pointAddingMode, hoveredSegment, segmentation, setSegmentation]);

  return {
    pointAddingMode,
    hoveredSegment,
    togglePointAddingMode,
    detectSegmentUnderCursor,
    handlePointAddingClick,
    setPointAddingMode // Export this to allow other components to directly change point adding mode
  };
};
