/**
 * Pure resolution of which microtubule *tracks* a "change type" action targets.
 *
 * The context-menu action can fire on a single polygon (right-clicked) or on a
 * multi-selection. For a *tracked* MT the type is a whole-track property, so we
 * map the affected polygons to their `trackId`s and dedupe. Polylines without a
 * `trackId` (never tracked, or a hand-drawn draw) contribute nothing — an empty
 * result just means there is no cross-frame write to do; the caller still stamps
 * the label onto the current frame's polygon(s) by id (see
 * {@link resolveTargetPolygonIds} + {@link applyMtTypeToPolygons}).
 */
export interface TrackedPolygon {
  id: string;
  trackId?: string | null;
}

/**
 * Resolve which of the current frame's polygons a "change type" action targets:
 * a real multi-selection (≥2) acts on the whole selection; otherwise just the
 * right-clicked polygon. This is the single home of the single-vs-multi rule —
 * {@link resolveTargetTrackIds} builds on it — so the ≥2 threshold lives in one
 * place. Returns POLYGON ids, so an untracked (hand-drawn) polyline, which
 * contributes no trackId, is still a valid target.
 */
export function resolveTargetPolygonIds(
  polygonId: string,
  selectedIds: ReadonlySet<string>
): Set<string> {
  // A 1-element selection is treated as the single case so right-clicking an
  // unselected MT still acts on the clicked polygon, not the lone selection.
  return selectedIds.size >= 2 ? new Set(selectedIds) : new Set([polygonId]);
}

export function resolveTargetTrackIds(
  polygonId: string,
  selectedIds: ReadonlySet<string>,
  polygons: ReadonlyArray<TrackedPolygon>
): string[] {
  const targetIds = resolveTargetPolygonIds(polygonId, selectedIds);
  return Array.from(
    new Set(
      [...targetIds]
        .map(id => polygons.find(p => p.id === id)?.trackId)
        .filter(
          (tid): tid is string => typeof tid === 'string' && tid.length > 0
        )
    )
  );
}

export interface TypeablePolygon extends TrackedPolygon {
  mtType?: string;
}

/**
 * Stamp `mtType` (or clear it, when `mtType` is null) onto every polygon the
 * action targets — matched by its own id (covers untracked, hand-drawn
 * polylines) OR by belonging to one of the target tracks (keeps a tracked MT's
 * current-frame polyline in lock-step with the cross-frame backend write).
 *
 * Returns the new array plus how many polygons actually changed, mirroring the
 * backend twin `setPolygonsTrackType`: a target already carrying the requested
 * value is a no-op (`changed` not incremented, reference preserved), so the
 * caller can skip `updatePolygons` and avoid dirtying the frame / pushing an
 * empty undo entry / tripping the CanvasPolygon memo. Pure — never mutates its
 * input; only genuinely changed polygons are shallow-copied.
 *
 * This optimistic stamp is what recolours the canvas + panel immediately and —
 * crucially — keeps `mtType` in the polygons a later save serialises, instead of
 * depending on an abortable network reload.
 */
export function applyMtTypeToPolygons<T extends TypeablePolygon>(
  polygons: ReadonlyArray<T>,
  targetPolygonIds: ReadonlySet<string>,
  targetTrackIds: ReadonlySet<string>,
  mtType: string | null
): { polygons: T[]; changed: number } {
  const next = mtType ?? undefined;
  let changed = 0;
  const updated = polygons.map(p => {
    const isTarget =
      targetPolygonIds.has(p.id) ||
      (typeof p.trackId === 'string' &&
        p.trackId.length > 0 &&
        targetTrackIds.has(p.trackId));
    if (!isTarget) return p;
    const current = typeof p.mtType === 'string' ? p.mtType : undefined;
    if (current === next) return p; // already that value — no-op
    changed++;
    const copy = { ...p };
    if (next === undefined) delete copy.mtType;
    else copy.mtType = next;
    return copy;
  });
  return { polygons: updated, changed };
}
