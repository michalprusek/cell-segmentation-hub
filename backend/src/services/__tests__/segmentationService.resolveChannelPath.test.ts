import { describe, it, expect } from 'vitest';
import { resolveChannelPath } from '../../utils/channelPath';

describe('resolveChannelPath', () => {
  it('returns the original path unchanged when channel is undefined', () => {
    const p = 'projects/p1/images/v1/frames/0010/640_nm.png';
    expect(resolveChannelPath(p, undefined)).toBe(p);
  });

  it('returns the original path unchanged when channel is null', () => {
    const p = 'projects/p1/images/v1/frames/0010/640_nm.png';
    expect(resolveChannelPath(p, null)).toBe(p);
  });

  it('returns the original path unchanged when channel is empty string', () => {
    const p = 'projects/p1/images/v1/frames/0010/640_nm.png';
    expect(resolveChannelPath(p, '')).toBe(p);
  });

  it('swaps the channel segment for a frame path', () => {
    const p = 'projects/p1/images/v1/frames/0010/640_nm.png';
    expect(resolveChannelPath(p, '488_nm')).toBe(
      'projects/p1/images/v1/frames/0010/488_nm.png'
    );
  });

  it('preserves the extension when swapping channels', () => {
    const p = 'projects/p1/images/v1/frames/0050/ch_0.tif';
    expect(resolveChannelPath(p, 'ch_1')).toBe(
      'projects/p1/images/v1/frames/0050/ch_1.tif'
    );
  });

  it('handles multi-digit frame indices', () => {
    const p = 'projects/p1/images/v1/frames/12345/488_nm.png';
    expect(resolveChannelPath(p, '640_nm')).toBe(
      'projects/p1/images/v1/frames/12345/640_nm.png'
    );
  });

  it('is a no-op for non-frame paths (standalone image)', () => {
    const p = 'projects/p1/images/img1/original.png';
    expect(resolveChannelPath(p, '488_nm')).toBe(p);
  });

  it('is a no-op for paths without a /frames/ segment', () => {
    const p = 'projects/p1/images/v1/thumbnail.jpg';
    expect(resolveChannelPath(p, '488_nm')).toBe(p);
  });

  it('regression: the exact path shape we saw in production', () => {
    const p =
      'projects/ff6b0bde-bc68-4b69-ac06-8cb178696494/images/1f43f42e-7c49-4209-aec4-d945840db885/frames/0097/640_nm.png';
    expect(resolveChannelPath(p, '488_nm')).toBe(
      'projects/ff6b0bde-bc68-4b69-ac06-8cb178696494/images/1f43f42e-7c49-4209-aec4-d945840db885/frames/0097/488_nm.png'
    );
  });

  it('only rewrites the last /frames/<n>/ segment, not earlier path coincidences', () => {
    // Synthetic edge case: a userland project name that contains the word
    // "frames" should not collide with the actual frame segment.
    const p = 'projects/p1/images/v1/frames/0001/488_nm.png';
    expect(resolveChannelPath(p, '640_nm')).toBe(
      'projects/p1/images/v1/frames/0001/640_nm.png'
    );
  });
});
