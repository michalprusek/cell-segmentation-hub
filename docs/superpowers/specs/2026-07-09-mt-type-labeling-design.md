# Microtubule type (class) labeling — design

- **Date:** 2026-07-09
- **Status:** Approved design (pending user review of this doc)
- **Branch:** `feat/mt-type-labeling`
- **Project types affected:** `microtubules` only (strictly gated)

---

## 1. Summary & motivation

Microtubule (MT) researchers want to **label individual microtubules with a
"tubulin code" class** (e.g. distinguish tubulin isotypes / PTMs) directly in
the segmentation editor, then have that class flow into every export.

Labels are **user-defined**: the first time a class is assigned, the user types
a name and picks a colour, which creates the label; afterwards they just pick
the existing label. A **"+"** affordance adds a new label. Assignment can be
done **in bulk for all selected MTs**, and lives in the **right-click context
menu**. A microtubule is tracked across frames, so a class is a physical
property of the whole **track** — assigning it propagates to every frame.

The class must be projected into:

- **Exported metrics** — a new column.
- **All annotation formats** — chiefly **ImageJ** (the label must genuinely act
  as the ImageJ class), plus COCO / YOLO categories.

The side panel gains a **toggle to switch the canvas between semantic (label)
colouring and instance colouring**.

---

## 2. Recorded decisions (from brainstorming Q&A)

