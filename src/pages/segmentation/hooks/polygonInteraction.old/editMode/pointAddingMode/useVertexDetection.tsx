
import { useCallback } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';

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
    if (!pointAddingMode || !segmentation) {
      setHoveredSegment({ polygonId: null, segmentIndex: null, projectedPoint: null });
      return;
    }
    
    const mousePoint = { x, y };
    const DETECTION_THRESHOLD = 15; // vzdálenost detekce v pixelech
    
    // Pokud nemáme vybraný žádný počáteční bod, umožníme kliknout na libovolný bod
    if (selectedVertexIndex === null || sourcePolygonId === null) {
      // Procházíme všechny polygony a hledáme nejbližší bod
      let closestDistance = Infinity;
      let closestPolygonId = null;
      let closestVertexIndex = null;
      
      segmentation.polygons.forEach(polygon => {
        polygon.points.forEach((point, index) => {
          const dist = distance(point, mousePoint);
          if (dist < closestDistance && dist < DETECTION_THRESHOLD) {
            closestDistance = dist;
            closestPolygonId = polygon.id;
            closestVertexIndex = index;
          }
        });
      });
      
      if (closestPolygonId && closestVertexIndex !== null) {
        const polygon = segmentation.polygons.find(p => p.id === closestPolygonId);
        setHoveredSegment({
          polygonId: closestPolygonId,
          segmentIndex: closestVertexIndex,
          projectedPoint: polygon?.points[closestVertexIndex] || null
        });
      } else {
        setHoveredSegment({
          polygonId: null,
          segmentIndex: null,
          projectedPoint: mousePoint
        });
      }
    } 
    // Máme vybraný počáteční bod, hledáme body pouze ve stejném polygonu
    else {
      const polygon = segmentation.polygons.find(p => p.id === sourcePolygonId);
      
      if (!polygon) {
        setHoveredSegment({ polygonId: null, segmentIndex: null, projectedPoint: mousePoint });
        return;
      }
      
      // Procházíme každý vrchol polygonu a hledáme nejbližší
      let closestDistance = Infinity;
      let closestVertexIndex = null;
      
      polygon.points.forEach((point, index) => {
        // Přeskočíme aktuálně vybraný vrchol
        if (index === selectedVertexIndex) return;
        
        const dist = distance(point, mousePoint);
        if (dist < closestDistance && dist < DETECTION_THRESHOLD) {
          closestDistance = dist;
          closestVertexIndex = index;
        }
      });
      
      // Pokud jsme našli vrchol v rozsahu detekce
      if (closestVertexIndex !== null) {
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
