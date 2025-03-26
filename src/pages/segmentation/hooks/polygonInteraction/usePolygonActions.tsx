
import { SegmentationResult } from '@/lib/segmentation';
import { usePolygonSimplifyAction } from './actions/usePolygonSimplifyAction';
import { useVertexActions } from './actions/useVertexActions';
import { usePolygonModifyActions } from './actions/usePolygonModifyActions';
import { usePolygonEditModeActions } from './actions/usePolygonEditModeActions';

/**
 * Hook providing polygon action handlers like duplicate, delete vertex, etc.
 * Refactored to use smaller, more focused hooks
 */
export const usePolygonActions = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null,
  setSelectedPolygonId: (id: string | null) => void,
  togglePointAddingMode: () => void,
  toggleSlicingMode: () => void
) => {
  // Simplification actions
  const { simplifySelectedPolygon } = usePolygonSimplifyAction(
    segmentation, 
    setSegmentation, 
    selectedPolygonId
  );
  
  // Vertex actions
  const { 
    handleDeleteVertex, 
    handleDuplicateVertex,
    addPointToPolygon,
    removePointFromPolygon
  } = useVertexActions(segmentation, setSegmentation);
  
  // Polygon modification actions
  const { 
    handleDuplicatePolygon, 
    handleDeletePolygon 
  } = usePolygonModifyActions(
    segmentation, 
    setSegmentation, 
    selectedPolygonId, 
    setSelectedPolygonId
  );
  
  // Edit mode actions
  const { 
    handleSlicePolygon, 
    handleEditPolygon 
  } = usePolygonEditModeActions(
    setSelectedPolygonId, 
    togglePointAddingMode, 
    toggleSlicingMode
  );

  return {
    // Simplification
    simplifySelectedPolygon,
    
    // Vertex operations
    handleDeleteVertex,
    handleDuplicateVertex,
    
    // Edit mode operations
    handleSlicePolygon,
    handleEditPolygon,
    
    // Polygon operations
    handleDuplicatePolygon,
    handleDeletePolygon,
    
    // Point editor direct methods
    addPointToPolygon,
    removePointFromPolygon
  };
};
