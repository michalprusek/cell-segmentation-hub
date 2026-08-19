import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useFrameWindowPrefetch } from '../useFrameWindowPrefetch';
import { MAX_SPECULATIVE_REQUESTS } from '@/lib/requestThrottle';

const prefetchMock = vi.fn();
const isReadyMock = vi.fn().mockReturnValue(false);
const abortMock = vi.fn();
const readyCountMock = vi.fn().mockReturnValue(0);

vi.mock('@/lib/rendering/FrameImageCache', () => ({
  frameImageCache: {
    prefetch: (url: string) => prefetchMock(url),
    isReady: (url: string) => isReadyMock(url),
    abort: (url: string) => abortMock(url),
    readyCount: (urls: readonly string[]) => readyCountMock(urls),
  },
}));

vi.mock('@/lib/api', () => ({
  default: {
    getSegmentationResults: vi.fn().mockResolvedValue(null),
  },
}));

const fetchMock = vi.fn();

/**
 * How many window URLs were warmed, by whichever mechanism applies.
 *
 * The hook warms single-channel `/display` URLs through the <img> element
 * cache (they really are shown in an <img>) and multi-channel frame-data URLs
 * through a plain fetch (MultiChannelCanvas decodes those itself, so an <img>
 * would decode an 8.3 MB RGBA bitmap nothing draws). These tests are about the
 * WINDOW and DEDUP logic, so they count warms without caring which path was
 * taken; `warms the multi-channel window without decoding it` pins the choice.
 */
function warmCount(): number {
  return prefetchMock.mock.calls.length + fetchMock.mock.calls.length;
}

/** Let the fetch warms settle, the way ~100 ms between real window shifts
 *  does. Multi-channel warms drain through a shared 4-slot throttle, so a
 *  32-URL window is a dozen sequential waves and a fixed number of microtasks
 *  would measure the race rather than the behaviour — hence a macrotask turn,
 *  and `waitFor` for anything counted. */
async function settleWarms(): Promise<void> {
  await new Promise(r => setTimeout(r, 0));
}

function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * A `fetch` that never responds but DOES reject when aborted — which is what a
 * real one does. It matters here: the throttle frees a slot when its task
 * settles, so a mock that ignores its signal would wedge all four slots and
 * every later assertion in this file would be measuring a deadlock.
 */
function neverSettlingFetch(
  _url: string,
  init?: RequestInit
): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener('abort', () => reject(abortError()), {
      once: true,
    });
  });
}

/** `/api/images/frame-7/frame-data?channel=ch1` -> `frame-7`. */
function frameIdOf(url: string): string {
  return /\/images\/([^/]+)\//.exec(url)?.[1] ?? '';
}

function clearWarms(): void {
  prefetchMock.mockClear();
  fetchMock.mockClear();
}

function makeFrames(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `frame-${i}`,
    segmentationStatus: 'segmented',
  }));
}

