import { useCallback } from 'react';
import { Point, SegmentationResult } from '@/lib/segmentation';
import { TempPointsState } from '@/pages/segmentation/types';
import { useGeometryUtils } from './useGeometryUtils';
import { toast } from 'sonner';

/**
 * Hook for modifying polygon paths in edit mode
 */
export const usePathModification = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void
) => {
  const { calculatePathLength, calculatePolygonArea } = useGeometryUtils();

  /**
   * Add points to the polygon
   */
  const addPointsToPolygon = useCallback((
    polygonId: string,
    startIndex: number,
    endIndex: number,
    newPoints: Point[]
  ) => {
    if (!segmentation) return false;
    
    const polygonIndex = segmentation.polygons.findIndex(p => p.id === polygonId);
    if (polygonIndex === -1) return false;
    
    const polygon = segmentation.polygons[polygonIndex];
    const points = [...polygon.points];
    
    // Create two possible new polygons and calculate their areas
    
    // Path 1: Replace the clockwise path with new points
    const clockwisePolygon: Point[] = [];
    
    // Add points from original polygon up to startIndex
    for (let i = 0; i <= startIndex; i++) {
      clockwisePolygon.push(points[i]);
    }
    
    // Add new internal points (excluding start and end which already exist)
    for (let i = 1; i < newPoints.length - 1; i++) {
      clockwisePolygon.push(newPoints[i]);
    }
    
    // Add remaining points from endIndex onwards
    for (let i = endIndex; i < points.length; i++) {
      clockwisePolygon.push(points[i]);
    }
    
    // Path 2: Replace the counterclockwise path with new points
    const counterClockwisePolygon: Point[] = [];
    
    // Add points from original polygon up to endIndex
    for (let i = 0; i <= endIndex; i++) {
      counterClockwisePolygon.push(points[i]);
    }
    
    // Add new points in reverse (excluding end and start which already exist)
    for (let i = newPoints.length - 2; i > 0; i--) {
      counterClockwisePolygon.push(newPoints[i]);
    }
    
    // Add remaining points from startIndex onwards
    for (let i = startIndex; i < points.length; i++) {
      counterClockwisePolygon.push(points[i]);
    }
    
    // Calculate areas to determine which polygon to keep (we want the larger area)
    const clockwiseArea = calculatePolygonArea(clockwisePolygon);
    const counterClockwiseArea = calculatePolygonArea(counterClockwisePolygon);
    
    // Choose the polygon with larger area (this is a change from original which used path length)
    const resultPolygon = clockwiseArea >= counterClockwiseArea 
      ? clockwisePolygon 
      : counterClockwisePolygon;
    
    // Update the polygon
    const updatedPolygons = [...segmentation.polygons];
    updatedPolygons[polygonIndex] = {
      ...polygon,
      points: resultPolygon
    };
    
    setSegmentation({
      ...segmentation,
      polygons: updatedPolygons
    });
    
    // Notify success
    toast.success("Point sequence added successfully");
    
    return true;
  }, [segmentation, setSegmentation, calculatePolygonArea]);

  return {
    addPointsToPolygon
  };
};
