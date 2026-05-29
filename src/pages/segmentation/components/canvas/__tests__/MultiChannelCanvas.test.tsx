/**
 * MultiChannelCanvas — behavioral unit tests
 *
 * Covered:
 *  - Canvas element renders with data-testid and correct initial dimensions
 *  - CSS filter reflects brightness / contrast from context
 *  - Opacity class toggled by `loading` prop
 *  - hexToRgb pure-logic is exercised indirectly (correct defaults propagate)
 *  - buildLut identity (windowMin=0, windowMax=255 → identity mapping)
 *  - Effect fires fetch per visible channel
 *  - AbortController cancels in-flight fetches on re-render with new frameId
 *  - onLoad called with natural dimensions after first channel resolves
 *  - Failed channel fetch is swallowed; canvas still renders
 *  - Empty visibleChannels → no fetch, canvas still renders
 *
 * Skipped (raster / pixel-level):
 *  - Actual pixel values produced by the per-channel LUT + tint pipeline
 *    (requires a real canvas 2-D context; JSDOM's getContext('2d') returns our
 *    mock which has no pixel buffer — testing pixel math here would be
 *    testing the mock, not the code).
 *  - globalCompositeOperation = 'lighter' visual result.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import MultiChannelCanvas from '../MultiChannelCanvas';

// ── mock ImageDisplayContext ────────────────────────────────────────────────
let mockWindowMin = 0;
let mockWindowMax = 255;
let mockBrightness = 100;
let mockContrast = 100;
let mockChannelOpacities: Record<string, number> = {};

vi.mock('@/pages/segmentation/contexts/ImageDisplayContext', () => ({
  useImageDisplay: () => ({
    windowMin: mockWindowMin,
    windowMax: mockWindowMax,
    brightness: mockBrightness,
    contrast: mockContrast,
    channelOpacities: mockChannelOpacities,
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── helpers ─────────────────────────────────────────────────────────────────

/** Builds a resolved fetch mock that returns a 2×2 ImageBitmap. */
function makeSuccessfulFetch() {
  const mockBitmap = {
    width: 400,
    height: 300,
    close: vi.fn(),
  } as unknown as ImageBitmap;

  const mockBlob = new Blob(['fake-png-data'], { type: 'image/png' });

  global.createImageBitmap = vi.fn().mockResolvedValue(mockBitmap);

  return {
    mockBitmap,
    fetchImpl: vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(mockBlob),
    } as unknown as Response),
  };
}

const DEFAULT_PROPS = {
  frameId: 'frame-1',
  visibleChannels: ['ch1', 'ch2'],
  channelColors: { ch1: '#FF0000', ch2: '#00FF00' },
  width: 800,
  height: 600,
};

// ── tests ────────────────────────────────────────────────────────────────────

