# Design: Join polylines by clicking endpoints in Add-points mode

**Date:** 2026-07-15
**Branch:** `feat/polyline-join-addpoints`
**Status:** Approved (design), pending implementation plan

## Problem

In the segmentation editor, a polyline object (a `Polygon` with
`geometry: 'polyline'`) representing one physical structure is sometimes
split into two fragments — the tracker over-segments a microtubule, or a
sperm flagellum is drawn in two pieces. The user wants to stitch two
fragments into a single polyline directly on the canvas.

The requested interaction: **while in Add-points mode with a polyline
selected, click on an endpoint of another polyline of the same class to
join the two into one.**

## Scope decisions (confirmed with user)

1. **"Same class" = same specific class, gated by project type.**
   - Sperm project: same `partClass` (head↔head, midpiece↔midpiece,
     tail/flagellum↔tail). Different part classes do not join.
   - Microtubule project: same `mtType` label id (untyped joins untyped;
     a typed MT does not join an MT of a different type). `trackId` is
     **not** compared — the whole point is joining two different tracks.
   - Generic project (no dedicated polyline panel): any two polylines
     may join (no class field applies).
2. **Microtubule cross-frame behaviour = current frame only, survivor
   keeps its `trackId`.** The merge writes only to the current frame.
   The selected polyline (A) survives and keeps its identity fields; the
   clicked polyline (B) is removed from the current frame only. Other
   frames are untouched. The resulting cross-frame inconsistency (B still
   exists on other frames) is accepted and expected for a manual,
   per-frame correction.
3. **Gesture = click on the foreign endpoint to join.** With polyline A
   selected in Add-points mode, hovering near a same-class foreign
   polyline B's endpoint highlights it; clicking joins A (from its
   nearer/anchored end) to B. Intermediate points drawn before the join
   form a bridge; a join with no drawn points connects the two endpoints
   directly.

Out of scope (YAGNI): a dedicated Join edit mode / toolbar button /
shortcut; cross-class joining; whole-track cross-frame merge.

## Existing mechanics this builds on

- `EditMode.AddPoints` already requires a `selectedPolygonId`
  (`modeConfig.ts` `REQUIRES_POLYGON_SELECTION`).
- `handleAddPointsClick` (`useAdvancedInteractions.tsx`) is a two-phase
  state machine: phase 1 auto-anchors at the polyline's nearer endpoint
  and seeds `tempPoints`; phase 2 appends intermediate points, and a
  click on a _different vertex of the same polygon_ completes a splice.
- `handleEnterPolyline` (`useEnhancedSegmentationEditor.tsx`) already
  concatenates `points[]` with endpoint-orientation handling — the exact
  geometry a join needs, only appending drawn points instead of a second
  polyline.
- `updatePolygons(next)` is the single mutation entry point: it sets
  state, pushes an undo/redo snapshot, and flags `hasUnsavedChanges`. It
  does **not** auto-save; persistence happens on the explicit Save (or
  the image-switch autosave). One `updatePolygons` call producing the
  merged array minus B is all that is needed.
- Class semantics resolve from `project.type` via
  `polylineSemanticsForProjectType` (`src/lib/polylineSemantics.ts`).
  `useAdvancedInteractions` already receives `projectType` and imports
  this resolver.
- Vertex hover already runs in Add-points mode
  (`handleMouseMove`), currently only against the selected polygon's
  vertices via `vertexSpatialIndex`.

## Architecture

### 1. Pure join utilities — `src/pages/segmentation/utils/polylineJoin.ts` (new)

Isolated, dependency-free, unit-tested. Two exports:

```ts
type Endpoint = 'head' | 'tail'; // head = points[0], tail = points[last]

// Class gate. Both must be polylines with >= 2 points and distinct ids.
// Class comparison keyed on project type (sperm→partClass,
// microtubule→mtType, generic→always allowed).
function canJoinPolylines(
  a: Polygon,
  b: Polygon,
  projectType: string | undefined
): boolean;

// Merge B into A. A survives (keeps id, trackId, mtType, partClass,
// instanceId, name, class, type). Returns A's new `points` only; the
// caller drops B and commits via updatePolygons.
//   merged = orient(A so aEnd is the join side)
//            ++ bridge          (optional intermediate points)
//            ++ orient(B from bEnd)
function joinPolylinePoints(
  a: Polygon,
  aEnd: Endpoint,
  b: Polygon,
  bEnd: Endpoint,
  bridge: Point[]
): Point[];
```

Orientation: if `aEnd === 'tail'` keep A as-is, else reverse A so
`points[0]` becomes last; if `bEnd === 'head'` keep B as-is, else reverse
B so its tail leads. Concatenate `orientedA ++ bridge ++ orientedB`.

A small helper `nearestEndpoint(polygon, point): Endpoint` (squared
distance to `points[0]` vs `points[last]`) is shared by hit-testing and
direct-join anchor selection. It may be co-located here or in
`polygonGeometry.ts`; co-locate here to keep the join concern together.

### 2. Foreign-endpoint hit test in `handleAddPointsClick`

Before the existing phase-1/phase-2 branches, test whether the click
lands within `VERTEX_HIT_RADIUS / zoom` of an endpoint (`points[0]` or
`points[last]`) of any _other_ polyline B for which
`canJoinPolylines(A, B, projectType)` is true. Scan is O(#polylines × 2
endpoints) — cheap even for a busy MT frame.

On a hit:

