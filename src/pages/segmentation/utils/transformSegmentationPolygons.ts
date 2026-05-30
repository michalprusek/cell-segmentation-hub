import { Polygon } from '@/lib/segmentation';
import type { SegmentationPolygon } from '@/lib/api';
import { logger } from '@/lib/logger';
import {
  validatePolygonId,
  ensureValidPolygonId,
  logPolygonIdIssue,
} from '@/lib/polygonIdUtils';

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Transform raw ML/wire `SegmentationPolygon[]` into editor `Polygon[]`:
 *  - drops degenerate shapes (min 2 pts for polylines, 3 for polygons)
 *  - normalises points (`[x, y]` tuples or `{ x, y }`) and skips non-numeric
 *    coordinates
 *  - coerces invalid/missing IDs to a stable fallback (`ensureValidPolygonId`)
 *  - converts `parentIds[]` → `parent_id` (singular)
 *  - spreads every other wire field through unchanged (e.g. `trackId`,
 *    `partClass`, future additions) so the editor sees them without manual
 *    maintenance
 *
 * Extracted verbatim from the `initialPolygons` memo in `SegmentationEditor`.
 * Pure and dependency-light (no React, no socket.io/Radix/Axios — note the
 * `import type` on `SegmentationPolygon`), so it is directly unit-testable
 * without the editor's heavy import graph. `imageDimensions` feeds only the
 * development debug log and does not influence the output.
 */
export function transformSegmentationPolygons(
  segmentationPolygons: SegmentationPolygon[] | null | undefined,
  imageDimensions: ImageDimensions | null
): Polygon[] {
  // Return empty array if no segmentation data exists or if it's not an array
  if (
    !segmentationPolygons ||
    !Array.isArray(segmentationPolygons) ||
    segmentationPolygons.length === 0
  ) {
    return [];
  }

  // For large datasets, process in chunks to prevent blocking
  const startTime = performance.now();

  // Transform SegmentationPolygon[] to Polygon[] and filter out invalid polygons.
  // Spreads `segPoly` so any wire-level field (trackId, future additions) reaches
  // the editor without manual maintenance; only parentIds[] needs explicit
  // conversion to parent_id (singular).
  const polygons: Polygon[] = segmentationPolygons
    .filter(segPoly => {
      const minPoints = segPoly.geometry === 'polyline' ? 2 : 3;
      return segPoly.points && segPoly.points.length >= minPoints;
    })
    .map((segPoly): Polygon | null => {
      const validPoints = segPoly.points
        .map(point => {
          if (Array.isArray(point)) {
            return { x: point[0], y: point[1] };
          }
          if (typeof point === 'object' && point !== null) {
            if (typeof point.x === 'number' && typeof point.y === 'number') {
              return point;
            }
            logger.warn(
              'Skipping invalid point with non-numeric coordinates',
              point
            );
            return null;
          }
          logger.warn('Skipping invalid point format', point);
          return null;
        })
        .filter((point): point is { x: number; y: number } => point !== null);

      const minValidPoints = segPoly.geometry === 'polyline' ? 2 : 3;
      if (validPoints.length < minValidPoints) {
        logger.warn('Dropping polygon due to insufficient valid points', {
          polygonId: segPoly.id,
        });
        return null;
      }

      let polygonId = segPoly.id;
      if (!validatePolygonId(segPoly.id)) {
        logPolygonIdIssue(
          segPoly,
          'Invalid or missing polygon ID from ML service'
        );
        polygonId = ensureValidPolygonId(segPoly.id, 'ml_polygon');
        logger.warn(
          `Generated fallback ID: ${polygonId} for polygon with invalid ID: ${segPoly.id}`
        );
      }

      const { parentIds, ...rest } = segPoly;
      return {
        ...rest,
        id: polygonId,
        points: validPoints,
        parent_id: parentIds?.[0],
      };
    })
    .filter((polygon): polygon is Polygon => polygon !== null);

  const invalidCount = segmentationPolygons.length - polygons.length;
  const processingTime = performance.now() - startTime;

  if (invalidCount > 0) {
    logger.warn(
      `⚠️ Filtered out ${invalidCount} invalid polygons (missing or insufficient points)`
    );
  }

  // Monitor processing time to detect performance issues
  if (processingTime > 100) {
    logger.warn(
      `⚠️ Polygon processing took ${processingTime.toFixed(2)}ms for ${segmentationPolygons.length} polygons`
    );
  }

  if (process.env.NODE_ENV === 'development') {
    logger.debug('🔄 Transformed segmentation polygons for editor:', {
      hasSegmentationData: true,
      inputCount: segmentationPolygons.length,
      validCount: polygons.length,
      filteredOut: invalidCount,
      processingTime: `${processingTime.toFixed(2)}ms`,
      imageDimensions,
      firstPolygon: polygons[0]
        ? {
            id: polygons[0].id,
            type: polygons[0].type,
            parent_id: polygons[0].parent_id,
            pointsCount: polygons[0].points?.length || 0,
            firstPoints: polygons[0].points?.slice(0, 3),
          }
        : null,
      internalPolygonCount: polygons.filter(
        p => p.type === 'internal' || p.parent_id
      ).length,
      externalPolygonCount: polygons.filter(
        p => p.type === 'external' && !p.parent_id
      ).length,
    });
  }

  return polygons;
}