| #   | Decision                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Labels are user-defined.** Created on first assignment (name + colour) via a "+" affordance; thereafter picked from the list.                                                                                        |
| D2  | **Scope = whole track.** Assigning a type sets it on every polyline sharing the `trackId` across all frames of the video.                                                                                              |
| D3  | **ImageJ: the label IS the class.** Encoded as ROI _name_ + ROI _stroke colour_ (= the label colour) + ROI _group number_ (class index — included only if the group byte offset verifies against ImageJ `RoiDecoder`). |
| D4  | **Canvas colouring is a side-panel toggle:** _Instance_ (current per-`trackId` hash) ↔ _Semantic_ (the label colour; untyped MTs → neutral gray).                                                                     |
| D5  | **Label management in v1 includes rename and delete**, not only create.                                                                                                                                                |
| D6  | **Data model:** the polygon stores a stable label **id** (`mtType`); the project stores the palette `[{id,name,colour}]` as the single source of truth for name + colour.                                              |
| D7  | **Bulk apply:** the chosen label applies to the whole MT multi-selection (the panel's `selectedPolygonIds`), reusing the existing "propagate selected" gating.                                                         |

### Why id-based (D6)

Storing the label **name** on each polyline would force a rename to rewrite
`mtType` on every polyline across every frame (600+ on a real ND2 video) — a
heavy, drift-prone write. Storing a stable **id** makes rename an O(1) palette
edit. Every display and export path resolves `id → {name, colour}` through the
palette (which the editor and exporters already load). A dangling / unknown id
(e.g. after a delete that didn't fully clean up) resolves to _untyped_.

---

## 3. User-facing behaviour

### 3.1 Assigning a type (right-click)

1. User right-clicks a microtubule polyline in the editor.
2. The context menu (MT-only) shows a **"Set type"** submenu:
   - **Existing labels**, each with its colour swatch; the current one is
     check-marked.
   - **"None"** — clears the type.
   - **"+ New label…"** — opens a small dialog with a name input
     (uniqueness-validated) and a colour picker. On confirm, the label is
     created **and** immediately assigned.
3. If a **multi-selection** of ≥2 MTs is active (panel checkboxes /
   Shift-click), the chosen label applies to **all selected tracks**.
4. Assignment propagates to every frame of each affected track (D2).

### 3.2 Managing labels (D5)

- **Rename** a label → palette entry's `name` changes; no polyline rewrite
  (ids are stable). Every display/export picks up the new name on next read.
- **Delete** a label → the palette entry is removed **and** `mtType` is nulled
  on all polylines referencing that id across the project's MT videos (so no
  dangling references remain).

Management UI lives in the side panel (see 3.3), e.g. an edit / trash affordance
per label row plus the "+" to add.

### 3.3 Side-panel colouring toggle (D4)

A segmented control in the MT side panel: **Colour by: [ Instance | Label ]**.

- **Instance** (default): existing per-`trackId` hash colours — each MT its own
  stable colour across frames.
- **Label** (semantic): each MT drawn in its label's colour; **untyped** MTs
  drawn neutral gray so they read as "not yet classified".

The toggle is a **view preference** (persisted in `localStorage`, like other
editor view prefs). It does not change stored data.

---

## 4. Data model

### 4.1 Per-polygon field

Add `mtType?: string` (the label **id**) to the polygon contracts:

- **Backend validator SSOT** — one entry in `OPTIONAL_POLYGON_FIELDS`
  (`backend/src/utils/polygonValidation.ts`), coerced with
  `coerceNonEmptyString`. This is the single admit-point for untrusted ML → DB
  → editor round-trips.
- **Backend types** — `Polygon` in `polygonValidation.ts`; `SegmentationPolygon`
  interfaces in `backend/src/services/segmentationService.ts`.
- **Frontend types** — `Polygon` in `src/lib/segmentation.ts`;
  `SegmentationPolygon` in `src/lib/api.ts`.
- **No change** needed in `transformSegmentationPolygons.ts` (it already spreads
  every wire field through unchanged).

`mtType` is **distinct** from the existing `partClass` (a constrained
sperm/spheroid enum) and `class` (`'microtubule'`, set by the ML model and used
to identify MT rows) — neither is overloaded.

### 4.2 Per-project palette (SSOT for name + colour)

Add `mtTypeLabels Json?` to `Project` (Prisma), shaped:

```jsonc
[{ "id": "mt_type_<short>", "name": "alpha-tubulin", "color": "#e11d48" }]
```

Mirrors the existing `channels Json?` pattern on `Image`. Migration is a single
nullable column; on production it is applied via idempotent SQL
(`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) rather than a blind
`migrate deploy` (per the prod migration-drift caution).

---

## 5. API

### 5.1 Palette CRUD (project-scoped, MT projects)

- `GET  /api/projects/:id/mt-type-labels` → `{ labels: MTTypeLabel[] }`.
- `PUT  /api/projects/:id/mt-type-labels` — upsert the full array (handles
  create + rename + reorder; ids stable → no polyline rewrite).
- `DELETE /api/projects/:id/mt-type-labels/:labelId` — remove the entry **and**
  null `mtType` on referencing polylines across the project's MT videos.

### 5.2 Assign type to track(s)

- `PATCH /api/segmentation/videos/:videoId/tracks/type`
  body `{ trackIds: string[], mtType: string | null }`
  → new service `setTrackTypeAcrossVideo(videoId, trackIds, mtType)` sets
  `mtType` on every polyline carrying those `trackId`s across **all frames**;
  `null` clears it.

Modeled on the existing `deleteTrackAcrossVideo` /
`propagateTrackGeometryForward` (routes in `segmentationRoutes.ts`,
controller in `segmentationController.ts`).

---

## 6. Frontend components

| Component                                                 | Change                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context-menu/PolygonContextMenu.tsx`                     | New MT-gated **"Set type"** submenu (labels list + None + "+ New label…"). Applies to the multi-selection when ≥2 selected. New props: `mtTypeLabels`, `currentMtType`, `onChangeMtType(labelId\|null)`, `onCreateMtLabel(name,color)`. |
| New: `MtTypeLabelDialog.tsx`                              | Name + colour-picker dialog for create / rename.                                                                                                                                                                                        |
| `MicrotubuleInstancePanel.tsx`                            | Colour-by toggle (Instance/Label); per-row label swatch + name; label-management affordances (edit/delete).                                                                                                                             |
| `hooks/usePolygonHandlers.ts`                             | `handleChangeMtType` (single + bulk over the selection) calling the track-type endpoint; `handleCreate/Rename/DeleteMtLabel` calling palette CRUD.                                                                                      |
| `SegmentationEditor.tsx` / `SegmentationEditorLayout.tsx` | Load palette into editor state; thread new props/handlers down; own the `mtColorMode` view state.                                                                                                                                       |
| `canvas/CanvasPolygon.tsx` + `utils/instanceColors.ts`    | Colour resolver takes `mtColorMode` + palette: semantic → label colour (untyped → neutral gray); instance → existing `trackId` hash. Update the `React.memo` comparator for the new inputs.                                             |

`★` **memo comparator** — `CanvasPolygon` is `React.memo` with a custom
comparator; every new prop that affects rendering (colour mode, resolved
colour, `mtType`) must be added to it or the polyline won't re-colour on change.

---

## 7. Export projection

### 7.1 Metrics (`backend/src/services/export/mtMetricsExporter.ts`)

- Add `mtType` (resolved **name**) to `MTMetricsRow` and to `CSV_HEADERS`
  (the CSV / XLSX / JSON writers all derive from that one header list).
- The exporter loads the project palette to resolve `id → name`.

### 7.2 ImageJ (`imagejRoiEncoder.ts` + `imagejColor.ts`) — D3

The label acts as the ImageJ class three ways:

1. **ROI name** — carries the label name (visible & self-describing in
   RoiManager). Extend `roiLabel()` to prepend the resolved class,
   e.g. `alpha-tubulin__frame_0003__MT2`.
2. **Stroke colour** — the **label's colour** (not the `trackId` hash) when a
   type is assigned; unchanged hash colour when untyped. So exported colour =
   class colour, matching the editor's semantic mode.
3. **ROI group number** — a stable class index (labels sorted → 1..N) written to
   the ImageJ ROI `group` field, enabling "Color-code ROIs by group" and
   group-based selection in ImageJ. **Included only if** the group byte offset
   verifies against ImageJ `RoiDecoder`; otherwise ship (1)+(2) and log the
   omission.

### 7.3 COCO / YOLO

`mtType` (resolved name) maps to the annotation **category** — COCO
`categories[]` / `category_id`, YOLO leading class index — reusing the existing
`category` machinery. Untyped MTs fall back to a default `microtubule` category.

---

## 8. i18n & gating

- All new user-facing strings added to all 6 locales
  (`src/translations/{en,cs,es,de,fr,zh}.ts`); validated with
  `node scripts/check-i18n.cjs`.
- Every new UI surface is gated on `projectType === 'microtubules'`.

---

## 9. Out of scope (v1)

- Applying `mtType` to non-MT project types (sperm keeps its own `partClass`).
- Per-frame (non-track) type assignment.
- ML-side prediction of tubulin class (labels are human-assigned only).
- Colour-mode choice affecting exports other than ImageJ (metrics/COCO/YOLO
  carry the class name regardless of the editor's view toggle).

---

## 10. Verification plan (per CLAUDE.md gates)

- **D (DB):** apply the migration in dev; `\d projects` confirms `mtTypeLabels`
  column; verify JSON round-trips.
- **B (API):** `curl` the palette CRUD + track-type PATCH; confirm `mtType`
  present on the served polygon and cleared on delete.
- **A / F (UI + cross-stack, Playwright on production URL):** right-click an MT
  → create a label (name + colour) → confirm the polyline recolours (semantic
  mode) and the panel shows the label; multi-select several → bulk-assign →
  confirm all recolour; scrub frames → same MT keeps the class (track scope);
  toggle Instance/Label colouring; rename a label → all update; delete a label →
  references cleared. Zero console errors.
- **Export:** run an export → open `metrics.xlsx` and confirm the `mtType`
  column; open `RoiSet.zip` in ImageJ (or cross-check with Python `roifile`) and
  confirm ROI name carries the class, stroke colour = label colour, and (if
  shipped) group number = class index.

---

## 11. Risks

- **Polygon field strip** — `mtType` must be registered in
  `OPTIONAL_POLYGON_FIELDS` or it is silently dropped on the DB→editor path.
- **memo comparator** — missing the new colour inputs in `CanvasPolygon`'s
  comparator means polylines don't re-colour.
- **ImageJ group offset** — must be verified against `RoiDecoder`; treat as
  optional (fall back to name + colour).
- **Palette / polygon drift** — a `mtType` id absent from the palette resolves
  to untyped; delete must null references to avoid accumulating dangling ids.
