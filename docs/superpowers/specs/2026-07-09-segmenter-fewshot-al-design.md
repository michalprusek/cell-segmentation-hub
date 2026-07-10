# `/segmenter` — Few-shot, active-learning, native-resolution polygon segmentation — Design Spec

- **Date:** 2026-07-09
- **Status:** Design spec (approved-in-principle across brainstorming; awaiting spec review). **Nothing implemented.**
- **Research basis:** [`docs/research/segmenter-fewshot-active-learning-sota.md`](../../research/segmenter-fewshot-active-learning-sota.md) (full SOTA + citations).
- **Companion:** interactive proposal (Artifact "Segmenter — Design Proposal").

---

## 1. Summary

A **standalone `/segmenter` module** where biologists **self-train** a segmenter with no ML expertise.
They upload an unlabeled image dataset; an **active-learning loop** proposes which images to
annotate next; they draw **polygons** in a reused (polygon-only) editor; **one universal in-context
model pre-labels** each proposed image and the human only **corrects**; every correction grows a
**non-parametric memory bank**; after N rounds the system generalises to the whole dataset. The
model's **weights barely change** — "learning" is the growing, AL-curated memory bank.

## 2. Scope

**In scope (v1):**

- Segment **polygons only** — closed, arbitrary-shape regions (blobs, cells, spheroids, capsules…).
- **Multi-class** (arbitrary user-defined classes) and **multi-instance**.
- **Overlapping masks incl. same-class** (amodal-style) — instances may share pixels.
- **Native resolution** (image-level in v1; native-res tiling in phase 3).
- **Few-label self-training** via an in-context memory bank + Bayesian active learning.
- **Minimal weight change** — non-parametric by default.

**Out of scope (deferred, "zatím"):**

- **Polylines / filaments / microtubules.** No thin-structure arm, no skeletonisation, no tracing.
- Per-dataset **heavy training** (LoRA / full fine-tune).
- **Patch/tile-level** active learning (phase 3).
- Rich export formats (phase 3 — basic COCO/mask export only to start).

## 3. Locked decisions (from brainstorming, 2026-07-09)

| #   | Decision      | Choice                                                                                 |
| --- | ------------- | -------------------------------------------------------------------------------------- |
| 1   | ML direction  | **Option A, in-context-first** — a learning loop, but weights barely move.             |
| 2   | Overlap scope | **Arbitrary overlap incl. same-class.**                                                |
| 3   | Licensing     | **Academic / ÚTIA** (Cellpose/Omnipose CC-BY-NC permitted; not needed in v1).          |
| 4   | Compute       | **Serialise any training behind inference** (near-free given non-parametric learning). |
| 5   | Architecture  | **One universal model, no morphology arms.**                                           |
| 6   | v1 scope      | **Polygons only** (filaments deferred).                                                |

## 4. Architecture overview

Three layers, reusing the existing stack:

```
FE  React /segmenter module (reuse spheroseg polygon editor)
      ├─ Dataset dashboard (upload, AL queue, convergence)
      └─ Polygon editor (pre-label overlay → correct → advance)
BE  Node/Express/Prisma
      ├─ Dataset + ClassLabel registry + Annotation store
      ├─ Memory bank store (per-class prototypes + exemplar refs)
      └─ AL orchestrator (acquisition, rounds, convergence)
ML  FastAPI + PyTorch (frozen DINOv3-L — already deployed)
      ├─ /embed     dense DINOv3 features (cached)
      ├─ /prelabel  memory-bank correspondence → per-instance polygons
      └─ /acquire   uncertainty/diversity scores for the pool
```

No new large model is loaded — the propose backbone is the **frozen DINOv3-L already in
production** for microtubules.

## 5. The universal model (ML)

**One morphology-agnostic path** (per-instance dense correspondence — INSID3-lineage):

1. **Encode** query image with **frozen DINOv3-L** → dense patch-feature map at native/high res
   (tiled if large). Cache per image. Project out DINOv3's positional-bias subspace (INSID3).
