/**
 * Pure resolution of which microtubule *tracks* a "change type" action targets.
 *
 * The context-menu action can fire on a single polygon (right-clicked) or on a
 * multi-selection. Type is a whole-track property, so we map the affected
 * polygons to their `trackId`s and dedupe. Polylines without a `trackId` (never
 * tracked, or a stray un-tracked draw) contribute nothing — an empty result is
 * the caller's signal to abort with a "no track" toast rather than PATCH with an
 * empty id list.
 */
export interface TrackedPolygon {
  id: string;
  trackId?: string | null;
}

export function resolveTargetTrackIds(
  polygonId: string,
  selectedIds: ReadonlySet<string>,
  polygons: ReadonlyArray<TrackedPolygon>
): string[] {
  // A lone right-click acts on that polygon; a real multi-selection (≥2) acts
  // on the whole selection. A 1-element selection is treated as the single
  // case so right-clicking an unselected MT still works.
  const targetIds = selectedIds.size >= 2 ? [...selectedIds] : [polygonId];
  return Array.from(
    new Set(
      targetIds
        .map(id => polygons.find(p => p.id === id)?.trackId)
        .filter(
          (tid): tid is string => typeof tid === 'string' && tid.length > 0
        )
    )
  );
}
