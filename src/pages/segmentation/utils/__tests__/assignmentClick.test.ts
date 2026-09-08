/**
 * When a canvas click changes a neurite's soma assignment instead of selecting.
 *
 * The gesture lives entirely in `EditMode.AssignNeurite`, so most of these
 * assert that it does NOT fire — an assignment the user did not intend rewrites
 * data silently, which is far worse than a click that merely selects.
 *
 * A neurite may belong to SEVERAL somas (2026-09-08); the action therefore
 * carries the complete new list, never a single id, so the caller writes one
 * field and can never half-merge.
 */

import { describe, it, expect } from 'vitest';
import { assignmentClickAction } from '../assignmentClick';

const neurite = (id: string, somaId?: string) => ({
  id,
  partClass: 'neurite' as const,
  ...(somaId ? { somaId } : {}),
});
const soma = (id: string) => ({ id, partClass: 'soma' as const });

describe('assignmentClickAction', () => {
  it('assigns when a neurite is selected and a soma is clicked', () => {
    expect(assignmentClickAction(neurite('n1'), soma('s1'), true)).toEqual({
      kind: 'assign',
      neuriteId: 'n1',
      somaIds: ['s1'],
    });
  });

  it('ADDS a second soma rather than replacing the first', () => {
    // The whole point of the multi-assignment: a neurite bridging two cells is
    // a real state the ML pipeline already reports as `shared`. Asserting the
    // full list catches a replace, which an assertion on the last id would not.
    expect(
      assignmentClickAction(neurite('n1', 's1'), soma('s2'), true)
    ).toEqual({ kind: 'assign', neuriteId: 'n1', somaIds: ['s1', 's2'] });
  });

  it('appends in click order, so the stripe order is stable', () => {
    const three = {
      id: 'n1',
      partClass: 'neurite' as const,
      somaIds: ['s1', 's2'],
    };
    expect(assignmentClickAction(three, soma('s3'), true)).toEqual({
      kind: 'assign',
      neuriteId: 'n1',
      somaIds: ['s1', 's2', 's3'],
    });
  });

  it('REMOVES the soma when it is clicked a second time', () => {
    const both = {
      id: 'n1',
      partClass: 'neurite' as const,
      somaIds: ['s1', 's2'],
    };
    expect(assignmentClickAction(both, soma('s1'), true)).toEqual({
      kind: 'assign',
      neuriteId: 'n1',
      somaIds: ['s2'],
    });
  });

  it('removes the LAST soma down to an empty list', () => {
    // An empty list is "assigned to nothing", which the backend coercer drops
    // to an absent field — the same state as never having been assigned.
    expect(
      assignmentClickAction(neurite('n1', 's1'), soma('s1'), true)
    ).toEqual({ kind: 'assign', neuriteId: 'n1', somaIds: [] });
  });

  it('reads a legacy single somaId as a one-entry list', () => {
    // Rows written before 2026-09-08 carry `somaId`; adding a soma to one must
    // keep the old assignment rather than silently dropping it.
    expect(
      assignmentClickAction(neurite('n1', 'old'), soma('s2'), true)
    ).toEqual({ kind: 'assign', neuriteId: 'n1', somaIds: ['old', 's2'] });
  });

  it('does nothing special while the assign mode is not armed', () => {
    // The MODE is the gate (it used to be the colouring toggle). Outside it a
    // soma click has to behave exactly as it always did.
    expect(assignmentClickAction(neurite('n1'), soma('s1'), false)).toEqual({
      kind: 'select',
    });
  });

  it('does not fire when a SOMA is selected', () => {
    // This is what keeps somas selectable: after a reassignment the soma is
    // selected, so the very next click behaves ordinarily and there is no
    // state to get stuck in.
    expect(assignmentClickAction(soma('s1'), soma('s2'), true)).toEqual({
      kind: 'select',
    });
  });

  it('does not fire when a NEURITE is clicked', () => {
    expect(assignmentClickAction(neurite('n1'), neurite('n2'), true)).toEqual({
      kind: 'select',
    });
  });

  it('does not fire with nothing selected', () => {
    expect(assignmentClickAction(null, soma('s1'), true)).toEqual({
      kind: 'select',
    });
    expect(assignmentClickAction(undefined, soma('s1'), true)).toEqual({
      kind: 'select',
    });
  });

  it("does not fire on another project's geometry", () => {
    expect(
      assignmentClickAction(
        { id: 'a', partClass: 'tail' },
        { id: 'b', partClass: 'head' },
        true
      )
    ).toEqual({ kind: 'select' });
    expect(
      assignmentClickAction(neurite('n1'), { id: 'b', partClass: 'core' }, true)
    ).toEqual({ kind: 'select' });
  });

  it('does not fire when either polygon has no id', () => {
    expect(assignmentClickAction(neurite(''), soma('s1'), true)).toEqual({
      kind: 'select',
    });
    expect(assignmentClickAction(neurite('n1'), soma(''), true)).toEqual({
      kind: 'select',
    });
  });
});
