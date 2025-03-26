
import { useCallback } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';

interface VertexDetectionProps {
  pointAddingMode: boolean;
  segmentation: SegmentationResult | null;
  selectedVertexIndex: number | null;
  sourcePolygonId: string | null;
  setHoveredSegment: (segment: {
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  }) => void;
  distance: (p1: Point, p2: Point) => number;
}

/**
 * Hook pro detekci vrcholů polygonu při pohybu kurzoru
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
   * Detekce vrcholů pod kurzorem
   */
  const detectVertexUnderCursor = useCallback((x: number, y: number) => {
    if (!pointAddingMode || !segmentation) return;
    
    const cursorPoint = { x, y };
    
    // Kontrola vrcholů na všech polygonech
    for (const polygon of segmentation.polygons) {
      const points = polygon.points;
      
      // Pokud již byl vybrán počáteční vrchol
      if (selectedVertexIndex !== null && sourcePolygonId !== null) {
        // Zvýrazňujeme pouze vrcholy stejného polygonu
        if (polygon.id !== sourcePolygonId) continue;
        
        // Přeskočíme zvýraznění počátečního vrcholu
        for (let i = 0; i < points.length; i++) {
          if (i === selectedVertexIndex) continue;
          
          const point = points[i];
          if (distance(cursorPoint, point) < 15) {
            setHoveredSegment({
              polygonId: polygon.id,
              segmentIndex: i,
              projectedPoint: point
            });
            return;
          }
        }
      } else {
        // Pokud ještě nebyl vybrán počáteční vrchol, hledáme na všech polygonech
        for (let i = 0; i < points.length; i++) {
          const point = points[i];
          const dist = distance(cursorPoint, point);
          
          if (dist < 15) {
            setHoveredSegment({
              polygonId: polygon.id,
              segmentIndex: i,
              projectedPoint: point
            });
            return;
          }
        }
      }
    }
    
    // Pokud není blízko žádný vrchol, nastavíme projectedPoint na pozici kurzoru
    // To pomáhá s vykreslením dočasné čáry
    setHoveredSegment({
      polygonId: null,
      segmentIndex: null,
      projectedPoint: cursorPoint
    });
  }, [pointAddingMode, segmentation, selectedVertexIndex, sourcePolygonId, distance, setHoveredSegment]);

  return { detectVertexUnderCursor };
};
