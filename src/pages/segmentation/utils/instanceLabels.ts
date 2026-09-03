/**
 * FRONTEND MIRROR of `backend/src/utils/instanceLabels.ts`.
 *
 * The two trees share no import path, so the project keeps parallel
 * declarations. This pair is NOT in `scripts/verify-shared-types.cjs`: that
 * gate's extractor only understands an `export const NAME = { … }` / `[ … ]`
 * literal, and neither a function nor a bare string const has a brace for it to
 * balance. What guards the pair instead is that BOTH sides are behaviour-tested
 * against the same table of cases — `__tests__/instanceLabels.test.ts` here and
 * `backend/src/utils/__tests__/instanceLabels.test.ts` there — so a change to
 * either implementation turns its own suite red. Keep the function body
 * identical to the backend's, and change the two test tables together.
 *
 * Why the editor needs it at all: the exported visualization draws a badge
 * ("MT1", "MT2", …) on each image and the metrics table carries the SAME label,
 * so a spreadsheet row can be matched back to a microtubule. The editor's
 * sidebar, however, used to number its rows by their position in its own
 * display order, which sorts by `trackId` — a completely different ordering. So
 * "Microtubule 1" on screen and "MT1" in the metrics were different objects,
 * and there was no way to look a measurement back up. That is the Institut
 * Curie report of 2026-09-03 ("MT1 in the metrics file is labeled 'HeLa MT',
 * while in the segmentation window 'microtubule 1' is labelled 'WT MT'").
 *
 * NOTE the badge is a PER-FRAME ordinal and is not cross-frame stable: the same
 * physical microtubule can be MT1 on frame 0 and MT2 on frame 3. That is a
 * property of the export, not a bug introduced here — match within a frame on
 * `frameIndex` + `label`, and use `trackId` for cross-frame identity.
 */

/** Prefix drawn for sperm instances (S = sperm). */
export const SPERM_LABEL_PREFIX = 'S';
/** Prefix drawn for microtubule instances. */
export const MICROTUBULE_LABEL_PREFIX = 'MT';
/** Prefix for polylines in a generic (non-sperm, non-MT) project. */
export const GENERIC_LABEL_PREFIX = 'P';

export type InstanceLabelPrefix =
  | typeof SPERM_LABEL_PREFIX
  | typeof MICROTUBULE_LABEL_PREFIX
  | typeof GENERIC_LABEL_PREFIX;

/** Minimal polyline shape the labeller needs. */
export interface LabelablePolyline {
  geometry?: string;
  instanceId?: string | null;
  points?: Array<{ x: number; y: number }> | null;
}

/**
 * Assign sequential labels ("{prefix}1", "{prefix}2", …) to the unique
 * `instanceId`s of the polyline polygons, in first-appearance order.
 *
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
  prefix: InstanceLabelPrefix
): ReadonlyMap<string, string> {
  // First pass: remember first-appearance order and whether each instance has
  // at least one drawable (≥ 2-point) polyline. First-appearance order is the
  // same order the visualization uses when it groups polylines by `instanceId`.
  const drawableByInstance = new Map<string, boolean>();
  for (const p of polygons) {
    if (p.geometry !== 'polyline') {
      continue;
    }
    const id = p.instanceId;
    if (!id) {
      continue;
    }
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
