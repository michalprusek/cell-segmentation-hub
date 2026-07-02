/**
 * Per-instance labelling for polyline projects (sperm, microtubule).
 *
 * The export visualization draws a per-instance badge ("S1", "MT1", …) on
 * each image, and the microtubule metrics table carries the SAME label so a
 * spreadsheet row can be matched back to the badge on the image. Both call
 * sites feed this helper the *same* parsed polygon array for a given image
 * (order preserved by `JSON.parse`), so the ordinal assignment is identical
 * on both sides — the single source of truth for the numbering rule.
 */

/** Prefix drawn for sperm instances (S = sperm). */
export const SPERM_LABEL_PREFIX = 'S';
/** Prefix drawn for microtubule instances. */
export const MICROTUBULE_LABEL_PREFIX = 'MT';

/** Minimal polyline shape the labeller needs — a subset of both the
 *  visualization `Polygon` and the exporter's `RawPolyline`. */
export interface LabelablePolyline {
  geometry?: string;
  instanceId?: string | null;
  points?: Array<{ x: number; y: number }> | null;
}

/**
 * Assign sequential labels ("{prefix}1", "{prefix}2", …) to the unique
 * `instanceId`s of the polyline polygons, in first-appearance order.
 *
 * Mirrors exactly what the visualization draws:
 *  - Only polylines are considered; closed polygons never get a badge.
 *  - Polylines without an `instanceId` are unlabelled (no badge on the image).
 *  - An instance only earns a number if at least one of its polylines has
 *    ≥ 2 points — a single-point polyline can't be drawn as a curve, so it
 *    gets no midpoint badge and therefore consumes no number.
 *
 * @returns Map from `instanceId` to its label. Instances that earn no label
 *          are absent from the map (callers should treat a miss as "no label").
 */
export function buildInstanceLabelMap(
  polygons: readonly LabelablePolyline[],
  prefix: string
): Map<string, string> {
  // First pass: remember first-appearance order and whether each instance has
  // at least one drawable (≥ 2-point) polyline. Insertion order into the Map
  // matches the visualization's `spermInstances` Map insertion order.
  const drawableByInstance = new Map<string, boolean>();
  for (const p of polygons) {
    if (p.geometry !== 'polyline') continue;
    const id = p.instanceId;
    if (!id) continue;
    if (!drawableByInstance.has(id)) {
      drawableByInstance.set(id, false);
    }
    if (p.points && p.points.length >= 2) {
      drawableByInstance.set(id, true);
    }
  }

  // Second pass: number the drawable instances in first-appearance order.
  const labels = new Map<string, string>();
  let index = 1;
  for (const [id, drawable] of drawableByInstance) {
    if (drawable) {
      labels.set(id, `${prefix}${index}`);
      index++;
    }
  }
  return labels;
}
