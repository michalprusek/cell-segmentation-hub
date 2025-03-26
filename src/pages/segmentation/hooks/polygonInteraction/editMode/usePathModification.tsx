
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
   */
  const modifyPolygonPath = useCallback((
    polygonId: string | null,
    startIndex: number | null,
    endIndex: number | null,
    newPoints: Point[]
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
      
      console.log(`Modifying path from vertex ${startIndex} to ${endIndex} with ${newPoints.length} points`);
      
      // Vytvoříme nové pole bodů, kde zachováme body, které nejsou mezi startIndex a endIndex
      let newPolygonPoints: Point[] = [];
      
      // Zjistíme, jestli jdeme od startIndex k endIndex ve směru nebo proti směru hodinových ručiček
      const isClockwise = (endIndex > startIndex) ? 
        (endIndex - startIndex <= totalPoints / 2) : 
        (startIndex - endIndex > totalPoints / 2);
      
      if (isClockwise) {
        // Jdeme ve směru indexů (po směru hodinových ručiček)
        // Body před segmentem
        newPolygonPoints = polygon.points.slice(0, startIndex);
        
        // Nové body (bez duplicity koncového bodu)
        newPolygonPoints = [...newPolygonPoints, ...newPoints];
        
        // Body za segmentem
        // Pokud endIndex není poslední bod, přidáme zbývající body
        if (endIndex < totalPoints - 1) {
          newPolygonPoints = [...newPolygonPoints.slice(0, -1), ...polygon.points.slice(endIndex)];
        }
      } else {
        // Jdeme proti směru indexů (proti směru hodinových ručiček)
        // Body za endIndex
        newPolygonPoints = polygon.points.slice(endIndex);
        
        // Nové body
        newPolygonPoints = [...newPolygonPoints, ...newPoints.slice(1)];
        
        // Body před startIndex
        if (startIndex > 0) {
          newPolygonPoints = [...newPolygonPoints, ...polygon.points.slice(0, startIndex + 1)];
        }
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
