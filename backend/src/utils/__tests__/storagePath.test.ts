import { describe, it, expect } from 'vitest';
import {
  assertSafeStorageSegment,
  UnsafeStorageSegmentError,
} from '../storagePath';

describe('assertSafeStorageSegment', () => {
  describe('accepts the leaf names this codebase actually produces', () => {
    const valid = [
      '550e8400-e29b-41d4-a716-446655440000', // container / project UUID
      'pos_0000', // multi-position ND2 frames subdir
      'pos_0042',
      '0000', // zero-padded frame index
      'frames',
      'original.tif',
      'original.nd2',
      'thumbnail.jpg',
      'GFP.png', // channel-derived frame file
      'DAPI',
      'Channel 0', // ND2 channel name with a space
      'a..b', // embedded dots are harmless without a separator
    ];

    it.each(valid)('passes %j through unchanged', segment => {
      expect(assertSafeStorageSegment(segment)).toBe(segment);
    });
  });

  describe('rejects path-traversal and malformed segments', () => {
    const invalid: Array<[string, unknown]> = [
      ['empty string', ''],
      ['parent reference', '..'],
      ['current-dir reference', '.'],
      ['posix traversal', '../etc/passwd'],
      ['windows traversal', '..\\windows\\system32'],
      ['nested posix separator', 'a/b'],
      ['nested windows separator', 'a\\b'],
      ['leading slash (absolute)', '/etc/passwd'],
      ['NUL byte', 'original\0.tif'],
      ['non-string', 42],
      ['null', null],
      ['undefined', undefined],
    ];

    it.each(invalid)('throws on %s', (_label, segment) => {
      expect(() =>
        assertSafeStorageSegment(segment as string)
      ).toThrow(UnsafeStorageSegmentError);
    });
  });

  it('includes the supplied label in the error message', () => {
    expect(() => assertSafeStorageSegment('../x', 'containerId')).toThrow(
      /containerId/
    );
  });

  it('defaults the label when none is supplied', () => {
    expect(() => assertSafeStorageSegment('a/b')).toThrow(/path segment/);
  });
});
