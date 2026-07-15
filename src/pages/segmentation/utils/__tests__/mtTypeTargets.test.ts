import { describe, it, expect } from 'vitest';
import {
  resolveTargetTrackIds,
  resolveTargetPolygonIds,
  applyMtTypeToPolygons,
} from '../mtTypeTargets';

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

  it('returns [] for an untracked polygon (no cross-frame write; typed by id)', () => {
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

describe('resolveTargetPolygonIds', () => {
  it('uses the clicked polygon for a lone / empty selection', () => {
    expect([...resolveTargetPolygonIds('b', new Set())]).toEqual(['b']);
    expect([...resolveTargetPolygonIds('b', new Set(['a']))]).toEqual(['b']);
  });

  it('uses the whole selection once it has ≥2 members', () => {
    const out = resolveTargetPolygonIds('a', new Set(['a', 'd']));
    expect([...out].sort()).toEqual(['a', 'd']);
  });
});

describe('applyMtTypeToPolygons', () => {
  const set = (...ids: string[]) => new Set(ids);

  it('types an untracked, hand-drawn polyline by its id (Bug 1 fix)', () => {
    const out = applyMtTypeToPolygons(polys, set('e'), set(), 'brain');
    expect(out.find(p => p.id === 'e')?.mtType).toBe('brain');
    // Everything else is untouched (same reference).
    expect(out.find(p => p.id === 'a')).toBe(polys[0]);
  });

  it('types a tracked MT and its same-track siblings by trackId', () => {
    // Target only polygon 'a', but its trackId t1 also covers sibling 'c'.
    const out = applyMtTypeToPolygons(polys, set('a'), set('t1'), 'hela');
    expect(out.find(p => p.id === 'a')?.mtType).toBe('hela');
    expect(out.find(p => p.id === 'c')?.mtType).toBe('hela');
    expect(out.find(p => p.id === 'b')?.mtType).toBeUndefined();
  });

  it('clears mtType when passed null', () => {
    const typed = [{ id: 'x', trackId: 't9', mtType: 'brain' }];
    const out = applyMtTypeToPolygons(typed, set('x'), set('t9'), null);
    expect('mtType' in out[0]).toBe(false);
  });

  it('does not mutate the input polygons', () => {
    const input = [{ id: 'x', mtType: 'brain' }];
    applyMtTypeToPolygons(input, set('x'), set(), 'hela');
    expect(input[0].mtType).toBe('brain');
  });
});