const wrapper =
  (qc: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

describe('useFrameWindowPrefetch', () => {
  let qc: QueryClient;
  beforeEach(() => {
    prefetchMock.mockReset();
    prefetchMock.mockReturnValue(Promise.resolve(new Image()));
    fetchMock.mockReset().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    // Simulate the production case: cached/browser-HTTP fetches return
    // ready synchronously, so the cleanup branch that aborts pending
    // URLs is a no-op. The hook's dedup semantics depend on this.
    isReadyMock.mockReset().mockReturnValue(true);
    abortMock.mockReset();
    readyCountMock.mockReset().mockReturnValue(0);
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    qc.clear();
  });

  it('warms every URL in the window, a few at a time rather than all at once', async () => {
    const frames = makeFrames(100);
    renderHook(
      () =>
        useFrameWindowPrefetch({
          frames,
          currentIndex: 20,
          channels: ['ch1', 'ch2'],
          enabled: true,
        }),
      { wrapper: wrapper(qc) }
    );
    // Window = 5 back + 10 ahead + current = 16 frames × 2 channels = 32 URLs,
    // and issuing all 32 in one synchronous burst is the regression. Only the
    // shared cap goes out immediately; the rest wait for a slot.
    expect(warmCount()).toBe(MAX_SPECULATIVE_REQUESTS);
    // ...but none of them are dropped: throttled, not skipped.
    await waitFor(() => expect(warmCount()).toBe(32));
  });

  it('window-shift fires prefetch ONLY for new leading-edge URLs', async () => {
    const frames = makeFrames(100);
    const { rerender } = renderHook(
      ({ currentIndex }: { currentIndex: number }) =>
        useFrameWindowPrefetch({
          frames,
          currentIndex,
          channels: ['ch1', 'ch2'],
          enabled: true,
        }),
      {
        wrapper: wrapper(qc),
        initialProps: { currentIndex: 20 },
      }
    );
    await waitFor(() => expect(warmCount()).toBe(32));
    clearWarms();

    // Slide window by 1: only the new leading-edge frame (index 31)
    // contributes its 2 channels — the trailing edge (index 14) is
    // dropped silently, and every other URL is already in prefetchedRef.
    rerender({ currentIndex: 21 });
    await waitFor(() => expect(warmCount()).toBe(2));
    // And it stays 2 — a completed warm that fell off the trailing edge is in
    // the HTTP cache, so the shift must not cancel and re-issue it.
    await settleWarms();
    expect(warmCount()).toBe(2);
  });

  it('does NOT re-prefetch when window content unchanged (clamped at edge)', async () => {
    const frames = makeFrames(20);
    const { rerender } = renderHook(
      ({ currentIndex }: { currentIndex: number }) =>
        useFrameWindowPrefetch({
          frames,
          currentIndex,
          channels: ['ch1'],
          enabled: true,
        }),
      {
        wrapper: wrapper(qc),
        initialProps: { currentIndex: 18 },
      }
    );
    // Window clamped at frames.length - 1 = 19, so frames 13..19 = 7
    await waitFor(() => expect(warmCount()).toBe(7));
    clearWarms();

    // Advance currentIndex but window stays clamped at the end of the
    // frames array — no new URLs to prefetch.
    rerender({ currentIndex: 19 });
    await settleWarms();
    expect(warmCount()).toBe(0);
  });

  it('clears dedup state and re-fires on channelsKey change', async () => {
    const frames = makeFrames(50);
    const { rerender } = renderHook(
      ({ channels }: { channels: string[] }) =>
        useFrameWindowPrefetch({
          frames,
          currentIndex: 20,
          channels,
          enabled: true,
        }),
      {
        wrapper: wrapper(qc),
        initialProps: { channels: ['ch1'] },
      }
    );
    await waitFor(() => expect(warmCount()).toBe(16));
    clearWarms();

    // Switching channel set must re-prefetch the whole window for the
    // new URLs (channel name is part of the URL).
    rerender({ channels: ['ch2'] });
    await waitFor(() => expect(warmCount()).toBe(16));
  });

  it('skips polygon prefetch when frame status is not segmented', () => {
    const frames = [
      { id: 'a', segmentationStatus: 'segmented' },
      { id: 'b', segmentationStatus: 'queued' },
      { id: 'c', segmentationStatus: 'failed' },
    ];
    // Polygon prefetch goes through React Query; we don't have a direct
    // assertion on it without instrumenting the client. Image prefetch
    // for all 3 still fires (status only gates polygon, not image).
    renderHook(
      () =>
        useFrameWindowPrefetch({
          frames,
          currentIndex: 1,
          channels: ['ch1'],
          enabled: true,
        }),
      { wrapper: wrapper(qc) }
    );
    expect(warmCount()).toBe(3);
    // Polygon side: only 'a' should have been queried; b/c skipped.
    // React Query exposes this through cache state.
    const aData = qc.getQueryState(['segmentation-results', 'a']);
    const bData = qc.getQueryState(['segmentation-results', 'b']);
    expect(aData).toBeDefined();
    expect(bData).toBeUndefined();
  });

  it('caps concurrent frame-data warms however many channels a project has', async () => {
    // The regression, reproduced as a unit: 16 window frames × 3 channels = 48
    // URLs handed over at once. That burst is what put 547 rejections a minute
    // into nginx's 100 r/s `segmentation` zone. All 48 must still be warmed —
    // just never more than the cap at a time.
    const release: Array<() => void> = [];
    let outstanding = 0;
    let peak = 0;
    fetchMock.mockReset().mockImplementation(() => {
      outstanding++;
      if (outstanding > peak) peak = outstanding;
      return new Promise(resolve => {
        release.push(() => {
          outstanding--;
          resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
        });
      });
    });

    const frames = makeFrames(100);
    renderHook(
      () =>
        useFrameWindowPrefetch({
          frames,
          currentIndex: 20,
          channels: ['irm', 'gfp', 'dic'],
          enabled: true,
        }),
      { wrapper: wrapper(qc) }
    );

    expect(fetchMock).toHaveBeenCalledTimes(MAX_SPECULATIVE_REQUESTS);

    // Drain one at a time; each completion may admit exactly one more.
    for (let i = 0; i < 48; i++) {
      await waitFor(() => expect(release.length).toBeGreaterThan(i));
      release[i]();
      await settleWarms();
      expect(outstanding).toBeLessThanOrEqual(MAX_SPECULATIVE_REQUESTS);
    }

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(48));
    expect(peak).toBe(MAX_SPECULATIVE_REQUESTS);
  });

  it('never issues queued warms for URLs that left the window', async () => {
    // Cancellation has to reach work that has not been issued yet, not just
    // work in flight: aborting an already-issued request still cost nginx the
    // request. A queued entry for a URL that left the window must never be
    // handed to `fetch` at all.
    fetchMock.mockReset().mockImplementation(neverSettlingFetch);

    const frames = makeFrames(200);
    const { rerender } = renderHook(
      ({ currentIndex }: { currentIndex: number }) =>
        useFrameWindowPrefetch({
          frames,
          currentIndex,
          channels: ['ch1', 'ch2', 'ch3'],
          enabled: true,
        }),
      { wrapper: wrapper(qc), initialProps: { currentIndex: 20 } }
    );

    // 48 URLs wanted, 4 issued, 44 sitting in the queue touching nothing.
    expect(fetchMock).toHaveBeenCalledTimes(MAX_SPECULATIVE_REQUESTS);
    const firstSignals = fetchMock.mock.calls.map(
      c => (c[1] as RequestInit).signal as AbortSignal
    );
    const abandonedIds = new Set(
      Array.from({ length: 16 }, (_, i) => `frame-${15 + i}`)
    );
    clearWarms();

    // Jump the window somewhere disjoint, as a slider scrub does.
    rerender({ currentIndex: 120 });

    // In-flight warms from the old window are aborted...
    expect(firstSignals.every(s => s.aborted)).toBe(true);
    // ...and the 44 that were still queued are dropped unissued: everything
    // that reaches `fetch` from here on belongs to the NEW window.
    await settleWarms();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    const issuedAfterShift = fetchMock.mock.calls.map(c =>
      frameIdOf(String(c[0]))
    );
    expect(issuedAfterShift.some(id => abandonedIds.has(id))).toBe(false);
    expect(issuedAfterShift.length).toBeLessThanOrEqual(
      MAX_SPECULATIVE_REQUESTS
    );
  });

  it('warms the multi-channel window WITHOUT decoding it', async () => {
    // The reason this path exists. MultiChannelCanvas fetches and decodes
    // these frames itself and never puts them in an <img>, so warming them
    // through the element cache made the browser decode every window frame
    // into an RGBA bitmap nothing draws — 8.3 MB apiece at 1474x1412, roughly
    // 250 MB across a 15-frame two-channel window. A fetch fills the same HTTP
    // cache and decodes nothing.
    const frames = makeFrames(20);
    renderHook(
      () =>
        useFrameWindowPrefetch({
          frames,
          currentIndex: 5,
          channels: ['ch1', 'ch2'],
          enabled: true,
        }),
      { wrapper: wrapper(qc) }
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(prefetchMock).not.toHaveBeenCalled();
  });

  it('still warms the single-channel path through the <img> cache', async () => {
    // `/display` URLs really are shown in an <img>, so warming the element
    // cache is the point there. Only multi-channel frame-data — which
    // MultiChannelCanvas decodes itself — skips it.
    const frames = makeFrames(20);
    renderHook(
      () =>
        useFrameWindowPrefetch({
          frames,
          currentIndex: 5,
          channels: [],
          enabled: true,
        }),
      { wrapper: wrapper(qc) }
    );
    await waitFor(() => expect(prefetchMock).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when enabled=false', () => {
    const frames = makeFrames(50);
    renderHook(
      () =>
        useFrameWindowPrefetch({
          frames,
          currentIndex: 20,
          channels: ['ch1'],
          enabled: false,
        }),
      { wrapper: wrapper(qc) }
    );
    expect(prefetchMock).not.toHaveBeenCalled();
  });
});
