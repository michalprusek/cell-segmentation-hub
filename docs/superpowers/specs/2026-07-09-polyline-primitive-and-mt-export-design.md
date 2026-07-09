# Polyline as a generic labeling primitive + MT export / editor improvements

- **Date:** 2026-07-09
- **Status:** Approved design (pre-implementation)
- **Author:** Claude Code (brainstormed with @michalprusek)
- **Implementation:** one spec, delivered as 5 sequenced, independently-verified PRs.

---

## 1. Motivation

Five related requests, all rooted in the same architectural shortcut: the export
and editor code treats a **polyline** (`Polygon` with `geometry: 'polyline'`) as if
it were a sperm annotation, because it infers the polyline's _kind_ from an
instance-ID prefix (`isMicrotubuleInstance` = id starts with `mt_`) and **falls
through to sperm for everything else**. A polyline is actually a generic labeling
primitive used by _both_ sperm and microtubule projects.

| #   | Request                                                                                                                     | Verdict from code trace                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Metrics export `image_id` should be the image **name**, not a UUID.                                                         | The general writers already have `Image Name` + `Image ID (UUID)`; the **MT exporter** (`mtMetricsExporter.ts`, `imageId: fr.id`) shows only the UUID.                                                                                     |
| 2   | Polyline is hardcoded to sperm (sperm-flavored label + "weird" instance id even in non-sperm contexts). Fix systematically. | Kind is guessed from the ID prefix with a sperm fallthrough (`usePolygonRenderProps.ts:54-60`); new polylines default to `sperm_1` (`SegmentationEditor.tsx:300-309`); COCO/JSON emit a hardcoded `sperm` category (`formatConverter.ts`). |
| 3   | ImageJ ROIs should also encode the region the **background** statistics are sampled from.                                   | Background was **global per frame** (`frame − dilate(∪ all MT bands)`, `mt_metrics.py:566-571`) — not what the user expected. Decision: change it to **per-MT local**.                                                                     |
| 4   | Allow **renaming microtubules** in the segmentation editor.                                                                 | Backend persistence + cross-frame `name` mirroring already exist (`segmentationService.ts:157`, `:2146`); the generic rename UI is simply **hidden for MT** (`SegmentationEditorLayout.tsx:568`). FE-only work.                            |
| 5   | ImageJ ROI names should be `<type>_<id>` (HeLa_1, HeLa_2, brain_1…), per-type counter from 1.                               | Current name is `<name>__<type>` (`imagejRoiEncoder.ts:442`).                                                                                                                                                                              |

## 2. Decisions (locked during clarification)

1. **#1** — The image **name replaces the UUID** identifier column across _all_ metric exports.
2. **#2** — **Full** generic polyline primitive: project type is the single source of truth for polyline semantics, resolved once. The `generic` case is kept thin (no speculative UI) per YAGNI, but adding a 3rd polyline-using project type becomes a config-row change, not a rewrite.
3. **#3** — **Change the computation**: each MT computes its background from its **own local vicinity** — a ring out to `thickness × margin_multiplier` around that MT — excluding every MT's signal band so no microtubule counts as background. The width is the existing `margin_multiplier`, already exposed in the export dialog.
4. **#4** — Surface the existing rename in the MT panel + MT context menu (FE-only).
5. **#5** — ImageJ name = the manual **rename if present**, else `<typeName>_<perTypeCounter>` (untyped MTs → `untyped_<counter>`).

## 3. Foundation — the polyline-semantics SSOT

A single resolver, mirrored on FE and BE (following the existing shared-type
convention; keep both copies prettier-formatted identically per the
`shared_types_prettier_wrap` gotcha), maps `Project.type → PolylineSemantics`:

```
type PolylineKind = 'sperm' | 'microtubule' | 'generic';

interface PolylineSemantics {
  kind: PolylineKind;
  idPrefix: string;        // 'sperm_' | 'mt_' | 'poly_'
  labelPrefix: string;     // 'S' | 'MT' | 'P'
  supportsPartClass: boolean; // sperm head/midpiece/tail only
  exportCategory: string;  // COCO/JSON category name
}
```

| project type      | kind        | idPrefix | labelPrefix | partClass | category    |
| ----------------- | ----------- | -------- | ----------- | --------- | ----------- |
| `sperm`           | sperm       | `sperm_` | S           | yes       | sperm       |
| `microtubules`    | microtubule | `mt_`    | MT          | no        | microtubule |
| _(anything else)_ | generic     | `poly_`  | P           | no        | polyline    |

- **FE:** `src/lib/polylineSemantics.ts` (new). Replaces the per-polygon
  `isMicrotubuleInstance` guess used for _kind_ decisions. (`isMicrotubuleInstance`
  may still exist for legacy id parsing, but is no longer the source of truth for kind.)
- **BE:** `backend/src/utils/polylineSemantics.ts` (new), or extend
  `backend/src/types/validation.ts` where `isMicrotubuleProject` already lives.

