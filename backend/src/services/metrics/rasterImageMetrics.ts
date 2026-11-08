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

/**
 * Present on a read-out the ML service computed after resampling the frame to
 * the model's 1.28 µm/px (`backend/segmentation/api/disintegration_scale.py`):
 * the image's pixel size was known at segmentation and more than 2 % off. The
 * panel (DI, Index B, flags, ...) is from the `model_w` x `model_h` grid; the
 * three `area_*_px` and `image_width`/`image_height` are the uploaded grid's.
 */
export interface RasterResample {
  input_um_per_px: number;
  model_um_per_px: number;
  factor: number;
  model_w: number;
  model_h: number;
}

/**
 * Present on a read-out whose frame had a known pixel size that the ML service
 * declined to resample (outside 0.5-2x of 1.28 µm/px, or growth past its
 * ceiling). The frame was scored at its uploaded scale, and the read-out's own
 * `warnings` already carry the one message about that pixel size.
 */
export interface RasterResampleSkipped {
  input_um_per_px: number;
  model_um_per_px: number;
  factor: number;
}

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
  /** Absent when the frame was scored at its uploaded scale. */
  resample?: RasterResample | null;
  /** Present only when a known pixel size was declined (see the type). */
  resample_skipped?: RasterResampleSkipped | null;
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

const usablePixelSize = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

/** `v` as a resample block, or null when it is absent or malformed. */
function asResample(v: unknown): RasterResample | null {
  if (!v || typeof v !== 'object') {
    return null;
  }
  const r = v as Partial<RasterResample>;
  return usablePixelSize(r.input_um_per_px) && usablePixelSize(r.factor)
    ? (r as RasterResample)
    : null;
}

/** `v` as a declined-resample record, or null when absent or malformed. */
function asResampleSkipped(v: unknown): RasterResampleSkipped | null {
  if (!v || typeof v !== 'object') {
    return null;
  }
  const r = v as Partial<RasterResampleSkipped>;
  return usablePixelSize(r.input_um_per_px) ? (r as RasterResampleSkipped) : null;
}

/**
 * The stored read-out, if it exists, parses, and still describes `polygonsJson`.
 * Returns `{ metrics: null, reason }` otherwise, so the caller can say why it
 * fell back to the polygons.
 *
 * `staleResample` is set only when a complete read-out exists but the polygons
 * were edited since (hash mismatch): it is that read-out's `resample` block, or
 * null when the segmentation was scored at its uploaded scale. The polygon
 * fallback resamples with it, and only with it, so an edited image is scored
 * on the grid its own segmentation used — never on a scale the segmentation
 * did not use (the image row's or the export's).
 */
export function readStoredImageMetrics(
  stored: string | null | undefined,
  polygonsJson: string
): {
  metrics: StoredRasterImageMetrics | null;
  reason: string;
  staleResample?: RasterResample | null;
} {
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
      staleResample: asResample(m.resample),
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
 * at export. Same wording as the ML service's `input_scale_warnings`.
 *
 * For a read-out that carries `resample` or `resample_skipped`, use
 * `exportScaleWarning`, which decides whether this applies.
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

/**
 * The `Note` text for a read-out computed after resampling, or '' for one
 * that was not. Without it nothing in the export would say that the numbers
 * were taken at 1.28 µm/px rather than at the image's own scale.
 */
export function resampleNote(
  resample: RasterResample | null | undefined
): string {
  if (
    !resample ||
    typeof resample.input_um_per_px !== 'number' ||
    typeof resample.factor !== 'number'
  ) {
    return '';
  }
  const from = Number(resample.input_um_per_px.toPrecision(4));
  const factor = Number(resample.factor.toPrecision(4));
  return (
    `scored at ${resample.model_um_per_px ?? VALIDATED_UM_PER_PX} um/px: ` +
    `resampled from ${from} um/px (x${factor}, ` +
    `${resample.model_w}x${resample.model_h} px)`
  );
}

/**
 * The export-time warning about the pixel size for one read-out (stored, or
 * scored from the polygons), or null.
 *
 * - Resampled at segmentation (`resample`): the read-out was taken at
 *   1.28 µm/px on the assumption that the frame was `input_um_per_px`. No
 *   warning when the export gives no scale or one within `UM_PER_PX_REL_TOL`
 *   of that. Otherwise the export says the frame is really X µm/px, so the
 *   read-out was taken at 1.28·X/Y µm/px, not 1.28 — warned with both values,
 *   because the areas convert at X while the panel assumed Y.
 * - Declined at segmentation (`resample_skipped`): the read-out's own warnings
 *   already say so; this adds nothing when the export's scale is that same
 *   pixel size (within the band), and the plain warning for a different one.
 * - Neither: `pixelSizeWarning(exportScale)`, as before the resample existed.
 */
export function exportScaleWarning(
  exportScale: number | null | undefined,
  readOut: {
    resample?: RasterResample | null;
    resample_skipped?: RasterResampleSkipped | null;
  }
): string | null {
  const resample = asResample(readOut.resample);
  const sameAs = (y: number): boolean =>
    !usablePixelSize(exportScale) ||
    Math.abs(exportScale / y - 1) <= UM_PER_PX_REL_TOL;
  if (resample) {
    const y = resample.input_um_per_px;
    if (sameAs(y)) {
      return null;
    }
    const x = exportScale as number;
    const effective = Number(((VALIDATED_UM_PER_PX * x) / y).toPrecision(3));
    return (
      `pixel size is ${Number(x.toPrecision(4))} um/px at export, but the frame ` +
      `was resampled from ${Number(y.toPrecision(4))} um/px at segmentation, so ` +
      `the read-out was taken at ~${effective} um/px, not ${VALIDATED_UM_PER_PX}; ` +
      `the areas convert at ${Number(x.toPrecision(4))} um/px. Re-segment the ` +
      `image for the new pixel size to take effect.`
    );
  }
  const skipped = asResampleSkipped(readOut.resample_skipped);
  if (skipped && usablePixelSize(exportScale) && sameAs(skipped.input_um_per_px)) {
    return null;
  }
  return pixelSizeWarning(exportScale);
}
