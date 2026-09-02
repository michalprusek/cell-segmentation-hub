/**
 * Which microcapsules count.
 *
 * A microcapsule is measured — area, perimeter, compactness, and every row of
 * the export — unless it is marked **non relevant**. Two things can mark it:
 *
 *  1. The model, which sets `complete: false` on a capsule cut off by the image
 *     border. That is a DEFAULT, not a verdict.
 *  2. The user, through the project's type-label palette (the same mechanism
 *     microtubules use for their tubulin types). A type the user has set always
 *     wins, in both directions: a border-cut capsule typed as anything other
 *     than "non relevant" is measured, and a whole capsule typed "non relevant"
 *     is not.
 *
 * Only `MICROCAPSULE_NON_RELEVANT_LABEL_ID` excludes. Any other label — the
 * seeded "relevant" one, or one the user adds later — counts, which is what
 * makes "change it away from non-relevant to include it" work without the user
 * having to pick one specific label.
 *
 * MIRRORED at `src/lib/microcapsuleRelevance.ts`; the two are
 * diffed by `scripts/verify-shared-types.cjs`, because the frontend computes
 * the editor's live metrics and the backend computes the exported workbook and
 * the visualisation PNGs — a drift between them is two different answers to
 * "how many capsules are in this image".
 */

/** Label id that EXCLUDES a capsule from every measurement. */
export const MICROCAPSULE_NON_RELEVANT_LABEL_ID = 'non_relevant';

/** Label id seeded alongside it, for putting a capsule back in. */
export const MICROCAPSULE_RELEVANT_LABEL_ID = 'relevant';

/** Seeded into every microcapsule project's palette the first time it is read.
 *  Colours match what the canvas already drew before the palette existed: the
 *  external-contour red and the border-cut grey. */
export const MICROCAPSULE_DEFAULT_TYPE_LABELS = [
  { id: 'relevant', name: 'Relevant', color: '#ef4444' },
  { id: 'non_relevant', name: 'Non relevant', color: '#969696' },
] as const;

/** The fields this decision reads. Deliberately structural: the frontend and
 *  backend polygon types differ in everything else. */
export interface MicrocapsuleRelevanceInput {
  /** `false` when the model found the capsule cut off by the image border. */
  complete?: boolean | null;
  /** Label id the user assigned, if any. */
  mtType?: string | null;
}

/** True when this capsule contributes to metrics and appears in the export. */
export function isMeasuredMicrocapsule(
  polygon: MicrocapsuleRelevanceInput
): boolean {
  if (typeof polygon.mtType === 'string' && polygon.mtType.length > 0) {
    return polygon.mtType !== MICROCAPSULE_NON_RELEVANT_LABEL_ID;
  }
  return polygon.complete !== false;
}
