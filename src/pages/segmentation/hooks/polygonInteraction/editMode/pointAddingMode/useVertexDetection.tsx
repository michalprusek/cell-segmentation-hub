
import { useCallback } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { useGeometryUtils } from '../useGeometryUtils';

interface VertexDetectionProps {
  pointAddingMode: boolean;
  segmentation: SegmentationResult | null;
  selectedVertexIndex: number | null;
  sourcePolygonId: string | null;
  setHoveredSegment: (state: { 
    polygonId: string | null, 
    segmentIndex: number | null, 
    projectedPoint: Point | null 
  }) => void;
  distance: (p1: Point, p2: Point) => number;
}

/**
 * Hook pro detekci vrcholů polygonů v režimu přidávání bodů
 */
export const useVertexDetection = ({
  pointAddingMode,
  segmentation,
  selectedVertexIndex,
  sourcePolygonId,
  setHoveredSegment,
  distance
}: VertexDetectionProps) => {
  
  /**
   * Detekce vrcholu pod kurzorem
   */
  const detectVertexUnderCursor = useCallback((x: number, y: number) => {
    if (!pointAddingMode || !segmentation) return;
    
    const mousePoint = { x, y };
    const DETECTION_THRESHOLD = 15; // vzdálenost detekce
    
    // Hledáme ve vybraném polygonu
    const polygon = segmentation.polygons.find(p => p.id === sourcePolygonId);
    if (!polygon) {
      setHoveredSegment({ polygonId: null, segmentIndex: null, projectedPoint: null });
      return;
    }
    
    // Procházíme každý vrchol polygonu a hledáme nejbližší
    let closestDistance = Infinity;
    let closestVertexIndex = -1;
    
    polygon.points.forEach((point, index) => {
      // Přeskočíme aktuálně vybraný vrchol
      if (index === selectedVertexIndex) return;
      
      const dist = distance(point, mousePoint);
      if (dist < closestDistance) {
        closestDistance = dist;
        closestVertexIndex = index;
      }
    });
    
    // Pokud jsme našli vrchol v rozsahu detekce
    if (closestDistance < DETECTION_THRESHOLD) {
      setHoveredSegment({
        polygonId: sourcePolygonId,
        segmentIndex: closestVertexIndex,
        projectedPoint: polygon.points[closestVertexIndex]
      });
    } else {
      // Žádný vrchol není v blízkosti kurzoru
      setHoveredSegment({
        polygonId: null,
        segmentIndex: null,
        projectedPoint: mousePoint  // Nastavíme aktuální pozici kurzoru
      });
    }
  }, [
    pointAddingMode, 
    segmentation, 
    sourcePolygonId, 
    selectedVertexIndex, 
    setHoveredSegment, 
    distance
  ]);

  return { detectVertexUnderCursor };
};
