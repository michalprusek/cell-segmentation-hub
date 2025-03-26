
import { useCallback } from 'react';
import { Point } from '@/lib/segmentation';

interface OptimalPathResult {
  indices: number[];
  start: number;
  end: number;
}

/**
 * Hook pro nalezení optimální cesty mezi dvěma body polygonu
 */
export const useOptimalPath = () => {
  /**
   * Nalezení optimální cesty mezi dvěma body polygonu
   */
  const findOptimalPath = useCallback((polygon: any, startIdx: number, endIdx: number): OptimalPathResult => {
    // Nalezení dvou možných cest mezi počátečním a koncovým bodem
    const points = polygon.points;
    const totalPoints = points.length;
    
    // Cesta 1: Dopředu od počátečního k koncovému bodu
    const path1: number[] = [];
    let idx = startIdx;
    while (idx !== endIdx) {
      path1.push(idx);
      idx = (idx + 1) % totalPoints;
    }
    path1.push(endIdx);
    
    // Cesta 2: Dozadu od počátečního ke koncovému bodu
    const path2: number[] = [];
    idx = startIdx;
    while (idx !== endIdx) {
      path2.push(idx);
      idx = (idx - 1 + totalPoints) % totalPoints;
    }
    path2.push(endIdx);
    
    // Výpočet délek cest
    const calculatePathLength = (pathIndices: number[]) => {
      let length = 0;
      for (let i = 0; i < pathIndices.length - 1; i++) {
        const p1 = points[pathIndices[i]];
        const p2 = points[pathIndices[i + 1]];
        length += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
      }
      return length;
    };
    
    const path1Length = calculatePathLength(path1);
    const path2Length = calculatePathLength(path2);
    
    // Vrátíme cestu s indexy pro nahrazení
    return path1Length <= path2Length ? 
      { indices: path1, start: startIdx, end: endIdx } : 
      { indices: path2, start: startIdx, end: endIdx };
  }, []);

  return { findOptimalPath };
};
