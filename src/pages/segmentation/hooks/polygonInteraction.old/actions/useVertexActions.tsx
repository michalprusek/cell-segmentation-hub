
import { useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { toast } from 'sonner';
import { usePointEditor } from '../geometry/usePointEditor';

/**
 * Hook providing vertex action handlers like delete, duplicate
 */
export const useVertexActions = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void
) => {
  // Editor for point operations
  const pointEditor = usePointEditor(segmentation, setSegmentation);

  /**
   * Handler pro smazání vrcholu polygonu
   */
  const handleDeleteVertex = useCallback((polygonId: string, vertexIndex: number) => {
    const success = pointEditor.removePoint(polygonId, vertexIndex);
    if (success) {
      toast.success("Bod byl úspěšně odstraněn");
    } else {
      toast.error("Odstranění bodu selhalo");
    }
  }, [pointEditor]);
  
  /**
   * Handler pro duplikaci vrcholu polygonu
   */
  const handleDuplicateVertex = useCallback((polygonId: string, vertexIndex: number) => {
    const success = pointEditor.duplicatePoint(polygonId, vertexIndex);
    if (success) {
      toast.success("Bod byl úspěšně duplikován");
    } else {
      toast.error("Duplikace bodu selhala");
    }
  }, [pointEditor]);

  return {
    handleDeleteVertex,
    handleDuplicateVertex,
    // Export point editor methods for direct access
    addPointToPolygon: pointEditor.addPoint,
    removePointFromPolygon: pointEditor.removePoint
  };
};
