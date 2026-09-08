import type { Polygon } from '@/lib/segmentation';

/**
 * Every soma a neurite is assigned to, as a plain array.
 *
 * THE ONLY place the `somaId` → `somaIds` migration is handled. A neurite
 * became assignable to several somas on 2026-09-08; rows written before then
 * carry the single `somaId` instead, and reading either field directly would
 * scatter that fallback across the colouring, the context menu, the click
 * handler and the exporter — where one site would eventually miss it and show
 * an old frame as unassigned.
 *
 * Returns a NEW array every call, so callers may sort or filter it freely; it
 * is never the polygon's own reference.
 */
export function neuriteSomaIds(
  polygon: Pick<Polygon, 'somaId' | 'somaIds'> | null | undefined
): string[] {
  if (!polygon) {
    return [];
  }
  if (Array.isArray(polygon.somaIds)) {
    // Defensive filter: the field crosses the wire and a malformed entry must
    // not become a colour lookup for `undefined`.
    return polygon.somaIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    );
  }
  return typeof polygon.somaId === 'string' && polygon.somaId.length > 0
    ? [polygon.somaId]
    : [];
}

/** Whether a neurite is drawn as belonging to no cell at all. */
export function isUnassignedNeurite(
  polygon: Pick<Polygon, 'partClass' | 'somaId' | 'somaIds'>
): boolean {
  return (
    polygon.partClass === 'neurite' && neuriteSomaIds(polygon).length === 0
  );
}
