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
 * kind mapping identical. `AnnotationGeometry` below is deliberately NOT
 * mirrored — it gates a drawing tool, and the backend draws nothing.
 */

import { isProjectType, type ProjectType } from '@/types';

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

/** The one geometry a project type is HAND-DRAWN with. */
export type AnnotationGeometry = 'polygon' | 'polyline';

/**
 * Which create tool each project type offers. Exhaustive over `ProjectType` on
 * purpose: an eighth project type fails to compile here until someone decides,
 * where a `default` branch would silently hand it the polygon tool.
 *
 * Measured against production on 2026-09-05, and the data already agreed:
 * `sperm` (778 segmentations) and `microtubules` (2 641) held ZERO closed
 * polygons; `spheroid_invasive` (990), `microcapsule` (173) and `wound` (24)
 * held zero polylines; `spheroid` held exactly ONE polyline across 3 853
 * segmentations — which is what a mis-click looks like, though the cause was
 * never confirmed and it is geometry the type has no metric for either way.
 * `neurite` is the one type with no production row (it was new at the time);
 * its mapping comes from the model instead, see below.
 *
 * These are exactly the two types `polylinePanelKind` returns non-null for —
 * not by coincidence, but they are stated INDEPENDENTLY here so that asserting
 * their agreement is a real test rather than a tautology. The coupling is
 * load-bearing in both directions: giving a future type a polyline sidebar
 * panel should also switch its create tool, and that is intended.
 */
const ANNOTATION_GEOMETRY: Record<ProjectType, AnnotationGeometry> = {
  spheroid: 'polygon',
  spheroid_invasive: 'polygon',
  wound: 'polygon',
  microcapsule: 'polygon',
  // Looks wrong, is not: the neurite/soma model emits CLOSED POLYGONS for both
  // of its classes — `FOREGROUND_CLASSES = ((1, 'neurite'), (2, 'soma'))` in
  // `backend/segmentation/models/neurite_soma/wrapper.py`, emitted with
  // `type='external'` by `predict_neurite_soma` (`ml/model_loader.py`). A
  // hand-drawn polyline here would produce something no metric reads.
  neurite: 'polygon',
  sperm: 'polyline',
  microtubules: 'polyline',
};

/**
 * The create tool this project offers, or `null` when the answer is not known
 * — an absent type (`useProjectData` starts `undefined` and fills it when the
 * fetch resolves, so EVERY editor mount passes through this) or a string that
 * is not a `ProjectType`. Both fail OPEN at the call sites: a rail with no
 * create tool at all is a worse regression than a brief extra one, and an
 * unrecognised type is not evidence about geometry in either direction.
 *
 * Scope: this gates HAND-DRAWING only. Nothing hides or rewrites geometry that
 * already exists — the stray spheroid polyline above stays editable, it is
 * just no longer reproducible.
 */
export function annotationGeometryForProjectType(
  type: string | undefined | null
): AnnotationGeometry | null {
  return isProjectType(type) ? ANNOTATION_GEOMETRY[type] : null;
}
