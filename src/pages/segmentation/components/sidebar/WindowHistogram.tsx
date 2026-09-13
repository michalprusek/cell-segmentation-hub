/**
 * The histogram above the Min/Max sliders: ImageJ's Brightness & Contrast plot
 * (`ContrastPlot`), drawn as SVG.
 *
 * What it shows, all of it ImageJ's:
 *  - 256 bins over the SAME axis as the sliders below it, so a thumb and the
 *    part of the distribution it cuts sit above one another;
 *  - bar heights against `displayCeiling`, which clips a dominant background
 *    peak instead of letting it flatten the rest of the plot;
 *  - each bar coloured by where the window puts it — black below Min, the
 *    channel's full tint above Max, a ramp between — as ImageJ has done since
 *    1.54q21. The ramp is the canvas's own LUT (`buildLut`) and tint, not a
 *    second approximation of them, so the plot cannot drift from the picture;
 *  - a black dot capping each bar, which is what keeps a white bar visible on
 *    the white ground;
 *  - the window as a line from (Min, bottom) to (Max, top), with a tick at Max.
 *
 * SVG rather than a canvas: it scales with the resizable sidebar without
 * re-rasterising, and jsdom can render and inspect it.
 */

import { memo, useMemo } from 'react';
import { hexToRgb } from '@/lib/hexColor';
import {
  PLOT_HEIGHT,
  PLOT_WIDTH,
  binHistogram,
  displayCeiling,
  toneLine,
  valueHistogram,
  type SampleBuffer,
} from '@/lib/histogram';
import { buildLut } from '@/lib/windowLevel';

/** `ContrastPlot.paint`'s tick under the Max end of the line, in plot units. */
const MAX_TICK = 5;

interface WindowHistogramProps {
  /** The active channel's samples on screen, or null when none are (no frame
   *  decoded yet, or this frame does not carry the channel). ImageJ draws the
   *  empty frame and the line in that case, and so does this. */
  samples: SampleBuffer | null;
  axisMin: number;
  axisMax: number;
  windowMin: number;
  windowMax: number;
  /** The channel's display tint, `#RRGGBB`. */
  color: string;
  label: string;
}

function WindowHistogram({
  samples,
  axisMin,
  axisMax,
  windowMin,
  windowMax,
  color,
  label,
}: WindowHistogramProps) {
  // Counting is per sample buffer and cached inside `valueHistogram`; binning
  // is 256 folds of it; neither re-runs on a slider tick. Only the colours do.
  const binned = useMemo(
    () =>
      samples ? binHistogram(valueHistogram(samples), axisMin, axisMax) : null,
    [samples, axisMin, axisMax]
  );
  const ceiling = useMemo(
    () => (binned ? displayCeiling(binned.counts) : 0),
    [binned]
  );
  const lut = useMemo(
    () => buildLut(windowMin, windowMax, axisMax),
    [windowMin, windowMax, axisMax]
  );

  const [r, g, b] = hexToRgb(color);
  const bars: JSX.Element[] = [];
  let caps = '';
  if (binned && ceiling > 0) {
    const top = lut.length - 1;
    for (let i = 0; i < binned.counts.length; i++) {
      const count = binned.counts[i];
      if (count === 0) continue;
      const height = (PLOT_HEIGHT * Math.min(count, ceiling)) / ceiling;
      const y = PLOT_HEIGHT - height;
      // The first whole sample value that lands in this bin.
      const value = Math.ceil(axisMin + i * binned.binSize);
      const tone = lut[Math.max(0, Math.min(top, value))];
      bars.push(
        <rect
          key={i}
          x={i}
          y={y}
          width={1}
          height={height}
          // The CPU compositor's tint arithmetic, so a bar is the colour its
          // pixels are on the canvas.
          fill={`rgb(${(tone * r) >> 8},${(tone * g) >> 8},${(tone * b) >> 8})`}
          data-bin={i}
        />
      );
      caps += `M${i} ${y}h1v1h-1z`;
    }
  }

  const line = toneLine(axisMin, axisMax, windowMin, windowMax);

  return (
    <svg
      viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="block h-20 w-full border border-gray-400 bg-white dark:border-gray-500"
      shapeRendering="crispEdges"
      data-testid="window-histogram"
    >
      {bars}
      {caps && <path d={caps} fill="black" />}
      <line
        x1={line.x1}
        y1={line.y1}
        x2={line.x2}
        y2={line.y2}
        stroke="black"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        shapeRendering="geometricPrecision"
        data-testid="window-histogram-line"
      />
      <line
        x1={line.x2}
        y1={PLOT_HEIGHT - MAX_TICK}
        x2={line.x2}
        y2={PLOT_HEIGHT}
        stroke="black"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default memo(WindowHistogram);
