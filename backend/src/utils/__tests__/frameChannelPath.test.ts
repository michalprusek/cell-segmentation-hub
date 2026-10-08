import { describe, it, expect } from 'vitest';
import { frameChannelPath } from '../channelPath';

const FRAME = 'projects/p1/images/v1/frames/0007/Channel_1.png';

describe('frameChannelPath', () => {
  it('names the channel file of the same frame', () => {
    expect(frameChannelPath(FRAME, { name: 'Channel_2' })).toBe(
      'projects/p1/images/v1/frames/0007/Channel_2.png'
    );
  });

  it('follows a sparse channel to the frame that stands in for a gap', () => {
    // Frame 7 was not acquired on this channel; frame 5 stands in for it. The
    // gap frame's own file holds the constant fill, not a picture.
    expect(
      frameChannelPath(FRAME, { name: 'IRM', sparseFill: { '7': 5 } })
    ).toBe('projects/p1/images/v1/frames/0005/IRM.png');
  });

  it('keeps the directory padding when it redirects', () => {
    expect(
      frameChannelPath('a/frames/000123/x.png', {
        name: 'c',
        sparseFill: { '123': 9 },
      })
    ).toBe('a/frames/000009/c.png');
  });

  it('leaves a frame that is not a gap on its own plane', () => {
    expect(
      frameChannelPath(FRAME, { name: 'IRM', sparseFill: { '8': 5 } })
    ).toBe('projects/p1/images/v1/frames/0007/IRM.png');
  });

  it('does not turn a corrupt entry into a redirect to frame 0', () => {
    const corrupt = { '7': null } as unknown as Record<string, number>;
    expect(frameChannelPath(FRAME, { name: 'IRM', sparseFill: corrupt })).toBe(
      'projects/p1/images/v1/frames/0007/IRM.png'
    );
    expect(
      frameChannelPath(FRAME, { name: 'IRM', sparseFill: { '7': -1 } })
    ).toBe('projects/p1/images/v1/frames/0007/IRM.png');
  });

  it('answers null for an image that is not a video frame', () => {
    expect(
      frameChannelPath('user/project/originals/still.jpg', { name: 'c' })
    ).toBeNull();
  });
});
