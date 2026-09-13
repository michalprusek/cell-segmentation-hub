/**
 * ImageDisplayProvider — the samples on screen, and the axis floor.
 *
 * The samples live in a context of their own so that publishing one per
 * decoded frame does not re-render every consumer of the display state; the
 * render-count test below is what holds that claim, since nothing else would
 * notice it breaking until playback got slower.
 */

import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import {
  ImageDisplayProvider,
  useDisplayedSamples,
  useImageDisplay,
  type DisplayedSamples,
} from '../ImageDisplayContext';

beforeEach(() => {
  vi.mocked(localStorage.getItem).mockImplementation(() => null);
});

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ImageDisplayProvider>{children}</ImageDisplayProvider>
);

function useBoth() {
  return { display: useImageDisplay(), samples: useDisplayedSamples() };
}

function published(owner: symbol, frameKey: string): DisplayedSamples {
  return {
    owner,
    frameKey,
    channels: {
      ch: { data: new Uint16Array([1, 2]), bitDepth: 16, min: 1, max: 2 },
    },
  };
}

describe('displayed samples', () => {
  it('reach useDisplayedSamples once a canvas reports them', () => {
    const { result } = renderHook(useBoth, { wrapper });
    expect(result.current.samples).toBeNull();

    const report = published(Symbol('canvas'), 'frame-1');
    act(() => result.current.display.reportDisplayedSamples(report));

    expect(result.current.samples).toBe(report);
  });

  it('can only be withdrawn by the canvas that published them', () => {
    const { result } = renderHook(useBoth, { wrapper });
    const mine = Symbol('mine');
    const report = published(mine, 'frame-1');
    act(() => result.current.display.reportDisplayedSamples(report));

    act(() => result.current.display.clearDisplayedSamples(Symbol('other')));
    expect(result.current.samples).toBe(report);

    act(() => result.current.display.clearDisplayedSamples(mine));
    expect(result.current.samples).toBeNull();
  });

  it('survive the previous canvas unmounting after its replacement reported', () => {
    // The order a remount really produces: the new canvas decodes and reports,
    // THEN the old one's cleanup runs.
    const { result } = renderHook(useBoth, { wrapper });
    const oldCanvas = Symbol('old');
    const newCanvas = Symbol('new');
    act(() =>
      result.current.display.reportDisplayedSamples(published(oldCanvas, 'a'))
    );
    const replacement = published(newCanvas, 'b');
    act(() => result.current.display.reportDisplayedSamples(replacement));

    act(() => result.current.display.clearDisplayedSamples(oldCanvas));

    expect(result.current.samples).toBe(replacement);
  });

  it('do not re-render components that read only the display state', () => {
    let renders = 0;
    let report: ((s: DisplayedSamples) => void) | null = null;
    function DisplayOnly() {
      const display = useImageDisplay();
      renders++;
      report = display.reportDisplayedSamples;
      return null;
    }
    function SamplesReader() {
      const samples = useDisplayedSamples();
      const seen = useRef(0);
      seen.current++;
      return <span data-testid="frame">{samples?.frameKey ?? '-'}</span>;
    }
    const { getByTestId } = render(
      <ImageDisplayProvider>
        <DisplayOnly />
        <SamplesReader />
      </ImageDisplayProvider>
    );
    const before = renders;

    act(() => report!(published(Symbol('c'), 'frame-1')));
    act(() => report!(published(Symbol('c'), 'frame-2')));

    // The reader saw both frames...
    expect(getByTestId('frame').textContent).toBe('frame-2');
    // ...and the display-state consumer was not woken for either.
    expect(renders).toBe(before);
  });
});

describe('windowDataMin', () => {
  it("is the active channel's dimmest sample, not its Min cutoff", () => {
    const { result } = renderHook(useBoth, { wrapper });
    act(() => result.current.display.setVisibleChannels(['irm']));
    act(() =>
      result.current.display.reportChannelRanges(
        { irm: { min: 2941, max: 4145 } },
        'container-1'
      )
    );
    // Move the cutoff off the data floor, so the two can be told apart.
    act(() => result.current.display.setWindowMin(3000));

    expect(result.current.display.windowMin).toBe(3000);
    expect(result.current.display.windowDataMin).toBe(2941);
    expect(result.current.display.windowRangeMax).toBe(4145);
  });

  it('follows the channel the sliders edit', () => {
    const { result } = renderHook(useBoth, { wrapper });
    act(() => result.current.display.setVisibleChannels(['irm', 'tirf']));
    act(() =>
      result.current.display.reportChannelRanges(
        { irm: { min: 2941, max: 4145 }, tirf: { min: 489, max: 53927 } },
        'container-1'
      )
    );

    act(() => result.current.display.setActiveWindowChannel('tirf'));
    expect(result.current.display.windowDataMin).toBe(489);

    act(() => result.current.display.setActiveWindowChannel('irm'));
    expect(result.current.display.windowDataMin).toBe(2941);
  });
});
