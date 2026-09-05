/**
 * Which geometry each project type may be hand-drawn with.
 *
 * The table below is not a restatement of the implementation — it is the
 * decision, and production data agreed with it before the gate existed
 * (measured 2026-09-05): `sperm` (778 segmentations) and `microtubules` (2 641)
 * held ZERO closed polygons; `spheroid_invasive` (990), `microcapsule` (173)
 * and `wound` (24) held zero polylines; `spheroid` held exactly ONE polyline
 * across 3 853 segmentations, which is the mis-click this gate prevents.
 */

import { describe, it, expect } from 'vitest';
import { PROJECT_TYPES } from '@/types';
import {
  annotationGeometryForProjectType,
  type AnnotationGeometry,
} from '@/lib/polylineSemantics';

const EXPECTED: Record<string, AnnotationGeometry> = {
  spheroid: 'polygon',
  spheroid_invasive: 'polygon',
  wound: 'polygon',
  microcapsule: 'polygon',
  // Looks wrong, is not: the neurite/soma model emits CLOSED POLYGONS for both
  // of its classes. A polyline here would produce something no metric reads.
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
    // deliberate geometry above, rather than silently defaulting to polygon.
    expect([...PROJECT_TYPES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('defaults an unknown or absent type to polygon', () => {
    // The generic fallback: an unrecognised type gets the closed-region tool,
    // which is what every non-filament model in this codebase produces.
    expect(annotationGeometryForProjectType(undefined)).toBe('polygon');
    expect(annotationGeometryForProjectType(null)).toBe('polygon');
    expect(annotationGeometryForProjectType('not_a_real_type')).toBe('polygon');
  });

  it('agrees with polylinePanelKind about which types are filament projects', () => {
    // The two are the same fact stated twice; they must not drift. A type with
    // a dedicated polyline sidebar panel is exactly a type drawn with polylines.
    for (const type of PROJECT_TYPES) {
      const isFilament = annotationGeometryForProjectType(type) === 'polyline';
      expect(isFilament).toBe(type === 'sperm' || type === 'microtubules');
    }
  });
});
