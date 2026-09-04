/**
 * Tests for CanvasImage component
 * Covers src/alt rendering, load and error callbacks, dimension styles,
 * and CSS positioning.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CanvasImage from '../CanvasImage';

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

    it('applies crisp-edges image rendering style', () => {
      render(<CanvasImage src="/images/test.png" />);

      const img = screen.getByTestId('canvas-image');
      expect(img).toHaveStyle({ imageRendering: 'crisp-edges' });
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

  async function renderDeep(
    ctx: Partial<Record<string, unknown>> | null,
    props: Record<string, unknown> = {}
  ) {
    vi.doMock('@/lib/png16', () => ({
      decodeGrayPng: vi.fn().mockResolvedValue(deep),
    }));
    const realLut =
      await vi.importActual<typeof import('@/lib/windowLevel')>(
        '@/lib/windowLevel'
      );
    const buildLut = vi.fn(realLut.buildLut);
    vi.doMock('@/lib/windowLevel', () => ({ ...realLut, buildLut }));
    const png16 = await import('@/lib/png16');
    const { ImageDisplayContext } =
      await import('../../../contexts/ImageDisplayContext');
    const Comp = (await import('../CanvasImage')).default;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() })
    );
    const el = <Comp src="/images/deep.png" {...props} />;
    const r = render(
      ctx ? (
        <ImageDisplayContext.Provider value={ctx as never}>
          {el}
        </ImageDisplayContext.Provider>
      ) : (
        el
      )
    );
    // Let the decode promise settle.
    await new Promise(resolve => setTimeout(resolve, 0));
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
});
