
import { useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { useVertexDetection } from './useVertexDetection';
import { useCoordinateTransform } from './useCoordinateTransform';

/**
 * Hook pro práci s přetahováním vertexů
 */
export const useVertexDrag = (
  zoom: number,
  offset: { x: number; y: number },
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  setSelectedPolygonId: (id: string | null) => void,
  vertexDragState: React.MutableRefObject<{
    isDragging: boolean;
    polygonId: string | null;
    vertexIndex: number | null;
  }>
) => {
  const { isNearVertex } = useVertexDetection(zoom, offset);
  const { getCanvasCoordinates } = useCoordinateTransform(zoom, offset);

  /**
   * Zpracování pohybu při tažení vertexu
   */
  const handleVertexDrag = useCallback((
    e: React.MouseEvent,
    containerElement: HTMLElement
  ): boolean => {
    if (!vertexDragState.current.isDragging || !segmentation) return false;
    
    const polygonId = vertexDragState.current.polygonId;
    const vertexIndex = vertexDragState.current.vertexIndex;
    
    if (polygonId !== null && vertexIndex !== null) {
      const rect = containerElement.getBoundingClientRect();
      const { x, y } = getCanvasCoordinates(e.clientX, e.clientY, rect);
      
      console.log(`Dragging vertex to: (${x.toFixed(2)}, ${y.toFixed(2)})`);
      
      // Aktualizace pozice bodu polygonu
      setSegmentation({
        ...segmentation,
        polygons: segmentation.polygons.map(polygon => {
          if (polygon.id === polygonId) {
            const points = [...polygon.points];
            points[vertexIndex] = { x, y };
            return { ...polygon, points };
          }
          return polygon;
        })
      });
      
      // Aktualizujeme kurzor
      containerElement.style.cursor = 'grabbing';
      return true;
    }
    
    return false;
  }, [segmentation, setSegmentation, getCanvasCoordinates]);

  /**
   * Zpracování kliknutí na vertex
   */
  const handleVertexClick = useCallback((
    clientX: number,
    clientY: number,
    containerElement: HTMLElement
  ): boolean => {
    if (!segmentation) return false;
    
    const rect = containerElement.getBoundingClientRect();
    const { x, y } = getCanvasCoordinates(clientX, clientY, rect);
    
    console.log(`Checking vertex click at image coords: (${x.toFixed(2)}, ${y.toFixed(2)})`);
    
    // Nejprve zkontrolujeme, zda jsme klikli na bod polygonu
    for (const polygon of segmentation.polygons) {
      for (let i = 0; i < polygon.points.length; i++) {
        const point = polygon.points[i];
        
        if (isNearVertex(x, y, point, 12)) { // Zvětšený detekční poloměr
          console.log(`Clicked on vertex at (${point.x.toFixed(2)}, ${point.y.toFixed(2)})`);
          
          // Nastavíme aktivní polygon a začneme tažení bodu
          setSelectedPolygonId(polygon.id);
          vertexDragState.current = {
            isDragging: true,
            polygonId: polygon.id,
            vertexIndex: i
          };
          containerElement.style.cursor = 'grabbing';
          return true;
        }
      }
    }
    
    return false;
  }, [segmentation, setSelectedPolygonId, isNearVertex, getCanvasCoordinates]);

  return {
    handleVertexDrag,
    handleVertexClick
  };
};
