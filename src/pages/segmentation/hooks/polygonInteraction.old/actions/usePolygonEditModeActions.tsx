
import { useCallback } from 'react';

/**
 * Hook providing polygon edit mode actions
 */
export const usePolygonEditModeActions = (
  setSelectedPolygonId: (id: string | null) => void,
  togglePointAddingMode: () => void,
  toggleSlicingMode: () => void
) => {
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

  return {
    handleSlicePolygon,
    handleEditPolygon
  };
};
