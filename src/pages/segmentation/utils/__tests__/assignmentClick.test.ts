/**
 * When a canvas click reassigns a neurite instead of selecting.
 *
 * The gesture lives entirely in the assignment view, so most of these assert
 * that it does NOT fire — a reassignment the user did not intend rewrites data
 * silently, which is far worse than a click that merely selects.
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
  it('reassigns when a neurite is selected and a soma is clicked', () => {
    expect(assignmentClickAction(neurite('n1'), soma('s1'), true)).toEqual({
      kind: 'reassign',
      neuriteId: 'n1',
      somaId: 's1',
    });
  });

  it('reassigns away from the current soma', () => {
    expect(
      assignmentClickAction(neurite('n1', 's1'), soma('s2'), true)
    ).toEqual({ kind: 'reassign', neuriteId: 'n1', somaId: 's2' });
  });

  it('only SELECTS when the neurite is already assigned there', () => {
    // Reporting a change would mark the frame dirty and invite a save that
    // writes nothing.
    expect(
      assignmentClickAction(neurite('n1', 's1'), soma('s1'), true)
    ).toEqual({ kind: 'select' });
  });

  it('does nothing special while the assignment view is closed', () => {
    // The colouring toggle IS the mode. Outside it, a soma click has to behave
    // exactly as it always did.
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
