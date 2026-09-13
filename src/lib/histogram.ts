/**
 * ImageJ's Brightness & Contrast histogram, ported from its source.
 *
 * Every function here is a transcription of named ImageJ code, and the tests
 * hold it to what ImageJ ITSELF computes on the same samples: the expected
 * values in `__tests__/fixtures/imagejHistogram/expected.json` come from
 * running ImageJ's classes on them (`scripts/imagej-histogram-oracle`), not
 * from reading this file a second time.
 *
 * Sources, ImageJ 1.54p (Maven Central) and master @ 4c4975d6 (1.54u8), which
 * agree on everything below:
 *   - binning       ij/process/ShortStatistics.java  getStatistics()
 *   - plot ceiling  ij/plugin/frame/ContrastAdjuster.java  ContrastPlot.setHistogram()
 *   - tone line     same file, ContrastPlot.paint()
 *   - Auto          same file, ContrastAdjuster.autoAdjust()
 *
 * Nothing here knows about React, channels or the editor; `DisplaySection`
 * decides which samples and which range to hand in.
 */

/** Bins in ImageJ's plot, and in the statistics Auto reads. */
export const HISTOGRAM_BINS = 256;

/** `ContrastAdjuster.AUTO_THRESHOLD`: the first Auto saturates about 1/5000 of
 *  the pixels at each end, and every further press halves the divisor. */
export const AUTO_THRESHOLD = 5000;

/** One channel's decoded samples, at native depth. */
export interface SampleBuffer {
  data: Uint16Array | Uint8Array;
  /** 8 or 16. Decides the binning, exactly as ImageJ's image type does — a
   *  16-bit frame whose values happen to stay under 256 is still 16-bit. */
  bitDepth: number;
  min: number;
  max: number;
}

/** An ImageJ `ImageStatistics` histogram, reduced to what is used here. */
export interface BinnedHistogram {
  counts: Uint32Array;
  histMin: number;
  histMax: number;
  binSize: number;
  /** Samples that fell inside [histMin, histMax]. */
  pixelCount: number;
}

const valueHistograms = new WeakMap<ArrayBufferView, Uint32Array>();

/**
 * How many samples hold each value: `counts[v]`, for v in 0..max.
 *
 * This is ImageJ's own first step — `ShortStatistics` asks the processor for a
 * 65536-entry histogram and bins THAT — and it is also the cheap way to do it
 * here. Measured on real 1924x1476 16-bit production frames (IRM, 488 nm,
 * 640 nm), counting values and then binning took 3.1-3.7 ms per channel, while
 * binning each sample directly took 11.4-11.6 ms: the per-sample float
 * multiply-and-truncate costs more than the integer increment plus a
 * 65536-step second pass. Output identical.
 *
 * Kept per sample buffer, so moving a slider, switching the axis or pressing
 * Auto never recounts a frame. A WeakMap, so the counts leave memory with the
 * frame they describe.
 */
export function valueHistogram(samples: SampleBuffer): Uint32Array {
  const cached = valueHistograms.get(samples.data);
  if (cached) return cached;
  const size = Math.min(65535, Math.max(0, Math.round(samples.max))) + 1;
  const counts = new Uint32Array(samples.bitDepth === 8 ? 256 : size);
  const top = counts.length;
  const data = samples.data;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < top) counts[v]++;
  }
  valueHistograms.set(samples.data, counts);
  return counts;
}

/**
 * `ShortStatistics.getStatistics`: fold a value histogram into `nBins` bins
 * over [histMin, histMax], both inclusive.
 *
 * `binSize = (histMax - histMin + 1) / nBins` — the +1 makes the range count
 * VALUES, so 256 values in 256 bins is exactly one value per bin. Values
 * outside the range are not counted at all, as in ImageJ when a histogram
 * range is set. The arithmetic is kept in ImageJ's exact form (multiply by
 * `1 / binSize`, truncate), because an algebraically equal rewrite such as
 * `(v - min) / binSize` rounds differently at bin edges.
 */
export function binHistogram(
  values: Uint32Array,
  histMin: number,
  histMax: number,
  nBins: number = HISTOGRAM_BINS
): BinnedHistogram {
  const counts = new Uint32Array(nBins);
  const binSize = (histMax - histMin + 1) / nBins;
  const scale = 1.0 / binSize;
  const hMin = Math.trunc(histMin);
  const first = Math.max(0, hMin);
  const last = Math.min(values.length - 1, Math.trunc(histMax));
  let pixelCount = 0;
  for (let v = first; v <= last; v++) {
    const count = values[v];
    if (count === 0) continue;
    pixelCount += count;
    let index = Math.trunc(scale * (v - hMin));
    // ImageJ's guard, kept verbatim although no sample can reach it — removing
    // it is an equivalent program, which is why no test fails without it. With
    // m = histMin and M = histMax, v <= M gives v - trunc(m) < M - m + 1, so
    // the product is below nBins by nBins / (M - m + 1): at least 0.0039 for
    // any range of 16-bit values, ten orders of magnitude above the rounding
    // of the two divisions that produce `scale`.
    if (index >= nBins) index = nBins - 1;
    counts[index] += count;
  }
  return { counts, histMin, histMax, binSize, pixelCount };
}

/**
 * `ImagePlus.getRawStatistics()` — the histogram Auto reads.
 *
 * 16-bit: 256 bins over the frame's own [min, max] (ShortStatistics).
 * 8-bit: the fixed 0..255, one value per bin (ByteStatistics).
 */
export function rawStatistics(samples: SampleBuffer): BinnedHistogram {
  const values = valueHistogram(samples);
  return samples.bitDepth === 8
    ? binHistogram(values, 0, 255)
    : binHistogram(values, samples.min, samples.max);
}

