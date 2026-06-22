# Microcapsule Project Type + Instance-Segmentation Model — Design Spec

**Date:** 2026-06-22
**Branch:** `feat-microcapsule-project-type`
**Status:** Implemented + deployed

> **Update (2026-06-22, post-deploy):** the segmentation **model** changed from
> the delivered YOLO11n-seg student to the **Meta SAM 3 teacher directly**
> (Promptable Concept Segmentation, prompt `"circle"`). On live data the YOLO
> student's low-resolution masks showed an 8×8-pixel block "flat edges on the
> sides" artifact, and contour-smoothing to fix it clipped the boundary inward.
> SAM 3 returns full-resolution masks → clean circular boundaries; nested masks
> per capsule are merged (`merge_nested`, 0.88) and simplified with
> `approxPolyDP(1.5)` (no inward shrink). Integrated via the standalone `sam3`
> package (no `transformers` bump; numpy 1.24→1.26 and smp 0.3.4→0.5.0, both
> verified safe). Everything below about the project type, metrics, exclusion of
> border-cut capsules, export and editor still holds — only the model wrapper
> and its dependencies differ.

---

## Goal (user's words, translated)

Integrate a new segmentation module for **microcapsules** (round objects) as a
**new project type**, analogous to spheroids — same upload/editor/export flow
**including visualizations** — differing only in:

1. the **model** (a pre-trained YOLO11n-seg **instance** segmentation model), and
2. the **metrics**: **area, perimeter, compactness** of _each individual_
   microcapsule, **excluding capsules that are cut off by the image edge**.

The module was delivered as `microcapsule-segmentation.zip` at the repo root
(`infer.py` + `capsule_seg_best.pt`, 6.1 MB).

---

## What the delivered module is

A **YOLO11n-seg** instance-segmentation model (Ultralytics), ~6 MB, distilled
from Meta SAM 3, segmenting microcapsules in bright-field microscopy images.
Per the shipped `infer.py`, `seg.segment(image)` returns a list of instances,
each with:

- `polygon` — `(N,2)` float pixel boundary,
- `confidence` — 0..1,
- `complete` — `True` if fully inside the frame, `False` if its mask touches the
  image border within 3 px (`_touches_border(poly, h, w, m=3)`),
- `area_px`, `equiv_diameter_px`.

CPU inference, sub-second. This is fundamentally **instance** output (per-object
polygons), unlike the repo's other models which emit a semantic mask that gets
post-processed. But because each capsule is a **closed** polygon, it maps onto
the existing **spheroid `polygons[]` channel** (multiple external polygons = many
instances) — no polyline/instanceId machinery needed.

---

## Decisions (confirmed with user)

