
import { useCallback } from 'react';
import { Point } from '@/lib/segmentation';
import { SpatialGrid } from './utils/SpatialGrid';
import { useGeometryUtils } from '../editMode/useGeometryUtils';

/**
 * Hook pro hledání segmentů v polygonu
 */
export const useSegmentFinder = () => {
  const { findClosestPointOnSegment, distance } = useGeometryUtils();

  /**
   * Výpočet pozice pro vložení bodu na úsečku
   */
  const calculateInsertPosition = useCallback((
    a: Point,
    b: Point,
    cursor: Point
  ): Point => {
    // Get the object returned by findClosestPointOnSegment
    const result = findClosestPointOnSegment(cursor, a, b);
    // Return just the point
    return result.point;
  }, [findClosestPointOnSegment]);

  /**
   * Výpočet vzdálenosti bodu od úsečky
   */
  const distancePointToSegment = useCallback((
    point: Point,
    segmentStart: Point,
    segmentEnd: Point
  ): number => {
    const projectedPoint = calculateInsertPosition(segmentStart, segmentEnd, point);
    return distance(point, projectedPoint);
  }, [calculateInsertPosition, distance]);

  /**
   * Nalezení nejbližšího segmentu k zadanému bodu s optimalizací
   */
  const findClosestSegment = useCallback((
    point: Point,
    polygonPoints: Point[],
    threshold: number = 10
  ): { segmentIndex: number, distance: number, projectedPoint: Point } | null => {
    // Optimalizace: Pro malé polygony (méně než 100 bodů) použijeme přímý výpočet
    if (polygonPoints.length < 100) {
      let closestSegment = -1;
      let minDistance = Infinity;
      let closestProjection: Point = { x: 0, y: 0 };
      
      for (let i = 0; i < polygonPoints.length; i++) {
        const j = (i + 1) % polygonPoints.length; // Zajistí uzavření polygonu
        const projectedPoint = calculateInsertPosition(polygonPoints[i], polygonPoints[j], point);
        const segmentDistance = distance(point, projectedPoint);
        
        if (segmentDistance < minDistance) {
          minDistance = segmentDistance;
          closestSegment = i;
          closestProjection = projectedPoint;
        }
      }
      
      if (minDistance <= threshold && closestSegment !== -1) {
        return {
          segmentIndex: closestSegment,
          distance: minDistance,
          projectedPoint: closestProjection
        };
      }
      
      return null;
    } 
    // Optimalizace: Pro velké polygony použijeme prostorové indexování
    else {
      // Vytvoříme prostorovou mřížku
      const grid = new SpatialGrid(polygonPoints, 50);
      
      // Najdeme potenciální segmenty v okolí bodu
      const potentialPoints = grid.findPointsInRadius(point, threshold * 2);
      const processedSegments = new Set<number>();
      
      let closestSegment = -1;
      let minDistance = Infinity;
      let closestProjection: Point = { x: 0, y: 0 };
      
      // Kontrolujeme jen segmenty v okolí
      for (const pointIndex of potentialPoints) {
        // Kontrolujeme segment začínající v tomto bodě
        const segmentIndex = pointIndex;
        if (!processedSegments.has(segmentIndex)) {
          processedSegments.add(segmentIndex);
          
          const nextIndex = (pointIndex + 1) % polygonPoints.length;
          const projectedPoint = calculateInsertPosition(
            polygonPoints[pointIndex], 
            polygonPoints[nextIndex], 
            point
          );
          const segmentDistance = distance(point, projectedPoint);
          
          if (segmentDistance < minDistance) {
            minDistance = segmentDistance;
            closestSegment = segmentIndex;
            closestProjection = projectedPoint;
          }
        }
        
        // Kontrolujeme segment končící v tomto bodě
        const prevSegmentIndex = (pointIndex - 1 + polygonPoints.length) % polygonPoints.length;
        if (!processedSegments.has(prevSegmentIndex)) {
          processedSegments.add(prevSegmentIndex);
          
          const projectedPoint = calculateInsertPosition(
            polygonPoints[prevSegmentIndex], 
            polygonPoints[pointIndex], 
            point
          );
          const segmentDistance = distance(point, projectedPoint);
          
          if (segmentDistance < minDistance) {
            minDistance = segmentDistance;
            closestSegment = prevSegmentIndex;
            closestProjection = projectedPoint;
          }
        }
      }
      
      if (minDistance <= threshold && closestSegment !== -1) {
        return {
          segmentIndex: closestSegment,
          distance: minDistance,
          projectedPoint: closestProjection
        };
      }
      
      return null;
    }
  }, [calculateInsertPosition, distance]);

  return {
    calculateInsertPosition,
    distancePointToSegment,
    findClosestSegment
  };
};
