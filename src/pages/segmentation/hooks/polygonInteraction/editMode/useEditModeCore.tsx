
import { useState, useCallback } from 'react';
import { Point, SegmentationResult } from '@/lib/segmentation';
import { useGeometryUtils } from './useGeometryUtils';
import { useTempPoints } from './useTempPoints';
import { usePathModification } from './usePathModification';

/**
 * Core hook for managing polygon edit mode
 */
export const useEditModeCore = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null
) => {
  const [editMode, setEditMode] = useState(false);
  const { isNearPoint } = useGeometryUtils();
  const { addPointsToPolygon } = usePathModification(segmentation, setSegmentation);
  const { tempPoints, setTempPoints, cursorPosition, resetTempPoints } = useTempPoints(editMode);

  /**
   * Toggle edit mode
   */
  const toggleEditMode = useCallback(() => {
    if (editMode) {
      resetTempPoints();
    }
    setEditMode(!editMode);
  }, [editMode, resetTempPoints]);

  /**
   * Handle click in edit mode
   */
  const handleEditModeClick = useCallback((x: number, y: number) => {
    if (!editMode || !segmentation) return;

    const clickPoint = { x, y };
    
    // Find the polygon we're working with
    const polygonId = tempPoints.polygonId || selectedPolygonId;
    if (!polygonId) return;
    
    const polygon = segmentation.polygons.find(p => p.id === polygonId);
    if (!polygon) return;
    
    // Check if we're clicking on a vertex of the same polygon
    for (let i = 0; i < polygon.points.length; i++) {
      const point = polygon.points[i];
      
      if (isNearPoint(clickPoint, point, 10)) { // Adjust threshold based on zoom
        // If this is the first point, start a new sequence
        if (tempPoints.points.length === 0) {
          console.log("Starting new point sequence at vertex", i);
          setTempPoints({
            points: [{ x: point.x, y: point.y }],
            startIndex: i,
            endIndex: null,
            polygonId
          });
          return;
        } 
        // If we have a sequence and click on a different vertex, close the sequence
        else if (tempPoints.startIndex !== null && i !== tempPoints.startIndex) {
          console.log("Ending point sequence at vertex", i);
          const newPoints = [...tempPoints.points, { x: point.x, y: point.y }];
          
          // Add the points to the polygon
          const success = addPointsToPolygon(polygonId, tempPoints.startIndex, i, newPoints);
          if (success) {
            // Reset temp points and exit edit mode
            resetTempPoints();
            setEditMode(false);
          }
          return;
        }
      }
    }
    
    // If we're not clicking on a vertex but have started a sequence, add a new point
    if (tempPoints.points.length > 0 && tempPoints.startIndex !== null) {
      console.log("Adding point to sequence", clickPoint);
      setTempPoints({
        ...tempPoints,
        points: [...tempPoints.points, clickPoint]
      });
    }
  }, [
    editMode, 
    segmentation, 
    tempPoints, 
    selectedPolygonId, 
    isNearPoint, 
    addPointsToPolygon, 
    setTempPoints, 
    resetTempPoints
  ]);

  return {
    editMode,
    tempPoints,
    cursorPosition,
    toggleEditMode,
    handleEditModeClick
  };
};