| Decision                                     | Choice                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Compactness convention**                   | **Circularity `4π·A/P²`** (0–1, 1.0 = perfect circle), surfaced under the label "Compactness". The repo already computes this as `metrics.Circularity`.             |
| **Cut-off capsules in editor/visualization** | **Drawn grey, excluded from metrics.** Visible for QA (mirrors the model's own overlay), never counted.                                                             |
| **Export metric columns**                    | **Focused set:** Image Name · Image ID · Capsule ID · Area · Perimeter · Compactness · Equivalent Diameter · Confidence (complete capsules only) + a summary sheet. |
| **Project images**                           | Single bright-field images, like spheroid (not video).                                                                                                              |
| **Model count**                              | Exactly one model bound to the `microcapsule` project type.                                                                                                         |

---

## Architecture — integration surface

Five layers, mirroring how `segformer`/`wound` were added, plus a focused metrics
path.

### 1. ML service (`backend/segmentation/`)

- **`models/microcapsule.py`** — new `MicrocapsuleModel` wrapper class (NOT an
  `nn.Module`, following the sperm/wound pattern):
  - `__init__(self)` — no weights.
  - `load_weights(path, device)` — `from ultralytics import YOLO; self.model = YOLO(path)`; store device + `imgsz=1024`.
  - `predict(image_bgr, conf=0.25)` — adapts the shipped `infer.py`: read
    `res.masks.xy` + `res.boxes.conf`, compute `area = cv2.contourArea(poly)`,
    `complete = not _touches_border(poly, h, w, m=3)`, sort by area desc; return
    a list of instance dicts.
  - Stubs: `eval()`, `to(device)`, `parameters()`.
- **`models/__init__.py`** — guarded optional import + `__all__`.
- **`ml/model_loader.py`** — `AVAILABLE_MODELS['microcapsule']` entry
  (`weights/microcapsule_yolo11n.pt`), an early-return branch in `load_model`,
  and a new **`predict_microcapsule(image, threshold)`** method returning the
  response below.
- **`api/routes.py`** — dispatch `elif model == 'microcapsule': result = loader.predict_microcapsule(...)`.
- **`api/models.py`** — `ModelType.MICROCAPSULE = "microcapsule"`.
- **`config/batch_sizes.json`** — `microcapsule` entry (optimal/max batch 1,
  low memory, ~5–10 img/s on GPU; YOLO11n is tiny).
- **`requirements.txt`** — add `ultralytics>=8.3,<9`. Torch pin is safe
  (`ultralytics` needs `torch>=1.8`; the pinned `torch==2.6.0` satisfies it).
- **`Dockerfile`** — after `pip install -r requirements.txt`, reconcile OpenCV to
  a single **headless** build (ultralytics pulls non-headless `opencv-python`,
  which collides with the repo's `opencv-python-headless` over `cv2`):
  `pip uninstall -y opencv-python opencv-contrib-python || true && pip install --no-cache-dir --force-reinstall --no-deps opencv-python-headless==4.8.1.78`.
- **Weights** — `capsule_seg_best.pt` → host `backend/segmentation/weights/microcapsule_yolo11n.pt`, owned `999:999`, bind-mounted.

**ML response shape** (spheroid-shaped + two extra per-polygon fields):

```json
{
  "model_used": "microcapsule",
  "threshold_used": 0.25,
  "image_size": {"width": W, "height": H},
  "polygons": [
    {
      "id": "polygon_1",
      "points": [{"x": .., "y": ..}, ...],
      "type": "external",
      "class": "microcapsule",
      "confidence": 0.97,
      "complete": true,
      "vertices_count": N
    }
  ],
  "processing_info": { "device": "...", "num_polygons": K, "confidence_scores": [...], "batch_size": 1 }
}
```

The backend `threshold` maps to YOLO `conf`. `complete`/`confidence` are the only
new fields vs. the spheroid response.

### 2. Backend SSOT (`backend/src/`)

- **`types/validation.ts`** — add `'microcapsule'` to `PROJECT_TYPES`.
- **`constants/modelRegistry.ts`** — `microcapsule: { compatibleProjectTypes: ['microcapsule'] }`.

### 3. Polygon data model (carry the new fields end-to-end)

Add `complete?: boolean` to **`src/lib/segmentation.ts`** `Polygon` and
**`backend/src/types/polygon.ts`** `BasePolygon`; add `confidence?: number` to
`BasePolygon` (FE `Polygon` already has `confidence?`). Per the known **5-stage
field-stripping** pattern, whitelist `complete` (and BE `confidence`) through:
`PolygonValidator` + the 3 `segmentationService` mappers (`toApiPolygon` /
`toDbPolygon` / FE-bound mapper) + the FE editor sync. **No DB migration**
(polygons persist as JSON in `segmentations.polygons`).

### 4. Metrics + export

- **Compactness = `metrics.Circularity` value** (`4π·A/P²`), labeled "Compactness"
  in the microcapsule surfaces. (Capsules have no holes → perimeter-with-holes
  == perimeter.)
- **Border exclusion in BOTH metric engines**, keyed on the field so it is inert
  for other project types (they never set `complete`):
  - FE `src/pages/segmentation/utils/metricCalculations.ts` call sites
    (`MetricsDisplay.tsx`, `ExcelExporter.tsx`) — filter `p.complete !== false`.
  - BE `backend/src/services/metrics/metricsCalculator.ts` — filter
    `p.complete !== false` before computing.
- **Export** (`backend/src/services/exportService.ts`) — new
  `projectType === 'microcapsule'` branch → focused exporter (Excel + CSV + JSON
  metrics) with the columns above, complete capsules only, + summary sheet
  (count analysed, total detected, mean/min/max area & compactness).
- **`backend/src/services/export/exportDocs.ts`** — microcapsule metrics-guide
  branch (defines area/perimeter/compactness, explains the completeness filter).
- COCO/YOLO/JSON annotation export and the visualization export are **inherited**
  unchanged (each external polygon already exports as one instance).

### 5. Editor + visualization (grey cut-off capsules)

- **`CanvasPolygon.tsx`** — `complete === false` → grey stroke/fill; everything
  else unchanged. **Add `complete` to the `React.memo` comparator** (failure
  pattern #5: a prop not in the comparator never re-renders).
- **`backend/src/services/visualization/visualizationGenerator.ts`** — grey for
  `complete === false`, mirroring the model overlay; complete capsules use the
  normal external colour + numbering.

### 6. Registry + i18n

- **`src/types/index.ts`** — add `'microcapsule'` to `PROJECT_TYPES`
  (**byte-identical** to BE, enforced by `scripts/verify-shared-types.cjs`).
- **`src/lib/models/modelRegistry.ts`** — `microcapsule` entry: `size:'small'`,
  `defaultThreshold:0.25`, `category:'microcapsule'`, performance (~0.1 s),
  `name:'Microcapsule'`, `displayName:'Microcapsule (YOLO11n-seg)'`, description,
  `i18nKey:'microcapsule'`, `compatibleProjectTypes:['microcapsule']`.
- **i18n** — all 6 of `src/translations/{en,cs,es,de,fr,zh}.ts`:
  `projects.types.microcapsule`, `settings.modelSelection.models.microcapsule.{name,description}`,
  `settings.modelDescription.microcapsule`. Validate `node scripts/check-i18n.cjs`.
- Project-type picker (`NewProject.tsx`, `ProjectDialogForm.tsx`) auto-populates
  from `PROJECT_TYPES`; model selector is registry-driven — no edits there.

---

## Testing

- **Python (ML):** a wrapper unit test that loads `MicrocapsuleModel` against the
  real weights on a synthetic circles image and asserts: instances returned;
  border-touching circles flagged `complete=False`; fully-interior circles
  `complete=True`; `area_px` matches `cv2.contourArea` within tolerance. Guard
  with `importorskip('ultralytics')` + weights-exist skip (pytest absent in
  container — runnable via the GPU one-off recipe in memory
  `reference_run_ml_python_tests`).
- **Backend (Jest):**
  - `metricsCalculator` excludes `complete === false` polygons and includes
    `complete !== false` / undefined.
  - `exportService` routes `microcapsule` to the focused exporter; emitted
    columns match the spec; cut-off capsules absent from rows.
  - `modelRegistry` contains `microcapsule` ↔ `['microcapsule']` and the derived
    compatibility map is correct (registry already has a parity test).
- **Frontend (Vitest):**
  - `metricCalculations` circularity == 1.0 (±ε) for a regular polygon
    approximating a circle; compactness label maps to circularity value.
  - per-capsule metrics filter drops `complete === false`.
- **Shared-types:** `verify-shared-types.cjs` passes (PROJECT_TYPES parity).

Per CLAUDE.md, tests are necessary but **not** sufficient — see Verification.

---

## Verification (cross-stack gate F — mandatory before "done")

1. `make build-service SERVICE=ml` → in-container assert `import cv2` (headless,
   single copy) + `from ultralytics import YOLO` + `MicrocapsuleModel` loads the
   weights and runs on a synthetic image (logs `inference with microcapsule`).
2. `make build-service SERVICE=backend` + `frontend`; `make ci` green.
3. Playwright (inject-JWT pattern) on dev:
   - Create a **microcapsule** project (type appears in the picker, localized).
   - Upload the synthetic circles image; segment with the microcapsule model.
   - Confirm DB `segmentations.model === 'microcapsule'` + `updatedAt` fresh
     (enqueue 200 is not proof — compat is enforced in the worker).
   - Editor: complete capsules coloured + numbered; cut-off capsules grey;
     metrics panel shows Area/Perimeter/Compactness for complete only.
   - Export → download Excel; assert focused columns + cut-off capsules absent.
   - `browser_console_messages` length 0 (any error = blocker).

Dev only. **Production deploy is gated on explicit user go-ahead.**

---

## Risks & mitigations

| Risk                                                                 | Mitigation                                                                                                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ultralytics` drags non-headless `opencv-python` → duplicate `cv2`   | Dockerfile reconciles to single headless build; verify `import cv2` in image.                                                                                                      |
| New polygon field silently stripped before metrics                   | Whitelist `complete`/`confidence` through all 5 field-stripping stages; assert it survives via a real segment + DB read.                                                           |
| `React.memo` comparator misses `complete` → grey state never renders | Add `complete` to `CanvasPolygon` comparator (explicit checklist item).                                                                                                            |
| FE vs BE metric numbers disagree                                     | Enforce the exclusion filter in **both** engines, keyed on the same field.                                                                                                         |
| No real sample image for E2E                                         | Use a synthetic bright-field-style circles image with known interior/border split — deterministic for the completeness logic. Smoke-test real-weight detection in-container first. |
| Torch pin bump                                                       | None needed; `ultralytics` is satisfied by `torch==2.6.0`.                                                                                                                         |

---

## Out of scope

- Retraining / SAM-3 teacher path (the `training/` folder ships for
  reproducibility only).
- Cross-frame tracking / kymograph (microcapsules are single images).
- Exposing a per-image confidence-threshold slider (fixed default 0.25; can be a
  follow-up).
