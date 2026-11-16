# Scribble Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the segmentation editor's delete tool into a scribble eraser: drag, touched shapes fade, release deletes them, `Esc` cancels.

**Architecture:** A pure geometry module tests each new scribble segment against the rendered shapes (Excalidraw's eraser shape, `packages/excalidraw/eraser/index.ts` @ `b42b1a19`). Scribble state lives in `useEnhancedSegmentationEditor`; `useAdvancedInteractions` drives it from mousedown/move/up. The commit deletes untracked shapes in ONE `updatePolygons` call and hands tracked microtubules to `useDeleteTrackScope` for a single "this frame / whole track" question.

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library, SVG overlay, hand-rolled i18n (6 files).

**Spec:** `docs/superpowers/specs/2026-11-16-scribble-delete-design.md`

## Global Constraints

- Hit tolerance: `SCRIBBLE_HIT_TOLERANCE_PX = 6` SCREEN px, converted to image units as `6 / transform.zoom`.
- Pending (faded) opacity: `SCRIBBLE_PENDING_OPACITY = 0.2` (Excalidraw `ELEMENT_READY_TO_ERASE_OPACITY = 20`).
- Trail: `SCRIBBLE_TRAIL_WIDTH_PX = 9` screen px via `screenPx()`, colour `#ef4444` at opacity 0.45, round caps/joins.
- Candidates are EXACTLY the polygons the canvas renders (`visiblePolygons` from `usePolygonRenderProps`), never `editor.polygons`.
- Geometry reuses `@/lib/polygonGeometry` (`isPointInPolygon`, `distanceToSegment`, `lineIntersection`) — no local copies.
- Every new user string exists in all six `src/translations/{en,cs,es,de,fr,zh}.ts`; interpolation is `{{name}}`; `node scripts/check-i18n.cjs` passes.
- `CanvasPolygon` is `React.memo` with a custom comparator: a new prop MUST be compared (CLAUDE.md failure #5).
- Hooks referencing values declared later in `SegmentationEditor.tsx` go through a ref (CLAUDE.md failure #11).
- No `console.log`; ESLint 0 warnings on staged files.

## Review Focus

1. A fast stroke whose two consecutive (rAF-coalesced) points lie on opposite sides of a 3 px polyline, both far from it — must hit it. → Task 1 test `hits a polyline jumped over between two events`.
2. A shape hidden with the eye toggle lies under the stroke — must survive. → Task 3 test `never hits a polygon missing from the candidates`.
3. The pointer leaves the canvas mid-stroke and is released outside — `mouseleave` must not commit; the window `mouseup` must. → Task 3 tests `mouseleave keeps the scribble` / `window mouseup commits`.
4. `Esc` pressed while the button is still held, then released — nothing deleted, delete mode still armed. → Task 3 test `Esc mid-scribble cancels and keeps the mode`.
5. One stroke over tracked MTs AND untracked shapes, then Cancel in the dialog — untracked are gone in one undo step, tracked survive. → Task 2 test `requestDeleteMany returns untracked ids and asks once` + Task 3 test `one scribble is one undo step`.

---

### Task 1: Scribble hit-test geometry

**Files:**

- Create: `src/pages/segmentation/utils/scribbleErase.ts`
- Test: `src/pages/segmentation/utils/__tests__/scribbleErase.test.ts`

**Interfaces:**

- Produces:
  - `export const SCRIBBLE_HIT_TOLERANCE_PX = 6; SCRIBBLE_PENDING_OPACITY = 0.2; SCRIBBLE_TRAIL_WIDTH_PX = 9;`
  - `export interface ScribbleCandidate { id: string; points: Point[]; closed: boolean; bbox: { minX: number; minY: number; maxX: number; maxY: number }; holes: Point[][] }`
  - `export function prepareScribbleCandidates(polygons: Polygon[]): ScribbleCandidate[]` — `closed = geometry !== 'polyline'`; `holes` for an external polygon = points of every `internal` polygon whose `parent_id === id`, plus (fallback) every `internal` polygon WITHOUT `parent_id` whose bbox lies inside this bbox and whose first point is inside this polygon.
  - `export function segmentDistance(a: Point, b: Point, c: Point, d: Point): number` — 0 when `lineIntersection` finds a crossing, else the min of the four `distanceToSegment` values.
  - `export function scribbleSegmentHits(c: ScribbleCandidate, a: Point, b: Point, tol: number): boolean` — bbox prefilter (both expanded by `tol`); closed: `b` inside `points` and inside no hole, OR any edge (including closing edge, and every hole's edges) within `tol`; open: any edge within `tol`; a single-point shape: point distance.
  - `export function collectScribbleHits(cands: ScribbleCandidate[], a: Point, b: Point, tol: number, already: ReadonlySet<string>): string[]` — ids newly hit, skipping `already`.

- [ ] **Step 1: Write the failing tests** — `describe('scribbleErase')`, fixtures in image units, `tol = 6`:
  - `hits a polyline crossed by the segment`: polyline (0,50)-(100,50); segment (50,0)-(50,100) → true.
  - `hits a polyline jumped over between two events`: same polyline; segment (50,-500)-(50,500) → true.
  - `misses a polyline just beyond tolerance`: segment (0,57)-(100,57) → false; (0,55)-(100,55) → true.
  - `a click inside a closed polygon hits it`: square 0..100; a=b=(50,50) → true.
  - `a click in a hole hits the hole, not its parent`: parent square 0..100, internal square 40..60 with `parent_id` = parent → candidates; a=b=(50,50): hole true, parent false.
  - `hole without parent_id is still resolved geometrically`: same, no `parent_id` → parent false.
  - `crossing the parent's outline still hits the parent`: segment (-20,50)-(10,50) → parent true.
  - `tolerance is screen-constant`: helper `tol = SCRIBBLE_HIT_TOLERANCE_PX / zoom`; at zoom 3 a segment 3 image px from the polyline misses (`tol` 2), at zoom 0.5 a segment 10 px away hits (`tol` 12).
  - `collectScribbleHits skips already-hit ids`.
- [ ] **Step 2: Run** `npx vitest run src/pages/segmentation/utils/__tests__/scribbleErase.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the module per the Interfaces block.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Mutation-check** — remove the hole exclusion, then the bbox `tol` expansion, then the `lineIntersection` branch; each must turn a named test red; restore.
- [ ] **Step 6: Commit** `feat(editor): scribble hit-test geometry`.

### Task 2: Ask the track-scope question once for many microtubules

**Files:**

- Modify: `src/pages/segmentation/hooks/useDeleteTrackScope.ts`
- Modify: `src/translations/{en,cs,es,de,fr,zh}.ts` (`segmentation.trackOps.deleteManyFrameSuccess`, `deleteManyTrackSuccess`, both `{{count}}`)
- Test: `src/pages/segmentation/hooks/__tests__/useDeleteTrackScope.test.ts`

**Interfaces:**

- Produces on `DeleteTrackScopeHandlers`:
  - `requestDeleteMany: (polygonIds: string[]) => string[]` — returns the ids it did NOT claim (untracked). If any are tracked: opens the dialog for all of them; if `videoId`/`imageId` missing, toasts `deleteScopeUnavailable` and claims them anyway (nothing deleted).
  - `scopeDialog.count: number` — number of pending microtubules (1 for the single path).
- `pending` becomes `Array<{ polygonId: string; trackId: string }> | null`; `requestDelete` sets a one-element array; `onDeleteFrame` / `onDeleteTrack` run the pending targets sequentially. One target keeps today's toasts exactly; 2+ suppress the per-item success toast and end with ONE `deleteMany*Success` (or `deleteSelectedPartial` with `{done,total}` when some failed).

- [ ] **Step 1: Write the failing tests**:
  - `requestDeleteMany returns untracked ids and asks once`: polygons A (trackId t1), B (t2), C (none) on an MT project → returns `['C']`, `scopeDialog.open` true, `scopeDialog.count` 2.
  - `onDeleteFrame applies to every pending track with one toast`: then `onDeleteFrame()` → `apiClient.deleteTrackFromFrame` called for t1 and t2, `removeLocally` twice with `{silent:true}`, `toast.success` once with `deleteManyFrameSuccess`.
  - `requestDeleteMany on a non-MT project claims nothing`: returns all ids, dialog closed.
  - Existing single-path tests stay green unchanged.
- [ ] **Step 2: Run** `npx vitest run src/pages/segmentation/hooks/__tests__/useDeleteTrackScope.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**; add the two keys in all six translation files.
- [ ] **Step 4: Run** the test file + `node scripts/check-i18n.cjs` — Expected: PASS.
- [ ] **Step 5: Mutation-check** — make `onDeleteFrame` handle only `pending[0]`; the second test must go red; restore.
- [ ] **Step 6: Commit** `feat(editor): one scope question for a bulk microtubule delete`.

### Task 3: Scribble state machine and commit

**Files:**

- Modify: `src/pages/segmentation/hooks/useEnhancedSegmentationEditor.tsx` (state, Esc, commit, reset, new props)
- Modify: `src/pages/segmentation/hooks/useAdvancedInteractions.tsx` (mousedown/move/up, right-click, window listeners)
- Modify: `src/pages/segmentation/SegmentationEditor.tsx` (refs for candidates + `requestDeleteMany`; delete-mode guard in `handleCanvasSelect`)
- Test: `src/pages/segmentation/hooks/__tests__/useAdvancedInteractions.scribble.test.tsx` (new; do NOT mock `@/lib/polygonGeometry`)
- Test: `src/pages/segmentation/hooks/__tests__/useEnhancedSegmentationEditor.scribble.test.tsx` (new)

**Interfaces:**

- Consumes: Task 1 `prepareScribbleCandidates`, `collectScribbleHits`, `SCRIBBLE_HIT_TOLERANCE_PX`; Task 2 `requestDeleteMany`.
- Produces:
  - `export interface ScribbleState { points: Point[]; pendingIds: ReadonlySet<string> }` in `src/pages/segmentation/types.ts`.
  - `useEnhancedSegmentationEditor` new props: `getScribbleCandidates?: () => Polygon[]`, `onRequestDeletePolygons?: (ids: string[]) => string[]`; new return fields `scribble: ScribbleState | null`, `cancelScribble: () => void`.
  - `useAdvancedInteractions` new props: `scribble: ScribbleState | null`, `setScribble: (s: ScribbleState | null) => void`, `getScribbleCandidates: () => Polygon[]`, `onCommitScribble: (ids: string[]) => void`.

Behaviour (one line each, the tests below pin them):

- Left mousedown in `DeletePolygon` (after the Alt/Space pan branch) starts a scribble: candidates prepared ONCE into a ref, start point tested as a zero-length segment. Replaces the no-op `handleDeletePolygonClick` (delete it).
- Mousemove with a scribble appends the point and tests segment (prev, cur); `pendingIds` changes identity only when a new id is hit.
- Mouseup (canvas or window) commits `Array.from(pendingIds)` via `onCommitScribble` and clears the scribble; `mouseleave` with a scribble returns without committing. The two window-listener effects bind while `isDraggingVertex || scribble !== null`.
- Right mousedown during a scribble cancels it and keeps `DeletePolygon`.
- `handleEscape`: scribble active → `setScribble(null)` and return (mode unchanged); else today's behaviour.
- `editMode` or `imageId` change clears the scribble.
- Commit in the editor: `remaining = onRequestDeletePolygons?.(ids) ?? ids`; ONE `updatePolygons` filtering `remaining`; clear `selectedPolygonId` if removed; toast `toast.segmentation.deleted` for 1, new `toast.segmentation.deletedCount` (`{{count}} objects deleted`, six files) for 2+; nothing removed → no history entry, no toast.
- `SegmentationEditor`: `scribbleCandidatesRef.current = visiblePolygons` and `requestDeleteManyRef.current = deleteScope.requestDeleteMany`, read through stable callbacks passed to the editor hook; `handleCanvasSelect` returns early when `editorRef.current.editMode === EditMode.DeletePolygon` (the click after a scribble must not delete or select again).

- [ ] **Step 1: Write the failing interaction tests** (`useAdvancedInteractions.scribble.test.tsx`), drive `handleMouseDown/Move/Up` with `{ button: 0, clientX, clientY, type }`, real geometry, `getCanvasCoordinates` mocked to identity:
  - `drag across two polylines marks both pending and commits both`.
  - `click commits every shape under the point` (two overlapping closed polygons → both ids).
  - `never hits a polygon missing from the candidates`.
  - `mouseleave keeps the scribble`; `window mouseup commits` (dispatch `new MouseEvent('mouseup')` on `window`).
  - `right-click mid-scribble cancels without changing mode` (`setEditMode` not called, `onCommitScribble` not called).
- [ ] **Step 2: Write the failing editor tests** (`useEnhancedSegmentationEditor.scribble.test.tsx`):
  - `Esc mid-scribble cancels and keeps the mode`, then a second Esc → `EditMode.View`.
  - `one scribble is one undo step`: three polygons, commit two → two removed, `handleUndo()` once restores all three.
  - `ids claimed by onRequestDeletePolygons are not deleted locally`.
- [ ] **Step 3: Run** both files — Expected: FAIL.
- [ ] **Step 4: Implement** per the behaviour list; add `toast.segmentation.deletedCount` in six files.
- [ ] **Step 5: Run** both files plus every existing `useAdvancedInteractions.*`, `useEnhancedSegmentationEditor*`, `usePolygonSelection`, `useKeyboardShortcuts*` test — Expected: PASS.
- [ ] **Step 6: Mutation-check** — (a) commit on `mouseleave`; (b) drop the Esc early return; (c) pass `editor.polygons` instead of the candidates; (d) call `updatePolygons` per id. Each must turn a named test red; restore.
- [ ] **Step 7: Commit** `feat(editor): scribble to delete in delete mode`.

### Task 4: Fade and trail rendering

**Files:**

- Modify: `src/pages/segmentation/components/canvas/CanvasPolygon.tsx` (prop `isPendingDelete?: boolean` → `opacity: SCRIBBLE_PENDING_OPACITY` on the root `<g>` style; comparator line)
- Modify: `src/pages/segmentation/components/canvas/CanvasTemporaryGeometryLayer.tsx` (prop `scribblePoints?: Point[]` → one `<polyline>`, `pointerEvents="none"`, `data-testid="scribble-trail"`)
- Modify: `src/pages/segmentation/components/SegmentationEditorLayout.tsx` (pass both)
- Modify: `src/pages/segmentation/components/canvas/CanvasContainer.tsx` (`DeletePolygon` cursor → `crosshair`)
- Test: `src/pages/segmentation/components/canvas/__tests__/CanvasPolygon.test.tsx`, `CanvasTemporaryGeometryLayer.test.tsx`

- [ ] **Step 1: Write the failing tests**:
  - CanvasPolygon `fades while pending delete`: render with `isPendingDelete`, root `g[data-testid=<id>]` has `style.opacity === '0.2'`; `re-renders when isPendingDelete flips` via `rerender` (the comparator test).
  - Temp layer `draws the scribble trail`: `scribblePoints` of 3 points → `[data-testid=scribble-trail]` with 3 coordinate pairs in `points`; absent when `scribblePoints` is empty/undefined.
- [ ] **Step 2: Run** both test files — Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** both files + the whole `src/pages/segmentation` folder — Expected: PASS.
- [ ] **Step 5: Mutation-check** — delete the comparator line; the re-render test must go red; restore.
- [ ] **Step 6: Commit** `feat(editor): fade shapes under the scribble and draw its trail`.

### Task 5: Copy and documentation

**Files:**

- Modify: `src/pages/segmentation/components/canvas/ModeInstructions.tsx` (`clickToDelete` → `scribbleToDelete` + `escCancelsScribble`)
- Modify: `src/translations/{en,cs,es,de,fr,zh}.ts` — the two instruction keys (remove `clickToDelete`), and `docs.…deletePolygon.description` (the one under the `docs:` block, ~line 2112 in `en.ts`)
- Modify: any `docs/**.md` that describes the delete tool (grep `delete mode`, `DeletePolygon`, `Delete polygon`)

EN copy (translate faithfully into the other five):

- `scribbleToDelete`: `Click or draw over shapes — everything the stroke touches is deleted when you release`
- `escCancelsScribble`: `Esc cancels the stroke`
- docs description: `Click or draw over shapes: everything the stroke touches fades and is deleted when you release the button. Esc cancels the stroke. Undo restores the shapes; a tracked microtubule asks whether to remove it from this frame or the whole video first.`

- [ ] **Step 1:** Update the files; `grep -rn clickToDelete src docs` returns nothing.
- [ ] **Step 2: Run** `node scripts/check-i18n.cjs` and the `ModeInstructions` tests — Expected: PASS.
- [ ] **Step 3: Commit** `docs(editor): describe the scribble delete tool`.

### Task 6: Gate, real browser, PR, deploy

- [ ] **Step 1:** `make ci` → all 9 steps green; `npx vitest run` (frontend, full) → all pass.
- [ ] **Step 2:** `make build-service SERVICE=frontend` succeeds.
- [ ] **Step 3:** Push branch, open PR (summary, docs checked list, test plan).
- [ ] **Step 4:** Check prod activity (`~/.claude/spheroseg-prod-activity.sh`); deploy frontend, restart nginx, `curl /` 200.
- [ ] **Step 5:** Playwright on `https://spherosegapp.utia.cas.cz` as the e2e account: spheroid still with a hole + an MT video with tracks. Observe: fade during drag (screenshot mid-drag), delete on release, Esc mid-drag restores, undo restores all in one step, a click deletes, the scope dialog appears once for tracked MTs, hidden shape survives, console has no errors. Tune tolerance/trail only if the screenshots show a mismatch.
- [ ] **Step 6:** Wait for CodeRabbit; address findings; report.
