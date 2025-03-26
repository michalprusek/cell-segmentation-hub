
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
      const zoomMatch = containerElement.style.transform?.match(/scale\(([^)]+)\)/);
      const zoom = zoomMatch ? parseFloat(zoomMatch[1]) : 1;
      
      const transformMatch = containerElement.style.transform?.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
      const offsetX = transformMatch ? parseFloat(transformMatch[1]) : 0;
      const offsetY = transformMatch ? parseFloat(transformMatch[2]) : 0;
      
      // Přepočet na souřadnice obrazu
      const imageX = canvasX / zoom - offsetX / zoom;
      const imageY = canvasY / zoom - offsetY / zoom;
      
      setCursorPosition({ x: imageX, y: imageY });
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [pointAddingMode]);
  
  // Logování pro debugování
  useEffect(() => {
    if (pointAddingMode) {
      console.log("PointAddingMode state:", { 
        selectedVertexIndex, 
        sourcePolygonId, 
        tempPoints: tempPoints.length,
        hoveredSegment,
        cursorPosition
      });
    }
  }, [pointAddingMode, selectedVertexIndex, sourcePolygonId, tempPoints, hoveredSegment, cursorPosition]);

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
