
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
    if (!slicingMode || !segmentation || !selectedPolygonId) return false;
    
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
    
    // Vybrat typ operace (s nebo bez klávesy Shift)
    let success: boolean;
    if (window.event && (window.event as any).shiftKey) {
      // S klávesou Shift rozdělíme na dva samostatné polygony
      success = splitIntoTwoPolygons(sliceOperation);
      if (success) {
        toast.success("Polygon byl rozdělen na dva samostatné polygony");
      } else {
        toast.error("Rozdělení polygonu selhalo");
      }
    } else {
      // Bez klávesy Shift odřízneme část polygonu
      success = splitPolygon(sliceOperation);
      if (success) {
        toast.success("Část polygonu byla odříznuta");
      } else {
        toast.error("Oříznutí polygonu selhalo");
      }
    }
    
    // Reset stavu po dokončení operace
    resetSlicing();
    if (success) {
      setSlicingMode(false);
    }
    
    return true;
  }, [
    slicingMode,
    segmentation,
    selectedPolygonId,
    sliceStartPoint,
    splitPolygon,
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