2. **Memory bank (the "model"):** per class, a set of **instance prototypes** = masked DINOv3
   feature signatures of every corrected exemplar, plus the exemplar polygon. Non-parametric.
3. **Correspondence:** for each class, cosine-match query patches against the class's prototypes
   (bidirectional/backward-matched to suppress false positives).
4. **Instance formation:** **agglomerative clustering** of matched query patches into coherent
   regions → one region per instance. Overlap preserved because instances are formed
   **independently** and stored as separate masks (never a single argmax label raster).
5. **Mask → polygon:** upsample/CRF-refine each instance mask to native res → marching-squares
   contour → RDP simplification → **polygon** (reuse existing `polygonGeometry.ts` path).
6. **Refine (single, uniform step — impl choice, see §12):** either INSID3-style dense decode +
   CRF (no SAM), or a uniform promptable SAM refinement seeded from each cluster. **No
   per-morphology branch.**

**Weight-change policy:** **zero gradient by default.** Optional **global** PTSAM-style
prompt-tuning (~2,048 params, encoder/decoder frozen) only if the whole model plateaus. **No
LoRA / full fine-tune.**

**Why it satisfies the constraints:** no shape prior (works for any closed shape); per-instance
independent masks (overlap incl. same-class); native-res via tiling + dense decode; in-context
(bank = model, weights frozen); multi-class (per-class prototype sets); multi-instance (clustering).

## 6. Active-learning loop (sequential Bayesian design)

The human annotation **is** the expensive evaluation; acquisition picks the next image to label.

- **Round 0 (cold start, no bank):** DINOv3 embeddings of all images → **TypiClust / ProbCover**
  diverse-typical seed. No uncertainty at round 0 (cold-start pathology).
- **Rounds 1…N:** score pool by **generalisation-targeted acquisition (EPIG-style,** target
  distribution = the whole pool) using **cheap non-parametric uncertainty** (matching confidence /
  distance-to-nearest-prototype / candidate spread — no MC-dropout over weights), **× diversity**
  (BADGE / k-center on frozen features) **÷ predicted correction effort**.
- **Bank curation = the AL diversity term** — selecting what to annotate is the same operation as
  keeping the bank dataset-representative (curate to cap bank size).
- **Correction signal (used honestly):** pre-label↔correction disagreement is **lagging** and
  conflates informativeness with image difficulty → it **reweights future rounds** and **feeds
  the stopping signal**, it does **not** drive the current pick.
- **Stopping ("after N"):** composite — validation IoU plateau **and** prediction stability on a
  fixed stop-set **and** falling correction rate **and** flattening acquisition scores. Shown to
  the user as a live "model is converging" curve.
- **Guardrail:** always run a **random-selection control arm** and surface AL-vs-random on the
  user's own data (AL can collapse to random; the pre-label-correct loop delivers value regardless).
- **Granularity:** v1 = whole images; **native-res tiles = phase 3**.

## 7. Data model & storage (Prisma / BE)

- `SegmenterDataset` — a project of unlabeled images (own type; not a spheroseg project-type).
- `ClassLabel { id, datasetId, name, color }` — generic per-dataset class registry (pattern from
  the existing MT type-label palette + `/projects/:id/mt-type-labels`).
- `Annotation` — polygons per image: `{ points, classId, instanceId }` (reuse `SegmentationPolygon`
  wire shape; `classId` replaces the scattered `partClass`/`mtType`/`class`).
- `MemoryBankEntry { datasetId, classId, instanceId, embeddingRef, exemplarMaskRef, round }` —
  the non-parametric model state.
- `EmbeddingCache` — DINOv3 dense features per image (storage-budgeted; recompute-on-miss).
- `ALState { datasetId, round, selectedQueue, scores, convergence }`.

## 8. The editor (FE — reuse spheroseg, polygon-only)

Per the reuse map (see research doc / editor exploration):

