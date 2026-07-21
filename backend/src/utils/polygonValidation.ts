import { logger } from '../utils/logger';

export const SPERM_PART_CLASSES = ['head', 'midpiece', 'tail'] as const;
export type SpermPartClass = (typeof SPERM_PART_CLASSES)[number];

export const isValidSpermPartClass = (
  value: unknown
): value is SpermPartClass =>
  typeof value === 'string' &&
  (SPERM_PART_CLASSES as readonly string[]).includes(value);

// Wider partClass union: sperm body parts plus spheroid 'core'.
export const POLYGON_PART_CLASSES = [
  ...SPERM_PART_CLASSES,
  'core',
] as const;
export type PolygonPartClass = (typeof POLYGON_PART_CLASSES)[number];

export const isValidPolygonPartClass = (
  value: unknown
): value is PolygonPartClass =>
  typeof value === 'string' &&
  (POLYGON_PART_CLASSES as readonly string[]).includes(value);

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
  type?: 'external' | 'internal';
  parent_id?: string;
  area?: number;
  /** Open polyline (sperm tail / microtubule) vs closed polygon. */
  geometry?: 'polygon' | 'polyline';
  /** Sperm body part (head/midpiece/tail) or spheroid 'core'. */
  partClass?: PolygonPartClass;
  /** Per-detection sperm instance grouping id. */
  instanceId?: string;
  /** Cross-frame microtubule track ID populated by trackerService after a
   *  video container's batch finishes segmentation. The validator must
   *  preserve it so the response builder in segmentationService can
   *  conditionally spread it; otherwise the editor never sees the field
   *  and MT cross-frame colour stability is silently defeated. */
  trackId?: string;
  /** Human-friendly label set in the editor; mirrored across sibling
   *  frames during cross-frame propagation. Must be preserved here so a
   *  rename survives subsequent reads. */
  name?: string;
  /** Microcapsule completeness flag (instance models). `false` when the
   *  capsule's mask is cut off by the image border. Must be preserved here so
   *  the editor can grey it out and metrics/export can exclude it. */
  complete?: boolean;
  /** User-assigned microtubule type-label id (references the project's
   *  `mtTypeLabels` palette). Preserved so the editor + exports can resolve the
   *  class name/colour. Microtubule projects only. */
  mtType?: string;
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * OPTIONAL POLYGON FIELD SSOT (single source of truth)
 * ─────────────────────────────────────────────────────────────────────────
 * This table is the ONE place to register an optional polygon metadata field.
 * `validateSinglePolygon` iterates it, so adding a new optional field that
 * should survive the untrusted-ML → DB → editor round-trip means adding ONE
 * entry here (plus the explicit TS field on the typed contracts — see the
 * `SegmentationPolygon` interfaces in backend `segmentationService.ts` and
 * frontend `src/lib/api.ts`, both of which point back here).
 *
 * SECURITY BOUNDARY: this validator runs on UNTRUSTED ML-service output, so it
 * intentionally does NOT blind-spread arbitrary input. Each entry whitelists a
 * known field with a `coerce` fn that returns the cleaned value to store, or
 * `undefined` to drop it. Unknown/junk fields never appear here and are
 * therefore always discarded.
 *
 * NOTE: `_embedding` is deliberately ABSENT — it is a heavy server-only blob
 * that must never be admitted through this untrusted-input path. The 3 mappers
 * in `segmentationService.ts` operate on already-validated internal data and
 * spread it (so `_embedding` does pass through there) but the serve boundary
 * strips it again via `EDITOR_OMITTED_POLYGON_FIELDS`.
 */
export interface OptionalPolygonField {
  /** Field name as it appears on both the raw input and the stored polygon. */
  key: string;
  /**
   * Returns the cleaned value to copy onto the validated polygon, or
   * `undefined` to drop the field. Must not mutate its argument.
   */
  coerce: (value: unknown) => unknown;
}

const coerceNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export const OPTIONAL_POLYGON_FIELDS: readonly OptionalPolygonField[] = [
  // partClass accepts both sperm parts (head/midpiece/tail) and 'core' for
  // spheroid disintegration core polygons; older code only validated SpermPartClass
  // which silently stripped 'core' during polygon JSON load.
  {
    key: 'partClass',
    coerce: value =>
      isValidPolygonPartClass(value) ? (value as PolygonPartClass) : undefined,
  },
  { key: 'instanceId', coerce: coerceNonEmptyString },
  // Preserve cross-frame trackId written by trackerService.
  { key: 'trackId', coerce: coerceNonEmptyString },
  // Preserve editor-set label so renames survive subsequent reads.
  { key: 'name', coerce: coerceNonEmptyString },
  // Preserve microcapsule completeness so cut-off capsules can be greyed in
  // the editor and excluded from metrics. Only a real boolean survives.
  {
    key: 'complete',
    coerce: value => (typeof value === 'boolean' ? value : undefined),
  },
  // Preserve the user-assigned microtubule type-label id (resolved to a class
  // name/colour via the project's mtTypeLabels palette).
  { key: 'mtType', coerce: coerceNonEmptyString },
] as const;

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
              rawData:
                polygonData.slice(0, 100) +
                (polygonData.length > 100 ? '...' : ''),
            }
          );
          return {
            polygons: [],
            isValid: false,
            error: 'Invalid JSON format',
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
        const validatedPolygons = this.validatePolygonArray(
          parsed,
          context,
          imageId
        );
        return {
          polygons: validatedPolygons,
          isValid: true,
        };
      }

      // Handle object format (might have nested polygons property)
      const parsedObj = parsed as { polygons?: unknown };
      if (
        typeof parsed === 'object' &&
        parsedObj.polygons &&
        Array.isArray(parsedObj.polygons)
      ) {
        const validatedPolygons = this.validatePolygonArray(
          parsedObj.polygons,
          context,
          imageId
        );
        return {
          polygons: validatedPolygons,
          isValid: true,
        };
      }

      // Unexpected format
      logger.warn('Unexpected polygon data format', 'PolygonValidator', {
        context,
        imageId: imageId || 'unknown',
        dataType: typeof parsed,
        isArray: Array.isArray(parsed),
      });

      return {
        polygons: [],
        isValid: false,
        error: 'Unexpected data format',
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
        error: 'Parsing failed with unexpected error',
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
        logger.warn(`Invalid polygon at index ${i}`, 'PolygonValidator', {
          context,
          imageId: imageId || 'unknown',
          polygonIndex: i,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
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

    // Polylines need at least 2 points, polygons need at least 3
    const isPolyline = polygonObj.geometry === 'polyline';
    const minPoints = isPolyline ? 2 : 3;
    if (
      !Array.isArray(polygonObj.points) ||
      polygonObj.points.length < minPoints
    ) {
      return null;
    }

    // Validate each point
    const validPoints: PolygonPoint[] = [];
    for (const point of polygonObj.points as unknown[]) {
      if (this.isValidPoint(point)) {
        const validPoint = point as { x: number; y: number };
        validPoints.push({
          x: Number(validPoint.x),
          y: Number(validPoint.y),
        });
      }
    }

    // Need minimum valid points (2 for polylines, 3 for polygons)
    if (validPoints.length < minPoints) {
      return null;
    }

    // Build validated polygon
    const validatedPolygon: Polygon = {
      points: validPoints,
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

    if (
      polygonObj.confidence &&
      typeof polygonObj.confidence === 'number' &&
      polygonObj.confidence >= 0 &&
      polygonObj.confidence <= 1
    ) {
      validatedPolygon.confidence = polygonObj.confidence;
    }

    // Add hierarchy support - preserve type field
    if (
      polygonObj.type &&
      typeof polygonObj.type === 'string' &&
      ['external', 'internal'].includes(polygonObj.type as string)
    ) {
      validatedPolygon.type = polygonObj.type as 'external' | 'internal';
    }

    // Add parent_id for internal polygons
    if (polygonObj.parent_id && typeof polygonObj.parent_id === 'string') {
      validatedPolygon.parent_id = polygonObj.parent_id;
    }

    // Add area if present
    if (
      polygonObj.area &&
      typeof polygonObj.area === 'number' &&
      polygonObj.area >= 0
    ) {
      validatedPolygon.area = polygonObj.area;
    }

    // Preserve polyline geometry (sperm / microtubule). 'polygon' is the
    // implicit default and never stored explicitly.
    if (polygonObj.geometry === 'polyline') {
      validatedPolygon.geometry = 'polyline';
    }

    // Copy every registered optional metadata field via the SSOT table. This
    // is the ONLY place that needs editing to admit a new optional field; the
    // per-field whitelist preserves the untrusted-input security boundary.
    const validatedRecord = validatedPolygon as unknown as Record<
      string,
      unknown
    >;
    for (const field of OPTIONAL_POLYGON_FIELDS) {
      const coerced = field.coerce(polygonObj[field.key]);
      if (coerced !== undefined) {
        validatedRecord[field.key] = coerced;
      }
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
    return (
      typeof pointObj.x === 'number' &&
      typeof pointObj.y === 'number' &&
      !isNaN(pointObj.x) &&
      !isNaN(pointObj.y) &&
      isFinite(pointObj.x) &&
      isFinite(pointObj.y)
    );
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
    if (!polygonData) {
      return false;
    }

    const result = this.parsePolygonData(polygonData, 'validation-check');
    return result.isValid && result.polygons.length > 0;
  },
} as const;
