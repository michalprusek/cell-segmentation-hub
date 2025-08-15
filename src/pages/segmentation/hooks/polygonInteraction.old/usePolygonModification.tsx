
import { useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';

/**
 * Hook pro modifikaci polygonů v segmentačním editoru
 */
export const usePolygonModification = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null,
  setSelectedPolygonId: (id: string | null) => void
) => {
  // Smazání polygonu
  const handleDeletePolygon = useCallback(() => {
    if (!selectedPolygonId || !segmentation) return;
    
    // Odebrání vybraného polygonu
    setSegmentation({
      ...segmentation,
      polygons: segmentation.polygons.filter(polygon => polygon.id !== selectedPolygonId)
    });
    
    setSelectedPolygonId(null);
  }, [selectedPolygonId, segmentation, setSegmentation, setSelectedPolygonId]);
  
  return { handleDeletePolygon };
};
