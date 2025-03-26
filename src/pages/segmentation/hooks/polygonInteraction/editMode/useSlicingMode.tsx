import { useState, useCallback } from 'react';
import { Point, SegmentationResult } from '@/lib/segmentation';
import { usePolygonSplitter } from '../geometry/usePolygonSplitter';
import { toast } from 'sonner';

/**
 * Hook pro režim rozdělování polygonů (slicing)
 */
export const useSlicingMode = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null
) => {
  const [slicingMode, setSlicingMode] = useState(false);
  const [sliceStartPoint, setSliceStartPoint] = useState<Point | null>(null);
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);
  
  const { splitPolygon, splitIntoTwoPolygons } = usePolygonSplitter(
    segmentation,
    setSegmentation
  );
  
  /**
   * Přepínání režimu rozdělování
   */
  const toggleSlicingMode = useCallback(() => {
    setSlicingMode(prev => !prev);
    setSliceStartPoint(null);
    setCursorPosition(null);
  }, []);
  
  /**
   * Reset stavu slicingu
   */
  const resetSlicing = useCallback(() => {
    setSliceStartPoint(null);
    setCursorPosition(null);
  }, []);

  /**
   * Zpracování kliknutí v režimu rozdělování
   */
  const handleSlicingClick = useCallback((x: number, y: number): boolean => {
    if (!slicingMode || !segmentation || !selectedPolygonId) {
      toast.error("Vyberte polygon a aktivujte režim rozdělování");
      return false;
    }
    
    const clickPoint = { x, y };
    
    // Pokud nemáme počáteční bod, nastavíme ho
    if (!sliceStartPoint) {
      setSliceStartPoint(clickPoint);
      return true;
    }
    
    // Pokud máme počáteční bod, dokončíme řezací linii
    const sliceOperation = {
      polygonId: selectedPolygonId,
      startPoint: sliceStartPoint,
      endPoint: clickPoint
    };
    
    // Always split into two polygons (changed from the original behavior)
    const success = splitIntoTwoPolygons(sliceOperation);
    
    if (success) {
      toast.success("Polygon byl rozdělen na dva samostatné polygony");
    } else {
      toast.error("Rozdělení polygonu selhalo");
    }
    
    // Reset stavu po dokončení operace
    resetSlicing();
    
    // Keep slicing mode active after the operation, don't exit
    return true;
  }, [
    slicingMode,
    segmentation,
    selectedPolygonId,
    sliceStartPoint,
    splitIntoTwoPolygons,
    resetSlicing
  ]);
  
  /**
   * Aktualizace pozice kurzoru
   */
  const updateCursorPosition = useCallback((x: number, y: number) => {
    if (slicingMode) {
      setCursorPosition({ x, y });
    }
  }, [slicingMode]);

  return {
    slicingMode,
    sliceStartPoint,
    cursorPosition,
    toggleSlicingMode,
    handleSlicingClick,
    updateCursorPosition,
    resetSlicing
  };
};
