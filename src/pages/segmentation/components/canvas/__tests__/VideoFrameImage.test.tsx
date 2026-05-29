/**
 * VideoFrameImage — behavioral unit tests
 *
 * Covered behaviours:
 *  - Non-video mode: renders CanvasImage with fallbackSrc
 *  - Non-video mode: renders CanvasImage even when currentFrameId is null
 *  - Video mode + no currentFrameId: renders CanvasImage with fallbackSrc
 *  - Video mode + currentFrameId + no channel: src uses /display suffix
 *  - Video mode + currentFrameId + channel: src includes frame-data?channel=<name>
 *  - Video mode + channel with special chars: channel is URL-encoded in src
 *  - Multi-channel mode (visibleChannels.length > 0): renders MultiChannelCanvas,
 *    not CanvasImage
 *  - Multi-channel mode: passes frameId, visibleChannels, channelColors to MultiChannelCanvas
 *  - Single-channel mode: onLoad callback receives (width, height, channelsKey=channel)
 *  - Single-channel mode: channelsKey is empty string when channel is null
 *
 * NOT tested:
 *  - Actual image network load / error (HTML Image events not fired in jsdom for
 *    synthetic src values — tested in CanvasImage.test.tsx)
 *  - Canvas pixel compositing (GPU path; separate MultiChannelCanvas tests)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, render } from '@testing-library/react';
import VideoFrameImage from '../VideoFrameImage';

// ---------------------------------------------------------------------------
// Control visible-channels state per test
// ---------------------------------------------------------------------------
let mockChannel: string | null = null;
let mockVisibleChannels: string[] = [];
let mockChannelColors: Record<string, string> = {};

vi.mock('@/pages/segmentation/contexts/ImageDisplayContext', () => ({
  useImageDisplay: () => ({
    channel: mockChannel,
    visibleChannels: mockVisibleChannels,
    channelColors: mockChannelColors,
    channelOpacities: {},
    windowMin: 0,
    windowMax: 255,
    brightness: 100,
    contrast: 100,
    frameIndex: undefined,
    setFrameIndex: vi.fn(),
    setChannel: vi.fn(),
    toggleChannelVisibility: vi.fn(),
    setVisibleChannels: vi.fn(),
    setChannelColor: vi.fn(),
    setChannelOpacity: vi.fn(),
    setWindowMin: vi.fn(),
    setWindowMax: vi.fn(),
    setBrightness: vi.fn(),
    setContrast: vi.fn(),
  }),
  ImageDisplayContext: {
    Consumer: ({ children }: { children: (v: null) => React.ReactNode }) =>
      children(null),
  },
}));

// ---------------------------------------------------------------------------
// Mock CanvasImage to a simple img with data-testid
// ---------------------------------------------------------------------------
vi.mock('@/pages/segmentation/components/canvas/CanvasImage', () => ({
  default: ({
    src,
    alt,
    onLoad,
    width,
    height,
  }: {
    src: string;
    alt?: string;
    onLoad?: (w: number, h: number) => void;
    width?: number;
    height?: number;
  }) => (
    <img
      data-testid="canvas-image"
      src={src}
      alt={alt}
      data-width={width}
      data-height={height}
      onLoad={() => onLoad?.(800, 600)}
    />
  ),
}));

// ---------------------------------------------------------------------------
// Mock MultiChannelCanvas to a simple div with data-testid and props captured
// ---------------------------------------------------------------------------
const multiChannelCalls: Array<{
  frameId: string;
  visibleChannels: string[];
  channelColors: Record<string, string>;
}> = [];

vi.mock('@/pages/segmentation/components/canvas/MultiChannelCanvas', () => ({
  default: ({
    frameId,
    visibleChannels,
    channelColors,
    onLoad,
  }: {
    frameId: string;
    visibleChannels: string[];
    channelColors: Record<string, string>;
    onLoad?: (w: number, h: number, key: string) => void;
  }) => {
    multiChannelCalls.push({ frameId, visibleChannels, channelColors });
    return (
      <div
        data-testid="multi-channel-canvas"
        data-frame-id={frameId}
        onClick={() => onLoad?.(1024, 768, visibleChannels.join(','))}
      />
    );
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VideoFrameImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChannel = null;
    mockVisibleChannels = [];
    mockChannelColors = {};
    multiChannelCalls.length = 0;
  });

  // -------------------------------------------------------------------------
  // Non-video mode
  // -------------------------------------------------------------------------

  describe('non-video mode (isVideoMode=false)', () => {
    it('renders CanvasImage with the fallbackSrc', () => {
      render(
        <VideoFrameImage
          isVideoMode={false}
          currentFrameId={null}
          fallbackSrc="/static/image.png"
        />
      );
      const img = screen.getByTestId('canvas-image') as HTMLImageElement;
      expect(img.src).toContain('/static/image.png');
    });

    it('still renders CanvasImage when currentFrameId is provided (non-video overrides)', () => {
      render(
        <VideoFrameImage
          isVideoMode={false}
          currentFrameId="frame-99"
          fallbackSrc="/static/other.png"
        />
      );
      const img = screen.getByTestId('canvas-image') as HTMLImageElement;
      expect(img.src).toContain('/static/other.png');
    });

    it('does NOT render MultiChannelCanvas in non-video mode', () => {
      mockVisibleChannels = ['ch0', 'ch1'];
      render(
        <VideoFrameImage
          isVideoMode={false}
          currentFrameId="frame-1"
          fallbackSrc="/static/img.png"
        />
      );
      expect(screen.queryByTestId('multi-channel-canvas')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Video mode — single-channel (CanvasImage path)
  // -------------------------------------------------------------------------

  describe('video mode, single-channel', () => {
    it('uses /display suffix when channel is null', () => {
      mockChannel = null;
      render(
        <VideoFrameImage
          isVideoMode={true}
          currentFrameId="frame-5"
          fallbackSrc="/fallback.png"
        />
      );
      const img = screen.getByTestId('canvas-image') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('/api/images/frame-5/display');
    });

    it('includes frame-data?channel=<name> when channel is set', () => {
      mockChannel = 'IRM';
      render(
        <VideoFrameImage
          isVideoMode={true}
          currentFrameId="frame-7"
          fallbackSrc="/fallback.png"
        />
      );
      const img = screen.getByTestId('canvas-image') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe(
        '/api/images/frame-7/frame-data?channel=IRM'
      );
    });

    it('URL-encodes the channel name', () => {
      mockChannel = 'Ch 1 (FITC)';
      render(
        <VideoFrameImage
          isVideoMode={true}
          currentFrameId="frame-8"
          fallbackSrc="/fallback.png"
        />
      );
      const img = screen.getByTestId('canvas-image') as HTMLImageElement;
      // encodeURIComponent('Ch 1 (FITC)') = 'Ch%201%20(FITC)'
      expect(img.getAttribute('src')).toContain('channel=Ch%201%20(FITC)');
    });

    it('falls back to fallbackSrc when currentFrameId is null in video mode', () => {
      mockChannel = 'IRM';
      render(
        <VideoFrameImage
          isVideoMode={true}
          currentFrameId={null}
          fallbackSrc="/fallback.png"
        />
      );
      const img = screen.getByTestId('canvas-image') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('/fallback.png');
    });

    it('calls onLoad with (width, height, channel) when CanvasImage fires load', () => {
      mockChannel = 'DAPI';
      const onLoad = vi.fn();
      const { getByTestId } = render(
        <VideoFrameImage
          isVideoMode={true}
          currentFrameId="frame-3"
          fallbackSrc="/fallback.png"
          onLoad={onLoad}
        />
      );
      // Simulate img onLoad (our mock calls onLoad(800, 600))
      getByTestId('canvas-image').dispatchEvent(new Event('load'));
      // The VideoFrameImage wraps this: onLoad(w, h, channel ?? '')
      expect(onLoad).toHaveBeenCalledWith(800, 600, 'DAPI');
    });

    it('passes empty string as channelsKey when channel is null', () => {
      mockChannel = null;
      const onLoad = vi.fn();
      const { getByTestId } = render(
        <VideoFrameImage
          isVideoMode={true}
          currentFrameId="frame-3"
          fallbackSrc="/fallback.png"
          onLoad={onLoad}
        />
      );
      getByTestId('canvas-image').dispatchEvent(new Event('load'));
      expect(onLoad).toHaveBeenCalledWith(800, 600, '');
    });
  });

  // -------------------------------------------------------------------------
  // Video mode — multi-channel (MultiChannelCanvas path)
  // -------------------------------------------------------------------------

  describe('video mode, multi-channel', () => {
    it('renders MultiChannelCanvas instead of CanvasImage when visibleChannels is non-empty', () => {
      mockVisibleChannels = ['ch0', 'ch1'];
      render(
        <VideoFrameImage
          isVideoMode={true}
          currentFrameId="frame-2"
          fallbackSrc="/fallback.png"
        />
      );
      expect(screen.getByTestId('multi-channel-canvas')).toBeInTheDocument();
      expect(screen.queryByTestId('canvas-image')).toBeNull();
    });

    it('passes the correct frameId to MultiChannelCanvas', () => {
      mockVisibleChannels = ['ch0'];
      render(
        <VideoFrameImage
          isVideoMode={true}
          currentFrameId="frame-42"
          fallbackSrc="/fallback.png"
        />
      );
      const canvas = screen.getByTestId('multi-channel-canvas');
      expect(canvas).toHaveAttribute('data-frame-id', 'frame-42');
    });

    it('passes visibleChannels to MultiChannelCanvas', () => {
      mockVisibleChannels = ['ch_irm', 'ch_dapi'];
      render(
        <VideoFrameImage
          isVideoMode={true}
          currentFrameId="frame-1"
          fallbackSrc="/fallback.png"
        />
      );
      expect(multiChannelCalls[0].visibleChannels).toEqual([
        'ch_irm',
        'ch_dapi',
      ]);
    });

    it('passes channelColors to MultiChannelCanvas', () => {
      mockVisibleChannels = ['ch0'];
      mockChannelColors = { ch0: '#ff0000' };
      render(
        <VideoFrameImage
          isVideoMode={true}
          currentFrameId="frame-1"
          fallbackSrc="/fallback.png"
        />
      );
      expect(multiChannelCalls[0].channelColors).toEqual({ ch0: '#ff0000' });
    });

    it('does NOT render MultiChannelCanvas when currentFrameId is null even with visibleChannels', () => {
      mockVisibleChannels = ['ch0'];
      render(
        <VideoFrameImage
          isVideoMode={true}
          currentFrameId={null}
          fallbackSrc="/fallback.png"
        />
      );
      expect(screen.queryByTestId('multi-channel-canvas')).toBeNull();
    });
  });
});
