
import { useCallback, useRef, useEffect } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { useMouseInteractions } from './useMouseInteractions';

/**
 * Hook pro zpracování událostí polygonu s optimalizací výkonu
 */
export const usePolygonEventHandlers = (
  zoom: number,
  offset: { x: number; y: number },
  setOffset: (offset: { x: number; y: number }) => void,
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null,
  setSelectedPolygonId: (id: string | null) => void,
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null },
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
  editActive: boolean,
  handleEditModeClick: (x: number, y: number) => void,
  handleEditMouseMove: (x: number, y: number) => void
) => {
  // Optimalizace: Použijeme debounce pro omezení počtu událostí při pohybu myši
  const mouseMoveTimeoutRef = useRef<number | null>(null);
  
  // Optimalizace: Cachujeme poslední souřadnice myši
  const lastMousePosition = useRef<{ x: number, y: number } | null>(null);
  
  // Optimalizace: Zjišťujeme, zda je potřeba plné zpracování pohybu myši
  const shouldProcessFullMouseMove = useCallback((newX: number, newY: number): boolean => {
    if (!lastMousePosition.current) return true;
    
    const { x: lastX, y: lastY } = lastMousePosition.current;
    const distance = Math.sqrt(Math.pow(newX - lastX, 2) + Math.pow(newY - lastY, 2));
    
    // Zpracujeme pohyb pouze pokud je dostatečně velký nebo pokud táhneme vertex/plátno
    return distance > 1 || dragState.current.isDragging || vertexDragState.current.isDragging;
  }, [dragState, vertexDragState]);
  
  // Mouse interakce s použitím naší optimalizace
  const mouseInteractions = useMouseInteractions(
    zoom,
    offset,
    setOffset,
    segmentation,
    setSegmentation,
    setSelectedPolygonId,
    setHoveredVertex,
    dragState,
    vertexDragState,
    hoveredVertex,
    editActive,
    handleEditModeClick,
    handleEditMouseMove
  );
  
  /**
   * Optimalizovaný handler pro pohyb myši s debouncem
   */
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Okamžité zpracování během tažení
    if (dragState.current.isDragging || vertexDragState.current.isDragging) {
      mouseInteractions.handleMouseMove(e);
      lastMousePosition.current = { 
        x: e.clientX, 
        y: e.clientY 
      };
      return;
    }
    
    // V edit režimu chceme plynulejší aktualizace
    if (editActive) {
      mouseInteractions.handleMouseMove(e);
      lastMousePosition.current = { 
        x: e.clientX, 
        y: e.clientY 
      };
      return;
    }
    
    // Kontrola, zda se myš dostatečně posunula pro zpracování události
    if (shouldProcessFullMouseMove(e.clientX, e.clientY)) {
      // Zrušíme předchozí timeout, pokud existuje
      if (mouseMoveTimeoutRef.current !== null) {
        window.clearTimeout(mouseMoveTimeoutRef.current);
      }
      
      // Nastavíme nový timeout pro debounce (16ms odpovídá přibližně 60fps)
      mouseMoveTimeoutRef.current = window.setTimeout(() => {
        mouseInteractions.handleMouseMove(e);
        mouseMoveTimeoutRef.current = null;
      }, 16);
      
      // Aktualizujeme poslední pozici
      lastMousePosition.current = { 
        x: e.clientX, 
        y: e.clientY 
      };
    }
  }, [
    mouseInteractions, 
    dragState, 
    vertexDragState, 
    editActive, 
    shouldProcessFullMouseMove
  ]);
  
  /**
   * Wrapper pro mouseDown, který zajistí zrušení debounce
   */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Zrušíme debounce při kliknutí
    if (mouseMoveTimeoutRef.current !== null) {
      window.clearTimeout(mouseMoveTimeoutRef.current);
      mouseMoveTimeoutRef.current = null;
    }
    
    // Zavoláme původní handler
    mouseInteractions.handleMouseDown(e);
    
    // Aktualizujeme poslední pozici
    lastMousePosition.current = { 
      x: e.clientX, 
      y: e.clientY 
    };
  }, [mouseInteractions]);
  
  /**
   * Wrapper pro mouseUp, který zajistí zrušení debounce
   */
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // Zrušíme debounce při uvolnění tlačítka
    if (mouseMoveTimeoutRef.current !== null) {
      window.clearTimeout(mouseMoveTimeoutRef.current);
      mouseMoveTimeoutRef.current = null;
    }
    
    // Zavoláme původní handler
    mouseInteractions.handleMouseUp(e);
    
    // Reset poslední pozice
    lastMousePosition.current = null;
  }, [mouseInteractions]);

  // Add a global event listener to handle releasing the mouse outside the element
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      // Only handle if we are currently dragging
      if (dragState.current.isDragging || vertexDragState.current.isDragging) {
        mouseInteractions.handleMouseUp();
        lastMousePosition.current = null;
      }
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [dragState, vertexDragState, mouseInteractions]);
  
  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp
  };
};
