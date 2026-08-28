import { describe, it, expect, afterEach } from 'vitest';
import {
  setStaticChannelAnchors,
  clearStaticChannelAnchors,
  staticChannelAnchors,
  sparseChannelFills,
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

/** A channel the microscope refreshed every 3rd frame. `sparseFillFrameIds` is
 *  written by `videoUploadService` once the frame rows exist; its keys are the
 *  gaps and its values the real frame each one is served from. */
const SPARSE = {
  name: 'irm',
  sparseSource: true as const,
  sparseFillFrameIds: {
    'frame-1': 'frame-0',
    'frame-2': 'frame-0',
    'frame-4': 'frame-3',
    'frame-5': 'frame-3',
  },
};

describe('staticFrameChannels — sparse channels', () => {
  it('points a gap frame at the real frame it is served from', () => {
    setStaticChannelAnchors([SPARSE, DYNAMIC]);

    expect(resolveFrameId('frame-1', 'irm')).toBe('frame-0');
    expect(resolveFrameId('frame-2', 'irm')).toBe('frame-0');
    expect(resolveFrameId('frame-4', 'irm')).toBe('frame-3');
    expect(resolveFrameId('frame-5', 'irm')).toBe('frame-3');
  });

  it('leaves the REAL frames as themselves', () => {
    // A sparse channel is not a static one: frames 0 and 3 are different
    // pictures and must not collapse onto each other.
    setStaticChannelAnchors([SPARSE]);

    expect(resolveFrameId('frame-0', 'irm')).toBe('frame-0');
    expect(resolveFrameId('frame-3', 'irm')).toBe('frame-3');
    expect(resolveFrameId('frame-6', 'irm')).toBe('frame-6');
  });

  it('collapses each RUN of gaps onto one URL and one decode entry', () => {
    setStaticChannelAnchors([SPARSE]);

    const urls = new Set(
      ['frame-0', 'frame-1', 'frame-2'].map(id => buildFrameImageUrl(id, 'irm'))
    );
    const keys = new Set(
      ['frame-0', 'frame-1', 'frame-2'].map(id => frameCacheKey(id, 'irm'))
    );
    expect(urls.size).toBe(1);
    expect(keys.size).toBe(1);

    // ...but a DIFFERENT one from the next run.
    expect(buildFrameImageUrl('frame-4', 'irm')).not.toBe(
      buildFrameImageUrl('frame-1', 'irm')
    );
  });

  it('leaves other channels of the same container alone', () => {
    setStaticChannelAnchors([SPARSE, DYNAMIC]);
    expect(resolveFrameId('frame-1', '488_nm')).toBe('frame-1');
  });

  it('ignores a sparse channel whose id map never arrived', () => {
    // The backend still serves the right pixels from `sparseFill` (which is
    // index-keyed and never leaves the server), so an absent map costs a
    // duplicate download, not a wrong picture.
    setStaticChannelAnchors([{ name: 'irm', sparseSource: true }]);
    expect(resolveFrameId('frame-1', 'irm')).toBe('frame-1');
  });

  it('is cleared with the static anchors when the editor unmounts', () => {
    setStaticChannelAnchors([SPARSE]);
    clearStaticChannelAnchors();
    expect(resolveFrameId('frame-1', 'irm')).toBe('frame-1');
    expect(sparseChannelFills()).toEqual({});
  });

  it('replaces the registry, so the next video cannot inherit these gaps', () => {
    setStaticChannelAnchors([SPARSE]);
    setStaticChannelAnchors([{ name: 'irm' }]);
    expect(resolveFrameId('frame-1', 'irm')).toBe('frame-1');
  });
});
