
import { useState, useCallback, useEffect } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { TempPointsState } from '@/pages/segmentation/types';
import { toast } from 'sonner';

/**
 * Hook for managing polygon edit mode
 */
export const usePolygonEditMode = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  selectedPolygonId: string | null
) => {
  const [editMode, setEditMode] = useState(false);
  const [tempPoints, setTempPoints] = useState<TempPointsState>({
    points: [],
    startIndex: null,
    endIndex: null,
    polygonId: null
  });
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);

  // Track cursor position for edit mode line
  useEffect(() => {
    if (!editMode || tempPoints.points.length === 0) {
      setCursorPosition(null);
      return;
    }
    
    const handleMouseMove = (e: MouseEvent) => {
      const svgElement = document.querySelector('svg') as SVGSVGElement;
      if (!svgElement) return;
      
      const rect = svgElement.getBoundingClientRect();
      const point = svgElement.createSVGPoint();
      
      point.x = e.clientX - rect.left;
      point.y = e.clientY - rect.top;
      
      // Transform to SVG coordinate space
      const matrix = svgElement.getScreenCTM();
      if (matrix) {
        const transformedPoint = point.matrixTransform(matrix.inverse());
        setCursorPosition({ x: transformedPoint.x, y: transformedPoint.y });
      }
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [editMode, tempPoints.points.length]);

  /**
   * Toggle edit mode
   */
  const toggleEditMode = useCallback(() => {
    if (editMode) {
      // Reset temp points when exiting edit mode
      setTempPoints({
        points: [],
        startIndex: null,
        endIndex: null,
        polygonId: null
      });
    }
    setEditMode(!editMode);
  }, [editMode]);

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
    for (let i = 0; i < points.length - 1; i++) {
      length += distance(points[i], points[i + 1]);
    }
    return length;
  }, [distance]);

  /**
   * Add points to the polygon
   */
  const addPointsToPolygon = useCallback((
    polygonId: string,
    startIndex: number,
    endIndex: number,
    newPoints: Point[]
  ) => {
    if (!segmentation) return;
    
    const polygonIndex = segmentation.polygons.findIndex(p => p.id === polygonId);
    if (polygonIndex === -1) return;
    
    const polygon = segmentation.polygons[polygonIndex];
    const points = [...polygon.points];
    
    // There are two paths between startIndex and endIndex in a closed polygon
    // We need to determine which one to replace
    
    // Create two possible new point sets and calculate their perimeters
    const clockwisePath: Point[] = [];
    const counterClockwisePath: Point[] = [];
    
    // Path 1: Going from startIndex to endIndex
    let i = startIndex;
    while (i !== endIndex) {
      clockwisePath.push(points[i]);
      i = (i + 1) % points.length;
    }
    clockwisePath.push(points[endIndex]);
    
    // Path 2: Going from endIndex to startIndex
    i = endIndex;
    while (i !== startIndex) {
      counterClockwisePath.push(points[i]);
      i = (i + 1) % points.length;
    }
    counterClockwisePath.push(points[startIndex]);
    
    // Calculate perimeters
    const clockwiseLength = calculatePathLength(clockwisePath);
    const counterClockwiseLength = calculatePathLength(counterClockwisePath);
    
    // The new points (excluding the start and end points which already exist)
    const insertPoints = newPoints.slice(1, -1);
    
    let newPoints1: Point[];
    
    // Replace the shorter path with the new points
    if (clockwiseLength <= counterClockwiseLength) {
      // Replace clockwise path (from startIndex to endIndex)
      newPoints1 = [];
      
      // Add points up to startIndex
      for (i = 0; i <= startIndex; i++) {
        newPoints1.push(points[i]);
      }
      
      // Add new points
      newPoints1.push(...insertPoints);
      
      // Add points from endIndex onwards
      for (i = endIndex; i < points.length; i++) {
        newPoints1.push(points[i]);
      }
    } else {
      // Replace counterclockwise path (from endIndex to startIndex)
      newPoints1 = [];
      
      // Add points up to endIndex
      for (i = 0; i <= endIndex; i++) {
        newPoints1.push(points[i]);
      }
      
      // Add new points in reverse
      for (i = insertPoints.length - 1; i >= 0; i--) {
        newPoints1.push(insertPoints[i]);
      }
      
      // Add points from startIndex onwards
      for (i = startIndex; i < points.length; i++) {
        newPoints1.push(points[i]);
      }
    }
    
    // Update the polygon
    const updatedPolygons = [...segmentation.polygons];
    updatedPolygons[polygonIndex] = {
      ...polygon,
      points: newPoints1
    };
    
    setSegmentation({
      ...segmentation,
      polygons: updatedPolygons
    });
    
    // Reset temp points and exit edit mode
    setTempPoints({
      points: [],
      startIndex: null,
      endIndex: null,
      polygonId: null
    });
    
    // Automatically exit edit mode after completing a point sequence
    setEditMode(false);
    toast.success("Point sequence added successfully");
  }, [segmentation, setSegmentation, calculatePathLength]);

  /**
   * Handle click in edit mode
   */
  const handleEditModeClick = useCallback((x: number, y: number) => {
    if (!editMode || !segmentation) return;

    const clickPoint = { x, y };
    
    // Find the polygon we're working with
    const polygonId = tempPoints.polygonId || selectedPolygonId;
    if (!polygonId) return;
    
    const polygon = segmentation.polygons.find(p => p.id === polygonId);
    if (!polygon) return;
    
    // Check if we're clicking on a vertex of the same polygon
    for (let i = 0; i < polygon.points.length; i++) {
      const point = polygon.points[i];
      
      if (isNearPoint(clickPoint, point, 10)) { // Adjust threshold based on zoom
        // If this is the first point, start a new sequence
        if (tempPoints.points.length === 0) {
          console.log("Starting new point sequence at vertex", i);
          setTempPoints({
            points: [{ x: point.x, y: point.y }],
            startIndex: i,
            endIndex: null,
            polygonId
          });
          return;
        } 
        // If we have a sequence and click on a different vertex, close the sequence
        else if (tempPoints.startIndex !== null && i !== tempPoints.startIndex) {
          console.log("Ending point sequence at vertex", i);
          const newPoints = [...tempPoints.points, { x: point.x, y: point.y }];
          
          // Add the points to the polygon
          addPointsToPolygon(polygonId, tempPoints.startIndex, i, newPoints);
          return;
        }
      }
    }
    
    // If we're not clicking on a vertex but have started a sequence, add a new point
    if (tempPoints.points.length > 0 && tempPoints.startIndex !== null) {
      console.log("Adding point to sequence", clickPoint);
      setTempPoints({
        ...tempPoints,
        points: [...tempPoints.points, clickPoint]
      });
    }
  }, [editMode, segmentation, tempPoints, selectedPolygonId, isNearPoint, addPointsToPolygon]);

  return {
    editMode,
    tempPoints,
    cursorPosition,
    toggleEditMode,
    handleEditModeClick
  };
};
