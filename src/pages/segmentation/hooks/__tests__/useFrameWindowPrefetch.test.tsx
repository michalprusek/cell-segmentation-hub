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
    expect(prefetchMock).toHaveBeenCalledTimes(32);
  });

  it('window-shift fires prefetch ONLY for new leading-edge URLs', () => {
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
    expect(prefetchMock).toHaveBeenCalledTimes(32);
    prefetchMock.mockClear();

    // Slide window by 1: only the new leading-edge frame (index 31)
    // contributes its 2 channels — the trailing edge (index 14) is
    // dropped silently, and every other URL is already in prefetchedRef.
    rerender({ currentIndex: 21 });
    expect(prefetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT re-prefetch when window content unchanged (clamped at edge)', () => {
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
    expect(prefetchMock).toHaveBeenCalledTimes(7);
    prefetchMock.mockClear();

    // Advance currentIndex but window stays clamped at the end of the
    // frames array — no new URLs to prefetch.
    rerender({ currentIndex: 19 });
    expect(prefetchMock).toHaveBeenCalledTimes(0);
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
    expect(prefetchMock).toHaveBeenCalledTimes(16);
    prefetchMock.mockClear();

    // Switching channel set must re-prefetch the whole window for the
    // new URLs (channel name is part of the URL).
    rerender({ channels: ['ch2'] });
    expect(prefetchMock).toHaveBeenCalledTimes(16);
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
    expect(prefetchMock).toHaveBeenCalledTimes(3);
    // Polygon side: only 'a' should have been queried; b/c skipped.
    // React Query exposes this through cache state.
    const aData = qc.getQueryState(['segmentation-results', 'a']);
    const bData = qc.getQueryState(['segmentation-results', 'b']);
    expect(aData).toBeDefined();
    expect(bData).toBeUndefined();
  });

  it('aborts pending URLs from the previous window and unmarks them', () => {
    // Pending URLs (isReady=false) get cancelled on window-shift so a
    // user mashing the slider doesn't keep N HTTP connections open.
    isReadyMock.mockReturnValue(false);
    const frames = makeFrames(100);
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
        initialProps: { currentIndex: 20 },
      }
    );
    prefetchMock.mockClear();
    abortMock.mockClear();

    rerender({ currentIndex: 40 });
    // 16 NEW URLs in the new window get prefetched; 16 OLD URLs from
    // the previous run are aborted because they never settled.
    expect(prefetchMock).toHaveBeenCalledTimes(16);
    expect(abortMock).toHaveBeenCalledTimes(16);
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
