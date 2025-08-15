
import { useCallback } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';

/**
 * Hook for modifying polygon paths (adding/removing points)
 */
export const usePathModification = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void
) => {
  /**
   * Modify polygon path by replacing a segment between two points with a new path
   * @param polygonId ID polygonu, jehož cestu chceme upravit
   * @param startIndex Index počátečního bodu segmentu
   * @param endIndex Index koncového bodu segmentu
   * @param newPoints Nové body, které nahradí segment (včetně počátečního a koncového bodu)
   * @param clockwise Směr cesty (true = po směru hodinových ručiček, false = proti směru)
   */
  const modifyPolygonPath = useCallback((
    polygonId: string | null,
    startIndex: number | null,
    endIndex: number | null,
    newPoints: Point[],
    clockwise: boolean = true
  ): boolean => {
    if (!segmentation || !polygonId || startIndex === null || endIndex === null) return false;
    
    try {
      // Find target polygon
      const polygonIndex = segmentation.polygons.findIndex(p => p.id === polygonId);
      if (polygonIndex === -1) return false;
      
      const polygon = segmentation.polygons[polygonIndex];
      const totalPoints = polygon.points.length;
      
      // Pokud jsou body stejné, nemůžeme provést modifikaci
      if (startIndex === endIndex) return false;
      
      console.log(`Modifying path from vertex ${startIndex} to ${endIndex} (${clockwise ? 'clockwise' : 'counter-clockwise'}) with ${newPoints.length} points`);
      
      // Vytvoříme nové pole bodů polygonu
      let newPolygonPoints: Point[] = [];
      
      // Čtyři hlavní části:
      // 1. Bod startIndex
      // 2. Nová cesta (newPoints bez duplicitního startIndex a endIndex)
      // 3. Bod endIndex
      // 4. Zbytek polygonu (všechny body, které nejsou mezi startIndex a endIndex)
      
      // Začínáme s prázdným polem a postupně přidáváme body podle směru
      if (clockwise) {
        // Po směru hodinových ručiček
        
        // Najdeme index za endIndex (směrem po indexech)
        const afterEndIndex = (endIndex + 1) % totalPoints;
        
        // Přidáme všechny body od afterEndIndex do startIndex
        let i = afterEndIndex;
        while (i !== startIndex) {
          newPolygonPoints.push(polygon.points[i]);
          i = (i + 1) % totalPoints;
        }
        
        // Přidáme startIndex
        newPolygonPoints.push(polygon.points[startIndex]);
        
        // Přidáme nové body (bez prvního a posledního, abychom předešli duplicitě)
        if (newPoints.length > 2) {
          newPolygonPoints = [...newPolygonPoints, ...newPoints.slice(1, -1)];
        }
        
        // Přidáme endIndex
        newPolygonPoints.push(polygon.points[endIndex]);
        
      } else {
        // Proti směru hodinových ručiček (reversed)
        
        // Najdeme index za startIndex (směrem po indexech)
        const afterStartIndex = (startIndex + 1) % totalPoints;
        
        // Přidáme všechny body od afterStartIndex do endIndex
        let i = afterStartIndex;
        while (i !== endIndex) {
          newPolygonPoints.push(polygon.points[i]);
          i = (i + 1) % totalPoints;
        }
        
        // Přidáme endIndex
        newPolygonPoints.push(polygon.points[endIndex]);
        
        // Přidáme nové body v opačném pořadí (bez prvního a posledního)
        if (newPoints.length > 2) {
          const reversedNewPoints = [...newPoints.slice(1, -1)].reverse();
          newPolygonPoints = [...newPolygonPoints, ...reversedNewPoints];
        }
        
        // Přidáme startIndex
        newPolygonPoints.push(polygon.points[startIndex]);
      }
      
      console.log(`Created new polygon with ${newPolygonPoints.length} points (original had ${totalPoints})`);
      
      // Create new polygon object
      const newPolygon = {
        ...polygon,
        points: newPolygonPoints
      };
      
      // Create new polygons array
      const newPolygons = [...segmentation.polygons];
      newPolygons[polygonIndex] = newPolygon;
      
      // Update segmentation
      setSegmentation({
        ...segmentation,
        polygons: newPolygons
      });
      
      return true;
    } catch (error) {
      console.error('Error modifying polygon path:', error);
      return false;
    }
  }, [segmentation, setSegmentation]);

  return {
    modifyPolygonPath
  };
};

