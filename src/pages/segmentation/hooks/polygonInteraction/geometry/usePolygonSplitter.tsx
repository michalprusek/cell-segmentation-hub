
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
  const { calculatePathLength, isLineIntersectingItself } = useGeometryUtils();

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
   * protíná polygon přesně dvakrát a není sama průsečíkem
   */
  const validateSliceLine = useCallback((
    polygonPoints: Point[],
    line: [Point, Point]
  ): { isValid: boolean, intersections: Intersection[], message: string } => {
    // 1. Vylepšení: Kontrola, zda je řezací linie dostatečně dlouhá
    const [start, end] = line;
    const lineLength = Math.sqrt(
      Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
    );
    
    if (lineLength < 5) {
      return {
        isValid: false,
        intersections: [],
        message: 'Řezací linie je příliš krátká'
      };
    }
    
    // 2. Vylepšení: Kontrola, zda řezací linie neprotíná sama sebe
    if (isLineIntersectingItself(line)) {
      return {
        isValid: false,
        intersections: [],
        message: 'Řezací linie se protíná sama se sebou'
      };
    }
    
    const intersections = calculateIntersections(polygonPoints, line);
    
    // 3. Vylepšení: Detailnější zprávy o počtu průsečíků
    if (intersections.length === 0) {
      return {
        isValid: false,
        intersections,
        message: 'Řezací linie neprotíná polygon'
      };
    } else if (intersections.length === 1) {
      return {
        isValid: false,
        intersections,
        message: 'Řezací linie musí protínat polygon alespoň dvakrát'
      };
    } else if (intersections.length > 2) {
      return {
        isValid: false,
        intersections,
        message: `Řezací linie protíná polygon příliš mnohokrát (${intersections.length}x)`
      };
    }
    
    return {
      isValid: true,
      intersections,
      message: 'Řezací linie je validní'
    };
  }, [calculateIntersections, isLineIntersectingItself]);
  
  /**
   * Rozdělení polygonu podle řezací linie s vylepšeným algoritmem
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
    
    // 4. Vylepšení: Přesnější algoritmus rozdělení
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
    
    // 5. Vylepšení: Použití lepší heuristiky pro výběr části k zachování
    // Nejprve spočítáme plochu obou polygonů
    const calculatePolygonArea = (points: Point[]): number => {
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
      }
      return Math.abs(area) / 2;
    };
    
    const area1 = calculatePolygonArea(poly1Points);
    const area2 = calculatePolygonArea(poly2Points);
    
    // Použijeme kombinovanou metriku - plocha a délka obvodu
    const length1 = calculatePathLength(poly1Points);
    const length2 = calculatePathLength(poly2Points);
    
    // Normalizované metriky (větší hodnota = důležitější část)
    const score1 = (area1 * 0.7) + (length1 * 0.3);
    const score2 = (area2 * 0.7) + (length2 * 0.3);
    
    // Vybereme polygon s vyšším skóre
    const newPolygonPoints = score1 > score2 ? poly1Points : poly2Points;
    
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
   * Rozdělení polygonu na dva samostatné polygony s vylepšením
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
    
    // Vylepšení: Validace výsledných polygonů - musí mít alespoň 3 body
    if (poly1Points.length < 3 || poly2Points.length < 3) {
      return false;
    }
    
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
