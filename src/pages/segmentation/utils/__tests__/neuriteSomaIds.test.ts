/**
 * Reading a neurite's soma assignment across the `somaId` → `somaIds` change.
 *
 * The migration lives in ONE function on purpose: the colouring, the context
 * menu, the click handler and the exporter all read through it, and a second
 * implementation is how a frame written before 2026-09-08 would start showing
 * as unassigned in one place and assigned in another.
 */
import { describe, it, expect } from 'vitest';
import { neuriteSomaIds, isUnassignedNeurite } from '../neuriteSomaIds';

describe('neuriteSomaIds', () => {
  it('reads the modern list', () => {
    expect(neuriteSomaIds({ somaIds: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('reads a legacy single somaId as one entry', () => {
    expect(neuriteSomaIds({ somaId: 'legacy' })).toEqual(['legacy']);
  });

  it('prefers the list when a row somehow carries both', () => {
    // Only `somaIds` is written now, so a row with both is one the migration
    // has already touched; the legacy field is then a stale leftover.
    expect(neuriteSomaIds({ somaId: 'old', somaIds: ['new'] })).toEqual([
      'new',
    ]);
  });

  it('is empty for an unassigned neurite', () => {
    expect(neuriteSomaIds({})).toEqual([]);
    expect(neuriteSomaIds(null)).toEqual([]);
  });

  it('drops malformed entries rather than yielding an undefined colour key', () => {
    const dirty = { somaIds: ['a', '', null, 7, 'b'] as unknown as string[] };
    expect(neuriteSomaIds(dirty)).toEqual(['a', 'b']);
  });

  it('returns a fresh array the caller may mutate', () => {
    const poly = { somaIds: ['a'] };
    const out = neuriteSomaIds(poly);
    out.push('b');
    expect(poly.somaIds).toEqual(['a']);
  });
});

describe('isUnassignedNeurite', () => {
  it('is true only for a neurite with no soma at all', () => {
    expect(isUnassignedNeurite({ partClass: 'neurite' })).toBe(true);
    expect(isUnassignedNeurite({ partClass: 'neurite', somaIds: ['s1'] })).toBe(
      false
    );
    // Legacy rows must not count as unassigned — that would send the user
    // hunting for cells the pipeline actually did resolve.
    expect(isUnassignedNeurite({ partClass: 'neurite', somaId: 's1' })).toBe(
      false
    );
    // A soma is never "unassigned"; it is what others are assigned TO.
    expect(isUnassignedNeurite({ partClass: 'soma' })).toBe(false);
  });
});
