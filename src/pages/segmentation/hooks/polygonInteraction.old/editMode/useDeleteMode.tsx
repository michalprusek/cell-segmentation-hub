import { useState, useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { toast } from 'sonner';

/**
 * Hook for managing delete mode - allows clicking on polygons to delete them
 */
export const useDeleteMode = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  setSelectedPolygonId: (id: string | null) => void
) => {
  const [deleteMode, setDeleteMode] = useState(false);

  const toggleDeleteMode = useCallback(() => {
    setDeleteMode(prev => !prev);
  }, []);

  const exitDeleteMode = useCallback(() => {
    setDeleteMode(false);
  }, []);

  const handleDeleteClick = useCallback((polygonId: string) => {
    if (!deleteMode || !segmentation) return false;

    // Remove the polygon from segmentation
    const updatedPolygons = segmentation.polygons.filter(p => p.id !== polygonId);
    
    setSegmentation({
      ...segmentation,
      polygons: updatedPolygons
    });

    // Clear selection if deleted polygon was selected
    setSelectedPolygonId(null);
    
    toast.success('Polygon byl úspěšně odstraněn');
    return true;
  }, [deleteMode, segmentation, setSegmentation, setSelectedPolygonId]);

  return {
    deleteMode,
    toggleDeleteMode,
    exitDeleteMode,
    handleDeleteClick
  };
};