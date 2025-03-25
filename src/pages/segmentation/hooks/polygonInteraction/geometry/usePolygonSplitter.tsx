
import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Point, SegmentationResult } from '@/lib/segmentation';
import { useGeometryUtils } from '../editMode/useGeometryUtils';

interface Intersection {
  point: Point;
  segmentIndex: number;
  t: number; // parametrická hodnota podél segmentu (0-1)
}

interface SliceOperation {
  polygonId: string;
  startPoint: Point;
  endPoint: Point;
}

/**
 * Hook pro implementaci rozdělení polygonu (slicing)
 */
export const usePolygonSplitter = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void
) => {
  const { calculatePathLength } = useGeometryUtils();

  /**
   * Výpočet průsečíků řezací linie s polygonem
   */
  const calculateIntersections = useCallback((
    polygonPoints: Point[],
    line: [Point, Point]
  ): Intersection[] => {
    const intersections: Intersection[] = [];
    const [p1, p2] = line;

    // Pro každý segment polygonu hledáme průsečík s řezací linií
    for (let i = 0; i < polygonPoints.length; i++) {
      const j = (i + 1) % polygonPoints.length; // Zajistí uzavření polygonu
      const p3 = polygonPoints[i];
      const p4 = polygonPoints[j];

      // Výpočet průsečíku dvou úseček (line-segment intersection)
      // Používáme parametrické rovnice úseček:
      // P = p1 + t * (p2 - p1)
      // Q = p3 + s * (p4 - p3)
      // a hledáme t a s, pro které P = Q a kde 0 <= t,s <= 1
      
      const denominator = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
      
      // Přeskočíme rovnoběžné úsečky (denominator = 0)
      if (Math.abs(denominator) < 0.0001) continue;
      
      const t = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denominator;
      const s = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denominator;
      
      // Průsečík existuje pouze pokud t a s jsou v intervalu [0, 1]
      if (t >= 0 && t <= 1 && s >= 0 && s <= 1) {
        const point = {
          x: p1.x + t * (p2.x - p1.x),
          y: p1.y + t * (p2.y - p1.y)
        };
        
        // Speciální případ: průsečík je roven vrcholu polygonu
        const isVertex = (
          (Math.abs(point.x - p3.x) < 0.0001 && Math.abs(point.y - p3.y) < 0.0001) ||
          (Math.abs(point.x - p4.x) < 0.0001 && Math.abs(point.y - p4.y) < 0.0001)
        );
        
        // Ignorujeme průsečíky, které jsou přesně na vrcholech
        if (!isVertex) {
          intersections.push({
            point,
            segmentIndex: i,
            t: s // parametrická hodnota podél segmentu polygonu
          });
        }
      }
    }
    
    return intersections;
  }, []);
  
  /**
   * Validace řezací linie - kontroluje, zda řezací linie
   * protíná polygon přesně dvakrát
   */
  const validateSliceLine = useCallback((
    polygonPoints: Point[],
    line: [Point, Point]
  ): { isValid: boolean, intersections: Intersection[], message: string } => {
    const intersections = calculateIntersections(polygonPoints, line);
    
    // Řezací linie musí protínat polygon přesně dvakrát
    if (intersections.length !== 2) {
      return {
        isValid: false,
        intersections,
        message: `Řezací linie musí protínat polygon přesně dvakrát (nalezeno: ${intersections.length})`
      };
    }
    
    return {
      isValid: true,
      intersections,
      message: 'Řezací linie je validní'
    };
  }, [calculateIntersections]);
  
  /**
   * Rozdělení polygonu podle řezací linie
   */
  const splitPolygon = useCallback((
    operation: SliceOperation
  ): boolean => {
    if (!segmentation) return false;
    
    const { polygonId, startPoint, endPoint } = operation;
    const polygon = segmentation.polygons.find(p => p.id === polygonId);
    
    if (!polygon) return false;
    
    // Validace řezací linie
    const { isValid, intersections, message } = validateSliceLine(
      polygon.points,
      [startPoint, endPoint]
    );
    
    if (!isValid) {
      console.error(message);
      return false;
    }
    
    // Seřadíme průsečíky podle jejich pořadí v polygonu
    intersections.sort((a, b) => {
      if (a.segmentIndex !== b.segmentIndex) {
        return a.segmentIndex - b.segmentIndex;
      }
      return a.t - b.t;
    });
    
    const [int1, int2] = intersections;
    
    // Vytvoříme dva nové polygony
    const poly1Points: Point[] = [];
    const poly2Points: Point[] = [];
    
    // První část: od prvního průsečíku k druhému ve směru hodinových ručiček
    let i = int1.segmentIndex;
    poly1Points.push(int1.point);
    
    while (i !== int2.segmentIndex) {
      i = (i + 1) % polygon.points.length;
      poly1Points.push(polygon.points[i]);
    }
    
    poly1Points.push(int2.point);
    
    // Druhá část: od druhého průsečíku k prvnímu ve směru hodinových ručiček
    i = int2.segmentIndex;
    poly2Points.push(int2.point);
    
    while (i !== int1.segmentIndex) {
      i = (i + 1) % polygon.points.length;
      poly2Points.push(polygon.points[i]);
    }
    
    poly2Points.push(int1.point);
    
    // Vypočítáme plochy nových polygonů a rozhodneme, který zachovat
    // Pro jednoduchost použijeme délku obvodu jako heuristiku
    const length1 = calculatePathLength(poly1Points);
    const length2 = calculatePathLength(poly2Points);
    
    // Vybereme větší polygon
    const newPolygonPoints = length1 > length2 ? poly1Points : poly2Points;
    
    // Aktualizujeme segmentaci s novým polygonem
    const updatedPolygons = segmentation.polygons.map(p => {
      if (p.id === polygonId) {
        return {
          ...p,
          points: newPolygonPoints
        };
      }
      return p;
    });
    
    setSegmentation({
      ...segmentation,
      polygons: updatedPolygons
    });
    
    return true;
  }, [segmentation, setSegmentation, validateSliceLine, calculatePathLength]);

  /**
   * Rozdělení polygonu na dva samostatné polygony
   */
  const splitIntoTwoPolygons = useCallback((
    operation: SliceOperation
  ): boolean => {
    if (!segmentation) return false;
    
    const { polygonId, startPoint, endPoint } = operation;
    const polygon = segmentation.polygons.find(p => p.id === polygonId);
    
    if (!polygon) return false;
    
    // Validace řezací linie
    const { isValid, intersections, message } = validateSliceLine(
      polygon.points,
      [startPoint, endPoint]
    );
    
    if (!isValid) {
      console.error(message);
      return false;
    }
    
    // Seřadíme průsečíky podle jejich pořadí v polygonu
    intersections.sort((a, b) => {
      if (a.segmentIndex !== b.segmentIndex) {
        return a.segmentIndex - b.segmentIndex;
      }
      return a.t - b.t;
    });
    
    const [int1, int2] = intersections;
    
    // Vytvoříme dva nové polygony
    const poly1Points: Point[] = [];
    const poly2Points: Point[] = [];
    
    // První část: od prvního průsečíku k druhému ve směru hodinových ručiček
    let i = int1.segmentIndex;
    poly1Points.push(int1.point);
    
    while (i !== int2.segmentIndex) {
      i = (i + 1) % polygon.points.length;
      poly1Points.push(polygon.points[i]);
    }
    
    poly1Points.push(int2.point);
    
    // Druhá část: od druhého průsečíku k prvnímu ve směru hodinových ručiček
    i = int2.segmentIndex;
    poly2Points.push(int2.point);
    
    while (i !== int1.segmentIndex) {
      i = (i + 1) % polygon.points.length;
      poly2Points.push(polygon.points[i]);
    }
    
    poly2Points.push(int1.point);
    
    // Vytvoříme nové ID pro druhý polygon
    const newPolygonId = uuidv4();
    
    // Aktualizujeme první polygon a přidáme druhý
    const updatedPolygons = segmentation.polygons.map(p => {
      if (p.id === polygonId) {
        return {
          ...p,
          points: poly1Points
        };
      }
      return p;
    });
    
    // Přidáme druhý polygon
    updatedPolygons.push({
      ...polygon,
      id: newPolygonId,
      points: poly2Points
    });
    
    setSegmentation({
      ...segmentation,
      polygons: updatedPolygons
    });
    
    return true;
  }, [segmentation, setSegmentation, validateSliceLine]);

  return {
    calculateIntersections,
    validateSliceLine,
    splitPolygon,
    splitIntoTwoPolygons
  };
};
