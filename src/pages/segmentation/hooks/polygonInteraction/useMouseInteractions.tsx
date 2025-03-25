
import { useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { useVertexDetection } from './useVertexDetection';
import { usePolygonDetection } from './usePolygonDetection';

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
  const { isNearVertex } = useVertexDetection(zoom);
  const { isPointInPolygon } = usePolygonDetection();

  /**
   * Převod souřadnic myši na souřadnice v canvas
   * Bere v úvahu zoom a offset pro přesnou detekci
   */
  const getCanvasCoordinates = useCallback((
    mouseX: number, 
    mouseY: number, 
    containerRect: DOMRect
  ) => {
    // Převod z pozice myši na canvas
    const canvasX = mouseX - containerRect.left;
    const canvasY = mouseY - containerRect.top;
    
    // Převod na souřadnice v prostoru obrázku s ohledem na zoom a offset
    const x = canvasX / zoom - offset.x;
    const y = canvasY / zoom - offset.y;
    
    return { canvasX, canvasY, x, y };
  }, [zoom, offset]);

  /**
   * Zpracování pohybu myši
   */
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const containerElement = e.currentTarget as HTMLElement;
    if (!containerElement || !segmentation) return;
    
    const rect = containerElement.getBoundingClientRect();
    // Přesný výpočet souřadnic v prostoru plátna
    const { x, y, canvasX, canvasY } = getCanvasCoordinates(e.clientX, e.clientY, rect);
    
    // Pokud jsme ve stavu tažení bodu polygonu
    if (vertexDragState.current.isDragging) {
      const polygonId = vertexDragState.current.polygonId;
      const vertexIndex = vertexDragState.current.vertexIndex;
      
      if (polygonId !== null && vertexIndex !== null) {
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
        return;
      }
    }
    
    // Pokud přesouváme celý pohled
    if (dragState.current.isDragging) {
      const dx = e.clientX - dragState.current.lastX;
      const dy = e.clientY - dragState.current.lastY;
      
      // Aktualizace last pozice pro plynulý pohyb
      dragState.current.lastX = e.clientX;
      dragState.current.lastY = e.clientY;
      
      setOffset({
        x: offset.x + dx / zoom,
        y: offset.y + dy / zoom
      });
      
      containerElement.style.cursor = 'grabbing';
      return;
    }
    
    // Hledání bodu polygonu pod kurzorem pro hover efekt
    let foundVertex = false;
    
    // Procházíme všechny polygony a jejich body
    for (const polygon of segmentation.polygons) {
      for (let i = 0; i < polygon.points.length; i++) {
        const point = polygon.points[i];
        
        // Přímá detekce bodu v souřadnicích obrázku
        if (isNearVertex(x, y, point)) {
          setHoveredVertex({
            polygonId: polygon.id,
            vertexIndex: i
          });
          foundVertex = true;
          containerElement.style.cursor = 'grab';
          break;
        }
      }
      if (foundVertex) break;
    }
    
    if (!foundVertex) {
      if (hoveredVertex.polygonId !== null || hoveredVertex.vertexIndex !== null) {
        setHoveredVertex({ polygonId: null, vertexIndex: null });
      }
      
      // Nastavení kurzoru podle stavu
      containerElement.style.cursor = 'move';
    }
  }, [zoom, offset, segmentation, hoveredVertex, setOffset, setSegmentation, setHoveredVertex, getCanvasCoordinates, isNearVertex]);

  /**
   * Zpracování kliknutí myši
   */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const containerElement = e.currentTarget as HTMLElement;
    if (!containerElement || !segmentation) return;
    
    const rect = containerElement.getBoundingClientRect();
    const { x, y } = getCanvasCoordinates(e.clientX, e.clientY, rect);
    
    // Nejprve zkontrolujeme, zda jsme klikli na bod polygonu
    for (const polygon of segmentation.polygons) {
      for (let i = 0; i < polygon.points.length; i++) {
        const point = polygon.points[i];
        
        if (isNearVertex(x, y, point)) {
          // Nastavíme aktivní polygon a začneme tažení bodu
          setSelectedPolygonId(polygon.id);
          vertexDragState.current = {
            isDragging: true,
            polygonId: polygon.id,
            vertexIndex: i
          };
          containerElement.style.cursor = 'grabbing';
          return;
        }
      }
      
      // Pokud jsme neklikli na bod, zkontrolujeme, zda jsme klikli dovnitř polygonu
      const isInside = isPointInPolygon(x, y, polygon.points);
      if (isInside) {
        setSelectedPolygonId(polygon.id);
        return;
      }
    }
    
    // Pokud jsme neklikli na polygon ani na bod, začneme přesouvat celý pohled
    setSelectedPolygonId(null);
    dragState.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY
    };
    
    containerElement.style.cursor = 'grabbing';
  }, [zoom, offset, segmentation, setSelectedPolygonId, getCanvasCoordinates, isNearVertex, isPointInPolygon]);

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
