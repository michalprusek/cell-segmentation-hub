
import { useCallback } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { useSegmentFinder } from './useSegmentFinder';
import { toast } from 'sonner';

/**
 * Hook pro zjednodušení polygonů
 */
export const usePolygonSimplifier = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void
) => {
  const { distancePointToSegment } = useSegmentFinder();

  /**
   * Zjednodušení polygonu redukcí bodů
   */
  const simplifyPolygon = useCallback((
    polygonId: string,
    tolerance: number = 1.0
  ): boolean => {
    if (!segmentation) return false;
    
    const polygon = segmentation.polygons.find(p => p.id === polygonId);
    if (!polygon) return false;
    
    // Implementace Ramer-Douglas-Peucker algoritmu
    const simplifyPath = (points: Point[], start: number, end: number, tolerance: number): Point[] => {
      if (end - start <= 1) return [points[start], points[end]];
      
      let maxDistance = 0;
      let maxIndex = 0;
      
      const line = [points[start], points[end]];
      
      for (let i = start + 1; i < end; i++) {
        const dist = distancePointToSegment(points[i], line[0], line[1]);
        
        if (dist > maxDistance) {
          maxDistance = dist;
          maxIndex = i;
        }
      }
      
      const result: Point[] = [];
      
      if (maxDistance > tolerance) {
        const leftSegment = simplifyPath(points, start, maxIndex, tolerance);
        const rightSegment = simplifyPath(points, maxIndex, end, tolerance);
        
        // Spojíme výsledky (vynecháme duplicitní bod)
        result.push(...leftSegment.slice(0, -1));
        result.push(...rightSegment);
      } else {
        result.push(points[start]);
        result.push(points[end]);
      }
      
      return result;
    };
    
    const { points } = polygon;
    
    // Polygon musí mít alespoň 3 body
    if (points.length < 3) return false;
    
    // Vytvoříme uzavřenou křivku (poslední bod spojíme s prvním)
    const closedPath = [...points];
    
    // Zjednodušíme křivku
    let simplifiedPath = simplifyPath(closedPath, 0, closedPath.length - 1, tolerance);
    
    // Musíme zachovat minimálně 3 body
    if (simplifiedPath.length < 3) {
      console.error('Zjednodušení by vedlo k příliš malému počtu bodů');
      return false;
    }
    
    // Aktualizujeme segmentaci
    const updatedPolygons = segmentation.polygons.map(p => {
      if (p.id === polygonId) {
        return {
          ...p,
          points: simplifiedPath
        };
      }
      return p;
    });
    
    setSegmentation({
      ...segmentation,
      polygons: updatedPolygons
    });
    
    return true;
  }, [segmentation, setSegmentation, distancePointToSegment]);

  return {
    simplifyPolygon
  };
};
