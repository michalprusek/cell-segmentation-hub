/**
 * ImageDisplayProvider — moving to another video without the editor unmounting.
 *
 * The route changing from a frame of one container to a frame of another keeps
 * the editor, and so this provider, mounted. Reproduced on production
 * (2026-09-14, twochan.tif -> sparse_ref.ome.tif, which share channel names):
 * the tabs kept the first video's `StaticIRM` and the second video's frames were
 * asked for it ten times (HTTP 400), a stale `channelsSeeded` let the fallback
 * <img> fetch `/display` five times, and a stale window let the prefetcher warm
 * the neighbours before the new frame had decoded.
 *
 * The first test records what the children see on EVERY render, because the
 * defect lived in the render between the route change and a reset: a reset
 * done in an effect passes a test that only looks at the final state.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { ImageDisplayProvider, useImageDisplay } from '../ImageDisplayContext';

const prefetchCalls: Array<{ imagesEnabled?: boolean }> = [];
vi.mock('../../hooks/useFrameWindowPrefetch', () => ({
  useFrameWindowPrefetch: (opts: { imagesEnabled?: boolean }) => {
    prefetchCalls.push(opts);
    return { windowImageUrls: [], readyCount: 0, isWindowReady: false };
  },
}));
vi.mock('../../hooks/useDecodeAhead', () => ({ useDecodeAhead: vi.fn() }));
vi.mock('@/lib/webpGray', () => ({ canDecodeWebpGray: () => true }));

import FrameWindowPrefetcher from '../../components/canvas/FrameWindowPrefetcher';

type Display = ReturnType<typeof useImageDisplay>;

interface Seen {
  container: string | null;
  seeded: boolean;
  visible: string[];
  irmWindow: boolean;
  irmColour: string | undefined;
  brightness: number;
}

const FRAMES = [
  { id: 'f-0', segmentationStatus: 'segmented' },
  { id: 'f-1', segmentationStatus: 'segmented' },
  { id: 'f-2', segmentationStatus: 'segmented' },
];

let seen: Seen[] = [];
let api: Display | null = null;

function Probe({ container }: { container: string | null }) {
  const display = useImageDisplay();
  api = display;
  seen.push({
    container,
    seeded: display.channelsSeeded,
    visible: display.visibleChannels,
    irmWindow: display.channelWindows.irm !== undefined,
    irmColour: display.channelColors.irm,
    brightness: display.brightness,
  });
  return null;
}

function Harness({ container }: { container: string | null }) {
  return (
    <ImageDisplayProvider containerId={container}>
      <Probe container={container} />
      <FrameWindowPrefetcher
        frames={FRAMES}
        currentIndex={1}
        enabled
        awaitChannelSetup
      />
    </ImageDisplayProvider>
  );
}

/** What ChannelOverlayList and the first decode leave behind for a video. */
function setUpContainer(key: string) {
  act(() => {
    api!.setVisibleChannels(['irm', '488_nm']);
    api!.setChannelsSeeded(true);
    api!.reportChannelRanges({ irm: { min: 2941, max: 4145 } }, key);
  });
}

beforeEach(() => {
  vi.mocked(localStorage.getItem).mockImplementation(() => null);
  seen = [];
  api = null;
  prefetchCalls.length = 0;
});

describe('switching container without unmounting', () => {
  it("never lets a child render against the previous container's channels", () => {
    const { rerender } = render(<Harness container="A" />);
    setUpContainer('A');
    act(() => {
      api!.setChannelColor('irm', '#ff0000');
      api!.setBrightness(140);
    });
    expect(seen.at(-1)).toMatchObject({
      seeded: true,
      visible: ['irm', '488_nm'],
      irmWindow: true,
    });

    const mark = seen.length;
    rerender(<Harness container="B" />);
    const afterSwitch = seen.slice(mark);

    expect(afterSwitch.length).toBeGreaterThan(0);
    for (const render of afterSwitch) {
      expect(render).toMatchObject({
        container: 'B',
        seeded: false,
        visible: [],
        irmWindow: false,
      });
    }
    // What the user chose survives the move.
    expect(afterSwitch.at(-1)).toMatchObject({
      irmColour: '#ff0000',
      brightness: 140,
    });
  });

  it("holds the prefetch until the NEW container's frame has decoded", () => {
    const { rerender } = render(<Harness container="A" />);
    setUpContainer('A');
    expect(prefetchCalls.at(-1)?.imagesEnabled).toBe(true);

    const mark = prefetchCalls.length;
    rerender(<Harness container="B" />);
    // The channel list of B is applied, with the same channel names as A...
    act(() => {
      api!.setVisibleChannels(['irm', '488_nm']);
      api!.setChannelsSeeded(true);
    });
    // ...and still nothing may be warmed: A's window is not B's.
    expect(prefetchCalls.slice(mark).map(c => c.imagesEnabled)).not.toContain(
      true
    );

    act(() => {
      api!.reportChannelRanges({ irm: { min: 100, max: 900 } }, 'B');
    });
    expect(prefetchCalls.at(-1)?.imagesEnabled).toBe(true);
  });

  it('keeps everything when the container does not change', () => {
    // Scrubbing frames of one video re-renders the provider with the same
    // container; resetting there would re-seed the channels on every frame.
    const { rerender } = render(<Harness container="A" />);
    setUpContainer('A');

    rerender(<Harness container="A" />);

    expect(seen.at(-1)).toMatchObject({
      seeded: true,
      visible: ['irm', '488_nm'],
      irmWindow: true,
    });
  });
});
