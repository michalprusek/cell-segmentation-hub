import { describe, it, expect, afterEach } from 'vitest';
import {
  setStaticChannelAnchors,
  clearStaticChannelAnchors,
  staticChannelAnchors,
  resolveFrameId,
} from '../staticFrameChannels';
import { frameCacheKey } from '../decodedFrameCache';
import { buildFrameImageUrl } from '@/pages/segmentation/hooks/segmentationPolygonCache';

/** The production shape this was written for: project 984eac50, a 300-frame
 *  microtubule container whose `irm` channel is one snapshot stamped onto 299
 *  frames, alongside two genuinely per-frame fluorescence channels. */
const FRAME_IDS = Array.from({ length: 19 }, (_, i) => `frame-${i}`);

const IRM = {
  name: 'irm',
  staticSource: true as const,
  frameIds: FRAME_IDS,
};
const DYNAMIC = { name: '488_nm' };

afterEach(() => {
  clearStaticChannelAnchors();
});

describe('staticFrameChannels', () => {
  it('is the failure it was written for: without anchors every frame is its own request', () => {
    // The regression, asserted first. This is what production does today: the
    // prefetch window walks 19 frames and asks for 19 copies of one picture.
    const urls = new Set(FRAME_IDS.map(id => buildFrameImageUrl(id, 'irm')));
    expect(urls.size).toBe(19);
  });

  it('collapses a static channel onto one URL and one cache entry', () => {
    setStaticChannelAnchors([IRM, DYNAMIC]);

    const urls = new Set(FRAME_IDS.map(id => buildFrameImageUrl(id, 'irm')));
    const keys = new Set(FRAME_IDS.map(id => frameCacheKey(id, 'irm')));

    expect(urls.size).toBe(1);
    expect(keys.size).toBe(1);
    // …and it is a real frame of the container, not a synthesised id.
    expect([...urls][0]).toContain('frame-0');
  });

  it('leaves a per-frame channel alone', () => {
    setStaticChannelAnchors([IRM, DYNAMIC]);

    const urls = new Set(FRAME_IDS.map(id => buildFrameImageUrl(id, '488_nm')));
    const keys = new Set(FRAME_IDS.map(id => frameCacheKey(id, '488_nm')));

    expect(urls.size).toBe(19);
    expect(keys.size).toBe(19);
  });

  it('refuses to collapse a static channel that was ALIGNED per frame', () => {
    // `staticShifts` means each copy is the source translated by a known
    // (dy, dx). Sharing one copy would draw the wrong pixels — the case this
    // guard exists for, even though no container in production has one yet.
    setStaticChannelAnchors([
      {
        ...IRM,
        staticShifts: { 'frame-1': [3, -2], 'frame-2': [4, -2] },
      },
    ]);

    expect(staticChannelAnchors()).toEqual({});
    expect(
      new Set(FRAME_IDS.map(id => buildFrameImageUrl(id, 'irm'))).size
    ).toBe(19);
  });

  it('ignores a static channel that covers no frames', () => {
    setStaticChannelAnchors([{ name: 'irm', staticSource: true }]);
    expect(staticChannelAnchors()).toEqual({});
  });

  it('replaces anchors rather than merging them, so another video cannot inherit them', () => {
    setStaticChannelAnchors([IRM]);
    expect(resolveFrameId('frame-7', 'irm')).toBe('frame-0');

    // Opening a different container whose irm is NOT static.
    setStaticChannelAnchors([{ name: 'irm' }]);
    expect(resolveFrameId('frame-7', 'irm')).toBe('frame-7');
  });

  it('passes through the single-channel /display path untouched', () => {
    setStaticChannelAnchors([IRM]);
    expect(resolveFrameId('frame-7', null)).toBe('frame-7');
    expect(buildFrameImageUrl('frame-7', null)).toContain('frame-7');
  });
});
