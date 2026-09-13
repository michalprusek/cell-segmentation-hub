/**
 * DisplaySection — the histogram and Auto, wired to the display state.
 *
 * `src/lib/__tests__/histogram.test.ts` holds the arithmetic to ImageJ. This
 * file is about the WIRING, which is where such features really break: that
 * the plot is of the channel the sliders edit and on the sliders' own axis,
 * that Auto hands ImageJ's window to `setWindow`, and that Auto's progression
 * restarts exactly when ImageJ's does. Auto's expected windows are ImageJ's
 * own output, read from the oracle fixture.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import DisplaySection from '../DisplaySection';
import {
  DisplayedSamplesContext,
  ImageDisplayContext,
  useImageDisplay,
  type DisplayedSamples,
} from '../../../contexts/ImageDisplayContext';
import {
  PLOT_HEIGHT,
  binHistogram,
  displayCeiling,
  toneLine,
  valueHistogram,
  type SampleBuffer,
} from '@/lib/histogram';
import expectedJson from '@/lib/__tests__/fixtures/imagejHistogram/expected.json';
import {
  CASES,
  generateSamples,
} from '@/lib/__tests__/fixtures/imagejHistogram/cases.mjs';

type Ctx = ReturnType<typeof useImageDisplay>;

const oracle = expectedJson as unknown as {
  cases: Record<
    string,
    {
      auto: { displayMin: number; displayMax: number; autoThreshold: number }[];
    }
  >;
};

const OWNER = Symbol('test canvas');

function caseSamples(name: string): SampleBuffer {
  const testCase = CASES.find(c => c.name === name);
  if (!testCase) throw new Error(`no oracle case ${name}`);
  const { data, min, max } = generateSamples(testCase);
  return { data, bitDepth: testCase.bitDepth, min, max };
}

/** ImageJ's first `n` Auto windows for a case, as `setWindow` arguments. */
function imagejWindows(name: string, n: number): [number, number][] {
  return oracle.cases[name].auto
    .slice(0, n)
    .map(p => [p.displayMin, p.displayMax]);
}

function makeCtx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    windowMin: 0,
    windowMax: 255,
    windowRangeMax: 255,
    windowDataMin: 0,
    windowIsMeasured: true,
    windowChannel: '',
    visibleChannels: [],
    channelColors: {},
    brightness: 100,
    contrast: 100,
    setWindow: vi.fn(),
    setWindowMin: vi.fn(),
    setWindowMax: vi.fn(),
    setActiveWindowChannel: vi.fn(),
    setBrightness: vi.fn(),
    setContrast: vi.fn(),
    resetDisplay: vi.fn(),
    ...overrides,
  } as unknown as Ctx;
}

/** A context whose axis is exactly the samples' own range. */
function ctxFor(samples: SampleBuffer, overrides: Partial<Ctx> = {}): Ctx {
  return makeCtx({
    windowDataMin: samples.min,
    windowRangeMax: samples.max,
    windowMin: samples.min,
    windowMax: samples.max,
    ...overrides,
  });
}

function frame(
  frameKey: string,
  channels: Record<string, SampleBuffer>
): DisplayedSamples {
  return { owner: OWNER, frameKey, channels };
}

function renderPanel(ctx: Ctx, displayed: DisplayedSamples | null) {
  const tree = (c: Ctx, d: DisplayedSamples | null) => (
    <ImageDisplayContext.Provider value={c}>
      <DisplayedSamplesContext.Provider value={d}>
        <DisplaySection />
      </DisplayedSamplesContext.Provider>
    </ImageDisplayContext.Provider>
  );
  const utils = render(tree(ctx, displayed));
  return {
    update: (c: Ctx, d: DisplayedSamples | null) => utils.rerender(tree(c, d)),
  };
}

const plot = () => screen.getByTestId('window-histogram');
const bars = () =>
  Array.from(plot().querySelectorAll<SVGRectElement>('rect[data-bin]'));
const autoButton = () => screen.getByRole('button', { name: 'Auto' });
/** Min and Max come before Brightness and Contrast. */
const windowThumbs = () => screen.getAllByRole('slider').slice(0, 2);

function occupiedBins(samples: SampleBuffer, lo: number, hi: number): number {
  return Array.from(
    binHistogram(valueHistogram(samples), lo, hi).counts
  ).filter(c => c > 0).length;
}

