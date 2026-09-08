import type { Polygon } from '@/lib/segmentation';
import { colorFromInstanceId } from './instanceColors';
import { neuriteSomaIds } from './neuriteSomaIds';

/**
 * Colour a neurite by the SOMA it was assigned to, so a cell and its processes
 * read as one object on the canvas.
 *
 * WHY THIS IS NOT THE DEFAULT COLOURING. `neuronClassStyle` paints every
 * neurite cyan and every soma magenta, which answers "what kind of object is
 * this" — the question you have while checking a segmentation. This answers
 * "which cell does it belong to", which is the question you have while
 * checking an ASSIGNMENT, and the two cannot share a stroke. The editor
 * switches between them rather than trying to show both at once.
 *
 * A SOMA IS COLOURED BY ITS OWN id, a neurite by its soma ids, so both resolve
 * through the same hash and a cell matches its processes. That is the whole
 * mechanism: there is no palette to keep in sync and no per-frame state, so
 * the colour of a given cell cannot drift between renders or between frames.
 *
 * Returns null when the polygon is not part of an assignment — an unassigned
 * neurite, or any other project's geometry. The caller then falls back to the
 * class colouring, which is the honest answer: no colour is better than a
 * colour that claims an assignment the data does not have.
 */
export function somaAssignmentColors(
  polygon: Pick<Polygon, 'id' | 'partClass' | 'somaId' | 'somaIds'>,
  { selected = false }: { selected?: boolean } = {}
): string[] {
  if (polygon.partClass === 'soma') {
    return polygon.id ? [colorFromInstanceId(polygon.id, { selected })] : [];
  }
  if (polygon.partClass === 'neurite') {
    // NOT a fallback to the polygon's own id. An unassigned neurite given its
    // own colour would look exactly like an assigned one, and a user scanning
    // for the cells the pipeline could not resolve would find nothing.
    //
    // One entry per assigned soma, in assignment order: a neurite bridging two
    // cells gets both colours and the canvas alternates them along the stroke,
    // which is the only way "shared" is visible without opening a menu.
    return neuriteSomaIds(polygon).map(id =>
      colorFromInstanceId(id, { selected })
    );
  }
  return [];
}

/**
 * The single colour to paint a polygon with, or null.
 *
 * The FIRST of `somaAssignmentColors`. A shared neurite is drawn by painting
 * this one solid and overlaying the rest as interleaved dashes, so this stays
 * the base coat rather than becoming a lie about a one-cell assignment.
 */
export function somaAssignmentColor(
  polygon: Pick<Polygon, 'id' | 'partClass' | 'somaId' | 'somaIds'>,
  { selected = false }: { selected?: boolean } = {}
): string | null {
  return somaAssignmentColors(polygon, { selected })[0] ?? null;
}

/**
 * Whether a neurite is drawn as belonging to no cell.
 *
 * Distinct from "the colouring is switched off": this polygon HAS no
 * assignment, which is a measurement — the pipeline reports the majority owner
 * for every polygon a skeleton branch reaches, so an absent `somaId` means no
 * branch of it was credited to any soma the classifier accepted.
 */
export { isUnassignedNeurite } from './neuriteSomaIds';
