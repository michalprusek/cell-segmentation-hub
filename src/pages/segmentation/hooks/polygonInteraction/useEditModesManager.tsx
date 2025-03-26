
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
  
  // Zpracování kliknutí v editačním režimu
  const handleEditModeClick = useCallback((x: number, y: number) => {
    const containerElement = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
    if (!containerElement) return false;
    
    const rect = containerElement.getBoundingClientRect();
    
    // Log přesných souřadnic pro debugging
    console.log(`handleEditModeClick: Input coordinates: (${x}, ${y})`);
    console.log(`Current transform: zoom=${zoom}, offset=(${offset.x}, ${offset.y})`);
    
    // Souřadnice jsou již v prostoru obrazu, předáme je přímo
    return polygonEditMode.handleEditModeClick(x, y);
  }, [polygonEditMode, zoom, offset]);
  
  // Zpracování pohybu myši v editačním režimu
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
