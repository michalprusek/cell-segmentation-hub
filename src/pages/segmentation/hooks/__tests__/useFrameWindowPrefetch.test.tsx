import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useFrameWindowPrefetch } from '../useFrameWindowPrefetch';

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
 *  does. A warm still in flight is deliberately abandoned and retried, so
 *  without this the dedup assertions below would measure the race, not the
 *  behaviour. */
async function settleWarms(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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

  it('prefetches every URL in the window on first render', () => {
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
    // Window = 5 back + 10 ahead + current = 16 frames × 2 channels = 32
    expect(warmCount()).toBe(32);
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
    expect(warmCount()).toBe(32);
    await settleWarms();
    clearWarms();

    // Slide window by 1: only the new leading-edge frame (index 31)
    // contributes its 2 channels — the trailing edge (index 14) is
    // dropped silently, and every other URL is already in prefetchedRef.
    rerender({ currentIndex: 21 });
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
    expect(warmCount()).toBe(7);
    await settleWarms();
    clearWarms();

    // Advance currentIndex but window stays clamped at the end of the
    // frames array — no new URLs to prefetch.
    rerender({ currentIndex: 19 });
    expect(warmCount()).toBe(0);
  });

  it('clears dedup state and re-fires on channelsKey change', () => {
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
    expect(warmCount()).toBe(16);
    clearWarms();

    // Switching channel set must re-prefetch the whole window for the
    // new URLs (channel name is part of the URL).
    rerender({ channels: ['ch2'] });
    expect(warmCount()).toBe(16);
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

  it('cancels multi-channel warms that never settled, and retries them', async () => {
    // A user mashing the slider must not leave N requests in flight. The
    // multi-channel warm is a fetch, so cancellation is its AbortSignal —
    // frameImageCache is not involved on this path at all.
    const signals: AbortSignal[] = [];
    fetchMock
      .mockReset()
      .mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        return new Promise(() => {}); // never settles: the warm stays pending
      });

    const frames = makeFrames(100);
    const { rerender } = renderHook(
      ({ currentIndex }: { currentIndex: number }) =>
        useFrameWindowPrefetch({
          frames,
          currentIndex,
          channels: ['ch1'],
          enabled: true,
        }),
      { wrapper: wrapper(qc), initialProps: { currentIndex: 20 } }
    );
    expect(signals).toHaveLength(16);
    expect(signals.every(s => !s.aborted)).toBe(true);
    clearWarms();

    rerender({ currentIndex: 40 });

    // Every warm from the first window is aborted...
    expect(signals.slice(0, 16).every(s => s.aborted)).toBe(true);
    // ...and the new window is warmed fresh.
    expect(warmCount()).toBe(16);
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
    expect(fetchMock).toHaveBeenCalled();
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
    expect(prefetchMock).toHaveBeenCalled();
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
