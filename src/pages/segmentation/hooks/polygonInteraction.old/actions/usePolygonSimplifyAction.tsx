
import { useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { toast } from 'sonner';
import { usePointEditor } from '../geometry/usePointEditor';

/**
 * Hook providing polygon simplification functionality
 */
export const usePolygonSimplifyAction = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null
) => {
  // Editor for point operations
  const pointEditor = usePointEditor(segmentation, setSegmentation);

  /**
   * Zjednodušení polygonu
   */
  const simplifySelectedPolygon = useCallback((tolerance: number = 1.0) => {
    if (!selectedPolygonId) {
      toast.error("Nejprve vyberte polygon");
      return false;
    }
    
    const success = pointEditor.simplifyPolygon(selectedPolygonId, tolerance);
    
    if (success) {
      toast.success("Polygon byl úspěšně zjednodušen");
    } else {
      toast.error("Zjednodušení polygonu selhalo");
    }
    
    return success;
  }, [selectedPolygonId, pointEditor]);

  return {
    simplifySelectedPolygon
  };
};
