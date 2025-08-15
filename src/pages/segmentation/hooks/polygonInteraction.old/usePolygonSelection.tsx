
import { useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { usePolygonDetection } from './usePolygonDetection';

/**
 * Hook pro výběr polygonů
 */
export const usePolygonSelection = (
  segmentation: SegmentationResult | null,
  setSelectedPolygonId: (id: string | null) => void
) => {
  const { isPointInPolygon } = usePolygonDetection();

  /**
   * Pokusí se vybrat polygon na daných souřadnicích
   * Vrací true, pokud byl nějaký polygon vybrán
   */
  const trySelectPolygon = useCallback((
    x: number,
    y: number
  ): boolean => {
    if (!segmentation) return false;
    
    for (const polygon of segmentation.polygons) {
      // Zkontrolujeme, zda jsme klikli dovnitř polygonu
      const isInside = isPointInPolygon(x, y, polygon.points);
      if (isInside) {
        setSelectedPolygonId(polygon.id);
        return true;
      }
    }
    
    return false;
  }, [segmentation, setSelectedPolygonId, isPointInPolygon]);

  return { trySelectPolygon };
};
