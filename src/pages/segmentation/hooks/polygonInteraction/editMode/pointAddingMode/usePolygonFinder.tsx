
import { useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';

/**
 * Hook pro vyhledávání polygonů podle ID
 */
export const usePolygonFinder = (
  segmentation: SegmentationResult | null
) => {
  /**
   * Nalezení polygonu podle ID
   */
  const findPolygonById = useCallback((polygonId: string | null) => {
    if (!polygonId || !segmentation) return null;
    return segmentation.polygons.find(p => p.id === polygonId);
  }, [segmentation]);

  return { findPolygonById };
};
