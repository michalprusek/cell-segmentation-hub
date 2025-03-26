
import { useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { useVertexDetection } from './useVertexDetection';
import { useCoordinateTransform } from './useCoordinateTransform';

/**
 * Hook pro detekci najetí myši nad vertexy
 */
export const useVertexHover = (
  zoom: number,
  offset: { x: number; y: number },
  segmentation: SegmentationResult | null,
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null },
  setHoveredVertex: (state: { polygonId: string | null, vertexIndex: number | null }) => void
) => {
  const { isNearVertex } = useVertexDetection(zoom, offset);
  const { getCanvasCoordinates } = useCoordinateTransform(zoom, offset);

  /**
   * Detekce a nastavení bodu pod kurzorem
   */
  const detectVertexHover = useCallback((
    clientX: number,
    clientY: number,
    containerElement: HTMLElement
  ): boolean => {
    if (!segmentation) return false;
    
    const rect = containerElement.getBoundingClientRect();
    const { x, y, canvasX, canvasY } = getCanvasCoordinates(clientX, clientY, rect);
    
    // Logování pro ladění
    console.log(`detectVertexHover: Mouse at client: (${clientX}, ${clientY}), Canvas: (${canvasX}, ${canvasY}), Image space: (${x.toFixed(2)}, ${y.toFixed(2)})`);
    
    let foundVertex = false;
    
    // Procházíme všechny polygony a jejich body - prioritizujeme polygony od konce 
    // (novější/vyšší vrstvě jsou vidět navrchu)
    for (let p = segmentation.polygons.length - 1; p >= 0; p--) {
      const polygon = segmentation.polygons[p];
      
      for (let i = 0; i < polygon.points.length; i++) {
        const point = polygon.points[i];
        
        // Použijeme větší detekční radius pro snazší výběr vertexu při hoveru
        // Předáváme přímo canvas souřadnice (ne image souřadnice)
        if (isNearVertex(canvasX, canvasY, point, 18)) {
          if (hoveredVertex.polygonId !== polygon.id || hoveredVertex.vertexIndex !== i) {
            setHoveredVertex({
              polygonId: polygon.id,
              vertexIndex: i
            });
            console.log(`Hover detected on polygon ${polygon.id}, vertex ${i} at (${point.x}, ${point.y})`);
          }
          containerElement.style.cursor = 'grab';
          foundVertex = true;
          return true;
        }
      }
    }
    
    // Pokud jsme nenašli žádný bod pod kurzorem, resetujeme stav
    if (!foundVertex && (hoveredVertex.polygonId !== null || hoveredVertex.vertexIndex !== null)) {
      setHoveredVertex({ polygonId: null, vertexIndex: null });
      containerElement.style.cursor = 'move';
    }
    
    return foundVertex;
  }, [segmentation, hoveredVertex, setHoveredVertex, isNearVertex, getCanvasCoordinates]);

  return { detectVertexHover };
};
