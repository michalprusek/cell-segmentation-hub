/**
 * Backend half of the membrane wire contract. Mirrors
 * `src/lib/__tests__/microcapsuleMembrane.test.ts` — the two files must assert
 * the same table, because the constant travels from the ML service through the
 * exporter to the canvas and a drift between the sides orphans stored data.
 */
import { describe, it, expect } from 'vitest';
import {
  isMembranePolygon,
  MEMBRANE_CLASS,
  MEMBRANE_COLOR,
} from '../microcapsuleMembrane';

describe('isMembranePolygon (backend)', () => {
  it('recognises a membrane', () => {
    expect(isMembranePolygon({ class: MEMBRANE_CLASS })).toBe(true);
  });

  it('does not mistake a capsule for one', () => {
    expect(isMembranePolygon({ class: 'microcapsule' })).toBe(false);
  });

  it('is safe on a polygon with no class at all', () => {
    expect(isMembranePolygon({})).toBe(false);
    expect(isMembranePolygon(null)).toBe(false);
    expect(isMembranePolygon(undefined)).toBe(false);
  });

  it('pins the same wire value and colour as the frontend mirror', () => {
    expect(MEMBRANE_CLASS).toBe('membrane');
    expect(MEMBRANE_COLOR).toBe('#e879f9');
  });
});
