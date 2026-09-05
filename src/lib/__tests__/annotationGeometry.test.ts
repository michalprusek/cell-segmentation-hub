/**
 * Which geometry each project type may be hand-drawn with.
 *
 * The table below is not a restatement of the implementation — it is the
 * decision, and production data agreed with it before the gate existed
 * (measured 2026-09-05): `sperm` (778 segmentations) and `microtubules` (2 641)
 * held ZERO closed polygons; `spheroid_invasive` (990), `microcapsule` (173)
 * and `wound` (24) held zero polylines; `spheroid` held exactly ONE polyline
 * across 3 853 segmentations. `neurite` is the one type with no production row
 * — it was new at the time — so its mapping rests on the model instead, which
 * emits closed polygons for both of its classes.
 */

import { describe, it, expect } from 'vitest';
import { PROJECT_TYPES } from '@/types';
import {
  annotationGeometryForProjectType,
  polylinePanelKind,
  type AnnotationGeometry,
} from '@/lib/polylineSemantics';

const EXPECTED: Record<string, AnnotationGeometry> = {
  spheroid: 'polygon',
  spheroid_invasive: 'polygon',
  wound: 'polygon',
  microcapsule: 'polygon',
  neurite: 'polygon',
  sperm: 'polyline',
  microtubules: 'polyline',
};

describe('annotationGeometryForProjectType', () => {
  it.each(Object.entries(EXPECTED))('%s is annotated with %s', (type, want) => {
    expect(annotationGeometryForProjectType(type)).toBe(want);
  });

  it('covers every project type — a new one cannot slip through untested', () => {
    // If PROJECT_TYPES grows, this fails until the new type is given a
    // deliberate geometry above. The implementation is exhaustive over
    // ProjectType, so the compiler makes the same demand of the source.
    expect([...PROJECT_TYPES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('answers null — not polygon — for an absent or unknown type', () => {
    // Both call sites read null as "offer both tools". Defaulting to polygon
    // here would hide the polyline tool on a type nobody has classified yet,
    // which is a decision made by omission rather than on purpose.
    expect(annotationGeometryForProjectType(undefined)).toBeNull();
    expect(annotationGeometryForProjectType(null)).toBeNull();
    expect(annotationGeometryForProjectType('not_a_real_type')).toBeNull();
    expect(annotationGeometryForProjectType('')).toBeNull();
  });

  it('does not accept the singular model id "microtubule"', () => {
    // The project type is the PLURAL `microtubules`; `microtubule` is the
    // MODEL id. Confusing the two has already shipped a bug in this repo,
    // which is why `isMicrotubuleProject` exists. Accepting it here would
    // hide the polygon tool from whatever project passed it.
    expect(annotationGeometryForProjectType('microtubule')).toBeNull();
  });

  it('agrees with polylinePanelKind about which types are filament projects', () => {
    // Two independently-written tables — an exhaustive Record here, a switch
    // in polylineSemanticsForProjectType there — so this can actually fail.
    // The coupling is intended in both directions: a type that earns a
    // polyline sidebar panel should also earn the polyline create tool.
    for (const type of PROJECT_TYPES) {
      expect(annotationGeometryForProjectType(type) === 'polyline').toBe(
        polylinePanelKind(type) !== null
      );
    }
  });
});
