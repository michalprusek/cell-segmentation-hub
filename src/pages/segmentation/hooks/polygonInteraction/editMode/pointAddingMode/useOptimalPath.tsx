
import { useCallback } from 'react';
import { Point } from '@/lib/segmentation';

/**
 * Hook pro nalezení optimální cesty mezi dvěma body v polygonu
 */
export const useOptimalPath = () => {
  /**
   * Najde optimální cestu mezi dvěma body v polygonu
   * Optimální = ta, která vytvoří menší obvod výsledného polygonu
   */
  const findOptimalPath = useCallback((polygon: { points: Point[] }, startIndex: number, endIndex: number) => {
    const points = polygon.points;
    const numPoints = points.length;
    
    // Dvě možné cesty mezi body:
    // Cesta 1: startIndex -> endIndex (v pořadí indexů)
    // Cesta 2: endIndex -> startIndex (přes začátek/konec pole)
    
    // Vytvoříme indexy bodů na cestě 1
    const path1Indices: number[] = [];
    let i = startIndex;
    while (i !== endIndex) {
      path1Indices.push(i);
      i = (i + 1) % numPoints;
    }
    path1Indices.push(endIndex);
    
    // Vytvoříme indexy bodů na cestě 2
    const path2Indices: number[] = [];
    i = endIndex;
    while (i !== startIndex) {
      path2Indices.push(i);
      i = (i + 1) % numPoints;
    }
    path2Indices.push(startIndex);
    
    // Vypočítáme délku obou cest
    const calculatePathLength = (indices: number[]) => {
      let length = 0;
      for (let i = 0; i < indices.length - 1; i++) {
        const p1 = points[indices[i]];
        const p2 = points[indices[i + 1]];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        length += Math.sqrt(dx * dx + dy * dy);
      }
      return length;
    };
    
    const path1Length = calculatePathLength(path1Indices);
    const path2Length = calculatePathLength(path2Indices);
    
    // Vrátíme kratší cestu (s menším obvodem)
    if (path1Length <= path2Length) {
      return {
        indices: path1Indices,
        start: startIndex,
        end: endIndex
      };
    } else {
      return {
        indices: path2Indices,
        start: endIndex,
        end: startIndex
      };
    }
  }, []);
  
  return { findOptimalPath };
};
