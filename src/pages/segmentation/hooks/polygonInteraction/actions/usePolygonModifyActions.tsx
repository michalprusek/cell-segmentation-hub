
import { useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';

/**
 * Hook providing polygon modification actions like duplicate, delete
 */
export const usePolygonModifyActions = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null,
  setSelectedPolygonId: (id: string | null) => void
) => {
  /**
   * Handler pro duplikaci polygonu
   */
  const handleDuplicatePolygon = useCallback((polygonId: string) => {
    if (!segmentation) return;
    
    const polygon = segmentation.polygons.find(p => p.id === polygonId);
    if (!polygon) return;
    
    // Create a new polygon with slightly offset points
    const offsetX = 20;
    const offsetY = 20;
    const newPolygon = {
      ...polygon,
      id: uuidv4(),
      points: polygon.points.map(p => ({
        x: p.x + offsetX,
        y: p.y + offsetY
      }))
    };
    
    // Add the new polygon to the segmentation
    setSegmentation({
      ...segmentation,
      polygons: [...segmentation.polygons, newPolygon]
    });
    
    setSelectedPolygonId(newPolygon.id);
    toast.success("Polygon byl úspěšně duplikován");
  }, [segmentation, setSegmentation, setSelectedPolygonId]);

  /**
   * Handler pro smazání polygonu
   */
  const handleDeletePolygon = useCallback(() => {
    if (!selectedPolygonId || !segmentation) return;
    
    // Odebrání vybraného polygonu
    setSegmentation({
      ...segmentation,
      polygons: segmentation.polygons.filter(polygon => polygon.id !== selectedPolygonId)
    });
    
    setSelectedPolygonId(null);
    toast.success("Polygon byl úspěšně odstraněn");
  }, [selectedPolygonId, segmentation, setSegmentation, setSelectedPolygonId]);

  return {
    handleDuplicatePolygon,
    handleDeletePolygon
  };
};
