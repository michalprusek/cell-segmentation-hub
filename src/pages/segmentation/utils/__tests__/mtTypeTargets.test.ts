import { describe, it, expect } from 'vitest';
import { resolveTargetTrackIds } from '../mtTypeTargets';

const polys = [
  { id: 'a', trackId: 't1' },
  { id: 'b', trackId: 't2' },
  { id: 'c', trackId: 't1' }, // same track as 'a'
  { id: 'd', trackId: null }, // untracked
  { id: 'e' }, // no trackId at all
];

describe('resolveTargetTrackIds', () => {
  it('resolves the single right-clicked polygon to its track', () => {
    expect(resolveTargetTrackIds('a', new Set(), polys)).toEqual(['t1']);
  });

  it('ignores a 1-element selection and uses the clicked polygon', () => {
    // A lone selection must not shadow a right-click on a different MT.
    expect(resolveTargetTrackIds('b', new Set(['a']), polys)).toEqual(['t2']);
  });

  it('acts on the whole selection once it has ≥2 members', () => {
    const out = resolveTargetTrackIds('a', new Set(['a', 'b']), polys);
    expect(out.sort()).toEqual(['t1', 't2']);
  });

  it('dedupes tracks when several selected polygons share one', () => {
    expect(resolveTargetTrackIds('a', new Set(['a', 'c']), polys)).toEqual([
      't1',
    ]);
  });

  it('returns [] for an untracked polygon (caller aborts with a toast)', () => {
    expect(resolveTargetTrackIds('d', new Set(), polys)).toEqual([]);
    expect(resolveTargetTrackIds('e', new Set(), polys)).toEqual([]);
  });

  it('drops untracked members from a multi-selection', () => {
    const out = resolveTargetTrackIds('a', new Set(['a', 'd', 'e']), polys);
    expect(out).toEqual(['t1']);
  });

  it('returns [] when the clicked id is not among the polygons', () => {
    expect(resolveTargetTrackIds('ghost', new Set(), polys)).toEqual([]);
  });
});
