
import { useCallback } from 'react';
import { Point, SegmentationResult } from '@/lib/segmentation';

/**
 * Hook pro práci s body polygonu - přidávání, mazání a přesouvání bodů
 */
export const usePointEditor = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void
) => {
  /**
   * Výpočet pozice pro vložení bodu na úsečku
   */
  const calculateInsertPosition = useCallback((
    a: Point,
    b: Point,
    cursor: Point
  ): Point => {
    // Algoritmus projekce bodu na úsečku
    const vector = { x: b.x - a.x, y: b.y - a.y };
    const denominator = vector.x * vector.x + vector.y * vector.y;
    
    // Zabráníme dělení nulou (když jsou body a a b totožné)
    if (denominator < 0.0001) {
      return a; // Vrátíme jeden z krajních bodů
    }
    
    const t = ((cursor.x - a.x) * vector.x + (cursor.y - a.y) * vector.y) / denominator;
    
    // Omezíme t na interval [0, 1], abychom zajistili, že bod bude na úsečce
    const clampedT = Math.max(0, Math.min(1, t));
    
    return {
      x: a.x + clampedT * vector.x,
      y: a.y + clampedT * vector.y
    };
  }, []);

  /**
   * Výpočet vzdálenosti bodu od úsečky
   */
  const distancePointToSegment = useCallback((
    point: Point,
    segmentStart: Point,
    segmentEnd: Point
  ): number => {
    const projectedPoint = calculateInsertPosition(segmentStart, segmentEnd, point);
    
    // Vzdálenost mezi bodem a jeho projekcí
    return Math.sqrt(
      Math.pow(point.x - projectedPoint.x, 2) + 
      Math.pow(point.y - projectedPoint.y, 2)
    );
  }, [calculateInsertPosition]);

  /**
   * Nalezení nejbližšího segmentu k zadanému bodu
   */
  const findClosestSegment = useCallback((
    point: Point,
    polygonPoints: Point[],
    threshold: number = 10
  ): { segmentIndex: number, distance: number } | null => {
    let closestSegment = -1;
    let minDistance = Infinity;
    
    for (let i = 0; i < polygonPoints.length; i++) {
      const j = (i + 1) % polygonPoints.length; // Zajistí uzavření polygonu
      const distance = distancePointToSegment(point, polygonPoints[i], polygonPoints[j]);
      
      if (distance < minDistance) {
        minDistance = distance;
        closestSegment = i;
      }
    }
    
    if (minDistance <= threshold && closestSegment !== -1) {
      return {
        segmentIndex: closestSegment,
        distance: minDistance
      };
    }
    
    return null;
  }, [distancePointToSegment]);
  
  /**
   * Přidání nového bodu do polygonu
   */
  const addPoint = useCallback((
    polygonId: string,
    segmentIndex: number,
    point: Point
  ): boolean => {
    if (!segmentation) return false;
    
    const polygon = segmentation.polygons.find(p => p.id === polygonId);
    if (!polygon) return false;
    
    // Vypočítáme pozici pro vložení bodu na segment
    const a = polygon.points[segmentIndex];
    const b = polygon.points[(segmentIndex + 1) % polygon.points.length];
    const insertPosition = calculateInsertPosition(a, b, point);
    
    // Vložíme nový bod do polygonu
    const newPoints = [...polygon.points];
    newPoints.splice(segmentIndex + 1, 0, insertPosition);
    
    // Aktualizujeme segmentaci
    const updatedPolygons = segmentation.polygons.map(p => {
      if (p.id === polygonId) {
        return {
          ...p,
          points: newPoints
        };
      }
      return p;
    });
    
    setSegmentation({
      ...segmentation,
      polygons: updatedPolygons
    });
    
    return true;
  }, [segmentation, setSegmentation, calculateInsertPosition]);
  
  /**
   * Odebrání bodu z polygonu
   */
  const removePoint = useCallback((
    polygonId: string,
    pointIndex: number
  ): boolean => {
    if (!segmentation) return false;
    
    const polygon = segmentation.polygons.find(p => p.id === polygonId);
    if (!polygon) return false;
    
    // Polygon musí mít minimálně 4 body (po odebrání zůstanou alespoň 3)
    if (polygon.points.length <= 3) {
      console.error('Polygon musí mít minimálně 3 body');
      return false;
    }
    
    // Odebereme bod z polygonu
    const newPoints = [...polygon.points];
    newPoints.splice(pointIndex, 1);
    
    // Aktualizujeme segmentaci
    const updatedPolygons = segmentation.polygons.map(p => {
      if (p.id === polygonId) {
        return {
          ...p,
          points: newPoints
        };
      }
      return p;
    });
    
    setSegmentation({
      ...segmentation,
      polygons: updatedPolygons
    });
    
    return true;
  }, [segmentation, setSegmentation]);

  return {
    calculateInsertPosition,
    distancePointToSegment,
    findClosestSegment,
    addPoint,
    removePoint
  };
};
