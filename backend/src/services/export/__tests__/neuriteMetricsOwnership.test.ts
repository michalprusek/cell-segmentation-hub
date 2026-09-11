/**
 * Who owns `metrics.*` for a neurite project.
 *
 * A neurite project exported to XLSX produced ONE sheet of closed-polygon
 * spheroid metrics — Area, Circularity, Feret, Solidity, **Sphericity** — and
 * no neurite or soma sheet at all. Two independent causes, both covered here:
 * the standard report did not know to step aside, and the report that should
 * have replaced it was behind an opt-in that defaulted to off.
 *
 * Microtubule projects already solved exactly this; these assertions mirror
 * that arrangement so the two cannot drift.
 */

import { describe, it, expect } from 'vitest';
import { standardPolygonMetricsApply } from '../../../types/validation';
import {
  countExportSteps,
  neuriteMetricsWillRun,
} from '../exportFileOperations';

describe('standardPolygonMetricsApply', () => {
  it('steps aside for neurite projects', () => {
    // Neurite polygons are soma blobs and process masks. "Sphericity" of a
    // dendrite is not a quantity; the per-cell report replaces it entirely.
    expect(standardPolygonMetricsApply('neurite')).toBe(false);
  });

  it('steps aside for microtubule projects', () => {
    // Pre-existing behaviour, asserted so the two stay one decision.
    expect(standardPolygonMetricsApply('microtubules')).toBe(false);
  });

  it('applies to every project type whose annotations are closed polygons', () => {
    for (const t of ['spheroid', 'spheroid_invasive', 'sperm', 'wound']) {
      expect(standardPolygonMetricsApply(t)).toBe(true);
    }
  });

  it('applies when the type is unknown or absent', () => {
    // The caller defaults a missing type to 'spheroid'; erring toward the
    // generic report keeps an unrecognised project from exporting nothing.
    expect(standardPolygonMetricsApply(undefined)).toBe(true);
    expect(standardPolygonMetricsApply('something-new')).toBe(true);
  });
});

describe('countExportSteps — the neurite report is not opt-in', () => {
  const base = { metricsFormats: ['excel'] as string[] };

  it('counts the neurite report without neuriteMetrics.enabled', () => {
    // The step counter drives the progress bar. Leaving `enabled` in the
    // condition here while the task itself no longer reads it would make
    // progress overshoot and the bar stall at the end.
    const withFlag = countExportSteps(
      { ...base, neuriteMetrics: { enabled: true } },
      false,
      true,
      true
    );
    const withoutFlag = countExportSteps({ ...base }, false, true, true);
    expect(withoutFlag).toBe(withFlag);
  });

  it('still does not count it for a non-neurite project', () => {
    expect(countExportSteps({ ...base }, false, true, false)).toBeLessThan(
      countExportSteps({ ...base }, false, true, true)
    );
  });
});

describe('neuriteMetricsWillRun — the one expression of the rule', () => {
  it('runs for a neurite project with metrics requested and images', () => {
    expect(
      neuriteMetricsWillRun({ metricsFormats: ['excel'] }, true, true)
    ).toBe(true);
  });

  it('ignores neuriteMetrics.enabled entirely', () => {
    // The flag still arrives from older frontend bundles. Honouring it is the
    // bug: "off" did not mean "no report", it meant spheroid metrics per
    // dendrite and neither sheet. Reinstating the term anywhere turns this red.
    expect(
      neuriteMetricsWillRun(
        { metricsFormats: ['excel'], neuriteMetrics: { enabled: false } } as never,
        true,
        true
      )
    ).toBe(true);
  });

  it('does not run without metrics, without images, or off-type', () => {
    expect(neuriteMetricsWillRun({ metricsFormats: [] }, true, true)).toBe(false);
    expect(neuriteMetricsWillRun({ metricsFormats: ['excel'] }, true, false)).toBe(false);
    expect(neuriteMetricsWillRun({ metricsFormats: ['excel'] }, false, true)).toBe(false);
  });

  it('agrees with the step counter', () => {
    // The gate and the progress bar read the SAME predicate now; this pins
    // that they cannot drift back apart.
    const opts = { metricsFormats: ['excel'] };
    const counted =
      countExportSteps(opts, false, true, true) -
      countExportSteps(opts, false, true, false);
    expect(counted).toBe(neuriteMetricsWillRun(opts, true, true) ? 1 : 0);
  });
});
