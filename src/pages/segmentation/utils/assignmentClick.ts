import type { Polygon } from '@/lib/segmentation';
import { neuriteSomaIds } from './neuriteSomaIds';

/** What a click on the canvas means while the assignment mode is armed. */
export type AssignmentClickAction =
  { kind: 'assign'; neuriteId: string; somaIds: string[] } | { kind: 'select' };

/**
 * Decide whether a click changes a neurite's soma assignment, or just selects.
 *
 * THE GESTURE: with `EditMode.AssignNeurite` armed, click a neurite, then click
 * a soma. Repeat. Clicking a soma the neurite ALREADY belongs to removes that
 * one assignment, so the same gesture both adds and takes away and there is no
 * second gesture to learn for the common correction.
 *
 * A NEURITE MAY BELONG TO SEVERAL SOMAS. That is not a convenience: the ML
 * pipeline has always reported it (`neurite_owners[].shared` — "the polygon
 * carries cable from more than one cell, which is a real state, not an error")
 * and the old single `somaId` was a lossy projection onto the majority owner.
 * The returned `somaIds` is the COMPLETE new list, so the caller writes one
 * field and never has to merge.
 *
 * Order is preserved on add — a new soma is appended — because the canvas
 * alternates the assigned somas' colours along the stroke and a stable order
 * keeps a shared neurite from reshuffling its stripes on an unrelated edit.
 *
 * Gated on the MODE, not on the colouring toggle. It used to be the toggle
 * ("the colouring IS the mode"), which meant the gesture appeared and vanished
 * with a view setting and could not be found by looking at the toolbar.
 */
export function assignmentClickAction(
  selected:
    Pick<Polygon, 'id' | 'partClass' | 'somaId' | 'somaIds'> | null | undefined,
  clicked: Pick<Polygon, 'id' | 'partClass'> | null | undefined,
  assignModeArmed: boolean
): AssignmentClickAction {
  if (
    !assignModeArmed ||
    !selected ||
    !clicked ||
    selected.partClass !== 'neurite' ||
    clicked.partClass !== 'soma' ||
    !selected.id ||
    !clicked.id
  ) {
    return { kind: 'select' };
  }

  const current = neuriteSomaIds(selected);
  const somaIds = current.includes(clicked.id)
    ? current.filter(id => id !== clicked.id) // second click removes
    : [...current, clicked.id]; // first click adds, at the end

  return { kind: 'assign', neuriteId: selected.id, somaIds };
}
