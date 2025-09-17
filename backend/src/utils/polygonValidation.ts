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
export const PolygonValidator = {
  /**
   * Safely parse polygon JSON data with comprehensive validation
   * @param polygonData Raw polygon data (string or already parsed)
   * @param context Context for logging (e.g., 'single-fetch', 'batch-fetch')
   * @param imageId Optional image ID for detailed logging
   * @returns Validated polygon data with success status
   */
  parsePolygonData(
    polygonData: string | unknown,
    context = 'unknown',
    imageId?: string
  ): ParsedPolygonResult {
    try {
      let parsed: unknown;
      
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
      if (parsed === null || parsed === undefined) {
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
      const parsedObj = parsed as { polygons?: unknown };
      if (typeof parsed === 'object' && parsedObj.polygons && Array.isArray(parsedObj.polygons)) {
        const validatedPolygons = this.validatePolygonArray(parsedObj.polygons, context, imageId);
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
  },

  /**
   * Validate an array of polygon objects
   * @param polygonArray Array of polygon objects to validate
   * @param context Context for logging
   * @param imageId Optional image ID for detailed logging
   * @returns Validated and cleaned polygon array
   */
  validatePolygonArray(
    polygonArray: unknown[],
    context: string,
    imageId?: string
  ): Polygon[] {
    if (!Array.isArray(polygonArray)) {
      return [];
    }

    const validPolygons: Polygon[] = [];
    let invalidCount = 0;

    for (let i = 0; i < polygonArray.length; i++) {
      const polygon = polygonArray[i] as unknown;
      
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
  },

  /**
   * Validate a single polygon object
   * @param polygon Raw polygon object to validate
   * @param index Index in array for logging
   * @returns Validated polygon or null if invalid
   */
  validateSinglePolygon(polygon: unknown, _index: number): Polygon | null {
    if (!polygon || typeof polygon !== 'object') {
      return null;
    }

    const polygonObj = polygon as Record<string, unknown>;

    // Validate points array
    if (!Array.isArray(polygonObj.points) || polygonObj.points.length < 3) {
      return null;
    }

    // Validate each point
    const validPoints: PolygonPoint[] = [];
    for (const point of polygonObj.points as unknown[]) {
      if (this.isValidPoint(point)) {
        const validPoint = point as { x: number; y: number };
        validPoints.push({
          x: Number(validPoint.x),
          y: Number(validPoint.y)
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
    if (polygonObj.id && typeof polygonObj.id === 'string') {
      validatedPolygon.id = polygonObj.id;
    }

    if (polygonObj.color && typeof polygonObj.color === 'string') {
      validatedPolygon.color = polygonObj.color;
    }

    if (polygonObj.category && typeof polygonObj.category === 'string') {
      validatedPolygon.category = polygonObj.category;
    }

    if (polygonObj.confidence && typeof polygonObj.confidence === 'number' &&
        polygonObj.confidence >= 0 && polygonObj.confidence <= 1) {
      validatedPolygon.confidence = polygonObj.confidence;
    }

    return validatedPolygon;
  },

  /**
   * Validate a single point object
   * @param point Point object to validate
   * @returns True if point is valid
   */
  isValidPoint(point: unknown): boolean {
    if (!point || typeof point !== 'object') {
      return false;
    }
    const pointObj = point as Record<string, unknown>;
    return typeof pointObj.x === 'number' &&
           typeof pointObj.y === 'number' &&
           !isNaN(pointObj.x) &&
           !isNaN(pointObj.y) &&
           isFinite(pointObj.x) &&
           isFinite(pointObj.y);
  },

  /**
   * Quick validation for polygon count without full parsing
   * @param polygonData Raw polygon data
   * @returns Number of polygons or 0 if parsing fails
   */
  getPolygonCount(polygonData: string | unknown): number {
    try {
      const result = this.parsePolygonData(polygonData, 'count-only');
      return result.isValid ? result.polygons.length : 0;
    } catch {
      return 0;
    }
  },

  /**
   * Check if polygon data exists and is valid
   * @param polygonData Raw polygon data
   * @returns True if data exists and is parseable
   */
  hasValidPolygonData(polygonData: string | unknown): boolean {
    if (!polygonData) {return false;}
    
    const result = this.parsePolygonData(polygonData, 'validation-check');
    return result.isValid && result.polygons.length > 0;
  }
} as const;