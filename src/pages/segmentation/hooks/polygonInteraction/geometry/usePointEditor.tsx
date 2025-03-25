
import { useCallback } from 'react';
import { Point, SegmentationResult } from '@/lib/segmentation';
import { useGeometryUtils } from '../editMode/useGeometryUtils';

/**
 * Spatial Grid pro optimalizaci vyhledávání bodů v polygonu
 */
class SpatialGrid {
  private grid: Map<string, number[]> = new Map();
  private cellSize: number;
  private points: Point[];

  constructor(points: Point[], cellSize = 50) {
    this.points = points;
    this.cellSize = cellSize;
    this.buildIndex();
  }

  private buildIndex(): void {
    this.points.forEach((p, i) => {
      const key = this.getCellKey(p);
      if (!this.grid.has(key)) {
        this.grid.set(key, []);
      }
      this.grid.get(key)?.push(i);
    });
  }

  private getCellKey(point: Point): string {
    const cellX = Math.floor(point.x / this.cellSize);
    const cellY = Math.floor(point.y / this.cellSize);
    return `${cellX},${cellY}`;
  }

  findPointsInRadius(center: Point, radius: number): number[] {
    const result: number[] = [];
    const cellRadius = Math.ceil(radius / this.cellSize);
    
    const centerCellX = Math.floor(center.x / this.cellSize);
    const centerCellY = Math.floor(center.y / this.cellSize);
    
    // Procházíme okolní buňky
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const key = `${centerCellX + dx},${centerCellY + dy}`;
        const cellPoints = this.grid.get(key) || [];
        
        // Kontrolujeme body v buňce
        for (const pointIndex of cellPoints) {
          const point = this.points[pointIndex];
          const dist = Math.sqrt(
            Math.pow(point.x - center.x, 2) + 
            Math.pow(point.y - center.y, 2)
          );
          
          if (dist <= radius) {
            result.push(pointIndex);
          }
        }
      }
    }
    
    return result;
  }
}

/**
 * Hook pro práci s body polygonu - přidávání, mazání a přesouvání bodů
 */
export const usePointEditor = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void
) => {
  const {
    findClosestPointOnSegment,
    distance,
    isPolygonSelfIntersecting
  } = useGeometryUtils();

  /**
   * Výpočet pozice pro vložení bodu na úsečku
   */
  const calculateInsertPosition = useCallback((
    a: Point,
    b: Point,
    cursor: Point
  ): Point => {
    return findClosestPointOnSegment(cursor, a, b);
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
   * Optimalizace polygonu - zjednodušuje polygon odstraněním redundantních bodů
   */
  const simplifyPolygon = useCallback((
    polygonId: string, 
    tolerance: number = 1.0
  ): boolean => {
    if (!segmentation) return false;
    
    const polygon = segmentation.polygons.find(p => p.id === polygonId);
    if (!polygon || polygon.points.length <= 3) return false;
    
    // Implementace Douglas-Peucker algoritmu pro zjednodušení polygonu
    const douglasPeucker = (points: Point[], start: number, end: number, tolerance: number): number[] => {
      // Ukončovací podmínka - pokud jsou body vedle sebe, není co zjednodušovat
      if (end - start <= 1) return [start, end];
      
      // Najdeme bod nejvíce vzdálený od přímky start-end
      let maxDist = 0;
      let maxIndex = start;
      
      const startPoint = points[start];
      const endPoint = points[end];
      
      for (let i = start + 1; i < end; i++) {
        const dist = distancePointToSegment(points[i], startPoint, endPoint);
        if (dist > maxDist) {
          maxDist = dist;
          maxIndex = i;
        }
      }
      
      // Pokud je vzdálenost menší než tolerance, můžeme odstranit všechny body mezi
      if (maxDist <= tolerance) {
        return [start, end];
      }
      
      // Jinak rekurzivně zjednodušíme obě části
      const leftIndices = douglasPeucker(points, start, maxIndex, tolerance);
      const rightIndices = douglasPeucker(points, maxIndex, end, tolerance);
      
      // Spojíme výsledky (bez duplicity)
      return [...leftIndices.slice(0, -1), ...rightIndices];
    };
    
    // Protože pracujeme s uzavřeným polygonem, musíme najít vhodné startovní body
    const points = polygon.points;
    const n = points.length;
    
    // Najdeme dva body s největší vzdáleností jako základ
    let maxDist = 0;
    let furthestPair: [number, number] = [0, 0];
    
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dist = distance(points[i], points[j]);
        if (dist > maxDist) {
          maxDist = dist;
          furthestPair = [i, j];
        }
      }
    }
    
    // Zjednodušíme polygon ve dvou částech
    const indices1 = douglasPeucker(points, furthestPair[0], furthestPair[1], tolerance);
    const indices2 = douglasPeucker(points, furthestPair[1], furthestPair[0] + n, tolerance);
    
    // Kombinujeme výsledky a odstraňujeme duplicity
    let simplifiedIndices = [...indices1.slice(0, -1), ...indices2.slice(0, -1)];
    
    // Normalizujeme indexy (mohou být větší než n)
    simplifiedIndices = simplifiedIndices.map(i => i % n);
    
    // Odstraníme duplicity a seřadíme
    simplifiedIndices = [...new Set(simplifiedIndices)].sort((a, b) => a - b);
    
    // Vytvoříme nový polygon pouze s vybranými body
    const simplifiedPoints = simplifiedIndices.map(i => points[i]);
    
    // Validace: zjednodušený polygon musí mít alespoň 3 body
    if (simplifiedPoints.length < 3) return false;
    
    // Validace integrity: kontrola self-intersection
    if (isPolygonSelfIntersecting(simplifiedPoints)) {
      console.error('Zjednodušení by způsobilo self-intersection polygonu');
      return false;
    }
    
    // Aktualizujeme segmentaci
    const updatedPolygons = segmentation.polygons.map(p => {
      if (p.id === polygonId) {
        return {
          ...p,
          points: simplifiedPoints
        };
      }
      return p;
    });
    
    setSegmentation({
      ...segmentation,
      polygons: updatedPolygons
    });
    
    return true;
  }, [segmentation, setSegmentation, distancePointToSegment, distance, isPolygonSelfIntersecting]);

  return {
    calculateInsertPosition,
    distancePointToSegment,
    findClosestSegment,
    addPoint,
    removePoint,
    simplifyPolygon
  };
};
