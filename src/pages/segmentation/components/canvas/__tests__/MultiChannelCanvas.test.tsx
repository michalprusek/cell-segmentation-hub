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
 *  - Render-path selection: the WebGL2 compositor when `createCompositor`
 *    yields one, the CPU per-pixel path when it returns null, and the flip
 *    back to the CPU path on context loss / `isAlive() === false`
 *
 * `@/lib/webglCompositor` is mocked for every test here and DEFAULTS to
 * `() => null` (no WebGL2), so the CPU path — which is also what really
 * happens in jsdom, where `getContext('webgl2')` returns null — stays the
 * path the pre-existing tests exercise. Tests that want the GPU path opt in
 * with `makeFakeCompositor()`. `beforeEach` restores the null default because
 * `vi.clearAllMocks()` clears call records but NOT implementations.
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
import {
  createCompositor,
  type Compositor,
  type CompositorChannel,
  type CompositorWindow,
} from '@/lib/webglCompositor';
import { createMockCanvasContext } from '@/test-utils/canvasTestUtils';
import MultiChannelCanvas from '../MultiChannelCanvas';
import {
  MAX_SPECULATIVE_REQUESTS,
  speculativeFrameRequests,
} from '@/lib/requestThrottle';

// The compositor is the unit under test's collaborator, not its subject: stub
// it so the render-path decision is observable without a GPU. Default is null
// (= "no WebGL2"), which is also what the real factory does under jsdom.
vi.mock('@/lib/webglCompositor', () => ({
  createCompositor: vi.fn(() => null),
}));

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

/**
 * Makes `createCompositor` hand back a live fake compositor, and returns it.
 * `overrides` lets a test weaken one method (e.g. a dead `isAlive`).
 */
function makeFakeCompositor(overrides: Partial<Compositor> = {}) {
  const fake: Compositor = {
    setSize: vi.fn(),
    draw: vi.fn(),
    dispose: vi.fn(),
    isAlive: vi.fn(() => true),
    ...overrides,
  };
  vi.mocked(createCompositor).mockImplementation(() => fake);
  return fake as {
    [K in keyof Compositor]: ReturnType<typeof vi.fn>;
  };
}

/** The `onContextLost` callback the component handed to `createCompositor`. */
function capturedOnContextLost(): () => void {
  const cb = vi.mocked(createCompositor).mock.calls[0]?.[1];
  if (!cb) throw new Error('createCompositor was not given an onContextLost');
  return cb;
}

/**
 * Replaces the per-canvas `getContext` mock with one that hands the SAME 2D
 * context object to every canvas. The component's CPU composite writes through
 * an internal offscreen canvas we hold no handle on, so a shared context is the
 * only way one spy can see `putImageData` — the per-pixel path's signature
 * call, which no other code path in this component makes (`decode8Bit` only
 * reads, via `getImageData`).
 */
