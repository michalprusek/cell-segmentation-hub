
import { useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { useVertexDetection } from './useVertexDetection';

/**
 * Hook pro detekci najetí myši nad vertexy
 */
export const useVertexHover = (
  zoom: number,
  segmentation: SegmentationResult | null,
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null },
  setHoveredVertex: (state: { polygonId: string | null, vertexIndex: number | null }) => void
) => {
  const { isNearVertex } = useVertexDetection(zoom);

  /**
   * Detekce a nastavení bodu pod kurzorem
   */
  const detectVertexHover = useCallback((
    x: number,
    y: number,
    containerElement: HTMLElement
  ): boolean => {
    if (!segmentation) return false;
    
    // Procházíme všechny polygony a jejich body
    for (const polygon of segmentation.polygons) {
      for (let i = 0; i < polygon.points.length; i++) {
        const point = polygon.points[i];
        
        // Detekce bodu přímo v souřadnicích obrázku
        if (isNearVertex(x, y, point)) {
          if (hoveredVertex.polygonId !== polygon.id || hoveredVertex.vertexIndex !== i) {
            setHoveredVertex({
              polygonId: polygon.id,
              vertexIndex: i
            });
          }
          containerElement.style.cursor = 'grab';
          return true;
        }
      }
    }
    
    // Pokud jsme nenašli žádný bod pod kurzorem, resetujeme stav
    if (hoveredVertex.polygonId !== null || hoveredVertex.vertexIndex !== null) {
      setHoveredVertex({ polygonId: null, vertexIndex: null });
    }
    
    return false;
  }, [segmentation, hoveredVertex, setHoveredVertex, isNearVertex]);

  return { detectVertexHover };
};
