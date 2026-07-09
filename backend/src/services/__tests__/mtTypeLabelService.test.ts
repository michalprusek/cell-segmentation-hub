import { describe, it, expect } from 'vitest';
import {
  sanitizeLabels,
  diffRemovedIds,
  clearMtTypeById,
} from '../mtTypeLabelService';

describe('sanitizeLabels', () => {
  it('keeps valid entries and drops malformed ones', () => {
    const out = sanitizeLabels([
      { id: 'a', name: 'alpha', color: '#ff0000' },
      { id: '', name: 'bad', color: '#000000' }, // empty id dropped
      { id: 'b', name: '', color: '#00ff00' }, // empty name dropped
      { id: 'c', name: 'gamma', color: 'notacolor' }, // bad colour dropped
      'garbage',
      null,
    ]);
    expect(out).toEqual([{ id: 'a', name: 'alpha', color: '#ff0000' }]);
  });

  it('dedupes by id (last wins)', () => {
    const out = sanitizeLabels([
      { id: 'a', name: 'alpha', color: '#111111' },
      { id: 'a', name: 'alpha2', color: '#222222' },
    ]);
    expect(out).toEqual([{ id: 'a', name: 'alpha2', color: '#222222' }]);
  });

  it('dedupes by case-insensitive name (first wins)', () => {
    const out = sanitizeLabels([
      { id: 'a', name: 'Alpha', color: '#111111' },
      { id: 'b', name: 'alpha', color: '#222222' },
    ]);
    expect(out).toEqual([{ id: 'a', name: 'Alpha', color: '#111111' }]);
  });

  it('returns [] for non-array input', () => {
    expect(sanitizeLabels(null)).toEqual([]);
    expect(sanitizeLabels({ id: 'a' })).toEqual([]);
  });

  it('drops entries whose id/name/color are not strings', () => {
    expect(
      sanitizeLabels([
        { id: 42, name: 'x', color: '#000000' }, // non-string id
        { id: 'a', name: 5, color: '#000000' }, // non-string name
        { id: 'b', name: 'y', color: 999 }, // non-string colour
      ])
    ).toEqual([]);
  });
});

describe('diffRemovedIds', () => {
  it('returns ids present in prev but absent in next', () => {
    expect(
      diffRemovedIds(
        [
          { id: 'a', name: 'x', color: '#000000' },
          { id: 'b', name: 'y', color: '#000000' },
        ],
        [{ id: 'a', name: 'x', color: '#000000' }]
      )
    ).toEqual(['b']);
  });
});

describe('clearMtTypeById', () => {
  it('clears mtType where it matches and counts changes', () => {
    const polys = [
      { id: '1', mtType: 'lbl', trackId: 't1' },
      { id: '2', mtType: 'other' },
      { id: '3' },
    ];
    const { polygons, changed } = clearMtTypeById(polys, 'lbl');
    expect(changed).toBe(1);
    expect((polygons[0] as Record<string, unknown>).mtType).toBeUndefined();
    expect((polygons[1] as Record<string, unknown>).mtType).toBe('other');
  });

  it('does not mutate input', () => {
    const polys = [{ id: '1', mtType: 'lbl' }];
    clearMtTypeById(polys, 'lbl');
    expect(polys[0].mtType).toBe('lbl');
  });
});
