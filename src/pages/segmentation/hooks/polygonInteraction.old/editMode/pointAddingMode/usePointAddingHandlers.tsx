
import { useCallback } from 'react';
import type { SegmentationResult, Point, Polygon } from '@/lib/segmentation';
import { toast } from 'sonner';
import { useOptimalPath } from './useOptimalPath';

interface PointAddingHandlersProps {
  pointAddingMode: boolean;
  segmentation: SegmentationResult | null;
  selectedVertexIndex: number | null;
  setSelectedVertexIndex: (index: number | null) => void;
  sourcePolygonId: string | null;
  setSourcePolygonId: (id: string | null) => void;
  hoveredSegment: {
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  };
  tempPoints: Point[];
  setTempPoints: (points: Point[]) => void;
  resetPointAddingState: () => void;
  setPointAddingMode: (active: boolean) => void;
  modifyPolygonPath: (
    polygonId: string | null, 
    startIndex: number | null, 
    endIndex: number | null, 
    points: Point[],
    clockwise?: boolean
  ) => boolean;
  findPolygonById: (polygonId: string | null) => Polygon | undefined;
}

/**
 * Hook pro obsluhu interakcí v režimu přidávání bodů
 */
export const usePointAddingHandlers = ({
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
}: PointAddingHandlersProps) => {
  
  const { findOptimalPath } = useOptimalPath();

  /**
   * Obsluha kliknutí v režimu přidávání bodů
   */
  const handlePointAddingClick = useCallback((x: number, y: number) => {
    if (!pointAddingMode || !segmentation) return false;
    
    console.log("Point adding click:", x, y, "hoveredSegment:", hoveredSegment);
    
    // 1. Pokud ještě nemáme vybraný počáteční bod
    if (selectedVertexIndex === null || sourcePolygonId === null) {
      // Pokud jsme klikli na nějaký vrchol polygonu
      if (hoveredSegment.polygonId && hoveredSegment.segmentIndex !== null) {
        // Nastavíme tento vrchol jako počáteční
        setSelectedVertexIndex(hoveredSegment.segmentIndex);
        setSourcePolygonId(hoveredSegment.polygonId);
        // Vyčistíme dočasné body
        setTempPoints([]);
        console.log("Selected start vertex:", hoveredSegment.segmentIndex, "polygonId:", hoveredSegment.polygonId);
        return true;
      }
      return false;
    }
    
    // 2. Již máme vybraný počáteční bod, zkontrolujeme, zda klikáme na jiný bod stejného polygonu
    if (hoveredSegment.polygonId === sourcePolygonId && 
        hoveredSegment.segmentIndex !== null && 
        hoveredSegment.segmentIndex !== selectedVertexIndex) {
      
      // Klikli jsme na koncový bod - dokončíme přidávání bodů
      const polygon = findPolygonById(sourcePolygonId);
      if (polygon) {
        const startIndex = selectedVertexIndex;
        const endIndex = hoveredSegment.segmentIndex;
        
        console.log("Completing path from", startIndex, "to", endIndex, "with", tempPoints.length, "points");
        
        // Najdeme optimální cestu k nahrazení
        const pathInfo = findOptimalPath(polygon, startIndex, endIndex);
        const { start, end, clockwise } = pathInfo;
        
        // Log pro dohledatelnost
        console.log("Optimal path found:", pathInfo);
        
        // Vytvoříme nové pole bodů pro vložení
        const newPoints = [
          polygon.points[start], // Počáteční bod
          ...tempPoints,         // Dočasné body
          polygon.points[end]    // Koncový bod
        ];
        
        // Aplikujeme modifikaci s novou cestou a informací o směru
        const success = modifyPolygonPath(
          sourcePolygonId,
          start,
          end,
          newPoints,
          clockwise
        );
        
        if (success) {
          toast.success("Body byly úspěšně přidány do polygonu");
          resetPointAddingState();
          
          // Automaticky ukončíme režim přidávání bodů po úspěšném přidání
          setPointAddingMode(false);
        } else {
          toast.error("Přidání bodů selhalo");
          resetPointAddingState();
        }
        return true;
      }
    } 
    // 3. Klikli jsme někam do plátna, přidáme nový bod do dočasné sekvence
    else {
      // Pokud je kurzor nad vrcholem polygonu, neklikáme do volného prostoru
      if (hoveredSegment.segmentIndex !== null && hoveredSegment.polygonId === sourcePolygonId) {
        return false;
      }
      
      // Přidáme bod do naší dočasné sekvence
      console.log("Adding temp point:", x, y);
      const newPoint = { x, y };
      
      // Kontrola, zda bod už není součástí sekvence (zabránění duplicitě)
      const isDuplicate = tempPoints.some(p => 
        Math.abs(p.x - newPoint.x) < 3 && Math.abs(p.y - newPoint.y) < 3
      );
      
      if (!isDuplicate) {
        // Vždy vytvoříme nové pole s novým bodem na konci
        setTempPoints([...tempPoints, newPoint]);
        return true;
      }
    }
    
    return false;
  }, [
    pointAddingMode, 
    segmentation, 
    selectedVertexIndex,
    sourcePolygonId,
    hoveredSegment,
    tempPoints,
    findPolygonById,
    findOptimalPath,
    modifyPolygonPath,
    resetPointAddingState,
    setPointAddingMode,
    setSelectedVertexIndex,
    setSourcePolygonId,
    setTempPoints
  ]);

  return { handlePointAddingClick };
};
