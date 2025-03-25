
import { useState, useCallback } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { useTempPoints } from './useTempPoints';
import { usePathModification } from './usePathModification';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';

/**
 * Hook for managing the edit mode of the polygon editor
 */
export const useEditModeCore = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null,
  zoom: number = 1,
  offset: { x: number; y: number } = { x: 0, y: 0 }
) => {
  const [editMode, setEditMode] = useState(false);
  const { 
    tempPoints, 
    setTempPoints, 
    cursorPosition, 
    resetTempPoints,
    addPointToTemp,
    isShiftPressed
  } = useTempPoints(editMode, zoom, offset);
  
  const { addPointsToPolygon } = usePathModification(segmentation, setSegmentation);
  
  /**
   * Toggle edit mode on/off
   */
  const toggleEditMode = useCallback(() => {
    if (editMode) {
      resetTempPoints();
    }
    setEditMode(!editMode);
  }, [editMode, resetTempPoints]);

  /**
   * Handle click in edit mode - add point to tempPoints or complete polygon
   */
  const handleEditModeClick = useCallback((x: number, y: number): boolean => {
    if (!editMode) return false;

    const point = { x, y };
    const points = tempPoints.points;
    
    // If we already have points and clicked near the first point, complete the polygon
    if (points.length > 2) {
      const firstPoint = points[0];
      const distance = Math.sqrt(Math.pow(point.x - firstPoint.x, 2) + Math.pow(point.y - firstPoint.y, 2));
      
      if (distance < 10) {
        // Complete polygon
        if (points.length < 3) {
          toast.error("Polygon must have at least 3 points");
          return false;
        }
        
        // If tempPoints has startIndex, endIndex, and polygonId, we're adding to existing polygon
        if (tempPoints.startIndex !== null && tempPoints.endIndex !== null && tempPoints.polygonId) {
          // Add points to existing polygon
          const success = addPointsToPolygon(
            tempPoints.polygonId,
            tempPoints.startIndex,
            tempPoints.endIndex,
            [
              segmentation?.polygons.find(p => p.id === tempPoints.polygonId)?.points[tempPoints.startIndex!],
              ...points,
              segmentation?.polygons.find(p => p.id === tempPoints.polygonId)?.points[tempPoints.endIndex!]
            ]
          );
          
          if (success) {
            resetTempPoints();
            return true;
          }
        } else {
          // Create new polygon
          if (!segmentation) return false;
          
          const newPolygon = {
            id: uuidv4(),
            points: [...points],
            type: "manual", // or any other type you want
            class: "default" // or any default class
          };
          
          setSegmentation({
            ...segmentation,
            polygons: [...segmentation.polygons, newPolygon]
          });
          
          toast.success("New polygon created");
          resetTempPoints();
          return true;
        }
      }
    }
    
    // Add point to temporary points
    addPointToTemp(point);
    return true;
  }, [editMode, tempPoints, segmentation, setSegmentation, addPointsToPolygon, resetTempPoints, addPointToTemp]);

  return {
    editMode,
    tempPoints,
    cursorPosition,
    isShiftPressed,
    toggleEditMode,
    handleEditModeClick,
    resetTempPoints,
    setTempPoints,
    addPointToTemp
  };
};
