/**
 * The ImageJ histogram port, held to what ImageJ ITSELF computes.
 *
 * `fixtures/imagejHistogram/expected.json` is the output of ImageJ 1.54p's own
 * classes — `ImagePlus.getRawStatistics`, `ShortStatistics` with a histogram
 * range, `ContrastPlot.setHistogram` and `ContrastAdjuster.autoAdjust` — run on
 * the samples `cases.mjs` generates, by `scripts/imagej-histogram-oracle`.
 * Regenerate it with that script; never edit it by hand. A mismatch here means
 * the port and ImageJ disagree, not that the fixture is stale.
 *
 * The plot's LINE has no oracle (ImageJ draws it in whole pixels onto an AWT
 * canvas), so `toneLine` is pinned by hand-derived cases instead.
 */

import { describe, it, expect } from 'vitest';
import {
  AUTO_THRESHOLD,
  PLOT_HEIGHT,
  PLOT_WIDTH,
  autoAdjust,
  binHistogram,
  displayCeiling,
  rawStatistics,
  toneLine,
  valueHistogram,
  type SampleBuffer,
} from '../histogram';
import expectedJson from './fixtures/imagejHistogram/expected.json';
import {
  AUTO_CLICKS,
  CASES,
  generateSamples,
  type HistogramCase,
} from './fixtures/imagejHistogram/cases.mjs';

interface OracleStats {
  histogram: number[];
  nBins: number;
  histMin: number;
  histMax: number;
  binSize: number;
  pixelCount: number;
  min: number;
  max: number;
  maxCount: number;
}

interface OracleCase {
  raw: OracleStats;
  rawCeiling: { hmax: number; drawn: number[] };
  axes: {
    range: [number, number];
    stats: OracleStats;
    ceiling: { hmax: number };
  }[];
  auto: {
    displayMin: number;
    displayMax: number;
    min: number;
    max: number;
    autoThreshold: number;
    error: string | null;
  }[];
}

const oracle = expectedJson as unknown as {
  imagejVersion: string;
  autoClicks: number;
  cases: Record<string, OracleCase>;
};

function samplesOf(testCase: HistogramCase): SampleBuffer {
  const { data, min, max } = generateSamples(testCase);
  return { data, bitDepth: testCase.bitDepth, min, max };
}

describe('the oracle fixture', () => {
  it('holds exactly the cases cases.mjs defines, pressed Auto as often as it says', () => {
    expect(Object.keys(oracle.cases).sort()).toEqual(
      CASES.map(c => c.name).sort()
    );
    expect(oracle.autoClicks).toBe(AUTO_CLICKS);
  });

  // A fixture that never reaches a branch cannot test it. These pin that the
  // cases still do what their comments in cases.mjs claim, so a future edit to
  // the generator cannot quietly turn this suite into one that proves nothing.
  it('still exercises every branch the port has', () => {
    const all = Object.values(oracle.cases);
    // The ceiling rule actually clips somewhere...
    expect(all.some(c => c.rawCeiling.hmax < c.raw.maxCount)).toBe(true);
    // ...and leaves the tallest bin alone somewhere else.
    expect(all.some(c => c.rawCeiling.hmax === c.raw.maxCount)).toBe(true);
    // Bins narrower than one value, and wider.
    expect(all.some(c => c.raw.binSize < 1)).toBe(true);
    expect(all.some(c => c.raw.binSize > 1)).toBe(true);
    // Auto's reset path, and its min === max fallback's neighbour, the window.
    expect(all.some(c => c.auto.some(a => a.autoThreshold === 0))).toBe(true);
    expect(all.some(c => c.auto.some(a => a.autoThreshold > 0))).toBe(true);
    // A range narrower than the data, so exclusion is tested.
    expect(
      all.some(c => c.axes.some(a => a.stats.pixelCount < c.raw.pixelCount))
    ).toBe(true);
    // A press after a reset starts over at 5000 — the carry across a reset.
    expect(
      all.some(c =>
        c.auto.some(
          (a, k) =>
            k > 0 &&
            a.autoThreshold === AUTO_THRESHOLD &&
            c.auto[k - 1].autoThreshold === 0
        )
      )
    ).toBe(true);
  });

  it('never carries a threshold under 10 out of a press, which is why `< 10` only ever sees 0', () => {
    // See autoAdjust: at a divisor of 9 no bin can qualify, so that press
    // resets. ImageJ's own output on every case agrees.
    for (const c of Object.values(oracle.cases)) {
      for (const press of c.auto) {
        expect(press.autoThreshold === 0 || press.autoThreshold >= 10).toBe(
          true
        );
      }
    }
  });
});

