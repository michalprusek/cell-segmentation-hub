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

/**
 * Resolve which of the current frame's polygons a "change type" action targets:
 * a real multi-selection (≥2) acts on the whole selection; otherwise just the
 * right-clicked polygon. Mirrors {@link resolveTargetTrackIds}'s single-vs-multi
 * rule, but returns POLYGON ids — so an untracked (hand-drawn) polyline, which
 * contributes no trackId, is still a valid target.
 */
export function resolveTargetPolygonIds(
  polygonId: string,
  selectedIds: ReadonlySet<string>
): Set<string> {
  return selectedIds.size >= 2 ? new Set(selectedIds) : new Set([polygonId]);
}

export interface TypeablePolygon {
  id: string;
  trackId?: string | null;
  mtType?: string;
}

/**
 * Return a new array with `mtType` set (or cleared, when `mtType` is null) on
 * every polygon the action targets — matched by its own id (covers untracked,
 * hand-drawn polylines) OR by belonging to one of the target tracks (keeps a
 * tracked MT's current-frame polyline in lock-step with the cross-frame backend
 * write). Pure: untouched polygons keep their reference, changed ones are
 * shallow-copied. This optimistic stamp is what recolours the canvas + panel
 * immediately and — crucially — keeps `mtType` in the polygons a later save
 * serialises, instead of depending on an abortable network reload.
 */
export function applyMtTypeToPolygons<T extends TypeablePolygon>(
  polygons: ReadonlyArray<T>,
  targetPolygonIds: ReadonlySet<string>,
  targetTrackIds: ReadonlySet<string>,
  mtType: string | null
): T[] {
  const next = mtType ?? undefined;
  return polygons.map(p => {
    const isTarget =
      targetPolygonIds.has(p.id) ||
      (typeof p.trackId === 'string' &&
        p.trackId.length > 0 &&
        targetTrackIds.has(p.trackId));
    if (!isTarget) return p;
    const copy = { ...p };
    if (next === undefined) delete copy.mtType;
    else copy.mtType = next;
    return copy;
  });
}
