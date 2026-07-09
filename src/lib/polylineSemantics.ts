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
export function polylinePanelKind(
  type: string | undefined | null
): 'sperm' | 'microtubule' | null {
  const { kind } = polylineSemanticsForProjectType(type);
  return kind === 'generic' ? null : kind;
}
