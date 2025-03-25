
import { useCallback } from 'react';
import { Point } from '@/lib/segmentation';

/**
 * Hook providing geometry utility functions for polygon editing
 */
export const useGeometryUtils = () => {
  /**
   * Calculate the distance between two points
   */
  const distance = useCallback((p1: Point, p2: Point): number => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }, []);

  /**
   * Check if a point is close to another point
   */
  const isNearPoint = useCallback((p1: Point, p2: Point, threshold: number = 10): boolean => {
    return distance(p1, p2) < threshold;
  }, [distance]);

  /**
   * Calculate the path length
   */
  const calculatePathLength = useCallback((points: Point[]): number => {
    let length = 0;
    for (let i = 0; i < points.length; i++) {
      const nextIndex = (i + 1) % points.length;
      length += distance(points[i], points[nextIndex]);
    }
    return length;
  }, [distance]);

  /**
   * Calculate the area of a polygon
   */
  const calculatePolygonArea = useCallback((points: Point[]): number => {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
  }, []);

  /**
   * Check if a line is intersecting itself
   */
  const isLineIntersectingItself = useCallback((line: [Point, Point]): boolean => {
    // Jednoduchá linie se dvěma body se nemůže protínat sama se sebou
    return false;
  }, []);

  /**
   * Check if a polygon is self-intersecting
   */
  const isPolygonSelfIntersecting = useCallback((points: Point[]): boolean => {
    // Pro každý segment zkontrolujeme, zda se protíná s jiným segmentem
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      
      for (let j = i + 2; j < points.length + (i > 0 ? 0 : -1); j++) {
        const c = points[j % points.length];
        const d = points[(j + 1) % points.length];
        
        // Kontrola, zda se úsečky AB a CD protínají
        // Použijeme parametrické rovnice úseček:
        // P = a + t * (b - a)
        // Q = c + s * (d - c)
        // a hledáme t a s, pro které P = Q a kde 0 <= t,s <= 1
        
        const denominator = (d.y - c.y) * (b.x - a.x) - (d.x - c.x) * (b.y - a.y);
        
        // Přeskočíme rovnoběžné úsečky (denominator = 0)
        if (Math.abs(denominator) < 0.0001) continue;
        
        const t = ((d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x)) / denominator;
        const s = ((b.x - a.x) * (a.y - c.y) - (b.y - a.y) * (a.x - c.x)) / denominator;
        
        // Průsečík existuje pouze pokud t a s jsou v intervalu (0, 1)
        // Používáme striktní nerovnost, abychom ignorovali sdílené vrcholy
        if (t > 0 && t < 1 && s > 0 && s < 1) {
          return true;
        }
      }
    }
    
    return false;
  }, []);

  /**
   * Check if a point is inside a polygon
   */
  const isPointInPolygon = useCallback((point: Point, polygonPoints: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
      const xi = polygonPoints[i].x, yi = polygonPoints[i].y;
      const xj = polygonPoints[j].x, yj = polygonPoints[j].y;
      
      const intersect = ((yi > point.y) !== (yj > point.y))
          && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }, []);

  /**
   * Find the closest point on a segment to a given point
   */
  const findClosestPointOnSegment = useCallback((
    point: Point,
    segmentStart: Point,
    segmentEnd: Point
  ): Point => {
    const vector = { 
      x: segmentEnd.x - segmentStart.x, 
      y: segmentEnd.y - segmentStart.y 
    };
    const denominator = vector.x * vector.x + vector.y * vector.y;
    
    // Zabráníme dělení nulou (když jsou body segmentStart a segmentEnd totožné)
    if (denominator < 0.0001) {
      return segmentStart;
    }
    
    const t = Math.max(0, Math.min(1, (
      (point.x - segmentStart.x) * vector.x + 
      (point.y - segmentStart.y) * vector.y
    ) / denominator));
    
    return {
      x: segmentStart.x + t * vector.x,
      y: segmentStart.y + t * vector.y
    };
  }, []);

  return {
    distance,
    isNearPoint,
    calculatePathLength,
    calculatePolygonArea,
    isLineIntersectingItself,
    isPolygonSelfIntersecting,
    isPointInPolygon,
    findClosestPointOnSegment
  };
};
