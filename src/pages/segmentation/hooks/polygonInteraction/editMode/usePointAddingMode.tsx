
import { useEffect, useMemo, useState } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { useGeometryUtils } from './useGeometryUtils';
import { usePathModification } from './usePathModification';
import { usePointAddingState } from './pointAddingMode/usePointAddingState';
import { useVertexDetection } from './pointAddingMode/useVertexDetection';
import { usePointAddingHandlers } from './pointAddingMode/usePointAddingHandlers';
import { usePolygonFinder } from './pointAddingMode/usePolygonFinder';

/**
 * Hook pro přidávání bodů do existujících polygonů
 */
export const usePointAddingMode = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null
) => {
  // Základní stav režimu přidávání bodů
  const {
    pointAddingMode,
    setPointAddingMode,
    selectedVertexIndex,
    setSelectedVertexIndex,
    sourcePolygonId,
    setSourcePolygonId,
    hoveredSegment,
    setHoveredSegment,
    tempPoints,
    setTempPoints,
    togglePointAddingMode,
    resetPointAddingState
  } = usePointAddingState();
  
  // Sledování pozice kurzoru pro zobrazení spojnice
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);
  
  // Utility pro geometrické výpočty a hledání polygonů
  const { distance } = useGeometryUtils();
  const { modifyPolygonPath } = usePathModification(segmentation, setSegmentation);
  const { findPolygonById } = usePolygonFinder(segmentation);
  
  // Získáme body vybraného polygonu pro vizualizaci
  const selectedPolygonPoints = useMemo(() => {
    if (!sourcePolygonId || !segmentation) return null;
    
    const polygon = segmentation.polygons.find(p => p.id === sourcePolygonId);
    return polygon ? polygon.points : null;
  }, [segmentation, sourcePolygonId]);
  
  // Detekce vrcholů při pohybu myši
  const { detectVertexUnderCursor } = useVertexDetection({
    pointAddingMode,
    segmentation,
    selectedVertexIndex,
    sourcePolygonId,
    setHoveredSegment,
    distance
  });
  
  // Obsluha interakcí v režimu přidávání bodů
  const { handlePointAddingClick } = usePointAddingHandlers({
    pointAddingMode,
    segmentation,
    selectedVertexIndex,
    setSelectedVertexIndex,
    sourcePolygonId,
    setSourcePolygonId,
    hoveredSegment,
    tempPoints,
    setTempPoints,
    resetPointAddingState,
    setPointAddingMode,
    modifyPolygonPath,
    findPolygonById
  });
  
  // Sledování pozice kurzoru pro vykreslení spojnice k poslednímu bodu
  useEffect(() => {
    if (!pointAddingMode) {
      setCursorPosition(null);
      return;
    }
    
    const handleMouseMove = (e: MouseEvent) => {
      // Najdeme správný kontejner, kde se nachází canvas
      const containerElement = document.querySelector('[data-testid="canvas-container"]') as HTMLElement;
      if (!containerElement) return;
      
      const rect = containerElement.getBoundingClientRect();
      
      // Přepočet souřadnic myši na souřadnice obrazu
      const canvasX = (e.clientX - rect.left);
      const canvasY = (e.clientY - rect.top);
      
      // Získání aktuální hodnoty zoom a offset z atributů nebo transformace
      let zoom = 1;
      let offsetX = 0;
      let offsetY = 0;
      
      // Pokusíme se získat zoom a offset z transformace
      const transform = containerElement.style.transform || '';
      
      // Získání hodnoty zoomu
      const zoomMatch = transform.match(/scale\(([^)]+)\)/);
      if (zoomMatch && zoomMatch[1]) {
        zoom = parseFloat(zoomMatch[1]);
      }
      
      // Získání hodnoty offsetu
      const translateMatch = transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
      if (translateMatch && translateMatch[1] && translateMatch[2]) {
        offsetX = parseFloat(translateMatch[1]);
        offsetY = parseFloat(translateMatch[2]);
      }
      
      // Přepočet na souřadnice obrazu
      const imageX = canvasX / zoom - offsetX / zoom;
      const imageY = canvasY / zoom - offsetY / zoom;
      
      setCursorPosition({ x: imageX, y: imageY });
      
      // Detekce vrcholu pod kurzorem
      detectVertexUnderCursor(imageX, imageY);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [pointAddingMode, detectVertexUnderCursor]);
  
  // Při aktivaci režimu přidávání bodů resetujeme stav
  useEffect(() => {
    if (pointAddingMode) {
      // Ujistíme se, že začínáme s čistým stavem
      resetPointAddingState();
      
      // Pokud máme vybraný polygon, nastavíme ho jako zdrojový
      if (selectedPolygonId) {
        setSourcePolygonId(selectedPolygonId);
      }
      
      console.log("Point adding mode activated with polygon:", selectedPolygonId);
    }
  }, [pointAddingMode, selectedPolygonId, resetPointAddingState, setSourcePolygonId]);

  return {
    pointAddingMode,
    setPointAddingMode,
    hoveredSegment,
    tempPoints,
    selectedVertexIndex,
    sourcePolygonId,
    selectedPolygonPoints,
    cursorPosition,
    togglePointAddingMode,
    detectVertexUnderCursor,
    handlePointAddingClick,
    resetPointAddingState
  };
};
