/**
 * The microcapsule membrane: the second, inner boundary a capsule shows while
 * its internal membrane is intact.
 *
 * Detected by the classical stage in
 * `backend/segmentation/models/microcapsule_membrane.py`, which emits it as a
 * closed polygon of its OWN class beside the capsule — a capsule whose membrane
 * has dissolved simply gets none, so the polygon existing IS the verdict.
 *
 * Mirrored on the frontend by `src/lib/microcapsuleMembrane.ts`. Keep the two
 * in step; the constant is the wire contract between the ML service, the
 * exporter and the canvas.
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
 *  the same way. Mirrored in src/lib/microcapsuleMembrane.ts.
 */
export const MEMBRANE_COLOR = '#e879f9';
