import type { SegmentationPolygon } from '../services/segmentationService';

/**
 * Build the DB-storage shape from an internal/validated polygon: spread every
 * field through, then perform the one genuine transform — collapse the API's
 * `parentIds[]` to the DB's scalar `parent_id`. Editor-only fields are NOT
 * stripped here (they are server-side state that must persist); the serve
 * boundary handles omission. Operates on already-validated data, so a spread
 * is safe (the untrusted-input whitelist lives in the validator).
 *
 * Lives here, not in `segmentationService`, so that a path outside that
 * service (the microtubule temporal vote, `tracking/temporalVote.ts`) stores
 * what the ML service returns in the same shape without pulling the service's
 * module graph in.
 */
export function toDbPolygon(
  polygon: SegmentationPolygon & Record<string, unknown>
): Record<string, unknown> {
  const { parentIds, ...rest } = polygon;
  const dbPolygon: Record<string, unknown> = { ...rest };
  // parentIds[] (API) -> parent_id (DB scalar). Preserve any pre-existing
  // scalar parent_id when no array form is present.
  if (parentIds && parentIds.length > 0) {
    dbPolygon.parent_id = parentIds[0];
  }
  return dbPolygon;
}

/** What the save path stores for one polygon the ML service returned:
 *  `toDbPolygon` plus the historical defaults of the two numeric fields. */
export function toStoredPolygon(
  polygon: SegmentationPolygon & Record<string, unknown>
): Record<string, unknown> {
  const dbPolygon = toDbPolygon(polygon);
  dbPolygon.area = polygon.area || 0;
  dbPolygon.confidence = polygon.confidence || 0.8;
  return dbPolygon;
}