describe('the histogram', () => {
  it('plots the channel the sliders edit, not another visible one', () => {
    const irm = caseSamples('irm16');
    const tirf = caseSamples('fluorescence16');
    const shown = frame('f1', { IRM: irm, TIRF: tirf });
    const both = { visibleChannels: ['IRM', 'TIRF'] };
    // The two must plot differently, or this could not tell them apart.
    expect(occupiedBins(irm, irm.min, irm.max)).not.toBe(
      occupiedBins(tirf, tirf.min, tirf.max)
    );

    const { update } = renderPanel(
      ctxFor(irm, { ...both, windowChannel: 'IRM' }),
      shown
    );
    expect(bars()).toHaveLength(occupiedBins(irm, irm.min, irm.max));

    update(ctxFor(tirf, { ...both, windowChannel: 'TIRF' }), shown);
    expect(bars()).toHaveLength(occupiedBins(tirf, tirf.min, tirf.max));
  });

  it('bins over the same axis the Min and Max tracks span', () => {
    const s = caseSamples('fluorescence16');
    // An axis wider than this frame, as after scrubbing past brighter ones.
    const axis = { windowDataMin: 2000, windowRangeMax: 40000 };
    expect(occupiedBins(s, 2000, 40000)).not.toBe(occupiedBins(s, 0, 40000));

    renderPanel(
      makeCtx({ ...axis, windowMin: 2500, windowMax: 30000 }),
      frame('f1', { '': s })
    );

    expect(bars()).toHaveLength(occupiedBins(s, 2000, 40000));
    for (const thumb of windowThumbs()) {
      expect(thumb).toHaveAttribute('aria-valuemin', '2000');
      expect(thumb).toHaveAttribute('aria-valuemax', '40000');
    }
  });

  it('keeps a Min typed below the data on the end of its track', () => {
    renderPanel(
      makeCtx({
        windowDataMin: 2000,
        windowRangeMax: 40000,
        windowMin: 100,
        windowMax: 30000,
      }),
      null
    );
    const [minThumb] = windowThumbs();
    expect(minThumb).toHaveAttribute('aria-valuenow', '2000');
    // The number field still says what the window really is.
    expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(100);
  });

  it('draws bars below Min black and bars above Max in the channel tint', () => {
    const s = caseSamples('fluorescence16');
    renderPanel(
      ctxFor(s, {
        windowMin: 3000,
        windowMax: 3100,
        channelColors: { '': '#00FF00' },
      }),
      frame('f1', { '': s })
    );
    const { binSize } = binHistogram(valueHistogram(s), s.min, s.max);
    const valueOf = (bar: SVGRectElement) =>
      Math.ceil(s.min + Number(bar.dataset.bin) * binSize);

    const below = bars().filter(b => valueOf(b) <= 3000);
    const above = bars().filter(b => valueOf(b) >= 3100);
    expect(below.length).toBeGreaterThan(0);
    expect(above.length).toBeGreaterThan(0);
    for (const bar of below) expect(bar).toHaveAttribute('fill', 'rgb(0,0,0)');
    // The CPU compositor's tint: (255 * 255) >> 8.
    for (const bar of above)
      expect(bar).toHaveAttribute('fill', 'rgb(0,254,0)');
  });

  it('clips a dominant peak to the plot ceiling instead of flattening the rest', () => {
    const s = caseSamples('peak16');
    const { counts } = binHistogram(valueHistogram(s), s.min, s.max);
    const sorted = Array.from(counts).sort((a, b) => b - a);
    // The fixture must really have a peak worth clipping.
    expect(sorted[0]).toBeGreaterThan(sorted[1] * 2);

    renderPanel(ctxFor(s), frame('f1', { '': s }));

    const heights = bars()
      .map(b => Number(b.getAttribute('height')))
      .sort((a, b) => b - a);
    expect(heights[0]).toBe(PLOT_HEIGHT);
    expect(heights[1]).toBeCloseTo(
      (PLOT_HEIGHT * sorted[1]) / displayCeiling(counts),
      10
    );
  });

  it('draws the window as the line ContrastPlot draws', () => {
    const s = caseSamples('fluorescence16');
    renderPanel(
      ctxFor(s, { windowMin: 3000, windowMax: 9000 }),
      frame('f1', { '': s })
    );
    const want = toneLine(s.min, s.max, 3000, 9000);
    const line = screen.getByTestId('window-histogram-line');
    expect(Number(line.getAttribute('x1'))).toBeCloseTo(want.x1, 10);
    expect(Number(line.getAttribute('x2'))).toBeCloseTo(want.x2, 10);
  });

  it('shows the empty plot and a disabled Auto when this frame lacks the channel', () => {
    renderPanel(
      makeCtx({ windowChannel: 'sparse', visibleChannels: ['sparse', 'irm'] }),
      frame('f1', { irm: caseSamples('irm16') })
    );
    expect(plot()).toBeInTheDocument();
    expect(bars()).toHaveLength(0);
    expect(autoButton()).toBeDisabled();
  });

  it('is absent, with Auto, when no decoded range backs the window', () => {
    renderPanel(
      makeCtx({ windowIsMeasured: false }),
      frame('f1', { '': caseSamples('irm16') })
    );
    expect(screen.queryByTestId('window-histogram')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Auto' })
    ).not.toBeInTheDocument();
  });
});

