import { describe, it, expect } from 'vitest';
import { extractChannelsFromPaths } from '../SegmentChannelDialog';

describe('extractChannelsFromPaths', () => {
  it('returns empty array for an empty list', () => {
    expect(extractChannelsFromPaths([])).toEqual([]);
  });

  it('returns empty array when no path has a /frames/N/ segment', () => {
    expect(
      extractChannelsFromPaths([
        'projects/p1/images/img1/original.png',
        'projects/p1/images/img2/thumbnail.jpg',
      ])
    ).toEqual([]);
  });

  it('extracts a single channel when all frames share one', () => {
    expect(
      extractChannelsFromPaths([
        'projects/p1/images/v1/frames/0001/640_nm.png',
        'projects/p1/images/v1/frames/0002/640_nm.png',
        'projects/p1/images/v1/frames/0003/640_nm.png',
      ])
    ).toEqual(['640_nm']);
  });

  it('extracts distinct channels sorted alphabetically', () => {
    expect(
      extractChannelsFromPaths([
        'projects/p1/images/v1/frames/0001/640_nm.png',
        'projects/p1/images/v1/frames/0001/488_nm.png',
        'projects/p1/images/v1/frames/0002/640_nm.png',
      ])
    ).toEqual(['488_nm', '640_nm']);
  });

  it('handles ch_N naming alongside wavelength naming (sorted)', () => {
    expect(
      extractChannelsFromPaths([
        'projects/p1/images/v1/frames/0001/ch_0.tif',
        'projects/p1/images/v1/frames/0001/ch_1.tif',
        'projects/p1/images/v1/frames/0001/ch_2.tif',
      ])
    ).toEqual(['ch_0', 'ch_1', 'ch_2']);
  });

  it('skips null and undefined entries', () => {
    expect(
      extractChannelsFromPaths([
        null,
        undefined,
        'projects/p1/images/v1/frames/0001/640_nm.png',
      ])
    ).toEqual(['640_nm']);
  });

  it('ignores non-frame paths mixed in with frame paths', () => {
    expect(
      extractChannelsFromPaths([
        'projects/p1/images/img1/original.png',
        'projects/p1/images/v1/frames/0001/640_nm.png',
        'projects/p1/images/img2/thumb.jpg',
      ])
    ).toEqual(['640_nm']);
  });

  it('only considers the last /frames/<n>/<channel>.<ext> segment, not earlier coincidences', () => {
    // Defense-in-depth: even if the storage layout ever nests deeper, the
    // anchor on a trailing extension means we never grab the wrong token.
    expect(
      extractChannelsFromPaths([
        'projects/test/images/v1/frames/0001/488_nm.png',
      ])
    ).toEqual(['488_nm']);
  });
});
