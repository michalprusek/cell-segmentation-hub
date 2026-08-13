/**
 * Unit tests for the backend polyline-semantics SSOT. Mirrors the frontend
 * mapping and additionally pins the export-only fields (labelPrefix badge,
 * exportCategory for COCO/JSON). A polyline is a generic primitive; the export
 * must not assume sperm for a non-sperm project.
 */

import { describe, it, expect } from 'vitest';
import { polylineSemanticsForProjectType } from '../polylineSemantics';
import {
  SPERM_LABEL_PREFIX,
  MICROTUBULE_LABEL_PREFIX,
  GENERIC_LABEL_PREFIX,
} from '../instanceLabels';

describe('polylineSemanticsForProjectType (backend)', () => {
  it('sperm → sperm category + S badge + part classes', () => {
    const s = polylineSemanticsForProjectType('sperm');
    expect(s.kind).toBe('sperm');
    expect(s.labelPrefix).toBe(SPERM_LABEL_PREFIX);
    expect(s.exportCategory).toBe('sperm');
    expect(s.supportsPartClass).toBe(true);
  });

  it('microtubules → microtubule category + MT badge + no part classes', () => {
    const s = polylineSemanticsForProjectType('microtubules');
    expect(s.kind).toBe('microtubule');
    expect(s.labelPrefix).toBe(MICROTUBULE_LABEL_PREFIX);
    expect(s.exportCategory).toBe('microtubule');
    expect(s.supportsPartClass).toBe(false);
  });

  it.each(['spheroid', 'wound', 'microcapsule', undefined, null, 'x'])(
    'non-sperm/non-MT %s → generic category + P badge, never sperm',
    type => {
      const s = polylineSemanticsForProjectType(type);
      expect(s.kind).toBe('generic');
      expect(s.labelPrefix).toBe(GENERIC_LABEL_PREFIX);
      expect(s.exportCategory).toBe('polyline');
      expect(s.supportsPartClass).toBe(false);
    }
  );
});
