/**
 * The membrane class is the wire contract between the ML service (which stamps
 * it), the exporter (which pairs a membrane with its capsule) and the canvas
 * (which colours it). It is mirrored in
 * `backend/src/services/microcapsuleMembrane.ts`; both sides are behaviour-
 * tested so neither can drift silently.
 */
import { describe, it, expect } from 'vitest';
import {
  isMembranePolygon,
  MEMBRANE_CLASS,
  MEMBRANE_COLOR,
} from '../microcapsuleMembrane';

describe('isMembranePolygon', () => {
  it('recognises a membrane', () => {
    expect(isMembranePolygon({ class: MEMBRANE_CLASS })).toBe(true);
  });

  it('does not mistake a capsule for one', () => {
    // Both are `type: 'external'` closed outlines — the class is the ONLY
    // thing separating them, which is why this is a shared constant rather
    // than a string literal at each of the four call sites.
    expect(isMembranePolygon({ class: 'microcapsule' })).toBe(false);
  });

  it('is safe on a polygon with no class at all', () => {
    // Older stored polygons predate the field entirely.
    expect(isMembranePolygon({})).toBe(false);
    expect(isMembranePolygon(null)).toBe(false);
    expect(isMembranePolygon(undefined)).toBe(false);
  });

  it('pins the wire value', () => {
    // Changing this string silently orphans every membrane already stored.
    expect(MEMBRANE_CLASS).toBe('membrane');
  });

  it('pins a colour distinct from the capsule wall', () => {
    // Magenta against the wall's green, matching the upstream method's overlay.
    // A membrane drawn in the wall's colour is invisible as a second boundary.
    expect(MEMBRANE_COLOR).toBe('#e879f9');
    expect(MEMBRANE_COLOR).not.toBe('#00FF00');
  });
});
