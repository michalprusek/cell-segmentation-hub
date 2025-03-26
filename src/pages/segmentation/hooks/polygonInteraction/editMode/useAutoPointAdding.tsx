
import { useState, useEffect, useCallback } from 'react';
import { Point } from '@/lib/segmentation';
import { useGeometryUtils } from './useGeometryUtils';

interface AutoPointAddingProps {
  editMode: boolean;
  cursorPosition: Point | null;
  isShiftPressed: boolean;
  tempPoints: { points: Point[] };
  addPointToTemp: (point: Point) => void;
}

/**
 * Hook pro automatické přidávání bodů při držení klávesy Shift
 */
export const useAutoPointAdding = ({
  editMode,
  cursorPosition,
  isShiftPressed,
  tempPoints,
  addPointToTemp
}: AutoPointAddingProps) => {
  const { distance } = useGeometryUtils();
  const [lastAutoAddedPoint, setLastAutoAddedPoint] = useState<Point | null>(null);
  const MIN_DISTANCE_FOR_AUTO_POINT = 20; // Minimální vzdálenost pro automatické přidávání bodů

  // Automatické přidávání bodů při držení Shift
  useEffect(() => {
    if (!editMode || !cursorPosition || !isShiftPressed || 
        tempPoints.points.length === 0) {
      setLastAutoAddedPoint(null);
      return;
    }
    
    const lastPoint = tempPoints.points[tempPoints.points.length - 1];
    const currentCursor = cursorPosition;
    
    // Pokud není nastaven poslední auto přidaný bod, nastavíme ho jako poslední bod v sekvenci
    if (!lastAutoAddedPoint) {
      setLastAutoAddedPoint(lastPoint);
      return;
    }
    
    // Zjistíme vzdálenost od posledního auto přidaného bodu k aktuálnímu kurzoru
    const dist = distance(lastAutoAddedPoint, currentCursor);
    
    // Pokud je vzdálenost větší než práh, přidáme nový bod
    if (dist >= MIN_DISTANCE_FOR_AUTO_POINT) {
      addPointToTemp(currentCursor);
      setLastAutoAddedPoint(currentCursor);
    }
  }, [
    editMode, 
    cursorPosition, 
    isShiftPressed, 
    tempPoints.points, 
    addPointToTemp, 
    lastAutoAddedPoint, 
    distance
  ]);

  const resetLastAutoAddedPoint = useCallback(() => {
    setLastAutoAddedPoint(null);
  }, []);

  return {
    resetLastAutoAddedPoint
  };
};