The ID prefix becomes a **consequence** of the kind (used when synthesizing new
instance IDs), never the source of it.

## 4. Workstream A — de-sperm the polyline path (#2)

**Frontend**

- `src/pages/segmentation/hooks/usePolygonRenderProps.ts:54-60` — derive
  `polylineKind` from the project type (threaded from editor context /
  `SegmentationEditorLayout` which already holds `projectType`), not from
  `isMicrotubuleInstance(p.instanceId)`. Remove the sperm fallthrough.
- `src/pages/segmentation/SegmentationEditor.tsx:300-309, 940-942, 1151-1153` —
  seed a new polyline's `instanceId` from `semantics.idPrefix` (so MT projects
  produce `mt_…`, sperm produce `sperm_…`); drop the hardcoded `activeInstanceId='sperm_1'`.
- Panel selection (`SegmentationEditorLayout.tsx:448-461, 487-498, 584, 595`) and
  `MicrotubuleInstancePanel.tsx:80-88` membership key on `semantics.kind`, not on
  the `mt_` id prefix.

**Backend export**

- `backend/src/services/exportService.ts:540-542` — label prefix from the resolver,
  replacing `isMicrotubuleProject ? MICROTUBULE_LABEL_PREFIX : SPERM_LABEL_PREFIX`.
- `backend/src/services/export/formatConverter.ts` — COCO/JSON category + attributes
  chosen by `semantics.kind`: sperm keeps `sperm` category + head/midpiece/tail
  (`buildSpermInstances`, `:721-749`); microtubule/generic get their own category and
  skip part-class semantics. (MT already skips COCO/JSON at `exportService.ts:576-577`;
  this makes the converter correct for any polyline project rather than assuming sperm.)
- `backend/src/utils/instanceLabels.ts` — already generic (takes a prefix); no change
  beyond who supplies the prefix.

**Non-goal:** no new UI panels for the hypothetical `generic` kind (YAGNI). The
`generic` row exists so the code no longer _assumes_ sperm; it is not a feature.

## 5. Workstream B — image name in exports (#1)

