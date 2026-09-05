/**
 * A polyline (`Polygon` with `geometry: 'polyline'`) is a GENERIC labeling
 * primitive shared by sperm and microtubule projects. Its *semantics* — which
 * instance-id scheme new polylines use, whether head/midpiece/tail part classes
 * apply, how export badges/categories read — are a property of the PROJECT TYPE,
 * not of an individual polyline.
 *
 * Deriving them here, once, from `Project.type` removes the old per-polygon
 * guesswork (sniff an `mt_` instanceId prefix, fall back to sperm) that let a
 * hand-drawn polyline in a microtubule project masquerade as sperm — stamping it
 * with a `partClass` and a `sperm_1` id, and flipping the whole project's sidebar
 * to the sperm panel.
 *
 * Mirrored on the backend at `backend/src/utils/polylineSemantics.ts`; keep the
 * kind mapping identical.
 */

export type PolylineKind = 'sperm' | 'microtubule' | 'generic';

export interface PolylineSemantics {
  kind: PolylineKind;
  /** Prefix for a freshly-synthesised instance id: `sperm_`, `mt_`, `poly_`. */
  idPrefix: string;
  /** Sequential export badge prefix: `S`, `MT`, `P`. */
  labelPrefix: string;
  /** Only sperm carries head/midpiece/tail part classes. */
  supportsPartClass: boolean;
}

const SPERM: PolylineSemantics = {
  kind: 'sperm',
  idPrefix: 'sperm_',
  labelPrefix: 'S',
  supportsPartClass: true,
};

const MICROTUBULE: PolylineSemantics = {
  kind: 'microtubule',
  idPrefix: 'mt_',
  labelPrefix: 'MT',
  supportsPartClass: false,
};

const GENERIC: PolylineSemantics = {
  kind: 'generic',
  idPrefix: 'poly_',
  labelPrefix: 'P',
  supportsPartClass: false,
};

/** Resolve the polyline semantics for a raw `project.type` string. Unknown /
 *  legacy values (spheroid, wound, microcapsule, …) fall through to `generic`. */
export function polylineSemanticsForProjectType(
  type: string | undefined | null
): PolylineSemantics {
  switch (type) {
    case 'sperm':
      return SPERM;
    case 'microtubules':
      return MICROTUBULE;
    default:
      return GENERIC;
  }
}

/**
 * Panel / context-menu discriminator: `'sperm'` or `'microtubule'` for the two
 * project types that own a dedicated polyline sidebar panel, else `null`
 * (generic projects have no polyline UI). This is the single signal the editor
 * uses to choose the sperm vs microtubule panel — replacing the old per-polygon
 * `class`/`partClass`/`mt_`-prefix heuristic.
 */
/** The ONE geometry a project type is annotated with. */
export type AnnotationGeometry = 'polygon' | 'polyline';

/**
 * Which geometry may be drawn by hand in a project of this type.
 *
 * Every project type annotates exactly one thing, so the editor offers exactly
 * one create tool. Before this, both were always offered and the wrong one was
 * one mis-click away — measured on production 2026-09-05, a single stray
 * polyline had reached one of 3 853 spheroid segmentations that way, while
 * `sperm` (778) and `microtubules` (2 641) held ZERO closed polygons and
 * `spheroid_invasive` (990), `microcapsule` (173) and `wound` (24) held zero
 * polylines. The data already agreed with the rule; nothing enforced it.
 *
 *  - **polyline** — `sperm` (head/midpiece/tail carry `partClass`) and
 *    `microtubules` (filaments carry `trackId`, and feed the kymograph and the
 *    competition metric). These are the two types `polylineSemanticsForProjectType`
 *    above gives a non-generic kind to, and that is not a coincidence.
 *  - **polygon** — everything else: `spheroid`, `spheroid_invasive`, `wound`,
 *    `microcapsule`, `neurite`.
 *
 * `neurite` is the one that looks wrong and is not. The name suggests a
 * filament, but the neurite/soma model emits CLOSED POLYGONS for both of its
 * classes — see `neuronClassStyle.ts` and the comment at `CanvasPolygon.tsx`
 * ("Neuron classes (closed polygons from the neurite/soma model)"). Drawing a
 * polyline there would produce something no metric in this codebase can read.
 *
 * This gates HAND-DRAWING only. It never filters what the models return, and it
 * never touches geometry that already exists — the stray spheroid polyline
 * above is still editable, just no longer reproducible.
 */
export function annotationGeometryForProjectType(
  type: string | undefined | null
): AnnotationGeometry {
  return polylinePanelKind(type) === null ? 'polygon' : 'polyline';
}

export function polylinePanelKind(
  type: string | undefined | null
): 'sperm' | 'microtubule' | null {
  const { kind } = polylineSemanticsForProjectType(type);
  return kind === 'generic' ? null : kind;
}