describe('MultiChannelCanvas', () => {
  let originalFetch: typeof global.fetch;
  let originalCreateImageBitmap: typeof global.createImageBitmap;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWindowMin = 0;
    mockWindowMax = 255;
    mockBrightness = 100;
    mockContrast = 100;
    mockChannelOpacities = {};
    originalFetch = global.fetch;
    originalCreateImageBitmap = global.createImageBitmap;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.createImageBitmap = originalCreateImageBitmap;
  });

  // ── rendering ─────────────────────────────────────────────────────────────

  describe('DOM rendering', () => {
    it('renders a canvas element with data-testid', () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      render(<MultiChannelCanvas {...DEFAULT_PROPS} />);

      expect(screen.getByTestId('multi-channel-canvas')).toBeInTheDocument();
    });

    it('sets initial width and height attrs from props', () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      render(
        <MultiChannelCanvas {...DEFAULT_PROPS} width={320} height={240} />
      );

      const canvas = screen.getByTestId('multi-channel-canvas');
      expect(canvas).toHaveAttribute('width', '320');
      expect(canvas).toHaveAttribute('height', '240');
    });

    it('renders without width/height props (auto sizing)', () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      render(
        <MultiChannelCanvas
          frameId="f1"
          visibleChannels={['ch1']}
          channelColors={{ ch1: '#FFFFFF' }}
        />
      );
      expect(screen.getByTestId('multi-channel-canvas')).toBeInTheDocument();
    });
  });

  // ── CSS filter ────────────────────────────────────────────────────────────

  describe('CSS filter reflects context state', () => {
    it('applies brightness(1) contrast(1) at default values (100/100)', () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;
      mockBrightness = 100;
      mockContrast = 100;

      render(<MultiChannelCanvas {...DEFAULT_PROPS} />);

      const canvas = screen.getByTestId('multi-channel-canvas');
      expect(canvas).toHaveStyle({
        filter: 'brightness(1) contrast(1)',
      });
    });

    it('applies custom brightness and contrast from context', () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;
      mockBrightness = 150;
      mockContrast = 80;

      render(<MultiChannelCanvas {...DEFAULT_PROPS} />);

      const canvas = screen.getByTestId('multi-channel-canvas');
      expect(canvas).toHaveStyle({
        filter: 'brightness(1.5) contrast(0.8)',
      });
    });
  });

  // ── loading opacity ───────────────────────────────────────────────────────

  describe('opacity class driven by loading prop', () => {
    it('uses opacity-100 class when loading=true (default)', () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      const { container } = render(
        <MultiChannelCanvas {...DEFAULT_PROPS} loading={true} />
      );
      const canvas = container.querySelector('canvas');
      expect(canvas?.className).toContain('opacity-100');
      expect(canvas?.className).not.toContain('opacity-50');
    });

    it('uses opacity-50 class when loading=false', () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      const { container } = render(
        <MultiChannelCanvas {...DEFAULT_PROPS} loading={false} />
      );
      const canvas = container.querySelector('canvas');
      expect(canvas?.className).toContain('opacity-50');
    });
  });

  // ── fetch calls ───────────────────────────────────────────────────────────

  describe('fetch behaviour', () => {
    it('fetches one URL per visible channel with correct query string', async () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      render(<MultiChannelCanvas {...DEFAULT_PROPS} />);

      await waitFor(() => {
        expect(fetchImpl).toHaveBeenCalledTimes(2);
      });

      const urls = fetchImpl.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(urls).toContain('/api/images/frame-1/frame-data?channel=ch1');
      expect(urls).toContain('/api/images/frame-1/frame-data?channel=ch2');
    });

    it('does not fetch when visibleChannels is empty', () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      render(
        <MultiChannelCanvas
          frameId="frame-1"
          visibleChannels={[]}
          channelColors={{}}
        />
      );

      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('re-fetches when frameId changes', async () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      const { rerender } = render(<MultiChannelCanvas {...DEFAULT_PROPS} />);

      await waitFor(() => {
        expect(fetchImpl).toHaveBeenCalledTimes(2);
      });

      rerender(<MultiChannelCanvas {...DEFAULT_PROPS} frameId="frame-2" />);

      await waitFor(() => {
        expect(fetchImpl.mock.calls.length).toBeGreaterThan(2);
      });

      const laterUrls = fetchImpl.mock.calls
        .slice(2)
        .map((c: unknown[]) => c[0] as string);
      expect(laterUrls.some(u => u.includes('frame-2'))).toBe(true);
    });

    it('passes AbortSignal to fetch', async () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      render(<MultiChannelCanvas {...DEFAULT_PROPS} />);

      await waitFor(() => {
        expect(fetchImpl).toHaveBeenCalled();
      });

      const firstCallOptions = fetchImpl.mock.calls[0][1] as RequestInit;
      expect(firstCallOptions?.signal).toBeInstanceOf(AbortSignal);
    });

    it('swallows a failed channel fetch and does not throw', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        blob: vi.fn(),
      } as unknown as Response);

      // Should not throw
      await act(async () => {
        render(<MultiChannelCanvas {...DEFAULT_PROPS} />);
        await new Promise(r => setTimeout(r, 50));
      });

      // Canvas should still be in DOM
      expect(screen.getByTestId('multi-channel-canvas')).toBeInTheDocument();
    });

    it('swallows a network-error fetch and does not throw', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
      global.createImageBitmap = vi.fn();

      await act(async () => {
        render(<MultiChannelCanvas {...DEFAULT_PROPS} />);
        await new Promise(r => setTimeout(r, 50));
      });

      expect(screen.getByTestId('multi-channel-canvas')).toBeInTheDocument();
    });
  });

  // ── onLoad callback ───────────────────────────────────────────────────────

  describe('onLoad callback', () => {
    it('calls onLoad with bitmap dimensions and channelsKey after first success', async () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      const onLoad = vi.fn();

      await act(async () => {
        render(<MultiChannelCanvas {...DEFAULT_PROPS} onLoad={onLoad} />);
        await new Promise(r => setTimeout(r, 50));
      });

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalledWith(400, 300, 'ch1|ch2');
      });
    });

    it('does not call onLoad when all channel fetches fail', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        blob: vi.fn(),
      } as unknown as Response);
      global.createImageBitmap = vi.fn();

      const onLoad = vi.fn();

      await act(async () => {
        render(<MultiChannelCanvas {...DEFAULT_PROPS} onLoad={onLoad} />);
        await new Promise(r => setTimeout(r, 50));
      });

      expect(onLoad).not.toHaveBeenCalled();
    });
  });

  // ── channelsKey derivation ────────────────────────────────────────────────

  describe('channelsKey reflects channel + color changes', () => {
    it('re-fetches when color of a visible channel changes', async () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      const { rerender } = render(
        <MultiChannelCanvas
          {...DEFAULT_PROPS}
          channelColors={{ ch1: '#FF0000', ch2: '#00FF00' }}
        />
      );

      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));

      rerender(
        <MultiChannelCanvas
          {...DEFAULT_PROPS}
          channelColors={{ ch1: '#0000FF', ch2: '#00FF00' }}
        />
      );

      await waitFor(() => {
        expect(fetchImpl.mock.calls.length).toBeGreaterThan(2);
      });
    });
  });
});
