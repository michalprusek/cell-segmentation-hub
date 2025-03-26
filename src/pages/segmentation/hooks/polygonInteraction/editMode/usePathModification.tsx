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
      
      // Handle special case for consecutive points
      if ((endIndex === (startIndex + 1) % totalPoints) || 
          (startIndex === (endIndex + 1) % totalPoints)) {
        // Simple replacement - just insert our new points between the start and end vertices
        const pointsBeforeStart = polygon.points.slice(0, Math.min(startIndex, endIndex) + 1);
        const pointsAfterEnd = polygon.points.slice(Math.max(startIndex, endIndex));
        
        if (startIndex < endIndex) {
          newPolygonPoints = [
            ...pointsBeforeStart,
            ...newPoints,
            ...pointsAfterEnd
          ];
        } else {
          // The path goes backward, so we need to reverse order
          newPolygonPoints = [
            ...pointsAfterEnd,
            ...newPoints,
            ...pointsBeforeStart
          ];
        }
      } else {
        // Find the path indices in order
        let pathIndices: number[] = [];
        if (startIndex < endIndex) {
          // Forward path
          for (let i = startIndex; i <= endIndex; i++) {
            pathIndices.push(i);
          }
        } else {
          // Handle wrap around - two possible paths
          // Path 1: Going forward over the zero index
          let path1: number[] = [];
          for (let i = startIndex; i < totalPoints; i++) {
            path1.push(i);
          }
          for (let i = 0; i <= endIndex; i++) {
            path1.push(i);
          }
          
          // Path 2: Going backward
          let path2: number[] = [];
          for (let i = startIndex; i >= endIndex; i--) {
            path2.push(i);
          }
          
          // Use the shorter path
          pathIndices = path1.length <= path2.length ? path1 : path2;
        }
        
        // Identify the points to keep (those not in the path)
        const pointsToRemove = new Set(pathIndices);
        let keptPoints: Point[] = [];
        for (let i = 0; i < totalPoints; i++) {
          if (!pointsToRemove.has(i) || i === startIndex || i === endIndex) {
            keptPoints.push(polygon.points[i]);
          }
        }
        
        // Find where to insert our new points
        const startPoint = polygon.points[startIndex];
        const endPoint = polygon.points[endIndex];
        
        // Insert the new points between start and end in kept points
        const startInsertIndex = keptPoints.findIndex(p => 
          p.x === startPoint.x && p.y === startPoint.y);
        
        if (startInsertIndex >= 0) {
          newPolygonPoints = [
            ...keptPoints.slice(0, startInsertIndex + 1),
            ...newPoints,
            ...keptPoints.slice(startInsertIndex + 1)
          ];
        } else {
          // Fallback in case something went wrong
          newPolygonPoints = [
            polygon.points[startIndex],
            ...newPoints,
            polygon.points[endIndex],
            ...polygon.points.filter((_, i) => 
              i !== startIndex && i !== endIndex && !pathIndices.includes(i))
          ];
        }
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
