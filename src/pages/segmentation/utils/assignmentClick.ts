import type { Polygon } from '@/lib/segmentation';

/** What a click on the canvas means while the assignment view is open. */
export type AssignmentClickAction =
  { kind: 'reassign'; neuriteId: string; somaId: string } | { kind: 'select' };

/**
 * Decide whether a click reassigns a neurite or just selects.
 *
 * The gesture is: with a neurite selected, click a soma. It exists ONLY while
 * the by-cell colouring is on, and that is deliberate — the colouring toggle
 * IS the mode. A dedicated `EditMode` would have been the obvious alternative
 * and is the wrong one here: the editor's create modes are gated per project
 * type, `cycleEditMode` walks the enum with Tab, and adding a mode that only
 * one project type may enter puts a new hole in the gate that was just closed.
 *
 * Selecting a soma normally is still possible — a soma click only reassigns
 * when a NEURITE is selected, and the reassignment selects the soma afterwards,
 * so the very next click behaves ordinarily. There is no state to get stuck in.
 *
 * Clicking the soma a neurite is ALREADY assigned to selects rather than
 * reassigns: it changes nothing, and reporting a change would mark the frame
 * dirty and invite a pointless save.
 */
export function assignmentClickAction(
  selected: Pick<Polygon, 'id' | 'partClass' | 'somaId'> | null | undefined,
  clicked: Pick<Polygon, 'id' | 'partClass'> | null | undefined,
  colorBySoma: boolean
): AssignmentClickAction {
  if (
    !colorBySoma ||
    !selected ||
    !clicked ||
    selected.partClass !== 'neurite' ||
    clicked.partClass !== 'soma' ||
    !selected.id ||
    !clicked.id ||
    selected.somaId === clicked.id
  ) {
    return { kind: 'select' };
  }
  return { kind: 'reassign', neuriteId: selected.id, somaId: clicked.id };
}