- **Keep:** editor engine (`useEnhancedSegmentationEditor`), interactions
  (View/EditVertices/AddPoints/CreatePolygon/Slice/Delete + vertex spatial index), rendering
  (`CanvasPolygon`/`CanvasVertex` + memo-comparator discipline + quadtree), persistence
  (`useSegmentationLoader`/`Reload`, `transformSegmentationPolygons`, cache, wire shape), selection
  SSOT, keyboard, toolbars, layout.
- **Strip:** `CreatePolyline` mode + all polyline handlers/preview/slicing; video/frame machinery,
  channels, kymograph; cross-frame track ops, `trackId`, `_embedding`; MT/sperm panels + part-class;
  resegment model ladder.
- **Add:** a **generic `ClassLabel` registry hook + dialog** (model on `useMtTypeLabels` +
  `MtTypeLabelDialog`); a single `polygon.classId`; a **palette-driven colour resolver** (generalise
  `resolveMtColor`) + comparator entry; an **active-class / active-instance** draw selector; one
  **generic instance panel** (merge `PolygonListPanel` + MT panel, grouped by `instanceId`, coloured
  by `classId`); a data-driven **"Set class"** context menu; **overlapping-polygon rendering**.
- **Loop UX:** pre-label overlay (model's proposal shown for correction), correct → advance to the
  next AL-selected image, a "fix these" queue with a suggested count, and the convergence curve.

## 9. Backend / API surface

- `POST /segmenter/datasets` (create), `POST …/images` (upload), class-registry CRUD (mirror MT
  palette endpoints).
- `GET  …/al/next` — next AL-selected image(s) + scores.
- `POST …/images/:id/prelabel` — run the universal model → polygons (calls ML `/prelabel`).
- `POST …/images/:id/annotations` — save corrections → **update memory bank** + AL state.
- `GET  …/status` — round, convergence signals, AL-vs-random control.
- WebSocket: pre-label ready, round complete, convergence updates.

## 10. Phasing

| Phase      | Ships                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**     | `/segmenter` module + data model + upload + polygon-only editor + generic ClassLabel registry. Manual polygon annotation works.                         |
| **P1**     | In-context pre-label (frozen DINOv3-L correspondence + memory bank) + cold-start image AL (TypiClust) + correct-and-advance loop. Usable few-shot tool. |
| **P2**     | EPIG-style acquisition + non-parametric uncertainty + convergence/stopping + random-control arm + optional global prompt-tuning.                        |
| **P3**     | Native-res patch/tile AL + tiled inference & cross-tile instance stitching + tile-pyramid viewer + export.                                              |
| **Future** | Polylines/filaments/microtubules (the deferred morphology).                                                                                             |

## 11. Risks & mitigations

- **Instance discovery from few exemplars via clustering** (no trained detector, no watershed) is
  the research frontier → mitigate with the correction loop, denser initial exemplars, and an early
  prototype/benchmark before committing P2.
- **DINOv3 stride-16 sub-patch** for small objects → native/high resolution + dense decode; but
  polygon-only v1 avoids the worst (thin-filament) case entirely.
- **AL may not beat random** → mandatory random-control arm; value is robust via the HITL loop.
- **INSID3 / EPIG-on-instances are recent/unproven combinations** → prototype early; treat reported
  numbers as reported.
- **Embedding cache storage** for large datasets → budget + recompute-on-miss.

## 12. Open implementation questions (minor — resolve during build)

1. **Refine step:** INSID3-style dense-decode + CRF (no SAM, simplest, most in-context) **vs.** a
   uniform SAM refinement seeded from clusters (crisper boundaries, heavier). Recommend starting
   with the former (no SAM) to honour "everything in-context".
2. **Export formats** for v1 (COCO + per-instance masks likely).
3. **Bank size cap / curation policy** (coreset threshold per class).

## 13. Next step

On spec approval → **writing-plans** skill to produce the phased implementation plan, then P0.