- `backend/src/services/export/mtMetricsExporter.ts` — replace the `imageId`
  (UUID `fr.id`) output column with `imageName` (the frame's `name`), populated via a
  `nameById` map built from the frame rows. `imageId` is dropped from CSV/XLSX/JSON
  output (`CSV_HEADERS`, the geometry path `:728`, the intensity path `:619`).
  `frameIndex` is retained.
- General writers — drop the redundant `Image ID` UUID column (they already emit
  `Image Name`): `exportPolygonMetricsToExcel` (header `:779`), spheroid `exportToExcel`
  (`:1118`), CSV (`:1292`), microcapsule (`:884`).
- `exportSpermToExcel` already emits `Image Name` (no UUID column) — unaffected.

## 6. Workstream C — rename microtubules in the editor (#4, FE-only)

- `src/pages/segmentation/components/MicrotubuleInstancePanel.tsx` — add inline
  rename (pencil affordance mirroring `PolygonItem.tsx:164` + `:118-136`) and display
  the stored `mt.name`, falling back to the positional `Microtubule instance {idx+1}`
  (`:262`) when unnamed.
- `src/pages/segmentation/components/context-menu/PolygonContextMenu.tsx` (MT branch
  `:157-262`) — add a **Rename** item.
- Thread the **existing** `handleRenamePolygon` (`usePolygonHandlers.ts:232` → writes
  `{ name }`) into the MT panel/menu at `SegmentationEditorLayout.tsx:596-614`
  (it is already imported and passed to `PolygonListPanel` at `:576`).
- **Reuse unchanged:** `updatePolygons` → `handleSave` → PUT
  `/segmentation/images/:id/results` → `computeCrossFrameTrackPropagation`
  (`segmentationService.ts:1681, :2146`) mirrors the new name across every frame of the
  same `trackId`. No backend/DB work.

## 7. Workstream D — ImageJ `<type>_<counter>` naming (#5)

- `backend/src/services/export/imagejRoiEncoder.ts:437-442` (`buildVideoRoiEntries`) —
  compute a **per-type running counter** for the whole video, keyed on `trackId`,
  ordered by first appearance. ROI name resolution:
  1. If the MT has a manual `name` → use it verbatim (rename overrides).
  2. Else if it has a resolved type label → `<typeName>_<counter>` where counter is
     that type's running index from 1.
  3. Else (untyped, unnamed) → `untyped_<counter>`.
- Replaces the current `<name>__<type>` join. Depends on Workstream C (so a rename
  exists to honor) and the existing mtType palette resolution (`labelById`).

## 8. Workstream E — per-MT local background + ImageJ background ROI (#3)

**ML — `backend/segmentation/api/mt_metrics.py`**

- Replace the global background (`:566-571`) with a **per-MT vicinity**. With
  `margin_radius = round(thickness_px × margin_multiplier)` (unchanged formula, `:539`),
  and `signal_union = ∪ all band masks at thickness` (`:566-568`):
  ```
  vicinity_i = dilate(band_i, margin_radius) AND NOT signal_union
  ```
  Background stats (`median_background`, `mean_background`, `signal_minus_background`)
  are sampled per-MT from `frame_arr[vicinity_i]` instead of once per frame. The
  dilation runs within each band's bounding box (`_vicinity_mask`) — O(bbox), not
  O(frame) — bit-identical to a full-frame dilate but fast enough for many-MT videos.

> **Implementation note (as shipped):** an earlier draft had Python return the vicinity
> _contour_ (`background_regions` list) for the ImageJ ROI, threaded from the metrics
> step. That was dropped: the metrics and ImageJ export steps run in **parallel**
> (`Promise.all`), so threading a contour between them would force serialization. The
> ImageJ background ROI is instead drawn **decoupled**, as a wide-stroke polyline (see
> below) — no ML contour, no cross-step coupling. Python returns only the (per-MT)
> statistics.

**ImageJ — `exportService.ts` + `imagejRoiEncoder.ts`**

- Each MT gets a **second ROI**: the SAME polyline drawn at the vicinity band width
  `backgroundStrokeWidth = thickness + 2·round(thickness·margin_multiplier)` (equal to
  the diameter of `dilate(band, margin)`), named `<signal-roi-name>_bg` (the Workstream
  D name with a `_bg` suffix, so signal and background sort together). In ImageJ the
  user sees the thin signal band _inside_ the wider background band — the ring between
  them is where the background is sampled. Emitted only for polylines and only when the
  vicinity is wider than the signal (margin > 0). Fully decoupled from the metrics step.

**Transparency note (documented, not hidden):** the _drawn_ band is `dilate(MT, margin)`
(the wide stroke); the _measured_ background additionally subtracts neighboring MTs'
signal bands, so where MTs are close the measured pixel set is slightly smaller than the
drawn band. The `_bg` ROI is a "roughly where background comes from" visual aid, not a
metric-bearing ROI.

## 9. Implementation sequence (each an independently-verified PR)

1. **A — SSOT + de-sperm polyline path.** Foundation for the rest.
2. **C — MT rename** (small, FE-only; unblocks D's rename-override).
3. **B — image name in export columns.**
4. **D — ImageJ `<type>_<counter>` naming** (depends on C + mtType).
5. **E — per-MT local background + ImageJ bg ROI** (ML + encoder; largest single change).

## 10. Testing & verification (per CLAUDE.md gates)

- **A (FE + BE):** Playwright on production — in an MT project, draw a polyline via
  `CreatePolyline`; assert it renders as a microtubule (no head/midpiece/tail UI) and
  its synthesized id uses `mt_`. In a sperm project, assert sperm semantics persist.
  BE: unit tests on the resolver; export a sperm project → COCO still emits `sperm`.
- **C (FE):** Playwright — rename an MT, scrub frames, reload → the name persists on the
  same track across frames (exercises the existing cross-frame mirror).
- **B (BE):** trigger an MT export; `curl`/download the `.xlsx`/`.csv` → assert an
  `imageName` column with real frame names and **no** UUID column.
- **D (BE):** download `RoiSet.zip`; decode names with Python `roifile` → assert
  `<type>_<counter>` per-type sequencing and that a renamed MT overrides.
- **E (ML + BE):** `docker exec spheroseg-ml` minimal repro of `vicinity_i` on a known
  mask; confirm per-MT background differs from the old global value; download the export
  → `median_background` varies per MT and a `_bg` ROI is present and geometrically sane.

## 11. Risks & mitigations

- **Kind now depends on project type reaching the FE render hook.** `projectType` is
  already available in `SegmentationEditorLayout`; thread it into
  `usePolygonRenderProps`. Verify no path renders polylines before the type is known
  (guard with the existing loading states).
- **Existing polylines carry old `sperm_`/`mt_` ids.** The resolver keys on _project
  type_, so legacy ids don't change kind; only _new_ ids follow the new prefix. No
  migration required; verify old MT projects still group correctly.
- **E couples the ImageJ step to the metrics step** (contours come from the ML metrics
  call). Both are always-on for MT exports today; the bg ROI degrades gracefully if
  metrics is absent. Alternative (pure-TS stroke-outline) rejected to avoid a
  geometry re-implementation and to keep the drawn region exactly the ML-measured one.
- **Background numbers change (E).** This is intended and user-requested; call it out in
  the export docs (`exportDocs.ts`) so downstream analyses know the definition changed.
- **`formatConverter.ts` change touches COCO/JSON for real sperm exports.** Regression-
  test a sperm export end-to-end to ensure head/midpiece/tail output is byte-identical.

## 12. Out of scope (YAGNI)

- No UI/panels/metrics writer built for the hypothetical `generic` polyline kind beyond
  the resolver row that removes the sperm assumption.
- No change to closed-polygon (spheroid/microcapsule/wound) metrics beyond dropping the
  redundant UUID column (#1).
- No new export format; no change to the kymograph/CVAT exporters except where the
  polyline SSOT naturally applies.
