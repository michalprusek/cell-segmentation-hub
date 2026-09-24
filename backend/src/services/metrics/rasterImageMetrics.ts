/**
 * The spheroid-disintegration read-out computed by the ML service from the
 * model's RASTER argmax mask, and how it is stored beside the polygons.
 *
 * The ML service (`backend/segmentation/api/disintegration_metrics.py`, a
 * verbatim port of the paper's `spheroid_seg/compute_di.py`) returns it as
 * `image_metrics` from `/segment`. It is persisted in
 * `segmentations.imageMetrics` together with `polygons_sha256`, the SHA-256 of
 * the exact `polygons` string written in the same upsert. At export time the
 * read-out is used only while that hash still matches: any later rewrite of
 * the polygons (an editor save, a track assignment) makes it stale, and the
 * export falls back to scoring the polygons through `/api/disintegration-index`.
 *
 * Why the raster matters: the polygons have passed a 50 px minimum-area filter
 * and keep only each region's outer contour, so re-rasterising them loses
 * exactly the far, faint corona cells that set the index's reach. Review
 * finding G13 measured DI shifts of up to -0.039 from that round trip.
 */
import { createHash } from 'crypto';

/** Field names exactly as compute_di.py / the ML service write them. */
export interface RasterImageMetrics {
  algorithm: string;
  algorithm_sha256: string;
  source: 'model_raster';
  image_width: number;
  image_height: number;
  reference: 'core' | 'no_core' | 'core_too_small' | 'none';
  note: string;
  warnings: string[];
  DI: number | null;
  W1: number | null;
  index_B: number | null;
  reach_p90: number | null;
  n_fragments: number | null;
  largest_fragment_frac: number | null;
  solidity: number | null;
  area_core_px: number | null;
  area_corona_px: number | null;
  area_total_px: number | null;
  n_core_components: number | null;
  largest_core_component_frac: number | null;
  core_centroid_shift: number | null;
  core_fragmented: number | null;
  unvalidated_regime: number | null;
  below_validated_regime: number | null;
}

export interface StoredRasterImageMetrics extends RasterImageMetrics {
  polygons_sha256: string;
}

export function sha256OfPolygons(polygonsJson: string): string {
  return createHash('sha256').update(polygonsJson, 'utf8').digest('hex');
}

/**
 * The JSON string to store in `segmentations.imageMetrics`, or null when the
 * ML response carried no raster read-out (every model but
 * spheroid_disintegration). Null is written explicitly so that re-segmenting an
 * image with another model clears a read-out that no longer applies.
 */
export function serialiseImageMetricsForStorage(
  imageMetrics: unknown,
  polygonsJson: string
): string | null {
  if (!imageMetrics || typeof imageMetrics !== 'object') {
    return null;
  }
  return JSON.stringify({
    ...(imageMetrics as Record<string, unknown>),
    polygons_sha256: sha256OfPolygons(polygonsJson),
  });
}

/**
 * The stored read-out, if it exists, parses, and still describes `polygonsJson`.
 * Returns `{ metrics: null, reason }` otherwise, so the caller can say why it
 * fell back to the polygons.
 */
export function readStoredImageMetrics(
  stored: string | null | undefined,
  polygonsJson: string
): { metrics: StoredRasterImageMetrics | null; reason: string } {
  if (!stored) {
    return { metrics: null, reason: 'no raster read-out stored' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return { metrics: null, reason: 'stored raster read-out unreadable' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { metrics: null, reason: 'stored raster read-out unreadable' };
  }
  const m = parsed as Partial<StoredRasterImageMetrics>;
  if (typeof m.reference !== 'string' || typeof m.polygons_sha256 !== 'string') {
    return { metrics: null, reason: 'stored raster read-out incomplete' };
  }
  if (m.polygons_sha256 !== sha256OfPolygons(polygonsJson)) {
    return {
      metrics: null,
      reason: 'polygons edited since segmentation',
    };
  }
  return { metrics: m as StoredRasterImageMetrics, reason: '' };
}

// The validated input regime. Mirrors `VALIDATED_UM_PER_PX` and
// `UM_PER_PX_REL_TOL` in backend/segmentation/api/disintegration_metrics.py;
// the frame-size half of the check runs in the ML service at inference.
export const VALIDATED_UM_PER_PX = 1.28;
export const UM_PER_PX_REL_TOL = 0.1;

/**
 * The pixel-size half of the input-scale check, for the scale a user enters
 * at export (the raster read-out was computed before any scale was known).
 * Same wording as the ML service's `input_scale_warnings`.
 */
export function pixelSizeWarning(umPerPx?: number | null): string | null {
  if (
    umPerPx === undefined ||
    umPerPx === null ||
    !Number.isFinite(umPerPx) ||
    umPerPx <= 0
  ) {
    return null;
  }
  if (Math.abs(umPerPx / VALIDATED_UM_PER_PX - 1) <= UM_PER_PX_REL_TOL) {
    return null;
  }
  return (
    `pixel size is ${Number(umPerPx.toPrecision(4))} um/px; the model and the ` +
    `Disintegration Index were validated only at ~${VALIDATED_UM_PER_PX} um/px ` +
    `(2048x2048 px frames, 5x objective). The read-out is returned but was ` +
    `never tested at this scale.`
  );
}
