# Kymograph vs. per-image intensity profiles — batch export

**Date:** 2026-07-08
**Branch:** `feat/kymograph-profile-export`
**Surface:** project export dialog only (the editor's per-MT `KymographModal` is untouched).

## Goal

In the microtubule batch export, let the user choose **whether to export the
kymograph** (current behaviour) **or per-image intensity profiles**. When the
project has no time-lapse (every MT container is a single frame) a kymograph is
degenerate, so only the profile option is offered. A profile is always a
matplotlib line plot of **intensity vs. position along the microtubule**, one
plot per frame.

## Key facts (verified 2026-07-08)

- A kymograph **is** a stack of per-frame intensity profiles. In
  `tracker_kymograph.py` the `/kymograph` handler builds `rows` where each row is
  `profile = map_coordinates(image, coords)` (intensity along the polyline for
  one frame), then `kymo = np.stack(rows)` → the `(frames × position)` heatmap.
  So a "profile of one image" is exactly **one row** of the kymograph — same
  sampled data, drawn as a 1-D line instead of a 2-D heatmap. Profiles reuse the
  existing sampling/geometry/calibration path (no drift).
- **matplotlib is NOT installed** in the ML container. The kymograph PNG is drawn
  with PIL + a hardcoded 16-stop viridis table specifically to avoid matplotlib.
  This feature adds `matplotlib` to `backend/segmentation/requirements.txt` and
  requires an ML image rebuild + redeploy.
- `ProjectImage` already carries `frameCount` and `isVideoContainer`
  (`src/types/index.ts:549`), so the frontend gates single-frame → profile-only
  with data already on the wire — no extra fetch.

## Decisions (confirmed with user)

| Question                   | Decision                                                                   |
| -------------------------- | -------------------------------------------------------------------------- |
| Which surface              | Batch export dialog only.                                                  |
| Profile granularity        | One matplotlib plot per frame (per MT × channel).                          |
| When to force profile-only | When the project has no container with ≥ 2 frames.                         |
| Profiles output            | matplotlib **PNG plots + CSV** of the intensity matrix.                    |
| Deploy                     | Implement → verify E2E → build + deploy ML/BE/FE from a main-based branch. |

## Design

### 1. Frontend — `src/pages/export/components/MicrotubuleKymographsSection.tsx`

- Options type gains `mode: 'kymograph' | 'profiles'`:

  ```ts
  export type MtKymographMode = 'kymograph' | 'profiles';
  export interface MicrotubuleKymographsOptions {
    enabled: boolean;
    mode: MtKymographMode; // NEW
    includeVelocityMetrics: boolean; // kymograph mode only
    includeSegmentedImages: boolean; // kymograph mode only
  }
  ```

- Under the existing "Include kymograph analysis" checkbox, render a **mode
  radio**: _Kymograph_ ⟷ _Intensity profiles (per image)_.
  - Kymograph mode → existing two checkboxes.
  - Profiles mode → no sub-options (plots + CSV are always written).
- New prop `canBuildKymograph: boolean`. When `false`, disable the _Kymograph_
  radio, force `mode: 'profiles'`, and show a hint ("single frame — kymograph
  cannot be built, exporting profile"). Default `mode` is `'kymograph'` when a
  time-lapse exists (no behaviour change for existing users).
- i18n keys added to all six translation files.

### 2. Frontend — `src/pages/export/AdvancedExportDialog.tsx`

- Derive `hasTimelapse = images.some(i => i.isVideoContainer && (i.frameCount ?? 1) > 1)`
  and pass `canBuildKymograph={hasTimelapse}` into the section. If `frameCount`
  is not reliably populated, default `canBuildKymograph` to `true` (never hide a
  working option) — verify during implementation.
- Extend `MT_KYMOGRAPHS_DEFAULTS` with `mode: 'kymograph'`.

### 3. Backend — `src/services/kymographService.ts`

- `KymographServiceInput` gains `renderProfiles?: boolean`.
- When set, forward `render_profiles: true` to ML and map
  `payload.profiles` → `result.profiles: Array<{ frame: number; pngBase64: string }>`.
- `KymographServiceResult` gains optional `profiles`.

### 4. Backend — `src/services/export/mtKymographExporter.ts`

- `MTKymographOptions` gains `mode: 'kymograph' | 'profiles'`.
- Branch on mode:
  - **kymograph** — unchanged (PNG overlays + `velocity_metrics.xlsx`).
  - **profiles** — for each (container × MT × channel) call `buildKymograph({
renderProfiles: true, detectVelocity: false })`, then write: - `profiles/<video>__<mt>__<channel>__f<NNNN>.png` — one matplotlib plot per
    frame. - `profiles/<video>__<mt>__<channel>.csv` — the intensity matrix
    (`csv_base64` the ML already returns; rows = frames, cols = position).
- Add `MAX_PROFILE_PLOTS_PER_CONTAINER` cap with a `logger.warn` on truncation
  (no silent drop), mirroring `MAX_MT_PER_CONTAINER`.
- The early-return guard (`!includeVelocityMetrics && !includeSegmentedImages`)
  must not skip profiles mode — guard becomes mode-aware.

### 5. ML — `backend/segmentation/api/tracker_kymograph.py`

- `KymographRequest` gains `render_profiles: bool = False`.
- `KymographResponse` gains `profiles: Optional[List[ProfilePng]]` where
  `ProfilePng = { frame: int, png_base64: str }`.
- After `kymo` is built, if `render_profiles`, render one matplotlib line plot
  per frame row: x = position along MT (px, sample index × `px_per_column`),
  y = intensity; titled `<frame N>`. Use `matplotlib.use("Agg")`, import
  **lazily** inside the render helper (mirrors the lazy-`exceljs` pattern) so ML
  startup is not slowed.
- Rendering must never break the base kymograph: wrap in try/except, log, and
  return `profiles: None` on failure.

### 6. ML deps / build

- Add `matplotlib` (pinned to a current, non-yanked version) to
  `backend/segmentation/requirements.txt`.
- Rebuild `ml` image; redeploy `ml` (and `backend`/`frontend` for the wire +
  UI changes) from a branch 0 commits behind `origin/main`.

## Verification (per CLAUDE.md gates)

- **E (ML):** `docker exec spheroseg-ml python -c` — call `/kymograph` with
  `render_profiles: true` on a real MT frame; assert `profiles` length ==
  frame count and each PNG decodes.
- **B (API):** `curl` the backend kymograph path / inspect export network
  request for the new option.
- **A (UI):** Playwright on the export dialog — toggle to Profiles, confirm the
  radio + gating render; screenshot; zero console errors.
- **F (cross-stack):** run a real profiles export on a single-frame MT project
  and on a multi-frame one; open the ZIP; confirm `profiles/*.png` are matplotlib
  intensity-vs-position plots + the CSV matrix.
- **G (build):** `make build-service SERVICE=ml` (and frontend) succeed before
  deploy.

## Out of scope

- The editor `KymographModal` (per-MT viewer) — unchanged.
- Overlaid / averaged profile variants (user chose per-frame plots).
- Changing the kymograph algorithm, calibration, or velocity detection.
