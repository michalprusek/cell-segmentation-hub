
import { useState, useEffect } from 'react';
import { Point } from '@/lib/segmentation';
import { TempPointsState } from '@/pages/segmentation/types';

/**
 * Hook for managing temporary points during edit mode
 */
export const useTempPoints = (
  editMode: boolean
) => {
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
  
  // Function to reset temp points
  const resetTempPoints = () => {
    setTempPoints({
      points: [],
      startIndex: null,
      endIndex: null,
      polygonId: null
    });
  };

  return {
    tempPoints,
    setTempPoints,
    cursorPosition,
    resetTempPoints
  };
};
