/**
 * Unit tests for the frontend polyline-semantics SSOT. A polyline is a generic
 * labeling primitive; its kind/id-scheme/part-class support is a property of the
 * PROJECT type, not of an individual polyline. These lock the mapping so a
 * hand-drawn polyline in a microtubule project can never again be treated as
 * sperm.
 */

import { describe, it, expect } from 'vitest';
import {
  polylineSemanticsForProjectType,
  polylinePanelKind,
} from '../polylineSemantics';

describe('polylineSemanticsForProjectType', () => {
  it('maps sperm projects to sperm semantics (part classes, sperm_ ids, S badge)', () => {
    const s = polylineSemanticsForProjectType('sperm');
    expect(s.kind).toBe('sperm');
    expect(s.idPrefix).toBe('sperm_');
    expect(s.labelPrefix).toBe('S');
    expect(s.supportsPartClass).toBe(true);
  });

  it('maps microtubules projects to microtubule semantics (no part classes)', () => {
    const s = polylineSemanticsForProjectType('microtubules');
    expect(s.kind).toBe('microtubule');
    expect(s.idPrefix).toBe('mt_');
    expect(s.labelPrefix).toBe('MT');
    expect(s.supportsPartClass).toBe(false);
  });

  it.each(['spheroid', 'spheroid_invasive', 'wound', 'microcapsule'])(
    'maps non-polyline project type %s to generic (never sperm)',
    type => {
      const s = polylineSemanticsForProjectType(type);
      expect(s.kind).toBe('generic');
      expect(s.idPrefix).toBe('poly_');
      expect(s.supportsPartClass).toBe(false);
    }
  );

  it.each([undefined, null, '', 'garbage', 'MICROTUBULES'])(
    'falls back to generic for unknown/legacy value %s',
    type => {
      expect(polylineSemanticsForProjectType(type).kind).toBe('generic');
    }
  );

  // The singular model id `microtubule` must NOT resolve — only the plural
  // project type `microtubules` does. Mixing them has shipped a bug before.
  it('does not treat the singular model id "microtubule" as a MT project', () => {
    expect(polylineSemanticsForProjectType('microtubule').kind).toBe('generic');
  });
});

describe('polylinePanelKind', () => {
  it('returns the panel kind for the two projects with a dedicated panel', () => {
    expect(polylinePanelKind('sperm')).toBe('sperm');
    expect(polylinePanelKind('microtubules')).toBe('microtubule');
  });

  it('returns null for generic projects (no polyline sidebar panel)', () => {
    expect(polylinePanelKind('spheroid')).toBeNull();
    expect(polylinePanelKind(undefined)).toBeNull();
    expect(polylinePanelKind(null)).toBeNull();
  });
});
