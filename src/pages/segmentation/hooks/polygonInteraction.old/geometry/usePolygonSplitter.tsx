import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Point, SegmentationResult } from '@/lib/segmentation';
import { useGeometryUtils } from '../editMode/useGeometryUtils';
import { intersectionUtils } from './utils/intersectionUtils';
import { sliceValidator } from './utils/sliceValidator';
import { polygonSplitUtils, SliceOperation } from './utils/polygonSplitter';
import { toast } from 'sonner';

/**
 * Hook pro implementaci rozdělení polygonu (slicing)
 */
export const usePolygonSplitter = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void
) => {
  const { calculatePathLength, isLineIntersectingItself } = useGeometryUtils();

  /**
   * Rozdělení polygonu podle řezací linie
   */
  const splitPolygon = useCallback((
    operation: SliceOperation
  ): boolean => {
    if (!segmentation) return false;
    
    const { polygonId, startPoint, endPoint } = operation;
    const polygon = segmentation.polygons.find(p => p.id === polygonId);
    
    if (!polygon) return false;
    
    // Validate slice line
    const { isValid, intersections, message } = sliceValidator.validateSliceLine(
      polygon.points,
      [startPoint, endPoint],
      isLineIntersectingItself
    );
    
    if (!isValid) {
      console.error(message);
      return false;
    }
    
    // Split polygon into two paths
    const { poly1Points, poly2Points } = polygonSplitUtils.splitPolygonPaths(
      polygon.points,
      intersections
    );
    
    // Calculate scores for both potential polygons
    const score1 = polygonSplitUtils.calculatePolygonScore(
      poly1Points,
      intersectionUtils.calculatePolygonArea,
      calculatePathLength
    );
    
    const score2 = polygonSplitUtils.calculatePolygonScore(
      poly2Points,
      intersectionUtils.calculatePolygonArea,
      calculatePathLength
    );
    
    // Keep the polygon with higher score
    const newPolygonPoints = score1 > score2 ? poly1Points : poly2Points;
    
    // Update the polygon
    const updatedPolygons = segmentation.polygons.map(p => {
      if (p.id === polygonId) {
        return {
          ...p,
          points: newPolygonPoints
        };
      }
      return p;
    });
    
    setSegmentation({
      ...segmentation,
      polygons: updatedPolygons
    });
    
    return true;
  }, [segmentation, setSegmentation, isLineIntersectingItself, calculatePathLength]);

  /**
   * Rozdělení polygonu na dva samostatné polygony
   */
  const splitIntoTwoPolygons = useCallback((
    operation: SliceOperation
  ): boolean => {
    if (!segmentation) return false;
    
    const { polygonId, startPoint, endPoint } = operation;
    const polygon = segmentation.polygons.find(p => p.id === polygonId);
    
    if (!polygon) return false;
    
    // Validate the slice line
    const { isValid, intersections, message } = sliceValidator.validateSliceLine(
      polygon.points,
      [startPoint, endPoint],
      isLineIntersectingItself
    );
    
    if (!isValid) {
      console.error(message);
      return false;
    }
    
    // Split the polygon into two paths
    const { poly1Points, poly2Points } = polygonSplitUtils.splitPolygonPaths(
      polygon.points,
      intersections
    );
    
    // Ensure both polygons have at least 3 points
    if (poly1Points.length < 3 || poly2Points.length < 3) {
      toast.error("Výsledné polygony by byly příliš malé");
      return false;
    }
    
    // Create a new ID for the second polygon
    const newPolygonId = uuidv4();
    
    // Update the first polygon and add the second
    const updatedPolygons = segmentation.polygons.map(p => {
      if (p.id === polygonId) {
        return {
          ...p,
          points: poly1Points
        };
      }
      return p;
    });
    
    // Add the second polygon
    updatedPolygons.push({
      ...polygon,
      id: newPolygonId,
      points: poly2Points
    });
    
    setSegmentation({
      ...segmentation,
      polygons: updatedPolygons
    });
    
    return true;
  }, [segmentation, setSegmentation, isLineIntersectingItself]);

  return {
    calculateIntersections: intersectionUtils.calculateIntersections,
    validateSliceLine: (polygonPoints: Point[], line: [Point, Point]) => 
      sliceValidator.validateSliceLine(polygonPoints, line, isLineIntersectingItself),
    splitPolygon,
    splitIntoTwoPolygons
  };
};
