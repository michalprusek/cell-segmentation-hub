
import { useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { useCoordinateTransform } from './useCoordinateTransform';
import { useVertexDrag } from './useVertexDrag';
import { usePolygonSelection } from './usePolygonSelection';
import { useCanvasDrag } from './useCanvasDrag';
import { useVertexHover } from './useVertexHover';

/**
 * Hook pro práci s mouse interakcemi
 */
export const useMouseInteractions = (
  zoom: number,
  offset: { x: number; y: number },
  setOffset: (offset: { x: number; y: number }) => void,
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  setSelectedPolygonId: (id: string | null) => void,
  setHoveredVertex: (state: { polygonId: string | null, vertexIndex: number | null }) => void,
  dragState: React.MutableRefObject<{
    isDragging: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  }>,
  vertexDragState: React.MutableRefObject<{
    isDragging: boolean;
    polygonId: string | null;
    vertexIndex: number | null;
  }>,
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null }
) => {
  const { getCanvasCoordinates } = useCoordinateTransform(zoom, offset);
  
  const { handleVertexDrag, handleVertexClick } = useVertexDrag(
    zoom, offset, segmentation, setSegmentation, setSelectedPolygonId, vertexDragState
  );
  
  const { trySelectPolygon } = usePolygonSelection(
    segmentation, setSelectedPolygonId
  );
  
  const { handleCanvasDrag, startCanvasDrag } = useCanvasDrag(
    zoom, offset, setOffset, dragState
  );
  
  const { detectVertexHover } = useVertexHover(
    zoom, segmentation, hoveredVertex, setHoveredVertex
  );

  /**
   * Zpracování pohybu myši
   */
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const containerElement = e.currentTarget as HTMLElement;
    if (!containerElement || !segmentation) return;
    
    const rect = containerElement.getBoundingClientRect();
    const { x, y } = getCanvasCoordinates(e.clientX, e.clientY, rect);
    
    // Nejdřív kontrolujeme, jestli táhneme vertex
    if (handleVertexDrag(e, containerElement)) {
      return;
    }
    
    // Potom kontrolujeme, jestli táhneme celé plátno
    if (handleCanvasDrag(e, containerElement)) {
      return;
    }
    
    // Nakonec kontrolujeme, jestli je kurzor nad nějakým vertexem
    if (!detectVertexHover(x, y, containerElement)) {
      // Pokud ne, nastavíme kurzor na výchozí
      containerElement.style.cursor = 'move';
    }
  }, [
    segmentation, 
    getCanvasCoordinates, 
    handleVertexDrag, 
    handleCanvasDrag, 
    detectVertexHover
  ]);

  /**
   * Zpracování kliknutí myši
   */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const containerElement = e.currentTarget as HTMLElement;
    if (!containerElement || !segmentation) return;
    
    const rect = containerElement.getBoundingClientRect();
    const { x, y } = getCanvasCoordinates(e.clientX, e.clientY, rect);
    
    // Nejdřív zkontrolujeme, jestli jsme klikli na vertex
    if (handleVertexClick(x, y)) {
      containerElement.style.cursor = 'grabbing';
      return;
    }
    
    // Potom zkontrolujeme, jestli jsme klikli na polygon
    if (trySelectPolygon(x, y)) {
      return;
    }
    
    // Pokud jsme neklikli na polygon ani vertex, začneme táhnout plátno
    setSelectedPolygonId(null);
    startCanvasDrag(e);
    
    containerElement.style.cursor = 'grabbing';
  }, [
    segmentation, 
    getCanvasCoordinates, 
    handleVertexClick, 
    trySelectPolygon, 
    setSelectedPolygonId, 
    startCanvasDrag
  ]);

  /**
   * Zpracování uvolnění tlačítka myši
   */
  const handleMouseUp = useCallback(() => {
    // Ukončení tažení
    dragState.current.isDragging = false;
    vertexDragState.current.isDragging = false;
  }, []);

  return {
    handleMouseMove,
    handleMouseDown,
    handleMouseUp
  };
};
