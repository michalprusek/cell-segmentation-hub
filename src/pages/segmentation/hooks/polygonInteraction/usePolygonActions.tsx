
import { useCallback } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { usePointEditor } from './geometry/usePointEditor';

/**
 * Hook providing polygon action handlers like duplicate, delete vertex, etc.
 */
export const usePolygonActions = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null,
  setSelectedPolygonId: (id: string | null) => void,
  togglePointAddingMode: () => void,
  toggleSlicingMode: () => void
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
  
  /**
   * Handler pro zahájení režimu krájení polygonu
   */
  const handleSlicePolygon = useCallback((polygonId: string) => {
    setSelectedPolygonId(polygonId);
    toggleSlicingMode();
  }, [setSelectedPolygonId, toggleSlicingMode]);

  /**
   * Handler pro zahájení editace polygonu
   */
  const handleEditPolygon = useCallback((polygonId: string) => {
    setSelectedPolygonId(polygonId);
    togglePointAddingMode();
  }, [setSelectedPolygonId, togglePointAddingMode]);

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
    simplifySelectedPolygon,
    handleDeleteVertex,
    handleDuplicateVertex,
    handleSlicePolygon,
    handleEditPolygon,
    handleDuplicatePolygon,
    handleDeletePolygon,
    // Export point editor methods
    addPointToPolygon: pointEditor.addPoint,
    removePointFromPolygon: pointEditor.removePoint
  };
};
