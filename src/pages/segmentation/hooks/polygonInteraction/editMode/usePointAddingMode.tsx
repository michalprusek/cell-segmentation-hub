
import { useState, useCallback } from 'react';
import { Point, SegmentationResult } from '@/lib/segmentation';
import { usePointEditor } from '../geometry/usePointEditor';
import { toast } from 'sonner';

/**
 * Hook pro režim přidávání bodů do polygonu
 */
export const usePointAddingMode = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null
) => {
  const [pointAddingMode, setPointAddingMode] = useState(false);
  const [hoveredSegment, setHoveredSegment] = useState<{
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  }>({
    polygonId: null,
    segmentIndex: null,
    projectedPoint: null
  });
  
  const { findClosestSegment, calculateInsertPosition, addPoint } = usePointEditor(
    segmentation,
    setSegmentation
  );
  
  /**
   * Přepínání režimu přidávání bodů
   */
  const togglePointAddingMode = useCallback(() => {
    setPointAddingMode(prev => !prev);
    setHoveredSegment({
      polygonId: null,
      segmentIndex: null,
      projectedPoint: null
    });
  }, []);
  
  /**
   * Detekce segmentu pod kurzorem
   */
  const detectSegmentUnderCursor = useCallback((x: number, y: number): boolean => {
    if (!pointAddingMode || !segmentation || !selectedPolygonId) return false;
    
    const polygon = segmentation.polygons.find(p => p.id === selectedPolygonId);
    if (!polygon) return false;
    
    const cursorPoint = { x, y };
    const closestSegment = findClosestSegment(cursorPoint, polygon.points, 15); // threshold 15px
    
    if (closestSegment) {
      const segmentIndex = closestSegment.segmentIndex;
      const a = polygon.points[segmentIndex];
      const b = polygon.points[(segmentIndex + 1) % polygon.points.length];
      
      // Vypočítáme pozici pro vložení bodu na segment
      const projectedPoint = calculateInsertPosition(a, b, cursorPoint);
      
      setHoveredSegment({
        polygonId: selectedPolygonId,
        segmentIndex,
        projectedPoint
      });
      
      return true;
    } else {
      setHoveredSegment({
        polygonId: null,
        segmentIndex: null,
        projectedPoint: null
      });
      
      return false;
    }
  }, [
    pointAddingMode,
    segmentation,
    selectedPolygonId,
    findClosestSegment,
    calculateInsertPosition
  ]);

  /**
   * Zpracování kliknutí v režimu přidávání bodů
   */
  const handlePointAddingClick = useCallback((x: number, y: number): boolean => {
    if (!pointAddingMode || !segmentation || !selectedPolygonId) return false;
    
    // Aktualizujeme detekci segmentu před kliknutím
    if (detectSegmentUnderCursor(x, y) && 
        hoveredSegment.polygonId && 
        hoveredSegment.segmentIndex !== null && 
        hoveredSegment.projectedPoint) {
      
      const success = addPoint(
        hoveredSegment.polygonId,
        hoveredSegment.segmentIndex,
        hoveredSegment.projectedPoint
      );
      
      if (success) {
        toast.success("Bod byl přidán do polygonu");
        return true;
      } else {
        toast.error("Přidání bodu selhalo");
      }
    }
    
    return false;
  }, [
    pointAddingMode,
    segmentation,
    selectedPolygonId,
    hoveredSegment,
    detectSegmentUnderCursor,
    addPoint
  ]);

  return {
    pointAddingMode,
    hoveredSegment,
    togglePointAddingMode,
    detectSegmentUnderCursor,
    handlePointAddingClick
  };
};