- Determine A's connecting endpoint `aEnd`:
  - Phase 2 (`isAddingPoints`, `addPointStartVertex` set to an endpoint):
    use that anchor; `bridge = tempPoints`.
  - Phase 1 (not yet adding): `aEnd = nearestEndpoint(A, B's clicked
endpoint)`; `bridge = []` (direct join).
  - Edge case — anchor is a non-endpoint middle vertex (possible via the
    Shift+vertex entry): fall back to `nearestEndpoint(A, clickedPoint)`.
- `bEnd = nearestEndpoint(B, clickPoint)`.
- `merged = joinPolylinePoints(A, aEnd, B, bEnd, bridge)`.
- `updatePolygons(polygons.filter(p => p.id !== B.id).map(p => p.id === A.id ? { ...p, points: merged } : p))`.
- Reset add-points state (`isAddingPoints=false`, `addPointStartVertex=null`,
  `addPointEndVertex=null`, `tempPoints=[]`) and `setEditMode(EditVertices)`,
  mirroring the existing phase-2 completion.

The foreign-endpoint test runs first, so a click that is simultaneously
near A's own vertex and a foreign endpoint prefers the join only when the
foreign endpoint is the closer hit (compare distances; A's own vertices
keep priority on a tie to preserve current splice/extend behaviour).

### 3. Hover highlight — `hoveredJoinTarget`

New editor state `hoveredJoinTarget: { polygonId: string; endpoint: Endpoint } | null`
in `useEnhancedSegmentationEditor.tsx`, mirroring `hoveredVertex`
(exported through the same object).

In `handleMouseMove`, when `editMode === AddPoints` and a polyline is
selected, after the existing selected-polygon vertex hover, scan the two
endpoints of every same-class foreign polyline and set
`hoveredJoinTarget` to the nearest within `VERTEX_HIT_RADIUS / zoom`
(else null). Reuse the sub-pixel move-threshold guard already there.

Rendering: draw a distinct ring marker at the highlighted endpoint. Add
it to `CanvasTemporaryGeometryLayer` (already receives interaction
state + transform), gated on `editMode === AddPoints && hoveredJoinTarget`.
A ring (stroke, no fill) visually differs from the filled
hovered-vertex dot so "this is a join target" reads clearly.

### 4. Mode hint + i18n

`ModeInstructions.tsx` — extend the Add-points instruction text to
mention "click another polyline's endpoint of the same class to join".
Add the new string to all six locale files
(`src/translations/{en,cs,es,de,fr,zh}.ts`); validate with
`node scripts/check-i18n.cjs`.

## Data flow

```
mouse move (AddPoints, A selected)
  → handleMouseMove scans same-class foreign endpoints
  → setHoveredJoinTarget(nearest | null)
  → CanvasTemporaryGeometryLayer draws ring

click (AddPoints)
  → handleAddPointsClick: foreign same-class endpoint hit?
      yes → joinPolylinePoints(A, aEnd, B, bEnd, bridge)
          → updatePolygons(merged array without B)   // history + dirty flag
          → reset state, EditMode.EditVertices
      no  → existing anchor / append / splice behaviour
Save (explicit) → apiClient.updateSegmentationResults(...)  // persists
```

## Error handling / edge cases

- B not a polyline, B === A, B fewer than 2 points, or class mismatch →
  `canJoinPolylines` returns false; click falls through to existing
  behaviour. No error surfaced (a non-joinable click is just a normal
  add-points click).
- A is not an extendable polyline (closed polygon, <2 points) → join is
  never offered; existing closed-polygon splice path is unchanged.
- After merge, the survivor keeps A's `type` (`external`/`internal`) and
  all class fields; B's fields are discarded. This matches the "A
  survives" decision and avoids `PolygonValidator` field-strip surprises
  (only fields already on A persist).
- Undo restores both fragments (single `updatePolygons` snapshot).

## Testing

- `src/pages/segmentation/utils/polylineJoin.test.ts` (new):
  - `canJoinPolylines`: same/different `partClass` (sperm), same/different
    `mtType` (microtubule), untyped↔untyped joins, generic allows any,
    rejects polygon geometry, rejects self, rejects <2 points.
  - `joinPolylinePoints`: all four `aEnd`×`bEnd` orientations produce the
    expected ordered `points`; bridge inserted between; survivor field
    carry-over verified by the caller-side merge (assert points only
    here, fields in an integration-style test if cheap).
  - `nearestEndpoint`: picks head vs tail correctly incl. ties.
- Manual/Playwright verification (per CLAUDE.md gate A/F, cross-stack UI):
  on a microtubule project — select an MT, enter Add-points, hover a
  same-class MT endpoint (ring appears), click (two fragments become one,
  B gone), Save, reload, confirm persisted, 0 console errors. Repeat on a
  sperm project for `partClass` gating.

## Files touched

| File                                                                        | Change                                                                                  |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/pages/segmentation/utils/polylineJoin.ts`                              | new — pure gate + merge helpers                                                         |
| `src/pages/segmentation/utils/polylineJoin.test.ts`                         | new — unit tests                                                                        |
| `src/pages/segmentation/hooks/useAdvancedInteractions.tsx`                  | foreign-endpoint join in `handleAddPointsClick`; join-target hover in `handleMouseMove` |
| `src/pages/segmentation/hooks/useEnhancedSegmentationEditor.tsx`            | `hoveredJoinTarget` state + export                                                      |
| `src/pages/segmentation/components/canvas/CanvasTemporaryGeometryLayer.tsx` | ring marker for the join target                                                         |
| `src/pages/segmentation/components/canvas/ModeInstructions.tsx`             | Add-points hint text                                                                    |
| `src/translations/{en,cs,es,de,fr,zh}.ts`                                   | new hint string ×6                                                                      |
