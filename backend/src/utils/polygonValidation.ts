import { logger } from '../utils/logger';

export interface PolygonPoint {
  x: number;
  y: number;
}

export interface Polygon {
  id?: string;
  points: PolygonPoint[];
  color?: string;
  category?: string;
  confidence?: number;
}

export interface ParsedPolygonResult {
  polygons: Polygon[];
  isValid: boolean;
  error?: string;
}

/**
 * Centralized polygon validation and parsing utility
 * This eliminates code duplication across the segmentation service
 */
export class PolygonValidator {
  /**
   * Safely parse polygon JSON data with comprehensive validation
   * @param polygonData Raw polygon data (string or already parsed)
   * @param context Context for logging (e.g., 'single-fetch', 'batch-fetch')
   * @param imageId Optional image ID for detailed logging
   * @returns Validated polygon data with success status
   */
  static parsePolygonData(
    polygonData: string | any, 
    context: string = 'unknown', 
    imageId?: string
  ): ParsedPolygonResult {
    try {
      let parsed: any;
      
      // Handle string input - parse JSON
      if (typeof polygonData === 'string') {
        if (polygonData.trim() === '' || polygonData === 'null') {
          return { polygons: [], isValid: true };
        }
        
        try {
          parsed = JSON.parse(polygonData);
        } catch (parseError) {
          logger.error(
            'Failed to parse polygons JSON', 
            parseError instanceof Error ? parseError : undefined, 
            'PolygonValidator', 
            { 
              context, 
              imageId: imageId || 'unknown',
              rawData: polygonData.slice(0, 100) + (polygonData.length > 100 ? '...' : '')
            }
          );
          return {
            polygons: [],
            isValid: false,
            error: 'Invalid JSON format'
          };
        }
      } else {
        parsed = polygonData;
      }

      // Handle null or undefined
      if (parsed == null) {
        return { polygons: [], isValid: true };
      }

      // Handle array format
      if (Array.isArray(parsed)) {
        const validatedPolygons = this.validatePolygonArray(parsed, context, imageId);
        return {
          polygons: validatedPolygons,
          isValid: true
        };
      }

      // Handle object format (might have nested polygons property)
      if (typeof parsed === 'object' && parsed.polygons && Array.isArray(parsed.polygons)) {
        const validatedPolygons = this.validatePolygonArray(parsed.polygons, context, imageId);
        return {
          polygons: validatedPolygons,
          isValid: true
        };
      }

      // Unexpected format
      logger.warn(
        'Unexpected polygon data format', 
        'PolygonValidator', 
        { 
          context, 
          imageId: imageId || 'unknown',
          dataType: typeof parsed,
          isArray: Array.isArray(parsed)
        }
      );
      
      return {
        polygons: [],
        isValid: false,
        error: 'Unexpected data format'
      };

    } catch (error) {
      logger.error(
        'Unexpected error in polygon parsing', 
        error instanceof Error ? error : undefined, 
        'PolygonValidator', 
        { context, imageId: imageId || 'unknown' }
      );
      
      return {
        polygons: [],
        isValid: false,
        error: 'Parsing failed with unexpected error'
      };
    }
  }

  /**
   * Validate an array of polygon objects
   * @param polygonArray Array of polygon objects to validate
   * @param context Context for logging
   * @param imageId Optional image ID for detailed logging
   * @returns Validated and cleaned polygon array
   */
  private static validatePolygonArray(
    polygonArray: any[], 
    context: string, 
    imageId?: string
  ): Polygon[] {
    if (!Array.isArray(polygonArray)) {
      return [];
    }

    const validPolygons: Polygon[] = [];
    let invalidCount = 0;

    for (let i = 0; i < polygonArray.length; i++) {
      const polygon = polygonArray[i];
      
      try {
        const validatedPolygon = this.validateSinglePolygon(polygon, i);
        if (validatedPolygon) {
          validPolygons.push(validatedPolygon);
        } else {
          invalidCount++;
        }
      } catch (error) {
        logger.warn(
          `Invalid polygon at index ${i}`, 
          'PolygonValidator', 
          { 
            context, 
            imageId: imageId || 'unknown', 
            polygonIndex: i,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        );
        invalidCount++;
      }
    }

    if (invalidCount > 0) {
      logger.debug(
        `Filtered out ${invalidCount} invalid polygons from array of ${polygonArray.length}`, 
        'PolygonValidator', 
        { context, imageId: imageId || 'unknown' }
      );
    }

    return validPolygons;
  }

  /**
   * Validate a single polygon object
   * @param polygon Raw polygon object to validate
   * @param index Index in array for logging
   * @returns Validated polygon or null if invalid
   */
  private static validateSinglePolygon(polygon: any, index: number): Polygon | null {
    if (!polygon || typeof polygon !== 'object') {
      return null;
    }

    // Validate points array
    if (!Array.isArray(polygon.points) || polygon.points.length < 3) {
      return null;
    }

    // Validate each point
    const validPoints: PolygonPoint[] = [];
    for (const point of polygon.points) {
      if (this.isValidPoint(point)) {
        validPoints.push({
          x: Number(point.x),
          y: Number(point.y)
        });
      }
    }

    // Need at least 3 valid points to form a polygon
    if (validPoints.length < 3) {
      return null;
    }

    // Build validated polygon
    const validatedPolygon: Polygon = {
      points: validPoints
    };

    // Add optional properties if present and valid
    if (polygon.id && typeof polygon.id === 'string') {
      validatedPolygon.id = polygon.id;
    }
    
    if (polygon.color && typeof polygon.color === 'string') {
      validatedPolygon.color = polygon.color;
    }
    
    if (polygon.category && typeof polygon.category === 'string') {
      validatedPolygon.category = polygon.category;
    }
    
    if (polygon.confidence && typeof polygon.confidence === 'number' && 
        polygon.confidence >= 0 && polygon.confidence <= 1) {
      validatedPolygon.confidence = polygon.confidence;
    }

    return validatedPolygon;
  }

  /**
   * Validate a single point object
   * @param point Point object to validate
   * @returns True if point is valid
   */
  private static isValidPoint(point: any): boolean {
    return point && 
           typeof point === 'object' &&
           typeof point.x === 'number' && 
           typeof point.y === 'number' &&
           !isNaN(point.x) && 
           !isNaN(point.y) &&
           isFinite(point.x) && 
           isFinite(point.y);
  }

  /**
   * Quick validation for polygon count without full parsing
   * @param polygonData Raw polygon data
   * @returns Number of polygons or 0 if parsing fails
   */
  static getPolygonCount(polygonData: string | any): number {
    try {
      const result = this.parsePolygonData(polygonData, 'count-only');
      return result.isValid ? result.polygons.length : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Check if polygon data exists and is valid
   * @param polygonData Raw polygon data
   * @returns True if data exists and is parseable
   */
  static hasValidPolygonData(polygonData: string | any): boolean {
    if (!polygonData) return false;
    
    const result = this.parsePolygonData(polygonData, 'validation-check');
    return result.isValid && result.polygons.length > 0;
  }
}