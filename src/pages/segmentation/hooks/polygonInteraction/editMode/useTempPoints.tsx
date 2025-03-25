
import { useState, useEffect, useCallback } from 'react';
import { Point } from '@/lib/segmentation';
import { TempPointsState } from '@/pages/segmentation/types';
import { useCoordinateTransform } from '../useCoordinateTransform';

/**
 * Hook for managing temporary points during edit mode
 */
export const useTempPoints = (
  editMode: boolean,
  zoom: number = 1,
  offset: { x: number; y: number } = { x: 0, y: 0 }
) => {
  const [tempPoints, setTempPoints] = useState<TempPointsState>({
    points: [],
    startIndex: null,
    endIndex: null,
    polygonId: null
  });
  
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);
  const [isShiftPressed, setIsShiftPressed] = useState<boolean>(false);
  
  const { getImageCoordinates } = useCoordinateTransform(zoom, offset);

  // Track cursor position for edit mode line
  useEffect(() => {
    if (!editMode) {
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
  }, [editMode]);
  
  // Track shift key for auto-point addition
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(true);
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setIsShiftPressed(false);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Function to add point to temp points
  const addPointToTemp = useCallback((point: Point) => {
    setTempPoints(prev => ({
      ...prev,
      points: [...prev.points, point]
    }));
  }, []);
  
  // Function to reset temp points
  const resetTempPoints = useCallback(() => {
    setTempPoints({
      points: [],
      startIndex: null,
      endIndex: null,
      polygonId: null
    });
  }, []);

  return {
    tempPoints,
    setTempPoints,
    cursorPosition,
    resetTempPoints,
    addPointToTemp,
    isShiftPressed
  };
};
