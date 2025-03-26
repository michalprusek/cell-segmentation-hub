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
   * Considering the optimal path between the points
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
      
      // Create a new array of points
      let newPolygonPoints: Point[] = [];
      
      // Find all points that should be kept (those that are not between start and end)
      const keepPoints: Point[] = [];
      let shouldKeep = true;
      let currentIndex = 0;
      
      // Projdeme body polygonu a zachováme pouze ty, které nejsou mezi startIndex a endIndex
      while (currentIndex < totalPoints) {
        if (currentIndex === startIndex) {
          // Začátek nahrazované části
          keepPoints.push(polygon.points[currentIndex]); // Zachováme počáteční bod
          shouldKeep = false;
        } else if (currentIndex === endIndex) {
          // Konec nahrazované části
          keepPoints.push(polygon.points[currentIndex]); // Zachováme koncový bod
          shouldKeep = true;
        } else if (shouldKeep) {
          // Body mimo nahrazovanou část
          keepPoints.push(polygon.points[currentIndex]);
        }
        
        currentIndex++;
        // Po dosažení konce pole začneme znovu od začátku, pokud jsme ještě nenašli endIndex
        if (currentIndex === totalPoints && shouldKeep === false) {
          currentIndex = 0;
        } else if (currentIndex === totalPoints) {
          break;
        }
      }
      
      // Najít pozici startIndex v keepPoints
      const startKeepIndex = keepPoints.findIndex(p => 
        p.x === polygon.points[startIndex].x && p.y === polygon.points[startIndex].y);
      
      if (startKeepIndex >= 0) {
        // Vložíme nové body mezi start a end
        newPolygonPoints = [
          ...keepPoints.slice(0, startKeepIndex + 1),
          ...newPoints,
          ...keepPoints.slice(startKeepIndex + 1)
        ];
      } else {
        // Fallback pokud něco selhalo
        console.error("Failed to find start point in kept points");
        return false;
      }
      
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
