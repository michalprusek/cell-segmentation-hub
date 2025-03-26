
import { useCallback } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
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
    points: Point[]
  ) => boolean;
  findPolygonById: (polygonId: string | null) => any;
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
    
    // Pokud klikneme někam na plátno (a ne na existující bod)
    if (!hoveredSegment.polygonId || hoveredSegment.segmentIndex === null) {
      // Ale již byl vybrán počáteční bod, tak přidáme nový bod do dočasné sekvence
      if (selectedVertexIndex !== null && sourcePolygonId !== null) {
        // Přidáme bod do naší dočasné sekvence
        console.log("Adding temp point:", x, y);
        const newPoint = { x, y };
        
        // Vždy vytvoříme nové pole s novým bodem na konci
        setTempPoints([...tempPoints, newPoint]);
        return true;
      }
      return false;
    }
    
    // Pokud klikneme na existující vrchol polygonu
    if (hoveredSegment.polygonId && hoveredSegment.segmentIndex !== null) {
      // Pokud ještě nebyl vybrán počáteční vrchol
      if (selectedVertexIndex === null) {
        // Nastavíme tento vrchol jako počáteční
        setSelectedVertexIndex(hoveredSegment.segmentIndex);
        setSourcePolygonId(hoveredSegment.polygonId);
        // Vyčistíme dočasné body
        setTempPoints([]);
        console.log("Selected start vertex:", hoveredSegment.segmentIndex, "polygonId:", hoveredSegment.polygonId);
        return true;
      } 
      // Pokud již byl vybrán počáteční vrchol a klikli jsme na jiný vrchol stejného polygonu
      else if (hoveredSegment.polygonId === sourcePolygonId && 
              hoveredSegment.segmentIndex !== selectedVertexIndex) {
        
        const polygon = findPolygonById(sourcePolygonId);
        if (polygon) {
          const startIndex = selectedVertexIndex;
          const endIndex = hoveredSegment.segmentIndex;
          
          console.log("Completing path from", startIndex, "to", endIndex, "with", tempPoints.length, "points");
          
          // Najdeme optimální cestu k nahrazení (s ohledem na co nejmenší obvod)
          const { indices, start, end } = findOptimalPath(polygon, startIndex, endIndex);
          
          // Aplikujeme modifikaci s novou cestou
          const success = modifyPolygonPath(
            sourcePolygonId,
            start,
            end,
            tempPoints
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
        }
        return true;
      }
    }
    
    return false;
  }, [
    pointAddingMode, 
    segmentation, 
    hoveredSegment, 
    selectedVertexIndex,
    sourcePolygonId,
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
