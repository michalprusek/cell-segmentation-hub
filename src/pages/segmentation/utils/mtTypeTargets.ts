/**
 * The pure half of assigning a microtubule type label: who the action targets,
 * and what the frame looks like afterwards.
 *
 * Three exports, in the order the caller uses them:
 *  - {@link resolveTargetPolygonIds} — the single-vs-multi-selection rule, and
 *    the only place the "a selection counts from 2" threshold lives.
 *  - {@link resolveTargetTrackIds} — those polygons' `trackId`s, deduped. For a
 *    *tracked* MT the type is a whole-track property, so this is what the
 *    cross-frame backend write is given. Polylines without a `trackId` (never
 *    tracked, or hand-drawn) contribute nothing, and an empty result simply
 *    means there is no cross-frame write to do.
 *  - {@link applyMtTypeToPolygons} — the current frame's polygons with the
 *    label stamped on, which is what makes an untracked polyline typeable at
 *    all and what keeps the label in the array a save serialises.
 */
import type { Polygon } from '@/lib/segmentation';

export interface TrackedPolygon extends Pick<Polygon, 'id'> {
  /** Bound to the model, then widened by `| null`: these polygons arrive from
   *  parsed JSON, and the guards below test for a non-empty string rather than
   *  trusting the declaration. Binding to `Polygon` rather than re-declaring
   *  `string` is what keeps this from drifting — it is one of several
   *  structural re-declarations of the polygon shape in this codebase. */
  trackId?: Polygon['trackId'] | null;
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
  mtType?: Polygon['mtType'];
}

/**
 * Stamp `mtType` (or clear it, when `mtType` is null) onto every polygon the
 * action targets — matched by its own id (covers untracked, hand-drawn
 * polylines) OR by belonging to one of the target tracks (keeps a tracked MT's
 * current-frame polyline in lock-step with the cross-frame backend write).
 *
 * Returns the new array plus two counts. `changed` mirrors the backend twin
 * `setPolygonsTrackType`: a target already carrying the requested value is a
 * no-op (not counted, reference preserved), so the caller can skip
 * `updatePolygons` and avoid dirtying the frame / pushing an empty undo entry /
 * tripping the CanvasPolygon memo. `matched` counts target POLYGONS that were
 * found at all (a track with two polylines on this frame counts twice), which
 * is what separates "already had that label" (matched, unchanged —
 * benign) from "the target is not on this frame" (nothing matched — the caller
 * must not report success). The right-clicked id can go stale across an await:
 * a resegment or a background reload replaces the frame's polygons while the
 * type submenu is open. Pure — never mutates its input; only genuinely changed
 * polygons are shallow-copied.
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
): { polygons: T[]; changed: number; matched: number } {
  const next = mtType ?? undefined;
  let changed = 0;
  let matched = 0;
  const updated = polygons.map(p => {
    const isTarget =
      targetPolygonIds.has(p.id) ||
      (typeof p.trackId === 'string' &&
        p.trackId.length > 0 &&
        targetTrackIds.has(p.trackId));
    if (!isTarget) return p;
    matched++;
    const current = typeof p.mtType === 'string' ? p.mtType : undefined;
    if (current === next) return p; // already that value — no-op
    changed++;
    const copy = { ...p };
    if (next === undefined) delete copy.mtType;
    else copy.mtType = next;
    return copy;
  });
  return { polygons: updated, changed, matched };
}
