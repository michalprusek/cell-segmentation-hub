import { useCallback } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/useLanguage';
// import { getLocalizedErrorMessage } from '@/lib/errorUtils';
import { Point, Polygon } from '@/lib/segmentation';
import { slicePolygon, validateSliceLine } from '@/lib/polygonSlicing';
import { EditMode, InteractionState } from '../types';

interface UsePolygonSlicingProps {
  polygons: Polygon[];
  selectedPolygonId: string | null;
  tempPoints: Point[];
  interactionState: InteractionState;

  // State setters
  setSelectedPolygonId: (id: string | null) => void;
  setTempPoints: (points: Point[]) => void;
  setInteractionState: (state: InteractionState) => void;
  setEditMode: (mode: EditMode) => void;

  // Data operations
  updatePolygons: (polygons: Polygon[]) => void;
}

/**
 * Hook for handling polygon slicing functionality
 * Inspired by SpheroSeg implementation
 */
export const usePolygonSlicing = ({
  polygons,
  selectedPolygonId,
  tempPoints,
  interactionState,
  setSelectedPolygonId,
  setTempPoints,
  setInteractionState,
  setEditMode,
  updatePolygons,
}: UsePolygonSlicingProps) => {
  const { t } = useLanguage();

  /**
   * Handle slice action when two points have been selected
   */
  const handleSliceAction = useCallback(
    (providedTempPoints?: Point[]) => {
      const pointsToUse = providedTempPoints || tempPoints;

      if (!selectedPolygonId || pointsToUse.length !== 2) {
        // Invalid state: missing polygon ID or incorrect points count
        return false;
      }

      const polygon = polygons.find(p => p.id === selectedPolygonId);
      if (!polygon) {
        // Polygon not found error
        toast.error(t('segmentation.polygonNotFound') || 'Polygon not found');
        return false;
      }

      const [sliceStart, sliceEnd] = pointsToUse;

      // Attempting slice with points

      // Validate slice line
      const validation = validateSliceLine(polygon, sliceStart, sliceEnd);

      // Validation result obtained

      if (!validation.isValid) {
        // Show detailed error message to user
        const errorMessage = validation.reason
          ? `${t('segmentation.invalidSlice') || 'Invalid slice operation'}: ${validation.reason}`
          : t('segmentation.invalidSlice') || 'Invalid slice operation';

        // Validation failed
        toast.error(errorMessage);
        return false;
      }

      // Validation passed, performing slice

      // Perform the slice
      const result = slicePolygon(polygon, sliceStart, sliceEnd);

      if (result) {
        const [newPolygon1, newPolygon2] = result;

        // Slice successful - created two new polygons

        // Replace the original polygon with the two new ones
        const updatedPolygons = polygons.filter(
          p => p.id !== selectedPolygonId
        );
        updatedPolygons.push(newPolygon1, newPolygon2);

        updatePolygons(updatedPolygons);

        // Clear selection and reset state
        setSelectedPolygonId(null);
        setTempPoints([]);
        setInteractionState({
          ...interactionState,
          sliceStartPoint: null,
        });
        setEditMode(EditMode.View);

        toast.success(
          t('segmentation.sliceSuccess') || 'Polygon sliced successfully'
        );

        return true;
      } else {
        // Slice operation failed - slicePolygon returned null
        toast.error(t('segmentation.sliceFailed') || 'Failed to slice polygon');

        // Reset state on failure
        setTempPoints([]);
        setInteractionState({
          ...interactionState,
          sliceStartPoint: null,
        });

        return false;
      }
    },
    [
      selectedPolygonId,
      tempPoints,
      polygons,
      interactionState,
      updatePolygons,
      setSelectedPolygonId,
      setTempPoints,
      setInteractionState,
      setEditMode,
      t,
    ]
  );

  /**
   * Start slicing mode for a specific polygon
   */
  const startSlicing = useCallback(
    (polygonId: string) => {
      setSelectedPolygonId(polygonId);
      setEditMode(EditMode.Slice);
      setTempPoints([]);
      setInteractionState({
        ...interactionState,
        sliceStartPoint: null,
      });
    },
    [
      setSelectedPolygonId,
      setEditMode,
      setTempPoints,
      setInteractionState,
      interactionState,
    ]
  );

  /**
   * Cancel slicing operation
   */
  const cancelSlicing = useCallback(() => {
    setTempPoints([]);
    setInteractionState({
      ...interactionState,
      sliceStartPoint: null,
    });
    setEditMode(EditMode.View);
  }, [setTempPoints, setInteractionState, setEditMode, interactionState]);

  /**
   * Handle slice point placement
   */
  const handleSlicePointClick = useCallback(
    (point: Point) => {
      if (!selectedPolygonId) {
        return false;
      }

      const polygon = polygons.find(p => p.id === selectedPolygonId);
      if (!polygon) {
        return false;
      }

      if (tempPoints.length === 0) {
        // First point - set slice start
        setTempPoints([point]);
        setInteractionState({
          ...interactionState,
          sliceStartPoint: point,
        });
        return true;
      } else if (tempPoints.length === 1) {
        // Second point - set slice end and attempt slice
        const newTempPoints = [...tempPoints, point];
        setTempPoints(newTempPoints);

        // Pass the new temp points directly to avoid stale state issue
        handleSliceAction(newTempPoints);

        return true;
      }

      return false;
    },
    [
      selectedPolygonId,
      polygons,
      tempPoints,
      interactionState,
      setTempPoints,
      setInteractionState,
      handleSliceAction,
    ]
  );

  /**
   * Check if a polygon can be sliced with the current points
   */
  const canSlice = useCallback((): boolean => {
    if (!selectedPolygonId || tempPoints.length !== 2) {
      return false;
    }

    const polygon = polygons.find(p => p.id === selectedPolygonId);
    if (!polygon) {
      return false;
    }

    const [sliceStart, sliceEnd] = tempPoints;
    const validation = validateSliceLine(polygon, sliceStart, sliceEnd);

    return validation.isValid;
  }, [selectedPolygonId, tempPoints, polygons]);

  /**
   * Get slice preview information
   */
  const getSlicePreview = useCallback((): {
    isValid: boolean;
    reason?: string;
    intersectionCount?: number;
  } | null => {
    if (!selectedPolygonId || tempPoints.length !== 2) {
      return null;
    }

    const polygon = polygons.find(p => p.id === selectedPolygonId);
    if (!polygon) {
      return null;
    }

    const [sliceStart, sliceEnd] = tempPoints;
    return validateSliceLine(polygon, sliceStart, sliceEnd);
  }, [selectedPolygonId, tempPoints, polygons]);

  return {
    // Actions
    handleSliceAction,
    startSlicing,
    cancelSlicing,
    handleSlicePointClick,

    // State queries
    canSlice,
    getSlicePreview,

    // Current state
    isSlicing: tempPoints.length > 0,
    slicePointsCount: tempPoints.length,
    currentSlicePoints: tempPoints,
  };
};
