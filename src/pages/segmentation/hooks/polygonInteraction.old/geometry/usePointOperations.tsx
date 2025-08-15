
import { useCallback } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { useSegmentFinder } from './useSegmentFinder';
import { useGeometryUtils } from '../editMode/useGeometryUtils';

/**
 * Hook pro základní operace s body polygonu
 */
export const usePointOperations = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void
) => {
  const { calculateInsertPosition } = useSegmentFinder();
  const { isPolygonSelfIntersecting } = useGeometryUtils();

  /**
   * Přidání nového bodu do polygonu s validací integrity
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
    
    // Validace integrity: kontrola self-intersection
    if (isPolygonSelfIntersecting(newPoints)) {
      console.error('Přidání bodu by způsobilo self-intersection polygonu');
      return false;
    }
    
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
  }, [segmentation, setSegmentation, calculateInsertPosition, isPolygonSelfIntersecting]);
  
  /**
   * Odebrání bodu z polygonu s validací integrity
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
    
    // Validace integrity: kontrola self-intersection
    if (isPolygonSelfIntersecting(newPoints)) {
      console.error('Odebrání bodu by způsobilo self-intersection polygonu');
      return false;
    }
    
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
  }, [segmentation, setSegmentation, isPolygonSelfIntersecting]);

  /**
   * Duplikace bodu polygonu
   */
  const duplicatePoint = useCallback((
    polygonId: string, 
    pointIndex: number
  ): boolean => {
    if (!segmentation) return false;
    
    const polygon = segmentation.polygons.find(p => p.id === polygonId);
    if (!polygon) return false;
    
    const point = polygon.points[pointIndex];
    if (!point) return false;
    
    // Výpočet nové pozice - mírně posunuté od původního bodu
    const newPoint = {
      x: point.x + 5,
      y: point.y + 5
    };
    
    // Vložíme duplikovaný bod za původní bod
    const newPoints = [...polygon.points];
    newPoints.splice(pointIndex + 1, 0, newPoint);
    
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
    addPoint,
    removePoint,
    duplicatePoint
  };
};