/**
 * `ContrastPlot.setHistogram`: the count that maps to the top of the plot.
 *
 * Normally the tallest bin. But when that bin is more than twice the SECOND
 * tallest, the ceiling drops to 1.5x the second and the tallest is drawn
 * clipped — otherwise a background peak, which is most of any microscopy
 * frame, would flatten everything else into the baseline.
 */
export function displayCeiling(counts: Uint32Array): number {
  let maxCount = 0;
  let mode = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > maxCount) {
      maxCount = counts[i];
      mode = i;
    }
  }
  let maxCount2 = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > maxCount2 && i !== mode) maxCount2 = counts[i];
  }
  if (maxCount > maxCount2 * 2 && maxCount2 !== 0) {
    return Math.trunc(maxCount2 * 1.5);
  }
  return maxCount;
}

export type AutoResult =
  | {
      kind: 'window';
      min: number;
      max: number;
      /** Carry into the next press on the same frame and channel. */
      autoThreshold: number;
    }
  | {
      /** Nothing qualified. ImageJ resets the display range here. */
      kind: 'reset';
      autoThreshold: 0;
    };

/**
 * `ContrastAdjuster.autoAdjust` — the B&C dialog's Auto button.
 *
 * NOT ImageJ's "Enhance Contrast" command, despite recording itself as
 * `saturated=0.35`: it walks the 256-bin histogram in from each end to the
 * first bin holding more than `pixelCount / autoThreshold` samples, ignoring
 * any bin holding more than a tenth of the frame (a background peak must not
 * stop the walk). `autoThreshold` starts at 5000 and halves on every press, so
 * repeated presses saturate progressively more, wrapping back to 5000 once it
 * falls under 10.
 *
 * `previousThreshold` is 0 for a first press; ImageJ resets it to 0 whenever
 * the image, slice or channel changes, and on Reset.
 *
 * The `< 10` test only ever sees 0, and is kept as ImageJ wrote it rather than
 * "simplified" to `=== 0`, which would be an equivalent program. The halvings
 * run 5000, 2500, …, 39, 19, 9, and the press at 9 can never produce a window:
 * a bin qualifies only when it holds more than trunc(n/9) samples, but any bin
 * holding more than trunc(n/10) was zeroed first, and trunc(n/10) <= trunc(n/9)
 * for every n. So that press always takes the reset branch and hands back 0,
 * and no threshold from 1 to 9 is ever carried into the next one. ImageJ's
 * output agrees on every oracle case and on real production frames, where the
 * press after 19 resets.
 *
 * The result is the START of each edge bin, so the brightest qualifying bin
 * saturates — ImageJ's behaviour, kept.
 */
export function autoAdjust(
  stats: BinnedHistogram,
  dataMin: number,
  dataMax: number,
  previousThreshold: number
): AutoResult {
  const { counts, pixelCount, histMin, binSize } = stats;
  const limit = Math.trunc(pixelCount / 10);
  const autoThreshold =
    previousThreshold < 10 ? AUTO_THRESHOLD : Math.trunc(previousThreshold / 2);
  const threshold = Math.trunc(pixelCount / autoThreshold);
  const last = counts.length - 1;

  let i = -1;
  let found = false;
  do {
    i++;
    let count = counts[i];
    if (count > limit) count = 0;
    found = count > threshold;
  } while (!found && i < last);
  const hmin = i;

  i = last + 1;
  do {
    i--;
    let count = counts[i];
    if (count > limit) count = 0;
    found = count > threshold;
  } while (!found && i > 0);
  const hmax = i;

  if (hmax < hmin) return { kind: 'reset', autoThreshold: 0 };
  let min = histMin + hmin * binSize;
  let max = histMin + hmax * binSize;
  if (min === max) {
    min = dataMin;
    max = dataMax;
  }
  return { kind: 'window', min, max, autoThreshold };
}

/** The plot's coordinate space: one unit per bin across, ImageJ's 2:1 aspect
 *  (`ContrastPlot` is 128x64 before GUI scaling). */
export const PLOT_WIDTH = HISTOGRAM_BINS;
export const PLOT_HEIGHT = 64;

export interface ToneLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * `ContrastPlot.paint`: the window drawn as a line over the histogram, from
 * (min, bottom) to (max, top) on an axis spanning [axisMin, axisMax].
 *
 * A window reaching past either end of the axis is clipped ALONG its slope, so
 * the line meets the frame at the height the tone curve really has there,
 * instead of being pinned to a corner.
 *
 * One deliberate difference: ImageJ computes this in whole pixels with `(int)`
 * casts; this returns exact coordinates and lets the SVG rasterise them, so a
 * narrow plot does not snap the line a pixel away from where the window is.
 * ImageJ also divides by zero on a zero-width axis (a flat channel); that is
 * treated as one value wide.
 */
export function toneLine(
  axisMin: number,
  axisMax: number,
  windowMin: number,
  windowMax: number,
  width: number = PLOT_WIDTH,
  height: number = PLOT_HEIGHT
): ToneLine {
  const span = axisMax - axisMin;
  const scale = width / (span > 0 ? span : 1);
  const slope = windowMax !== windowMin ? height / (windowMax - windowMin) : 0;
  let x1: number;
  let y1: number;
  let x2: number;
  let y2: number;
  if (windowMin >= axisMin) {
    x1 = scale * (windowMin - axisMin);
    y1 = height;
  } else {
    x1 = 0;
    y1 =
      windowMax > windowMin ? height - (axisMin - windowMin) * slope : height;
  }
  if (windowMax <= axisMax) {
    x2 = scale * (windowMax - axisMin);
    y2 = 0;
  } else {
    x2 = width;
    y2 = windowMax > windowMin ? height - (axisMax - windowMin) * slope : 0;
  }
  return { x1, y1, x2, y2 };
}