function installSharedCanvasContext() {
  const ctx = createMockCanvasContext();
  HTMLCanvasElement.prototype.getContext = vi.fn((type: string) =>
    type === '2d' ? ctx : null
  ) as unknown as HTMLCanvasElement['getContext'];
  return ctx;
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
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWindowMin = 0;
    mockWindowMax = 255;
    mockBrightness = 100;
    mockContrast = 100;
    mockChannelOpacities = {};
    originalFetch = global.fetch;
    originalCreateImageBitmap = global.createImageBitmap;
    // clearAllMocks wipes calls, not implementations — without this a fake
    // compositor installed by one test would silently keep every LATER test on
    // the GPU path.
    vi.mocked(createCompositor).mockImplementation(() => null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.createImageBitmap = originalCreateImageBitmap;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
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
    it('issues the DISPLAYED frame immediately, never behind speculative warms', async () => {
      // The window prefetcher fills every slot of the shared throttle during
      // playback. The frame the user is actually looking at is exempt from the
      // queue — a priority slot in a queue is still a queue, and waiting for
      // one of four multi-megabyte warms to finish is latency the user sees.
      const release: Array<() => void> = [];
      for (let i = 0; i < MAX_SPECULATIVE_REQUESTS; i++) {
        void speculativeFrameRequests
          .schedule(() => new Promise<void>(r => release.push(r)))
          .catch(() => undefined);
      }
      expect(speculativeFrameRequests.inFlight).toBe(MAX_SPECULATIVE_REQUESTS);

      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      render(<MultiChannelCanvas {...DEFAULT_PROPS} frameId="exempt-1" />);

      // Synchronously, in the same tick as the effect — not one microtask of
      // waiting for a slot.
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      release.forEach(r => r());
      await waitFor(() => expect(speculativeFrameRequests.inFlight).toBe(0));
    });

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

  // ── WebGL2 compositor vs. the CPU fallback ────────────────────────────────
  //
  // A canvas yields ONE context type for its lifetime, so the component has to
  // commit to WebGL2 at mount and, when that fails or the context is lost,
  // remount a fresh element (React `key`) for the CPU path. These tests pin
  // both directions of that decision. `putImageData` is the marker for "the
  // per-pixel CPU loop ran": nothing else in the component calls it.

  describe('render path selection', () => {
    it('renders through the CPU path when createCompositor returns null (no WebGL2)', async () => {
      const ctx = installSharedCanvasContext();
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      const onLoad = vi.fn();

      await act(async () => {
        render(<MultiChannelCanvas {...DEFAULT_PROPS} onLoad={onLoad} />);
        await new Promise(r => setTimeout(r, 50));
      });

      expect(createCompositor).toHaveBeenCalled();
      // One composite pass, one putImageData per channel.
      expect(ctx.putImageData).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('multi-channel-canvas')).toBeInTheDocument();
      expect(onLoad).toHaveBeenCalledWith(400, 300, 'ch1|ch2');
    });

    it('renders and reports onLoad with the REAL compositor factory under jsdom', async () => {
      // Integration check against the actual module: jsdom has no WebGL, so
      // `getContext('webgl2')` returns null there. Deliberately asserts only
      // the user-visible outcome — whether the factory returns null or throws
      // is the compositor's business; either way the component must paint.
      const actual = await vi.importActual<
        typeof import('@/lib/webglCompositor')
      >('@/lib/webglCompositor');
      vi.mocked(createCompositor).mockImplementation(actual.createCompositor);

      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      const onLoad = vi.fn();

      await act(async () => {
        render(<MultiChannelCanvas {...DEFAULT_PROPS} onLoad={onLoad} />);
        await new Promise(r => setTimeout(r, 50));
      });

      expect(screen.getByTestId('multi-channel-canvas')).toBeInTheDocument();
      expect(onLoad).toHaveBeenCalledWith(400, 300, 'ch1|ch2');
    });

    it('draws via the compositor with mapped channels + window, skipping the CPU loop', async () => {
      const ctx = installSharedCanvasContext();
      const fake = makeFakeCompositor();
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;
      mockChannelOpacities = { ch2: 40 };

      const onLoad = vi.fn();

      await act(async () => {
        render(<MultiChannelCanvas {...DEFAULT_PROPS} onLoad={onLoad} />);
        await new Promise(r => setTimeout(r, 50));
      });

      expect(fake.setSize).toHaveBeenCalledWith(400, 300);
      expect(fake.draw).toHaveBeenCalledTimes(1);

      const [channels, win] = fake.draw.mock.calls[0] as [
        CompositorChannel[],
        CompositorWindow,
      ];
      // Window is passed in RAW SAMPLE UNITS, exactly as buildLut took it.
      expect(win).toEqual({ min: 0, max: 255, rangeMax: 255 });
      expect(channels.map(c => c.channel).sort()).toEqual(['ch1', 'ch2']);

      const ch1 = channels.find(c => c.channel === 'ch1');
      expect(ch1?.color).toEqual([255, 0, 0]); // '#FF0000' via hexToRgb
      expect(ch1?.opacity).toBe(1); // absent from channelOpacities ⇒ 100 %
      expect(ch1?.width).toBe(400);
      expect(ch1?.height).toBe(300);
      // The sample view IS the depth — there is no separate bitDepth field to
      // disagree with it.
      expect(ch1?.data).toBeInstanceOf(Uint8Array);
      expect(ch1?.data.length).toBe(400 * 300);

      const ch2 = channels.find(c => c.channel === 'ch2');
      expect(ch2?.color).toEqual([0, 255, 0]); // '#00FF00'
      expect(ch2?.opacity).toBeCloseTo(0.4); // 40 / 100

      // The whole point of the change: no per-pixel JS work on this path.
      expect(ctx.putImageData).not.toHaveBeenCalled();
      expect(ctx.clearRect).not.toHaveBeenCalled();
      expect(onLoad).toHaveBeenCalledWith(400, 300, 'ch1|ch2');
    });

    it('re-draws on a window (slider) change without refetching or remounting', async () => {
      const fake = makeFakeCompositor();
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      const { rerender } = render(<MultiChannelCanvas {...DEFAULT_PROPS} />);
      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(fake.draw).toHaveBeenCalledTimes(1);

      // Simulate a Min/Max slider drag: context state changes, props don't.
      mockWindowMin = 10;
      mockWindowMax = 200;
      rerender(<MultiChannelCanvas {...DEFAULT_PROPS} />);
      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      expect(fake.draw).toHaveBeenCalledTimes(2);
      const [, win] = fake.draw.mock.calls[1] as [
        CompositorChannel[],
        CompositorWindow,
      ];
      expect(win).toEqual({ min: 10, max: 200, rangeMax: 255 });
      // No refetch (decode cache reused) and no new canvas element, so no new
      // GL context: a drag is a uniform update, nothing more.
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(createCompositor).toHaveBeenCalledTimes(1);
    });

    it('falls back to a FRESH canvas on the CPU path after context loss', async () => {
      const ctx = installSharedCanvasContext();
      const fake = makeFakeCompositor();
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      render(<MultiChannelCanvas {...DEFAULT_PROPS} />);
      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      expect(fake.draw).toHaveBeenCalledTimes(1);
      expect(ctx.putImageData).not.toHaveBeenCalled();
      const canvasBefore = screen.getByTestId('multi-channel-canvas');

      await act(async () => {
        capturedOnContextLost()();
        await new Promise(r => setTimeout(r, 50));
      });

      // A NEW element — the lost one is stuck in WebGL context mode and could
      // never yield a 2D context.
      const canvasAfter = screen.getByTestId('multi-channel-canvas');
      expect(canvasAfter).not.toBe(canvasBefore);
      expect(fake.dispose).toHaveBeenCalledTimes(1);
      // Repainted on the CPU from the cached samples: not blank, not refetched.
      expect(ctx.putImageData).toHaveBeenCalledTimes(2);
      expect(fake.draw).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('falls back to the CPU path when the compositor reports isAlive() === false', async () => {
      const ctx = installSharedCanvasContext();
      const fake = makeFakeCompositor({ isAlive: vi.fn(() => false) });
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      const onLoad = vi.fn();

      await act(async () => {
        render(<MultiChannelCanvas {...DEFAULT_PROPS} onLoad={onLoad} />);
        await new Promise(r => setTimeout(r, 50));
      });

      // Never drawn through a dead context; painted on the CPU instead.
      expect(fake.draw).not.toHaveBeenCalled();
      expect(fake.dispose).toHaveBeenCalledTimes(1);
      expect(ctx.putImageData).toHaveBeenCalledTimes(2);
      expect(onLoad).toHaveBeenCalledWith(400, 300, 'ch1|ch2');
    });

    it('falls back to the CPU path when createCompositor throws', async () => {
      const ctx = installSharedCanvasContext();
      vi.mocked(createCompositor).mockImplementation(() => {
        throw new Error('WebGL2 init exploded');
      });
      const { fetchImpl } = makeSuccessfulFetch();
      global.fetch = fetchImpl;

      const onLoad = vi.fn();

      await act(async () => {
        render(<MultiChannelCanvas {...DEFAULT_PROPS} onLoad={onLoad} />);
        await new Promise(r => setTimeout(r, 50));
      });

      expect(ctx.putImageData).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('multi-channel-canvas')).toBeInTheDocument();
      expect(onLoad).toHaveBeenCalledWith(400, 300, 'ch1|ch2');
    });
  });
});
