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

// Control visibleChannels / channel from the test.
let mockVisibleChannels: string[] = [];
let mockChannel: string | null = null;

vi.mock('../../../contexts/ImageDisplayContext', () => ({
  useImageDisplay: () => ({
    visibleChannels: mockVisibleChannels,
    channel: mockChannel,
  }),
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
  overrides: Partial<{
    frames: readonly FrameMinimal[];
    currentIndex: number;
    enabled: boolean;
  }> = {}
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
