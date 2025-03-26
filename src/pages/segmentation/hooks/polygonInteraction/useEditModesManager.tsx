
import { usePolygonEditMode } from './usePolygonEditMode';
import { useCoordinateTransform } from './useCoordinateTransform';
import { useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';

/**
 * Hook pro správu režimů editace polygonů
 */
export const useEditModesManager = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null,
  zoom: number,
  offset: { x: number; y: number }
) => {
  // Režimy editace polygonů
  const polygonEditMode = usePolygonEditMode(
    segmentation,
    setSegmentation,
    selectedPolygonId,
    zoom,
    offset
  );
  
  // Transformace souřadnic
  const { getImageCoordinates } = useCoordinateTransform(zoom, offset);
  
  // Je aktivní nějaký editační režim?
  const isAnyEditModeActive = 
    polygonEditMode.editMode || 
    polygonEditMode.slicingMode || 
    polygonEditMode.pointAddingMode;
  
  // Transformace souřadnic při kliknutí
  const handleEditModeClick = useCallback((x: number, y: number) => {
    console.log("handleEditModeClick called with image coordinates:", x, y);
    return polygonEditMode.handleEditModeClick(x, y);
  }, [polygonEditMode]);
  
  // Transformace souřadnic při pohybu myši
  const handleEditMouseMove = useCallback((x: number, y: number) => {
    return polygonEditMode.handleEditMouseMove(x, y);
  }, [polygonEditMode]);

  return {
    ...polygonEditMode,
    isAnyEditModeActive,
    handleEditModeClick,
    handleEditMouseMove,
  };
};
