/**
 * The pure rule behind an ADDITIVE selection gesture — Shift+click on the
 * canvas, or a checkbox in the microtubule sidebar. Both mean the same thing to
 * the user ("also include this one"), so both go through here.
 *
 * Why a rule is needed at all: the editor keeps two selections side by side.
 * `selectedPolygonId` is the lone one, used by vertex editing and the
 * cross-frame re-select; `selectedPolygonIds` is the bulk set that every
 * "…for N selected" action reads. A plain click fills the FIRST, an additive
 * click adds to the SECOND — so a user who clicks one microtubule and then
 * Shift+clicks two more leaves the first outside the bulk set. It is not in the
 * count and the bulk write skips it, silently. That is the Institut Curie
 * report of 2026-09-03 ("I see the text 'set type for 2 selected'" after
 * picking three), and the sidebar path had already grown its own copy of the
 * fix, which is why only the canvas was affected.
 */

export interface AdditiveTogglePlan {
  /** Drop the lone selection. Must go through the editor's
   *  `handleSelectPolygon(null)`, never a bare `setSelectedPolygonId(null)`:
   *  the latter leaves `persistedSelectionTrackId` set, and the cross-frame
   *  re-select effect immediately puts the microtubule back. */
  clearSingle: boolean;
  /** Ids to flip in the bulk set, in order. One list rather than two calls so
   *  a caller cannot interleave a re-render between the absorb and the toggle
   *  and lose one of them. */
  toggle: string[];
}

/**
 * @param singleSelectedId the lone `selectedPolygonId`, or null
 * @param polygonId        the polygon the user just additively clicked
 */
export function planAdditiveToggle(
  singleSelectedId: string | null | undefined,
  polygonId: string
): AdditiveTogglePlan {
  // Re-picking the single-selected polygon means "deselect it". Absorbing it
  // and then toggling it would cancel out, which reads as a dead click.
  if (singleSelectedId === polygonId) {
    return { clearSingle: true, toggle: [] };
  }
  // Absorb first, so the polygon the user picked BEFORE reaching for Shift is
  // part of the same bulk set as everything after it.
  if (singleSelectedId) {
    return { clearSingle: true, toggle: [singleSelectedId, polygonId] };
  }
  return { clearSingle: false, toggle: [polygonId] };
}
