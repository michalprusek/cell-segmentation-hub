/**
 * Utilities for polygon ID management and validation
 *
 * This module provides robust polygon ID validation and generation to prevent
 * React key conflicts and ensure proper polygon identification throughout the application.
 */

/**
 * Generates a unique polygon ID with timestamp and random component
 */
export const generatePolygonId = (prefix: string = 'polygon'): string => {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Validates that a polygon ID is a valid string
 */
export const validatePolygonId = (id: any): id is string => {
  return typeof id === 'string' && id.trim().length > 0;
};

/**
 * Ensures a polygon has a valid ID, generating one if necessary
 */
export const ensureValidPolygonId = (
  id: any,
  fallbackPrefix: string = 'fallback'
): string => {
  if (validatePolygonId(id)) {
    return id;
  }
  return generatePolygonId(fallbackPrefix);
};

/**
 * Generates a safe React key for polygon rendering with fallback for undefined IDs
 */
export const generateSafePolygonKey = (
  polygon: any,
  isUndoRedo: boolean
): string => {
  const safeId = ensureValidPolygonId(polygon.id, 'polygon');
  return `${safeId}-${isUndoRedo ? 'undo' : 'normal'}`;
};

/**
 * Logs polygon ID validation issues for debugging
 */
export const logPolygonIdIssue = (polygon: any, reason: string): void => {
  // Only log in development mode to avoid production console spam
  if (process.env.NODE_ENV === 'development') {
    console.warn('[PolygonID] Validation issue:', {
      reason,
      polygonId: polygon.id,
      polygonType: polygon.type,
      polygonData: {
        hasId: polygon.id !== undefined,
        idType: typeof polygon.id,
        pointsCount: polygon.points?.length || 0,
      },
    });
  }
};
