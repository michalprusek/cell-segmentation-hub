/**
 * Deterministic sample sets for the ImageJ histogram oracle.
 *
 * Plain JavaScript, not TypeScript, because two programs import it: the vitest
 * suite, and `scripts/imagej-histogram-oracle/run.mjs`, which writes these
 * samples to disk, runs ImageJ's own code on them and records what it computed
 * in `expected.json`. Both sides regenerating the SAME samples from one source
 * is what makes the comparison mean anything, so the generator lives here once.
 *
 * Each case targets a branch of the ported code, not a pretty picture: a range
 * narrower than 256 values (bins wider than one value is the usual case, bins
 * NARROWER than one value is not), a background peak holding more than a tenth
 * of the pixels (Auto's `limit`), a flat and a two-valued frame (Auto's reset
 * path), and 8-bit data (ByteStatistics' fixed 0..255).
 */

/** xorshift32 — integer-only, so the sequence is identical everywhere. */
function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
}

const uniform = (next, lo, hi) => lo + (next() % (hi - lo + 1));

/** Unit-variance noise from four uniforms (Irwin-Hall), deterministic. */
function noise(next) {
  let s = 0;
  for (let i = 0; i < 4; i++) s += next() / 4294967296;
  return (s - 2) * Math.sqrt(3);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

export const CASES = [
  {
    // TIRF-like: a tight background plus sparse bright spots.
    name: 'fluorescence16',
    bitDepth: 16,
    width: 160,
    height: 120,
    seed: 11,
    sample: next =>
      next() % 100 < 3
        ? uniform(next, 8000, 30000)
        : clamp(3000 + 150 * noise(next), 0, 65535),
    axes: (min, max) => [
      [min, max],
      [min - 500, max + 4000],
      [2900, 3100],
    ],
  },
  {
    // IRM-like: high offset, broad, clipped.
    name: 'irm16',
    bitDepth: 16,
    width: 160,
    height: 120,
    seed: 23,
    sample: next => clamp(18000 + 1500 * noise(next), 12000, 24000),
    axes: (min, max) => [
      [min, max],
      [0, 65535],
    ],
  },
  {
    // 51 distinct values: every bin is narrower than one value.
    name: 'narrow16',
    bitDepth: 16,
    width: 160,
    height: 120,
    seed: 37,
    sample: next => uniform(next, 100, 150),
    axes: (min, max) => [
      [min, max],
      [min - 10, max + 300],
    ],
  },
  {
    // A background value holding ~40 % of the frame: the plot clips it and
    // Auto ignores it.
    name: 'peak16',
    bitDepth: 16,
    width: 160,
    height: 120,
    seed: 41,
    sample: next =>
      next() % 10 < 4 ? 500 : clamp(900 + 200 * noise(next), 0, 65535),
    axes: (min, max) => [[min, max]],
  },
  {
    name: 'flat16',
    bitDepth: 16,
    width: 64,
    height: 48,
    seed: 53,
    sample: () => 4242,
    axes: () => [
      [4242, 4242],
      [4000, 4500],
    ],
  },
  {
    // Both values exceed a tenth of the frame, so Auto finds nothing.
    name: 'twoValue16',
    bitDepth: 16,
    width: 64,
    height: 48,
    seed: 59,
    sample: next => (next() % 2 ? 1000 : 3000),
    axes: (min, max) => [[min, max]],
  },
  {
    // Mostly zero with a thin spread over the whole 16-bit range.
    name: 'sparse16',
    bitDepth: 16,
    width: 160,
    height: 120,
    seed: 67,
    sample: next => (next() % 100 < 95 ? 0 : uniform(next, 1, 65535)),
    axes: (min, max) => [[min, max]],
  },
  {
    // A long exponential tail: most of the plot is the ceiling rule's business.
    name: 'tail16',
    bitDepth: 16,
    width: 160,
    height: 120,
    seed: 71,
    sample: next =>
      clamp(100 - 200 * Math.log((next() + 1) / 4294967297), 0, 65535),
    axes: (min, max) => [
      [min, max],
      [0, max + 1000],
    ],
  },
  {
    name: 'full8',
    bitDepth: 8,
    width: 160,
    height: 120,
    seed: 79,
    sample: next => clamp(120 + 40 * noise(next), 0, 255),
    axes: (min, max) => [
      [min, max],
      [0, 255],
    ],
  },
  {
    name: 'dim8',
    bitDepth: 8,
    width: 160,
    height: 120,
    seed: 83,
    sample: next => uniform(next, 10, 60),
    axes: (min, max) => [[min, max]],
  },
];

/** How many times the oracle presses Auto per case: enough to walk the
 *  threshold 5000 → 9 and wrap back to 5000. */
export const AUTO_CLICKS = 12;

/** The samples of one case, plus their extremes. */
export function generateSamples(testCase) {
  const next = rng(testCase.seed);
  const n = testCase.width * testCase.height;
  const data =
    testCase.bitDepth === 16 ? new Uint16Array(n) : new Uint8Array(n);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = testCase.sample(next);
    data[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { data, min, max };
}
