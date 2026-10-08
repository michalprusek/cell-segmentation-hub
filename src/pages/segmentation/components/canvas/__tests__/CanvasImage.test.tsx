/**
 * Tests for CanvasImage component
 * Covers src/alt rendering, load and error callbacks, dimension styles,
 * CSS positioning, and the display style (Smooth image + brightness/contrast
 * filter) on both of its bitmap paths.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import CanvasImage from '../CanvasImage';
import { ImageDisplayContext } from '../../../contexts/ImageDisplayContext';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CanvasImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------

  describe('Rendering', () => {
    it('renders an img element with the provided src', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image') as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.tagName).toBe('IMG');
      expect(img).toHaveAttribute('src', '/images/test.png');
    });

    it('uses the default alt text when alt is not provided', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image');
      expect(img).toHaveAttribute('alt', 'Image to segment');
    });

    it('uses a custom alt text when alt is provided', () => {
      render(<CanvasImage src="/images/test.png" alt="My cell image" />);

      const img = screen.getByTestId('canvas-image');
      expect(img).toHaveAttribute('alt', 'My cell image');
    });

    it('is not draggable', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image');
      expect(img).toHaveAttribute('draggable', 'false');
    });
  });

  // -------------------------------------------------------------------------
  // Callbacks
  // -------------------------------------------------------------------------

  describe('onLoad callback', () => {
    it('calls onLoad with naturalWidth and naturalHeight when the image loads', () => {
      const onLoad = vi.fn();
      render(<CanvasImage src="/images/test.png" onLoad={onLoad} />);

      const img = screen.getByTestId('canvas-image') as HTMLImageElement;

      // Simulate image loaded — jsdom does not populate naturalWidth/Height
      // automatically, so we define them via Object.defineProperty.
      Object.defineProperty(img, 'naturalWidth', {
        value: 800,
        configurable: true,
      });
      Object.defineProperty(img, 'naturalHeight', {
        value: 600,
        configurable: true,
      });

      fireEvent.load(img);

      expect(onLoad).toHaveBeenCalledTimes(1);
      expect(onLoad).toHaveBeenCalledWith(800, 600);
    });

    it('does not throw when onLoad is not provided', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image');
      expect(() => fireEvent.load(img)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Dimension styles
  // -------------------------------------------------------------------------

  describe('Dimension styles', () => {
    it('applies pixel width and height from props', () => {
      render(<CanvasImage src="/images/test.png" width={400} height={300} />);

      const img = screen.getByTestId('canvas-image') as HTMLImageElement;
      expect(img).toHaveStyle({ width: '400px', height: '300px' });
    });

    it('uses "auto" for width and height when props are omitted', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image');
      expect(img).toHaveStyle({ width: 'auto', height: 'auto' });
    });

    it('forwards width and height HTML attributes', () => {
      render(<CanvasImage src="/images/test.png" width={200} height={150} />);

      const img = screen.getByTestId('canvas-image') as HTMLImageElement;
      // The component passes width/height directly to the img element
      expect(img.width).toBe(200);
      expect(img.height).toBe(150);
    });
  });

  // -------------------------------------------------------------------------
  // CSS class / opacity
  // -------------------------------------------------------------------------

  describe('Opacity behaviour', () => {
    it('renders at full opacity when loading=true (default)', () => {
      render(<CanvasImage src="/images/test.png" loading={true} />);

      const img = screen.getByTestId('canvas-image');
      // The class applied is opacity-100 when loading is true
      expect(img.className).toContain('opacity-100');
    });

    it('renders at reduced opacity when loading=false', () => {
      render(<CanvasImage src="/images/test.png" loading={false} />);

      const img = screen.getByTestId('canvas-image');
      expect(img.className).toContain('opacity-50');
    });
  });

  // -------------------------------------------------------------------------
  // Positioning
  // -------------------------------------------------------------------------

  describe('CSS positioning', () => {
    it('is positioned absolutely at top-left (0, 0)', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image');
      expect(img.className).toMatch(/absolute/);
      expect(img.className).toMatch(/top-0/);
      expect(img.className).toMatch(/left-0/);
    });

    it('has pointer-events-none so it does not interfere with canvas interactions', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image');
      expect(img.className).toMatch(/pointer-events-none/);
    });
  });

  // -------------------------------------------------------------------------
  // Display style: Smooth image + brightness/contrast filter (<img> path)
  // -------------------------------------------------------------------------

  describe('Display style on the <img> path', () => {
    const withDisplay = (
      value: Record<string, unknown>,
      props: Record<string, unknown> = {}
    ) => (
      <ImageDisplayContext.Provider value={value as never}>
        <CanvasImage src="/images/test.png" {...props} />
      </ImageDisplayContext.Provider>
    );
    const style = () => screen.getByTestId('canvas-image').style;

    it('is smooth by default, with no provider at all', () => {
      render(<CanvasImage src="/images/test.png" />);
      expect(style().imageRendering).toBe('auto');
    });

    it('is smooth for a context value that predates the setting', () => {
      render(withDisplay({ brightness: 100, contrast: 100 }));
      expect(style().imageRendering).toBe('auto');
    });

    it('draws hard pixels when Smooth image is off — pixelated, never crisp-edges', () => {
      // `crisp-edges` is invalid before Chrome 148 and silently computes to
      // `auto`, i.e. the "sharp" mode was smooth there.
      render(withDisplay({ smoothImage: false }));
      expect(style().imageRendering).toBe('pixelated');
    });

    it('toggles as a style on the SAME element, without refiring onLoad', () => {
      const onLoad = vi.fn();
      const { rerender } = render(
        withDisplay({ smoothImage: true }, { onLoad })
      );
      const before = screen.getByTestId('canvas-image');
      fireEvent.load(before);
      expect(onLoad).toHaveBeenCalledTimes(1);

      rerender(withDisplay({ smoothImage: false }, { onLoad }));
      const after = screen.getByTestId('canvas-image');
      // A remount would be a new node, a new image request and a second
      // onLoad — which resets the editor's "frame loaded" state.
      expect(after).toBe(before);
      expect(after.style.imageRendering).toBe('pixelated');
      expect(onLoad).toHaveBeenCalledTimes(1);
    });

    it('emits no filter at brightness 100 / contrast 100', () => {
      // An identity `brightness(1) contrast(1)` still promotes the element to
      // its own compositor surface: measured, one blended pixel per image
      // pixel boundary and half the pan frame rate on a software GPU.
      render(withDisplay({ brightness: 100, contrast: 100 }));
      expect(style().filter).toBe('');
    });

    it('emits no filter with no provider', () => {
      render(<CanvasImage src="/images/test.png" />);
      expect(style().filter).toBe('');
    });

    it('emits the filter as soon as either value moves', () => {
      const { rerender } = render(
        withDisplay({ brightness: 150, contrast: 100 })
      );
      expect(style().filter).toBe('brightness(1.5) contrast(1)');
      rerender(withDisplay({ brightness: 100, contrast: 80 }));
      expect(style().filter).toBe('brightness(1) contrast(0.8)');
      rerender(withDisplay({ brightness: 100, contrast: 100 }));
      expect(style().filter).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// The 16-bit window
//
// A 16-bit image is decoded here and painted through a window/level LUT, and
// the sliders that drive that window live in the sidebar. These cover the two
// halves of that wiring: which window the canvas paints through, and which key
// the reported range is filed under.
// ---------------------------------------------------------------------------

describe('CanvasImage 16-bit window', () => {
  const deep = {
    width: 2,
    height: 1,
    bitDepth: 16,
    min: 1000,
    max: 5000,
    data: new Uint16Array([1000, 5000]),
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  /** The component and its context module, loaded fresh against a decoder that
   *  yields `decoded` and a spy on the LUT every paint goes through. */
  async function loadDeep(decoded: unknown = deep) {
    vi.doMock('@/lib/png16', () => ({
      decodeGrayPng: vi.fn().mockResolvedValue(decoded),
    }));
    const realLut =
      await vi.importActual<typeof import('@/lib/windowLevel')>(
        '@/lib/windowLevel'
      );
    const buildLut = vi.fn(realLut.buildLut);
    vi.doMock('@/lib/windowLevel', () => ({ ...realLut, buildLut }));
    const png16 = await import('@/lib/png16');
    const display = await import('../../../contexts/ImageDisplayContext');
    const Comp = (await import('../CanvasImage')).default;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() })
    );
    return { png16, buildLut, display, Comp };
  }

  /** Lets the decode promise settle. */
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  async function renderDeep(
    ctx: Partial<Record<string, unknown>> | null,
    props: Record<string, unknown> = {},
    decoded: unknown = deep
  ) {
    const { png16, buildLut, display, Comp } = await loadDeep(decoded);
    const el = <Comp src="/images/deep.png" {...props} />;
    const r = render(
      ctx ? (
        <display.ImageDisplayContext.Provider value={ctx as never}>
          {el}
        </display.ImageDisplayContext.Provider>
      ) : (
        el
      )
    );
    await settle();
    return { ...r, png16, buildLut };
  }

  it('files the decoded range under the fallback channel, keyed by windowKey', async () => {
    const reportChannelRanges = vi.fn();
    await renderDeep(
      { reportChannelRanges, windowChannel: '' },
      { windowKey: 'container-42' }
    );

    expect(reportChannelRanges).toHaveBeenCalledWith(
      { '': { min: 1000, max: 5000 } },
      // The CONTAINER, never the frame URL: this component is also the
      // single-channel video canvas, and keying on `src` would drop the
      // user's window on every scrub.
      'container-42'
    );
  });

  // The 16-bit <canvas> is the second bitmap path of this component and takes
  // the same two display properties as the <img>.
  it('applies Smooth image and the filter to the 16-bit canvas, as style only', async () => {
    const { display, Comp } = await loadDeep();
    const ui = (value: Record<string, unknown>) => (
      <display.ImageDisplayContext.Provider value={value as never}>
        <Comp src="/images/deep.png" />
      </display.ImageDisplayContext.Provider>
    );
    const base = { reportChannelRanges: vi.fn(), windowChannel: '' };
    const { container, rerender } = render(ui({ ...base, smoothImage: true }));
    await settle();

    const canvas = container.querySelector('canvas')!;
    expect(canvas).toBeTruthy();
    expect(canvas.getAttribute('data-bit-depth')).toBe('16');
    expect(canvas.style.imageRendering).toBe('auto');
    expect(canvas.style.filter).toBe('');

    rerender(
      ui({ ...base, smoothImage: false, brightness: 120, contrast: 100 })
    );
    await settle();
    // Same node: a remount would repaint the frame from scratch.
    expect(container.querySelector('canvas')).toBe(canvas);
    expect(canvas.style.imageRendering).toBe('pixelated');
    expect(canvas.style.filter).toBe('brightness(1.2) contrast(1)');
  });

  // VideoFrameImage hands CanvasImage a fresh `onLoad` arrow on every render,
  // and the editor re-renders on every pan and zoom step. With `onLoad` in the
  // probe effect's deps each of those re-fetched and re-decoded the image and
  // put the bare <img> on screen while it did — measured on production: 18
  // wheel steps, 18 canvas -> <img> -> canvas swaps.
  it('does not re-fetch or drop the canvas when only the onLoad identity changes', async () => {
    const { Comp } = await loadDeep();
    const first = vi.fn();
    const { container, rerender } = render(
      <Comp src="/images/deep.png" onLoad={first} />
    );
    await settle();
    const canvas = container.querySelector('canvas')!;
    expect(canvas).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) {
      rerender(<Comp src="/images/deep.png" onLoad={vi.fn()} />);
      await settle();
    }

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.querySelector('canvas')).toBe(canvas);
    expect(container.querySelector('img')).toBeNull();
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('reports a NEW image to the newest onLoad', async () => {
    // The other half of holding the callback in a ref: it must not go stale.
    const { Comp } = await loadDeep();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Comp src="/images/a.png" onLoad={first} />);
    await settle();
    rerender(<Comp src="/images/b.png" onLoad={second} />);
    await settle();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(2, 1);
  });

  it('does not touch the window when the provider is absent', async () => {
    // Rendered bare (as the tests above do) it must still paint, not crash.
    const { container } = await renderDeep(null);
    expect(container.querySelector('canvas, img')).toBeTruthy();
  });

  it('paints through the window the sliders set, not the data range', async () => {
    // The reserve 16 bits buy is worth nothing without a control that spends
    // it; this is the half that spends it.
    const { buildLut } = await renderDeep({
      reportChannelRanges: vi.fn(),
      windowChannel: '',
      windowMin: 2000,
      windowMax: 3000,
    });

    expect(buildLut).toHaveBeenCalledWith(2000, 3000, deep.max);
  });

  it('auto-fits to the data when no window has been set', async () => {
    // ImageJ's behaviour on opening a 16-bit image, and what makes a dim one
    // visible before anybody touches anything.
    const { buildLut } = await renderDeep({
      reportChannelRanges: vi.fn(),
      windowChannel: '',
      windowMin: undefined,
      windowMax: undefined,
    });

    expect(buildLut).toHaveBeenCalledWith(deep.min, deep.max, deep.max);
  });

  it('ignores a window that belongs to another channel', async () => {
    // In a multi-channel video the sliders may be editing a named channel;
    // that window is not this canvas's to paint through.
    const { buildLut } = await renderDeep({
      reportChannelRanges: vi.fn(),
      windowChannel: 'DAPI',
      windowMin: 2000,
      windowMax: 3000,
    });

    expect(buildLut).toHaveBeenCalledWith(deep.min, deep.max, deep.max);
  });

  // ── samples for the Display panel's histogram ──────────────────────────────

  function samplesCtx() {
    return {
      reportChannelRanges: vi.fn(),
      reportDisplayedSamples: vi.fn(),
      clearDisplayedSamples: vi.fn(),
      windowChannel: '',
    };
  }

  it('hands its samples to the histogram keyed by the frame, not by windowKey', async () => {
    // For a single-channel video `windowKey` is the container, the same on
    // every frame; Auto's progression must restart per frame, so the samples
    // are filed under `src`.
    const ctx = samplesCtx();
    await renderDeep(ctx, { windowKey: 'container-42' });

    expect(ctx.reportDisplayedSamples).toHaveBeenCalledTimes(1);
    const [published] = ctx.reportDisplayedSamples.mock.calls[0];
    expect(published.frameKey).toBe('/images/deep.png');
    expect(published.channels).toEqual({ '': deep });
    expect(typeof published.owner).toBe('symbol');
  });

  it('withdraws its samples when the image turns out not to be 16-bit', async () => {
    // The picture is then an <img> nothing decoded; a histogram of the image
    // before it would describe something no longer on screen.
    const ctx = samplesCtx();
    await renderDeep(ctx, {}, { ...deep, bitDepth: 8 });

    expect(ctx.reportDisplayedSamples).not.toHaveBeenCalled();
    expect(ctx.clearDisplayedSamples).toHaveBeenCalledTimes(1);
    expect(typeof ctx.clearDisplayedSamples.mock.calls[0][0]).toBe('symbol');
  });

  it('withdraws on unmount under the owner it published with', async () => {
    const ctx = samplesCtx();
    const { unmount } = await renderDeep(ctx);
    const { owner } = ctx.reportDisplayedSamples.mock.calls[0][0];
    expect(ctx.clearDisplayedSamples).not.toHaveBeenCalled();

    unmount();

    expect(ctx.clearDisplayedSamples).toHaveBeenCalledWith(owner);
  });

  it('paints a video with every channel hidden through a window fitted to its data', async () => {
    // Hiding the last channel makes this component the video's canvas, and it
    // reports under the container key the channels already used. The real
    // provider rather than a stub: the defect lived where the two meet — that
    // key is not new, so the fallback window's 8-bit placeholder was widened
    // instead of fitted and the 16-bit frame painted through 0..255, all white.
    vi.mocked(localStorage.getItem).mockImplementation(() => null);
    const { buildLut, display, Comp } = await loadDeep();
    const probe: { api?: ReturnType<typeof display.useImageDisplay> } = {};
    const Probe = () => {
      probe.api = display.useImageDisplay();
      return null;
    };
    const tree = (withCanvas: boolean) => (
      <display.ImageDisplayProvider>
        <Probe />
        {withCanvas && <Comp src="/images/deep.png" windowKey="container-42" />}
      </display.ImageDisplayProvider>
    );
    const { rerender } = render(tree(false));
    // What the multi-channel canvas leaves behind for this video...
    act(() => {
      probe.api!.setVisibleChannels(['irm']);
      probe.api!.reportChannelRanges(
        { irm: { min: 2941, max: 4145 } },
        'container-42'
      );
    });
    // ...then the user hides the last channel.
    act(() => probe.api!.setVisibleChannels([]));
    rerender(tree(true));
    await act(settle);

    expect(probe.api!.windowChannel).toBe('');
    expect(buildLut).toHaveBeenCalled();
    // Every paint, not only the last: a white first frame is the bug too.
    for (const args of buildLut.mock.calls) {
      expect(args).toEqual([deep.min, deep.max, deep.max]);
    }
  });
});
