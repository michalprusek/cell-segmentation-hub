
import { useCallback } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { v4 as uuidv4 } from 'uuid';

/**
 * Hook for modifying polygon paths (adding/removing points)
 */
export const usePathModification = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void
) => {
  /**
   * Add points to polygon between two vertices
   */
  const addPointsToPolygon = useCallback((
    polygonId: string,
    startVertexIndex: number,
    endVertexIndex: number,
    points: Point[]
  ): boolean => {
    if (!segmentation) return false;
    
    // Find target polygon
    const polygonIndex = segmentation.polygons.findIndex(p => p.id === polygonId);
    if (polygonIndex === -1) return false;
    
    const polygon = segmentation.polygons[polygonIndex];
    
    try {
      // Create new array of points with inserted sequence
      const newPolygon = { ...polygon };
      
      // We need to create a new array of points that includes our new points
      // between the start and end vertices. The logic depends on the order of indices.
      const totalPoints = polygon.points.length;
      
      // Get points before start
      const pointsBefore = polygon.points.slice(0, startVertexIndex + 1);
      
      // Get points after end (or wrap around)
      let pointsAfter;
      if (endVertexIndex < startVertexIndex) {
        // Handle wrap around
        pointsAfter = polygon.points.slice(endVertexIndex);
      } else {
        // Normal case
        pointsAfter = polygon.points.slice(endVertexIndex);
      }
      
      // New points (excluding first and last which are already in the polygon)
      const newPoints = points.slice(0, -1);
      
      // Create complete new points array
      if (endVertexIndex > startVertexIndex) {
        // Normal case
        newPolygon.points = [
          ...pointsBefore,
          ...newPoints,
          ...pointsAfter
        ];
      } else {
        // Wrap around case
        newPolygon.points = [
          ...pointsBefore,
          ...newPoints,
          ...pointsAfter
        ];
      }
      
      // Create new polygons array
      const newPolygons = [...segmentation.polygons];
      newPolygons[polygonIndex] = newPolygon;
      
      // Update segmentation
      setSegmentation({
        ...segmentation,
        polygons: newPolygons
      });
      
      return true;
    } catch (error) {
      console.error('Error adding points to polygon:', error);
      return false;
    }
  }, [segmentation, setSegmentation]);

  /**
   * Modify polygon path by replacing a segment between two points with a new path
   */
  const modifyPolygonPath = useCallback((
    polygonId: string,
    startIndex: number,
    endIndex: number,
    newPoints: Point[]
  ): boolean => {
    if (!segmentation) return false;
    
    try {
      // Find target polygon
      const polygonIndex = segmentation.polygons.findIndex(p => p.id === polygonId);
      if (polygonIndex === -1) return false;
      
      const polygon = segmentation.polygons[polygonIndex];
      const totalPoints = polygon.points.length;
      
      // Create a new array of points
      let newPolygonPoints: Point[] = [];
      
      // Include points up to the start index
      newPolygonPoints.push(...polygon.points.slice(0, startIndex + 1));
      
      // Include the new points
      newPolygonPoints.push(...newPoints);
      
      // Include the end point and points after it
      if (endIndex < startIndex) {
        // Handle wrap around
        newPolygonPoints.push(...polygon.points.slice(endIndex));
      } else {
        // Normal case
        newPolygonPoints.push(polygon.points[endIndex]);
        newPolygonPoints.push(...polygon.points.slice(endIndex + 1));
      }
      
      // Create new polygon object
      const newPolygon = {
        ...polygon,
        points: newPolygonPoints
      };
      
      // Create new polygons array
      const newPolygons = [...segmentation.polygons];
      newPolygons[polygonIndex] = newPolygon;
      
      // Update segmentation
      setSegmentation({
        ...segmentation,
        polygons: newPolygons
      });
      
      return true;
    } catch (error) {
      console.error('Error modifying polygon path:', error);
      return false;
    }
  }, [segmentation, setSegmentation]);

  return {
    addPointsToPolygon,
    modifyPolygonPath
  };
};
