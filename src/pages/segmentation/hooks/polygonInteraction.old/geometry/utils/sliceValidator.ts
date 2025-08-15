
import { Point } from '@/lib/segmentation';
import { Intersection, intersectionUtils } from './intersectionUtils';

export interface ValidationResult {
  isValid: boolean;
  intersections: Intersection[];
  message: string;
}

/**
 * Validates if a slicing line is valid for polygon slicing operations
 */
export const sliceValidator = {
  /**
   * Validate a slicing line against a polygon
   */
  validateSliceLine: (
    polygonPoints: Point[],
    line: [Point, Point],
    isLineIntersectingItself: (line: [Point, Point]) => boolean
  ): ValidationResult => {
    // 1. Check if slicing line is long enough
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
    
    // 2. Check if slicing line intersects itself
    if (isLineIntersectingItself(line)) {
      return {
        isValid: false,
        intersections: [],
        message: 'Řezací linie se protíná sama se sebou'
      };
    }
    
    const intersections = intersectionUtils.calculateIntersections(polygonPoints, line);
    
    // 3. Validate number of intersections
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
  }
};
