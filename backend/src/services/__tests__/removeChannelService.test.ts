/**
 * `applyChannelRemoval` — the channels-JSON half of "Remove channel".
 *
 * Every rule here is one the ADD path established and this one has to undo
 * exactly: coverage is `frameIds ?? every frame`, an omitted `frameIds` means
 * full coverage, and the client's static anchor is `frameIds[0]`. Getting the
 * coverage arithmetic wrong does not throw — it leaves the editor asking for
 * PNGs that are gone, or hiding PNGs that are still there.
 */

import { describe, it, expect } from 'vitest';
import { applyChannelRemoval } from '../removeChannelService';
import type { ChannelMeta } from '../video/types';

const ALL = ['f0', 'f1', 'f2', 'f3'];
/** The pure function needs frameINDEX too: `sparseFill` is keyed by index, and
 *  it — not the id-keyed mirror — is the authoritative map. */
const FRAMES = ALL.map((id, frameIndex) => ({ id, frameIndex }));

function ch(over: Partial<ChannelMeta> = {}): ChannelMeta {
  return {
    name: 'extra',
    type: 'fluorescent',
    isSegmentationSource: false,
    ...over,
  };
}

describe('applyChannelRemoval', () => {
  it('drops the channel entirely when every covered frame is removed', () => {
    const out = applyChannelRemoval([ch()], FRAMES, ALL, 'extra');
    expect(out.channels).toEqual([]);
    expect(out.removedFrameIds).toEqual(ALL);
    expect(out.fullyRemoved).toBe(true);
  });

  it('narrows a full-coverage channel to the frames left over', () => {
    const out = applyChannelRemoval([ch()], FRAMES, ['f1'], 'extra');
    expect(out.channels).toHaveLength(1);
    expect(out.channels[0].frameIds).toEqual(['f0', 'f2', 'f3']);
    expect(out.removedFrameIds).toEqual(['f1']);
    expect(out.fullyRemoved).toBe(false);
  });

  it('narrows an already-partial channel within its own coverage', () => {
    const out = applyChannelRemoval(
      [ch({ frameIds: ['f1', 'f2'] })],
      FRAMES,
      ['f2'],
      'extra'
    );
    expect(out.channels[0].frameIds).toEqual(['f1']);
    // f3 was never covered, so removing it is not this channel's business.
    expect(out.removedFrameIds).toEqual(['f2']);
  });

  it('deletes no file for a frame the channel never covered', () => {
    const out = applyChannelRemoval(
      [ch({ frameIds: ['f0'] })],
      FRAMES,
      ['f2', 'f3'],
      'extra'
    );
    expect(out.removedFrameIds).toEqual([]);
    expect(out.channels[0].frameIds).toEqual(['f0']);
    expect(out.changed).toBe(false);
  });

  it('leaves other channels untouched', () => {
    const out = applyChannelRemoval(
      [ch({ name: 'keep' }), ch({ name: 'extra' })],
      FRAMES,
      ALL,
      'extra'
    );
    expect(out.channels.map(c => c.name)).toEqual(['keep']);
  });

  it('is a no-op for a channel the container does not have', () => {
    const before = [ch({ name: 'keep' })];
    const out = applyChannelRemoval(before, FRAMES, ALL, 'absent');
    expect(out.channels).toEqual(before);
    expect(out.changed).toBe(false);
  });

  it('keeps frameIds omitted when the removal touched no covered frame', () => {
    // Full coverage stays full: writing an explicit list here would turn a
    // compact "covers everything" channel into an enumerated one for nothing,
    // and — because the static anchor is frameIds[0] — would switch a static
    // channel from "no de-duplication" to "de-duplicate onto f0".
    const out = applyChannelRemoval([ch()], FRAMES, [], 'extra');
    expect(out.channels[0].frameIds).toBeUndefined();
    expect(out.changed).toBe(false);
  });

  it('reports clearing the segmentation source when that channel goes', () => {
    const out = applyChannelRemoval(
      [ch({ isSegmentationSource: true })],
      FRAMES,
      ALL,
      'extra'
    );
    expect(out.segmentationSourceCleared).toBe(true);
  });

  it('does not report a cleared source while the channel still covers frames', () => {
    const out = applyChannelRemoval(
      [ch({ isSegmentationSource: true })],
      FRAMES,
      ['f0'],
      'extra'
    );
    expect(out.segmentationSourceCleared).toBe(false);
  });

  describe('static channels', () => {
    it('leaves the anchor on a surviving frame', () => {
      // The client's anchor is `frameIds[0]`. Removing f0 must move it, or
      // every remaining frame fetches a URL whose PNG was just deleted.
      const out = applyChannelRemoval(
        [ch({ staticSource: true })],
        FRAMES,
        ['f0'],
        'extra'
      );
      expect(out.channels[0].frameIds?.[0]).toBe('f1');
    });

    it('prunes staticShifts for frames that are gone', () => {
      const out = applyChannelRemoval(
        [
          ch({
            staticSource: true,
            staticShifts: { f0: [1, 1], f1: [2, 2], f2: [3, 3], f3: [4, 4] },
          }),
        ],
        FRAMES,
        ['f0', 'f2'],
        'extra'
      );
      expect(out.channels[0].staticShifts).toEqual({ f1: [2, 2], f3: [4, 4] });
    });
  });

  describe('sparse channels', () => {
    it('decides from sparseFill, the authoritative index-keyed map', () => {
      // `sparseFillFrameIds` is documented as "PURELY A RENDERING OPTIMISATION
      // ... nothing on the correctness path may read it", and it may be absent
      // or PARTIAL while `sparseFill` is complete. Deciding coverage from the
      // mirror silently keeps a gap frame whose anchor's PNG was just deleted,
      // which is a 404 per gap — the exact failure this logic exists to avoid.
      const out = applyChannelRemoval(
        [
          ch({
            sparseSource: true,
            frameIds: ALL,
            // index 1 and 2 are gaps served from index 0. No id-keyed mirror.
            sparseFill: { '1': 0, '2': 0 },
          }),
        ],
        FRAMES,
        ['f0'],
        'extra'
      );
      expect(out.sparseDependentsDropped).toEqual(['f1', 'f2']);
      expect(out.channels[0].frameIds).toEqual(['f3']);
    });

    it('prunes the index-keyed map too, not only its id-keyed mirror', () => {
      const out = applyChannelRemoval(
        [
          ch({
            sparseSource: true,
            frameIds: ALL,
            sparseFill: { '1': 0, '3': 2 },
            sparseFillFrameIds: { f1: 'f0', f3: 'f2' },
          }),
        ],
        FRAMES,
        ['f2'],
        'extra'
      );
      // f2 removed => f3 (its gap) goes too; f0/f1 survive.
      expect(out.channels[0].frameIds).toEqual(['f0', 'f1']);
      expect(out.channels[0].sparseFill).toEqual({ '1': 0 });
      expect(out.channels[0].sparseFillFrameIds).toEqual({ f1: 'f0' });
    });

    it('drops the gap frames that read from a removed real frame', () => {
      // f1 and f2 hold no acquisition; the backend serves both from f0. Delete
      // f0's PNG and they have no pixels left, so they leave coverage too —
      // otherwise the editor requests them and gets a 404 per frame.
      const out = applyChannelRemoval(
        [
          ch({
            sparseSource: true,
            frameIds: ALL,
            sparseFill: { '1': 0, '2': 0 },
            sparseFillFrameIds: { f1: 'f0', f2: 'f0' },
          }),
        ],
        FRAMES,
        ['f0'],
        'extra'
      );
      expect(out.channels[0].frameIds).toEqual(['f3']);
      expect(out.removedFrameIds).toEqual(['f0']);
      expect(out.sparseDependentsDropped).toEqual(['f1', 'f2']);
    });

    it('keeps gap frames whose real frame survives', () => {
      const out = applyChannelRemoval(
        [
          ch({
            sparseSource: true,
            frameIds: ALL,
            sparseFill: { '1': 0, '3': 2 },
            sparseFillFrameIds: { f1: 'f0', f3: 'f2' },
          }),
        ],
        FRAMES,
        ['f2'],
        'extra'
      );
      expect(out.channels[0].frameIds).toEqual(['f0', 'f1']);
      expect(out.sparseDependentsDropped).toEqual(['f3']);
      expect(out.channels[0].sparseFillFrameIds).toEqual({ f1: 'f0' });
    });
  });
});
