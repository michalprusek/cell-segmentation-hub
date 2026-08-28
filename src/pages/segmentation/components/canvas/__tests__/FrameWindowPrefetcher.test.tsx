/**
 * Tests for FrameWindowPrefetcher component.
 *
 * The component is headless (returns null) and its only observable behaviour
 * is calling `useFrameWindowPrefetch` with the right arguments.  We mock
 * `useImageDisplay` to control `visibleChannels` / `channel`, and mock
 * `useFrameWindowPrefetch` to capture the call arguments.
 *
 * Skipped: verifying actual cache/network calls — those belong to
 * useFrameWindowPrefetch's own tests.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import FrameWindowPrefetcher from '../FrameWindowPrefetcher';
import type { FrameMinimal } from '../../../hooks/useFrameWindowPrefetch';

// -----------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------

// Capture the args passed to the hook.
const mockUseFrameWindowPrefetch = vi.fn(() => ({
  windowImageUrls: [],
  readyCount: 0,
  isWindowReady: false,
}));

vi.mock('../../../hooks/useFrameWindowPrefetch', () => ({
  useFrameWindowPrefetch: (
    ...args: Parameters<typeof mockUseFrameWindowPrefetch>
  ) => mockUseFrameWindowPrefetch(...args),
}));

// Control visibleChannels / channel / windows from the test.
let mockVisibleChannels: string[] = [];
let mockChannel: string | null = null;
let mockChannelWindows: Record<
  string,
  { min: number; max: number; rangeMax: number; dataMin: number }
> = {};
let mockProxyRangeMax: number | null = null;

vi.mock('../../../contexts/ImageDisplayContext', () => ({
  useImageDisplay: () => ({
    visibleChannels: mockVisibleChannels,
    channel: mockChannel,
    channelWindows: mockChannelWindows,
    fallbackWindow: { min: 0, max: 255, rangeMax: 255, dataMin: 0 },
    proxyRangeMax: mockProxyRangeMax,
    channelCoverage: {},
  }),
}));

// Not mocked before, so `canDecodeWebpGray()` returned false in jsdom and the
// `&&` short-circuited: the proxy decision — the whole reason this component
// reads the display context — was never reached by any test, and the context
// mock could stay incomplete without anything noticing.
let mockCanDecode = true;
vi.mock('@/lib/webpGray', () => ({
  canDecodeWebpGray: () => mockCanDecode,
}));

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

const FRAMES: FrameMinimal[] = [
  { id: 'f-0', segmentationStatus: 'segmented' },
  { id: 'f-1', segmentationStatus: 'segmented' },
  { id: 'f-2', segmentationStatus: 'segmented' },
];

function renderPrefetcher(
  overrides: Partial<React.ComponentProps<typeof FrameWindowPrefetcher>> = {}
) {
  return render(
    <FrameWindowPrefetcher
      frames={FRAMES}
      currentIndex={1}
      enabled={true}
      {...overrides}
    />
  );
}

describe('FrameWindowPrefetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVisibleChannels = [];
    mockChannel = null;
  });

  // -----------------------------------------------------------------------
  // Returns null
  // -----------------------------------------------------------------------

  describe('Rendering', () => {
    it('renders nothing (returns null)', () => {
      const { container } = renderPrefetcher();
      expect(container.firstChild).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Playback buffer probe
  //
  // This is the WIRING the playback gate depends on: this component is the only
  // place that knows which cache keys the canvas will read, so if it stops
  // handing the probe up, `useVideoFrames` silently reverts to the free-running
  // timer that skipped frames in the first place.
  // -----------------------------------------------------------------------

  describe('Buffer probe registration', () => {
    it('registers a probe while enabled and unregisters on unmount', () => {
      const registerBufferProbe = vi.fn();
      const { unmount } = renderPrefetcher({ registerBufferProbe });

      expect(registerBufferProbe).toHaveBeenCalledWith(expect.any(Function));

      registerBufferProbe.mockClear();
      unmount();
      expect(registerBufferProbe).toHaveBeenCalledWith(null);
    });

    it('registers null when disabled, so a non-video editor never gates', () => {
      const registerBufferProbe = vi.fn();
      renderPrefetcher({ registerBufferProbe, enabled: false });
      expect(registerBufferProbe).toHaveBeenCalledWith(null);
      expect(registerBufferProbe).not.toHaveBeenCalledWith(
        expect.any(Function)
      );
    });

    it('keeps one stable probe identity across re-renders', () => {
      // A fresh identity every render would re-run the register effect at the
      // rate the window-level slider ticks.
      const registerBufferProbe = vi.fn();
      const { rerender } = renderPrefetcher({ registerBufferProbe });
      const first = registerBufferProbe.mock.calls[0][0];

      mockVisibleChannels = ['irm'];
      rerender(
        <FrameWindowPrefetcher
          frames={FRAMES}
          currentIndex={2}
          enabled={true}
          registerBufferProbe={registerBufferProbe}
        />
      );

      const registered = registerBufferProbe.mock.calls
        .map(c => c[0])
        .filter(Boolean);
      expect(new Set(registered).size).toBe(1);
      expect(registered[0]).toBe(first);
    });
  });

  // -----------------------------------------------------------------------
  // Hook receives the right frames / index / enabled
  // -----------------------------------------------------------------------

  describe('Hook arguments', () => {
    it('passes frames prop to useFrameWindowPrefetch', () => {
      renderPrefetcher({ frames: FRAMES });
      expect(mockUseFrameWindowPrefetch).toHaveBeenCalledWith(
        expect.objectContaining({ frames: FRAMES })
      );
    });

    it('passes currentIndex to the hook', () => {
      renderPrefetcher({ currentIndex: 2 });
      expect(mockUseFrameWindowPrefetch).toHaveBeenCalledWith(
        expect.objectContaining({ currentIndex: 2 })
      );
    });

    it('passes enabled=true when prop is true', () => {
      renderPrefetcher({ enabled: true });
      expect(mockUseFrameWindowPrefetch).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true })
      );
    });

    it('passes enabled=false when prop is false', () => {
      renderPrefetcher({ enabled: false });
      expect(mockUseFrameWindowPrefetch).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false })
      );
    });
  });

  // -----------------------------------------------------------------------
  // Channel derivation — multi-channel path
  // -----------------------------------------------------------------------

  describe('Channel derivation — visibleChannels non-empty', () => {
    it('uses visibleChannels when non-empty', () => {
      mockVisibleChannels = ['DAPI', 'GFP'];
      renderPrefetcher();
      expect(mockUseFrameWindowPrefetch).toHaveBeenCalledWith(
        expect.objectContaining({ channels: ['DAPI', 'GFP'] })
      );
    });

    it('ignores channel when visibleChannels is non-empty', () => {
      mockVisibleChannels = ['DAPI'];
      mockChannel = 'GFP';
      renderPrefetcher();
      const { channels } = mockUseFrameWindowPrefetch.mock.calls[0][0] as {
        channels: string[];
      };
      expect(channels).toEqual(['DAPI']);
    });
  });

  // -----------------------------------------------------------------------
  // Channel derivation — single-channel fallback
  // -----------------------------------------------------------------------

  describe('Channel derivation — single-channel fallback', () => {
    it('wraps channel in an array when visibleChannels is empty', () => {
      mockVisibleChannels = [];
      mockChannel = 'BF';
      renderPrefetcher();
      expect(mockUseFrameWindowPrefetch).toHaveBeenCalledWith(
        expect.objectContaining({ channels: ['BF'] })
      );
    });

    it('passes empty channels array when both visibleChannels and channel are absent', () => {
      mockVisibleChannels = [];
      mockChannel = null;
      renderPrefetcher();
      expect(mockUseFrameWindowPrefetch).toHaveBeenCalledWith(
        expect.objectContaining({ channels: [] })
      );
    });
  });
});

// -----------------------------------------------------------------------
// Representation choice — must match the canvas, or the prefetcher warms
// bytes the canvas will not ask for.
// -----------------------------------------------------------------------

describe('FrameWindowPrefetcher — proxy vs original', () => {
  beforeEach(() => {
    mockCanDecode = true;
    mockVisibleChannels = ['irm'];
    mockChannel = null;
    mockProxyRangeMax = 65535;
    mockChannelWindows = {};
  });

  it('asks for the proxy when a channel is windowed to its own full range', () => {
    // The regression this pins: judged against the container-wide 65535 this
    // narrow channel can never clear the threshold, so the prefetcher would
    // warm full-depth PNGs for ever — and because the same gate drives the
    // canvas, no proxy would ever be fetched to teach the gate otherwise.
    mockChannelWindows = {
      irm: { min: 2941, max: 4145, rangeMax: 4145, dataMin: 2941 },
    };
    renderPrefetcher();
    expect(mockUseFrameWindowPrefetch).toHaveBeenCalledWith(
      expect.objectContaining({ repr: 'proxy' })
    );
  });

  it('asks for the original once that channel is genuinely narrowed', () => {
    mockChannelWindows = {
      irm: { min: 3000, max: 3120, rangeMax: 4145, dataMin: 2941 },
    };
    renderPrefetcher();
    expect(mockUseFrameWindowPrefetch).toHaveBeenCalledWith(
      expect.objectContaining({ repr: undefined })
    );
  });

  it('asks for the original when the browser cannot decode a proxy', () => {
    mockCanDecode = false;
    mockChannelWindows = {
      irm: { min: 2941, max: 4145, rangeMax: 4145, dataMin: 2941 },
    };
    renderPrefetcher();
    expect(mockUseFrameWindowPrefetch).toHaveBeenCalledWith(
      expect.objectContaining({ repr: undefined })
    );
  });
});
