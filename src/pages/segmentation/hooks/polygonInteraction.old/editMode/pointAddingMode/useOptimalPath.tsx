
import { useCallback } from 'react';
import { Point } from '@/lib/segmentation';

/**
 * Hook pro nalezení optimální cesty mezi dvěma body v polygonu
 */
export const useOptimalPath = () => {
  /**
   * Najde optimální cestu mezi dvěma body v polygonu
   * Optimální = ta, která vytvoří polygon s minimálním obvodem
   */
  const findOptimalPath = useCallback((polygon: { points: Point[] }, startIndex: number, endIndex: number) => {
    const points = polygon.points;
    const numPoints = points.length;
    
    if (startIndex === endIndex) {
      console.warn("Počáteční a koncový bod jsou stejné, nelze vytvořit cestu");
      return {
        indices: [startIndex],
        start: startIndex,
        end: startIndex
      };
    }
    
    // Vždy vytvoříme dvě možné cesty mezi body bez ohledu na orientaci polygonu:
    // Cesta 1: startIndex -> endIndex (po směru)
    // Cesta 2: endIndex -> startIndex (proti směru)
    
    // Vytvoříme pole indexů pro obě cesty
    const path1Indices: number[] = [];
    const path2Indices: number[] = [];
    
    // Cesta 1: od startIndex k endIndex
    let i = startIndex;
    while (i !== endIndex) {
      path1Indices.push(i);
      i = (i + 1) % numPoints;
    }
    path1Indices.push(endIndex);
    
    // Cesta 2: od startIndex k endIndex (druhým směrem)
    i = startIndex;
    while (i !== endIndex) {
      path2Indices.push(i);
      i = (i - 1 + numPoints) % numPoints; // Jdeme pozpátku s korekcí pro záporné indexy
    }
    path2Indices.push(endIndex);
    
    // Vybíráme kratší cestu, ale používáme přímý výpočet vzdálenosti
    // místo aproximace pomocí počtu indexů
    let path1Length = 0;
    let path2Length = 0;
    
    // Výpočet délky cesty 1
    for (let j = 0; j < path1Indices.length - 1; j++) {
      const p1 = points[path1Indices[j]];
      const p2 = points[path1Indices[j + 1]];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      path1Length += Math.sqrt(dx * dx + dy * dy);
    }
    
    // Výpočet délky cesty 2
    for (let j = 0; j < path2Indices.length - 1; j++) {
      const p1 = points[path2Indices[j]];
      const p2 = points[path2Indices[j + 1]];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      path2Length += Math.sqrt(dx * dx + dy * dy);
    }
    
    console.log(`Cesta 1 (${startIndex}->${endIndex}): délka=${path1Length.toFixed(2)}, body=${path1Indices.length}`);
    console.log(`Cesta 2 (${startIndex}->${endIndex} zpátky): délka=${path2Length.toFixed(2)}, body=${path2Indices.length}`);
    
    // Vrátíme informace o kratší cestě
    if (path1Length <= path2Length) {
      return {
        indices: path1Indices,
        start: startIndex,
        end: endIndex,
        clockwise: true
      };
    } else {
      return {
        indices: path2Indices,
        start: startIndex,
        end: endIndex,
        clockwise: false
      };
    }
  }, []);
  
  return { findOptimalPath };
};

