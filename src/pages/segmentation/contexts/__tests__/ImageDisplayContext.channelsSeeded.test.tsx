/**
 * ImageDisplayProvider — whether the channel list has been applied yet.
 *
 * Until it has, a multi-channel video has no visible channels, and the canvas
 * and prefetcher used to read that as "single-channel video": the <img> path
 * fetched a 4.25 MB `/display` nobody draws, once for the fallback image and
 * once for frame 0, neither of them cancellable. The flag is what lets them
 * tell "not set up yet" from "the user hid every channel", which must keep
 * today's single-channel fallback.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ImageDisplayProvider, useImageDisplay } from '../ImageDisplayContext';

beforeEach(() => {
  vi.mocked(localStorage.getItem).mockImplementation(() => null);
});

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ImageDisplayProvider>{children}</ImageDisplayProvider>
);

describe('channelsSeeded', () => {
  it('starts false and follows the setter', () => {
    const { result } = renderHook(useImageDisplay, { wrapper });
    expect(result.current.channelsSeeded).toBe(false);

    act(() => result.current.setChannelsSeeded(true));
    expect(result.current.channelsSeeded).toBe(true);

    act(() => result.current.setChannelsSeeded(false));
    expect(result.current.channelsSeeded).toBe(false);
  });

  it('is independent of which channels are visible', () => {
    // Hiding every channel is a user choice on a set-up video, not a video that
    // is still loading.
    const { result } = renderHook(useImageDisplay, { wrapper });
    act(() => {
      result.current.setVisibleChannels(['irm']);
      result.current.setChannelsSeeded(true);
    });
    act(() => result.current.toggleChannelVisibility('irm'));

    expect(result.current.visibleChannels).toEqual([]);
    expect(result.current.channelsSeeded).toBe(true);
  });
});
