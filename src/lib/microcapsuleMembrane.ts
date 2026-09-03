/**
 * The microcapsule membrane: the second, inner boundary a capsule shows while
 * its internal membrane is intact.
 *
 * Frontend mirror of `backend/src/services/microcapsuleMembrane.ts`. The
 * constant is the wire contract — the ML service stamps it on the polygon, the
 * exporter pairs it with its capsule, and the canvas colours it — so the two
 * files must not drift.
 */

/** `Polygon.class` of a membrane outline. */
export const MEMBRANE_CLASS = 'membrane';

/** Is this polygon a membrane rather than a capsule? */
export function isMembranePolygon(
  polygon: { class?: string | null } | null | undefined
): boolean {
  return polygon?.class === MEMBRANE_CLASS;
}

/** Stroke colour for a membrane outline.
 *
 *  Magenta against the capsule wall's green — the upstream method's own overlay
 *  convention, kept so a QA image exported from here and the editor canvas read
 *  the same way. Mirrored in backend/src/services/microcapsuleMembrane.ts.
 */
export const MEMBRANE_COLOR = '#e879f9';
