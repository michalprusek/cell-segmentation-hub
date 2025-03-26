
import { useState, useCallback } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { toast } from 'sonner';
import { usePolygonSplitter } from '../geometry/usePolygonSplitter';

/**
 * Hook for polygon slicing mode
 */
export const useSlicingMode = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null
) => {
  const [slicingMode, setSlicingMode] = useState(false);
  const [sliceStartPoint, setSliceStartPoint] = useState<Point | null>(null);
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);
  
  const { splitIntoTwoPolygons } = usePolygonSplitter(segmentation, setSegmentation);
  
  /**
   * Toggle slicing mode on/off
   */
  const toggleSlicingMode = useCallback(() => {
    setSlicingMode(prev => !prev);
    setSliceStartPoint(null);
    setCursorPosition(null);
  }, []);
  
  /**
   * Update cursor position for slicing mode
   */
  const updateCursorPosition = useCallback((x: number, y: number) => {
    if (!slicingMode) return;
    setCursorPosition({ x, y });
  }, [slicingMode]);
  
  /**
   * Handle clicks in slicing mode
   */
  const handleSlicingClick = useCallback((x: number, y: number): boolean => {
    if (!slicingMode || !selectedPolygonId) return false;
    
    const clickPoint = { x, y };
    
    // First click - set start point
    if (!sliceStartPoint) {
      setSliceStartPoint(clickPoint);
      return true;
    }
    
    // Second click - complete slice and split into two polygons
    const success = splitIntoTwoPolygons({
      polygonId: selectedPolygonId,
      startPoint: sliceStartPoint,
      endPoint: clickPoint
    });
    
    if (success) {
      toast.success("Polygon byl úspěšně rozdělen na dva");
      // Reset state and exit slicing mode automatically
      setSliceStartPoint(null);
      setSlicingMode(false);
    } else {
      toast.error("Rozdělení polygonu selhalo");
      setSliceStartPoint(null);
    }
    
    return true;
  }, [slicingMode, selectedPolygonId, sliceStartPoint, splitIntoTwoPolygons]);

  return {
    slicingMode,
    sliceStartPoint,
    cursorPosition,
    toggleSlicingMode,
    handleSlicingClick,
    updateCursorPosition,
    setSlicingMode // Export this to allow other components to directly change slicing mode
  };
};
