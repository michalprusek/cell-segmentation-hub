
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
  const { calculatePathLength } = useGeometryUtils();

  /**
   * Add points to the polygon
   */
  const addPointsToPolygon = useCallback((
    polygonId: string,
    startIndex: number,
    endIndex: number,
    newPoints: Point[]
  ) => {
    if (!segmentation) return;
    
    const polygonIndex = segmentation.polygons.findIndex(p => p.id === polygonId);
    if (polygonIndex === -1) return;
    
    const polygon = segmentation.polygons[polygonIndex];
    const points = [...polygon.points];
    
    // There are two paths between startIndex and endIndex in a closed polygon
    // We need to determine which one to replace
    
    // Create two possible new point sets and calculate their perimeters
    const clockwisePath: Point[] = [];
    const counterClockwisePath: Point[] = [];
    
    // Path 1: Going from startIndex to endIndex
    let i = startIndex;
    while (i !== endIndex) {
      clockwisePath.push(points[i]);
      i = (i + 1) % points.length;
    }
    clockwisePath.push(points[endIndex]);
    
    // Path 2: Going from endIndex to startIndex
    i = endIndex;
    while (i !== startIndex) {
      counterClockwisePath.push(points[i]);
      i = (i + 1) % points.length;
    }
    counterClockwisePath.push(points[startIndex]);
    
    // Calculate perimeters
    const clockwiseLength = calculatePathLength(clockwisePath);
    const counterClockwiseLength = calculatePathLength(counterClockwisePath);
    
    // The new points (excluding the start and end points which already exist)
    const insertPoints = newPoints.slice(1, -1);
    
    let newPoints1: Point[];
    
    // Replace the shorter path with the new points
    if (clockwiseLength <= counterClockwiseLength) {
      // Replace clockwise path (from startIndex to endIndex)
      newPoints1 = [];
      
      // Add points up to startIndex
      for (i = 0; i <= startIndex; i++) {
        newPoints1.push(points[i]);
      }
      
      // Add new points
      newPoints1.push(...insertPoints);
      
      // Add points from endIndex onwards
      for (i = endIndex; i < points.length; i++) {
        newPoints1.push(points[i]);
      }
    } else {
      // Replace counterclockwise path (from endIndex to startIndex)
      newPoints1 = [];
      
      // Add points up to endIndex
      for (i = 0; i <= endIndex; i++) {
        newPoints1.push(points[i]);
      }
      
      // Add new points in reverse
      for (i = insertPoints.length - 1; i >= 0; i--) {
        newPoints1.push(insertPoints[i]);
      }
      
      // Add points from startIndex onwards
      for (i = startIndex; i < points.length; i++) {
        newPoints1.push(points[i]);
      }
    }
    
    // Update the polygon
    const updatedPolygons = [...segmentation.polygons];
    updatedPolygons[polygonIndex] = {
      ...polygon,
      points: newPoints1
    };
    
    setSegmentation({
      ...segmentation,
      polygons: updatedPolygons
    });
    
    // Notify success
    toast.success("Point sequence added successfully");
    
    return true;
  }, [segmentation, setSegmentation, calculatePathLength]);

  return {
    addPointsToPolygon
  };
};