describe.each(CASES)('$name against ImageJ', testCase => {
  const want = oracle.cases[testCase.name];
  const samples = samplesOf(testCase);

  it('bins like ImagePlus.getRawStatistics', () => {
    const got = rawStatistics(samples);
    expect(Array.from(got.counts)).toEqual(want.raw.histogram);
    expect(got.binSize).toBe(want.raw.binSize);
    expect(got.histMin).toBe(want.raw.histMin);
    expect(got.histMax).toBe(want.raw.histMax);
    expect(got.pixelCount).toBe(want.raw.pixelCount);
  });

  it('puts the plot ceiling where ContrastPlot.setHistogram does', () => {
    expect(displayCeiling(rawStatistics(samples).counts)).toBe(
      want.rawCeiling.hmax
    );
  });

  it('bins an explicit range like ShortStatistics with setHistogramRange', () => {
    const axes = testCase.axes(samples.min, samples.max);
    // The oracle binned these very ranges, not ones computed differently.
    expect(want.axes.map(a => a.range)).toEqual(axes);
    axes.forEach(([lo, hi], k) => {
      const got = binHistogram(valueHistogram(samples), lo, hi);
      const label = `range ${lo}..${hi}`;
      expect(Array.from(got.counts), label).toEqual(
        want.axes[k].stats.histogram
      );
      expect(got.binSize, label).toBe(want.axes[k].stats.binSize);
      expect(got.pixelCount, label).toBe(want.axes[k].stats.pixelCount);
      expect(displayCeiling(got.counts), label).toBe(want.axes[k].ceiling.hmax);
    });
  });

  it('walks Auto through the same presses as ContrastAdjuster.autoAdjust', () => {
    let threshold = 0;
    want.auto.forEach((press, k) => {
      const label = `press ${k + 1}`;
      // The oracle really ran this press to the end.
      expect(press.error, label).toBeNull();
      const result = autoAdjust(
        rawStatistics(samples),
        samples.min,
        samples.max,
        threshold
      );
      expect(result.autoThreshold, label).toBe(press.autoThreshold);
      if (result.kind === 'window') {
        expect(result.min, label).toBe(press.min);
        expect(result.max, label).toBe(press.max);
        // What ImageJ then displays: the window rounded to whole values.
        expect(Math.round(result.min), label).toBe(press.displayMin);
        expect(Math.round(result.max), label).toBe(press.displayMax);
      } else {
        // ImageJ's reset(): the frame's own range for 16-bit, the fixed
        // 0..255 for 8-bit. DisplaySection applies the data range to both.
        expect([press.displayMin, press.displayMax], label).toEqual(
          testCase.bitDepth === 8 ? [0, 255] : [samples.min, samples.max]
        );
      }
      threshold = result.autoThreshold;
    });
  });
});

describe('valueHistogram', () => {
  it('counts each value once per sample and keeps the counts for the buffer', () => {
    const samples: SampleBuffer = {
      data: new Uint16Array([5, 7, 7, 1000]),
      bitDepth: 16,
      min: 5,
      max: 1000,
    };
    const counts = valueHistogram(samples);
    expect(counts.length).toBe(1001);
    expect([counts[5], counts[7], counts[1000], counts[6]]).toEqual([
      1, 2, 1, 0,
    ]);
    // Same buffer, same counts object: sliders and Auto never recount.
    expect(valueHistogram({ ...samples })).toBe(counts);
  });
});

describe('toneLine — ContrastPlot.paint', () => {
  const W = PLOT_WIDTH;
  const H = PLOT_HEIGHT;

  it('runs from (min, bottom) to (max, top) inside the axis', () => {
    expect(toneLine(100, 1100, 350, 850)).toEqual({
      x1: (W * 250) / 1000,
      y1: H,
      x2: (W * 750) / 1000,
      y2: 0,
    });
  });

  it('meets the left edge at the height the tone curve has there', () => {
    // Window 0..600 on an axis starting at 100: at value 100 the tone is
    // 100/600 of the way up.
    const line = toneLine(100, 1100, 0, 600);
    expect(line.x1).toBe(0);
    expect(line.y1).toBeCloseTo(H - (100 * H) / 600, 10);
    expect(line.x2).toBe((W * 500) / 1000);
    expect(line.y2).toBe(0);
  });

  it('meets the right edge at the height the tone curve has there', () => {
    // Window 600..1600 on an axis ending at 1100: halfway up at 1100.
    expect(toneLine(100, 1100, 600, 1600)).toEqual({
      x1: (W * 500) / 1000,
      y1: H,
      x2: W,
      y2: H / 2,
    });
  });

  it('draws a zero-width window as a vertical step, like ImageJ', () => {
    const line = toneLine(100, 1100, 500, 500);
    expect(line.x1).toBe(line.x2);
    expect([line.y1, line.y2]).toEqual([H, 0]);
  });

  it('does not divide by zero on a flat channel', () => {
    const line = toneLine(4242, 4242, 4242, 4242);
    expect(Object.values(line).every(Number.isFinite)).toBe(true);
  });
});
