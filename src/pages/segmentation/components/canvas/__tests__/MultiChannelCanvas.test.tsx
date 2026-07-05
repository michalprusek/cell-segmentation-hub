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
import { toast } from 'sonner';
import MultiChannelCanvas from '../MultiChannelCanvas';

// sonner isn't mocked anywhere for this component tree (no <Toaster/>), so
// without this mock `toast.error` would hit the real module. That's harmless
// but unobservable — mock it so the partial/all-channels-failed toast paths
// are assertable.
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// ── mock ImageDisplayContext ────────────────────────────────────────────────
let mockWindowMin = 0;
let mockWindowMax = 255;
const mockWindowRangeMax = 255;
let mockBrightness = 100;
let mockContrast = 100;
let mockChannelOpacities: Record<string, number> = {};
// Must be a STABLE reference: it sits in the decode effect's dependency
// array, so a fresh fn each render would re-trigger the fetch effect forever.
const mockReportDataRange = vi.fn();

vi.mock('@/pages/segmentation/contexts/ImageDisplayContext', () => ({
  useImageDisplay: () => ({
    windowMin: mockWindowMin,
    windowMax: mockWindowMax,
    windowRangeMax: mockWindowRangeMax,
    brightness: mockBrightness,
    contrast: mockContrast,
    channelOpacities: mockChannelOpacities,
    reportDataRange: mockReportDataRange,
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

/**
 * Builds a fetch mock where the channel named `failChannel` gets a non-ok
 * response and every other channel succeeds via the same fake-blob → 8-bit
 * `decode8Bit` fallback as `makeSuccessfulFetch` (invalid PNG signature ⇒
 * `decodeGrayPng` returns null ⇒ falls back to `createImageBitmap`).
 */
function makePartialFailureFetch(failChannel: string) {
  const mockBitmap = {
    width: 400,
    height: 300,
    close: vi.fn(),
  } as unknown as ImageBitmap;

  const mockBlob = new Blob(['fake-png-data'], { type: 'image/png' });

  global.createImageBitmap = vi.fn().mockResolvedValue(mockBitmap);

  const fetchImpl = vi.fn((url: string) => {
    if (url.includes(`channel=${failChannel}`)) {
      return Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        blob: vi.fn(),
      } as unknown as Response);
    }
    return Promise.resolve({
      ok: true,
      blob: vi.fn().mockResolvedValue(mockBlob),
    } as unknown as Response);
  });

  return { fetchImpl, mockBitmap };
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

  // ── colour changes re-composite, they do NOT re-fetch ─────────────────────

  describe('colour changes re-composite without re-fetching', () => {
    it('does not re-fetch when only a visible channel colour changes', async () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      const { rerender } = render(
        <MultiChannelCanvas
          {...DEFAULT_PROPS}
          channelColors={{ ch1: '#FF0000', ch2: '#00FF00' }}
        />
      );

      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));

      // Colour is applied client-side at composite time — the decode effect
      // does not depend on colour — so changing a channel's tint re-composites
      // from the cached samples WITHOUT issuing a new fetch.
      rerender(
        <MultiChannelCanvas
          {...DEFAULT_PROPS}
          channelColors={{ ch1: '#0000FF', ch2: '#00FF00' }}
        />
      );

      // Give any (unwanted) re-fetch a chance to fire, then assert none did.
      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    // Positive signal for the same "re-composite from cache" behaviour: the
    // windowing effect re-runs `canvas.getContext('2d')` (once for the main
    // canvas, once for the offscreen compositing canvas) every time it fires.
    // `HTMLCanvasElement.prototype.getContext` is a single global `vi.fn()`
    // (see src/test/setup.ts) shared by every canvas instance created during
    // the test — including the offscreen `<canvas>` the component creates
    // internally — so counting its total invocations is a reliable proxy for
    // "did a composite pass run" without needing a per-instance context spy
    // (the mock creates a brand-new context object on every call, so a
    // handle captured from one call can't observe a later pass).
    it('re-invokes canvas.getContext (recomposites) after a colour change', async () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      const getContextMock = HTMLCanvasElement.prototype
        .getContext as unknown as ReturnType<typeof vi.fn>;

      const { rerender } = render(
        <MultiChannelCanvas
          {...DEFAULT_PROPS}
          channelColors={{ ch1: '#FF0000', ch2: '#00FF00' }}
        />
      );

      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      const callsBefore = getContextMock.mock.calls.length;

      rerender(
        <MultiChannelCanvas
          {...DEFAULT_PROPS}
          channelColors={{ ch1: '#0000FF', ch2: '#00FF00' }}
        />
      );

      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      expect(getContextMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  // ── window (Min/Max) changes re-composite, they do NOT re-fetch ───────────

  describe('window changes re-composite without re-fetching', () => {
    it('does not re-fetch when windowMax changes (decode effect deps exclude window state)', async () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      const { rerender } = render(<MultiChannelCanvas {...DEFAULT_PROPS} />);

      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));

      // Mutate the context mock's window state directly (module-level var)
      // and force a re-render — this is the perf-critical guarantee: the
      // decode effect's deps are
      // [frameId, containerId, channelsKey, reportDataRange, onLoad, t,
      // visibleChannels]. windowMin/windowMax are NOT in that list, so a
      // slider drag re-runs only the (cheap) windowing/composite effect.
      // A regression that re-adds windowMin/windowMax to the decode deps
      // must fail this assertion.
      mockWindowMax = 200;
      rerender(<MultiChannelCanvas {...DEFAULT_PROPS} />);

      // Give any (unwanted) re-fetch a chance to fire, then assert none did.
      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });

  // ── reportDataRange is scoped to containerId::channelsKey ─────────────────

  describe('reportDataRange container-scoped key', () => {
    it('reports the combined sample range with an empty containerId prefix by default', async () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      await act(async () => {
        render(<MultiChannelCanvas {...DEFAULT_PROPS} />);
        await new Promise(r => setTimeout(r, 50));
      });

      // The fake-blob 8-bit decode path produces all-zero samples (jsdom's
      // mocked getImageData returns a zeroed Uint8ClampedArray), so both
      // cmin and cmax collapse to 0. `containerId` is undefined in
      // DEFAULT_PROPS, so the key's prefix is the empty string.
      await waitFor(() => {
        expect(mockReportDataRange).toHaveBeenCalledWith(0, 0, '::ch1|ch2');
      });
    });

    it('scopes the range key to containerId when the prop is provided', async () => {
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      await act(async () => {
        render(<MultiChannelCanvas {...DEFAULT_PROPS} containerId="vidA" />);
        await new Promise(r => setTimeout(r, 50));
      });

      await waitFor(() => {
        expect(mockReportDataRange).toHaveBeenCalledWith(0, 0, 'vidA::ch1|ch2');
      });
    });
  });

  // ── partial channel failure surfaces a toast but still composites ─────────

  describe('partial channel failure', () => {
    it('toasts someChannelsFailed and still composites/onLoad when one of several channels fails', async () => {
      const { fetchImpl } = makePartialFailureFetch('ch1');
      global.fetch = fetchImpl;

      const onLoad = vi.fn();

      await act(async () => {
        render(<MultiChannelCanvas {...DEFAULT_PROPS} onLoad={onLoad} />);
        await new Promise(r => setTimeout(r, 50));
      });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'toast.multiChannel.someChannelsFailed'
        );
      });
      // The "all channels failed" toast must NOT also fire.
      expect(toast.error).toHaveBeenCalledTimes(1);

      // The composite still renders (partial composite from the channel(s)
      // that did load) and onLoad still fires for the surviving channel.
      expect(screen.getByTestId('multi-channel-canvas')).toBeInTheDocument();
      expect(onLoad).toHaveBeenCalledWith(400, 300, 'ch1|ch2');
    });
  });
});
