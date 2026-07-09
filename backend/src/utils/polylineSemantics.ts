/**
 * A polyline (`geometry: 'polyline'`) is a GENERIC labeling primitive shared by
 * sperm and microtubule projects. Its export semantics — the badge prefix, the
 * instance-id scheme used when one must be synthesised, whether head/midpiece/
 * tail part classes apply, and the COCO/JSON category name — are a property of
 * the PROJECT TYPE, not of an individual polyline.
 *
 * Resolving them here, once, from `project.type` removes the old assumption that
 * every non-microtubule polyline is sperm (the `isMicrotubuleProject ? MT : S`
 * branch and the hardcoded `sperm` COCO category).
 *
 * Mirrors the frontend SSOT at `src/lib/polylineSemantics.ts`; keep the kind
 * mapping identical.
 */

import {
  SPERM_LABEL_PREFIX,
  MICROTUBULE_LABEL_PREFIX,
  GENERIC_LABEL_PREFIX,
  type InstanceLabelPrefix,
} from './instanceLabels';

export type PolylineKind = 'sperm' | 'microtubule' | 'generic';

export interface PolylineSemantics {
  kind: PolylineKind;
  /** Prefix for a freshly-synthesised instance id: `sperm_`, `mt_`, `poly_`. */
  idPrefix: string;
  /** Sequential export badge prefix (`S`, `MT`, `P`). */
  labelPrefix: InstanceLabelPrefix;
  /** Only sperm carries head/midpiece/tail part classes. */
  supportsPartClass: boolean;
  /** COCO / JSON annotation category name for this kind's polylines. */
  exportCategory: string;
}

const SPERM: PolylineSemantics = {
  kind: 'sperm',
  idPrefix: 'sperm_',
  labelPrefix: SPERM_LABEL_PREFIX,
  supportsPartClass: true,
  exportCategory: 'sperm',
};

const MICROTUBULE: PolylineSemantics = {
  kind: 'microtubule',
  idPrefix: 'mt_',
  labelPrefix: MICROTUBULE_LABEL_PREFIX,
  supportsPartClass: false,
  exportCategory: 'microtubule',
};

const GENERIC: PolylineSemantics = {
  kind: 'generic',
  idPrefix: 'poly_',
  labelPrefix: GENERIC_LABEL_PREFIX,
  supportsPartClass: false,
  exportCategory: 'polyline',
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
