/**
 * Colouring a neurite by the cell it belongs to.
 *
 * The property that matters is the PAIRING: a soma and its neurites must
 * resolve to the same colour, and two different cells must not collide by
 * construction. Everything else here is about what happens when the assignment
 * is absent, which is a measurement rather than a gap.
 */

import { describe, it, expect } from 'vitest';
import {
  somaAssignmentColor,
  isUnassignedNeurite,
} from '../somaAssignmentColor';
import { colorFromInstanceId } from '../instanceColors';

const soma = (id: string) => ({ id, partClass: 'soma' as const });
const neurite = (id: string, somaId?: string) => ({
  id,
  partClass: 'neurite' as const,
  ...(somaId ? { somaId } : {}),
});

describe('somaAssignmentColor', () => {
  it('gives a soma and its neurites the SAME colour', () => {
    // The whole mechanism. Both sides resolve through one hash, so there is no
    // palette to keep in sync and a cell cannot drift colour between renders.
    const cell = somaAssignmentColor(soma('polygon_7'));
    expect(somaAssignmentColor(neurite('polygon_9', 'polygon_7'))).toBe(cell);
    expect(somaAssignmentColor(neurite('polygon_11', 'polygon_7'))).toBe(cell);
  });

  it('gives two different cells different colours', () => {
    expect(somaAssignmentColor(soma('polygon_1'))).not.toBe(
      somaAssignmentColor(soma('polygon_2'))
    );
  });

  it('colours a neurite by its soma, NOT by its own id', () => {
    // The trap: falling back to the polygon's own id would give every neurite
    // a colour, and an unassigned one would be indistinguishable from an
    // assigned one.
    const n = neurite('polygon_9', 'polygon_7');
    expect(somaAssignmentColor(n)).toBe(colorFromInstanceId('polygon_7'));
    expect(somaAssignmentColor(n)).not.toBe(colorFromInstanceId('polygon_9'));
  });

  it('returns null for an unassigned neurite', () => {
    // No colour is better than a colour claiming an assignment the data does
    // not have — the caller falls back to the class colouring.
    expect(somaAssignmentColor(neurite('polygon_9'))).toBeNull();
  });

  it('returns null for geometry that is not part of an assignment', () => {
    expect(
      somaAssignmentColor({ id: 'p', partClass: 'head', somaId: undefined })
    ).toBeNull();
    expect(somaAssignmentColor({ id: 'p' })).toBeNull();
  });

  it('returns null for a soma with no id rather than a neutral grey', () => {
    // `colorFromInstanceId('')` answers grey, which would read as a real
    // assignment to a cell nobody can select.
    expect(somaAssignmentColor({ id: '', partClass: 'soma' })).toBeNull();
  });

  it('shifts on selection, and the pairing survives it', () => {
    const a = somaAssignmentColor(soma('polygon_7'));
    const b = somaAssignmentColor(soma('polygon_7'), { selected: true });
    expect(b).not.toBe(a);
    expect(
      somaAssignmentColor(neurite('n', 'polygon_7'), { selected: true })
    ).toBe(b);
  });
});

describe('isUnassignedNeurite', () => {
  it('is true only for a neurite with no soma', () => {
    expect(isUnassignedNeurite(neurite('n'))).toBe(true);
    expect(isUnassignedNeurite(neurite('n', 's'))).toBe(false);
    // A soma is never "unassigned" — it IS the thing others are assigned to.
    expect(isUnassignedNeurite(soma('s'))).toBe(false);
  });

  it('is false for another project type entirely', () => {
    expect(isUnassignedNeurite({ partClass: 'tail' })).toBe(false);
    expect(isUnassignedNeurite({})).toBe(false);
  });
});