describe('Auto', () => {
  const NAME = 'fluorescence16';

  it("sets ImageJ's window, saturating more on each press", () => {
    const s = caseSamples(NAME);
    const want = imagejWindows(NAME, 3);
    // Three different windows, or a lost carry would go unnoticed.
    expect(new Set(want.map(w => w.join())).size).toBe(3);
    const setWindow = vi.fn();
    renderPanel(ctxFor(s, { setWindow }), frame('f1', { '': s }));

    for (let k = 0; k < 3; k++) fireEvent.click(autoButton());

    expect(setWindow.mock.calls).toEqual(want);
  });

  it('starts over on a new frame', () => {
    const s = caseSamples(NAME);
    const [first] = imagejWindows(NAME, 1);
    const setWindow = vi.fn();
    const ctx = ctxFor(s, { setWindow });
    const { update } = renderPanel(ctx, frame('f1', { '': s }));

    fireEvent.click(autoButton());
    update(ctx, frame('f2', { '': s }));
    fireEvent.click(autoButton());

    expect(setWindow.mock.calls).toEqual([first, first]);
  });

  it('starts over on another channel', () => {
    const s = caseSamples(NAME);
    const [first] = imagejWindows(NAME, 1);
    const setWindow = vi.fn();
    const shown = frame('f1', { A: s, B: s });
    const both = { setWindow, visibleChannels: ['A', 'B'] };
    const { update } = renderPanel(
      ctxFor(s, { ...both, windowChannel: 'A' }),
      shown
    );

    fireEvent.click(autoButton());
    update(ctxFor(s, { ...both, windowChannel: 'B' }), shown);
    fireEvent.click(autoButton());

    expect(setWindow.mock.calls).toEqual([first, first]);
  });

  it('starts over after Reset', () => {
    const s = caseSamples(NAME);
    const [first] = imagejWindows(NAME, 1);
    const setWindow = vi.fn();
    const resetDisplay = vi.fn();
    renderPanel(ctxFor(s, { setWindow, resetDisplay }), frame('f1', { '': s }));

    fireEvent.click(autoButton());
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    fireEvent.click(autoButton());

    expect(resetDisplay).toHaveBeenCalledTimes(1);
    expect(setWindow.mock.calls).toEqual([first, first]);
  });

  it('keeps carrying on the same frame even when the canvas re-publishes it', () => {
    // A re-render hands a new DisplayedSamples object for the same frame; that
    // is not a new slice and must not restart the progression.
    const s = caseSamples(NAME);
    const want = imagejWindows(NAME, 2);
    const setWindow = vi.fn();
    const ctx = ctxFor(s, { setWindow });
    const { update } = renderPanel(ctx, frame('f1', { '': s }));

    fireEvent.click(autoButton());
    update(ctx, frame('f1', { '': s }));
    fireEvent.click(autoButton());

    expect(setWindow.mock.calls).toEqual(want);
  });

  it("falls back to the frame's data range when nothing qualifies, for 8-bit too", () => {
    // Two values, each far more than a tenth of the frame: ImageJ's Auto finds
    // no edge bin and resets. ImageJ would reset an 8-bit image to 0..255; the
    // track here spans the data, so the data range is what gets applied.
    const data = new Uint8Array(1000).map((_, i) => (i % 2 ? 10 : 200));
    const s: SampleBuffer = { data, bitDepth: 8, min: 10, max: 200 };
    const setWindow = vi.fn();
    renderPanel(ctxFor(s, { setWindow }), frame('f1', { '': s }));

    fireEvent.click(autoButton());

    expect(setWindow).toHaveBeenCalledWith(10, 200);
  });
});
