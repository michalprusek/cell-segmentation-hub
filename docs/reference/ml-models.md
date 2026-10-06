# ML models reference

Every segmentation model the platform can run: what it is, what it was trained
on, what it outputs, how fast it is, and what it will not do.

There are **twelve** models. Each one is locked to one or more project types — the
model picker only offers compatible models, and the backend rejects an
incompatible pair with a 400 even if you post it directly.

> **There is no single list — a model id is written down in five places.**
> Four of them must hold the identical set of ids:
> `src/lib/models/modelRegistry.ts` (frontend, plus display metadata),
> `backend/src/constants/modelRegistry.ts` (backend, compatibility only),
> `ModelLoader.AVAILABLE_MODELS` in `backend/segmentation/ml/model_loader.py`
> (Python, checkpoint paths) and the `ModelType` enum in
> `backend/segmentation/api/models.py`. `scripts/check-model-parity.cjs`
> compares those four id sets — the ids only, nothing else an entry carries —
> and is step 8 of `make ci` and a step of the required `frontend` job in
> `.github/workflows/ci.yml`. It is deliberately **not** in the pre-commit
> hook. (Until 2026-10-06 nothing ran it at all, while this page and two
> other places said it guarded the registries.)
>
> The fifth is `backend/src/api/v1/models.ts`, the public API's per-model
> table: output geometry, classes, and whether the model reads `threshold` and
> `detect_holes` at all. It is typed `Record<KnownModelId, V1Model>`, so the
> backend type check fails on a model missing from it, and
> `backend/src/api/v1/__tests__/openapi.test.ts` pins its key set, the count,
> and both parameter lists. Those flags describe
> `backend/segmentation/api/routes.py::_dispatch_inference`, which no check
> reads — change them only together with the dispatch.
>
> `scripts/verify-shared-types.cjs` is a different guard: it compares the
> frontend and backend copies of `DEFAULT_MODEL_BY_PROJECT_TYPE` and
> `PROJECT_TYPES_WITH_HOLE_DETECTION` (among other shared declarations), not
> the model set. It is step 9 of `make ci`, a step of the same `frontend` CI
> job, and lint-staged runs it at commit time when one of the files it reads
> is staged — both `modelRegistry.ts` files included. (Until 2026-10-06 only
> lint-staged ran it, and only for `src/types/` and `backend/src/types/`, so
> an edit to either registry — where those two constants live — triggered
> nothing.)

---

## The catalogue at a glance

| Model id                  | Display name                       | Project type        | Output          | Threshold (registry value)                                  | Typical time / image          | Size bucket |
| ------------------------- | ---------------------------------- | ------------------- | --------------- | ----------------------------------------------------------- | ----------------------------- | ----------- |
| `hrnet`                   | HRNet (Balanced)                   | `spheroid`          | Closed polygons | 0.5                                                         | ~0.20 s (p95 0.31 s)          | small       |
| `cbam_resunet`            | CBAM-ResUNet (Precise)             | `spheroid`          | Closed polygons | 0.5                                                         | ~0.38 s (p95 0.48 s)          | medium      |
| `unet_spherohq`           | UNet (Fastest)                     | `spheroid`          | Closed polygons | 0.5                                                         | ~0.18 s (p95 0.29 s)          | small       |
| `segformer`               | SegFormer                          | `spheroid`          | Closed polygons | 0.5                                                         | ~0.20 s                       | small       |
| `mamba_unet`              | Mamba-UNet                         | `spheroid`          | Closed polygons | 0.5                                                         | ~0.24 s                       | large       |
| `spheroid_disintegration` | Spheroid Disintegration            | `spheroid_invasive` | Core + corona   | 0.5, **not read** (argmax)                                  | ~0.70 s                       | medium      |
| `wound`                   | Wound Healing (Scratch Assay)      | `wound`             | Closed polygons | 0.5                                                         | ~0.03 s                       | medium      |
| `sperm`                   | Sperm Morphology                   | `sperm`             | Part polylines  | 0.5, **not read** (own cut-offs: mask 0.3, score 0.95)      | ~0.30 s                       | medium      |
| `sperm_2part`             | Sperm Morphology (head + tail)     | `sperm`             | Part polylines  | 0.5, **not read** (own cut-offs: mask 0.3, score 0.95)      | ~0.30 s (copied from `sperm`) | medium      |
| `microtubule`             | Microtubule (ResEnc-M + instancer) | `microtubules`      | **Polylines**   | 0.98, **not read** (`prob_thr` 0.98 in its own params file) | ~0.6 s (p95 ~2 s)             | large       |
| `microcapsule`            | Microcapsule                       | `microcapsule`      | Closed polygons | 0.5                                                         | ~0.30 s                       | small       |
| `neurite_soma`            | Neurite / Soma                     | `neurite`           | Closed polygons | 0.5, **not read** (argmax)                                  | ~12 s at 2048²                | large       |

The threshold column is `defaultThreshold` from the frontend registry — the
value the request carries. **Five models never read it** (`threshold: null` in
`backend/src/api/v1/models.ts`, mirroring
`backend/segmentation/api/routes.py::_dispatch_inference`): for those the
registry number changes nothing, and the cell says what decides instead.

Timings are the registry's recorded measurements on an NVIDIA A5000 and are
end-to-end (pre-process → inference → post-process → polygon extraction), not
raw forward-pass time. On CPU everything is one to two orders of magnitude
slower; see [GPU configuration](../GPU-CONFIGURATION.md).

> **Images are dispatched one at a time.** The registry carries a `batchSize`
> hint per model, but the queue's `BATCH_LIMITS` pins every model to **1** —
> and an unlisted model falls back to 1 as well. Multi-image batching is
> therefore not active anywhere today; concurrency lives at the queue level
> instead. Do not read the registry's `batchSize` as a description of runtime
> behaviour.

### Compatibility matrix

| Project type        | Models offered (in picker order)                                    |
| ------------------- | ------------------------------------------------------------------- |
| `spheroid`          | `hrnet`, `cbam_resunet`, `unet_spherohq`, `segformer`, `mamba_unet` |
| `spheroid_invasive` | `spheroid_disintegration`                                           |
| `wound`             | `wound`                                                             |
| `sperm`             | `sperm` (default), `sperm_2part`                                    |
| `microtubules`      | `microtubule`                                                       |
| `microcapsule`      | `microcapsule`                                                      |
| `neurite`           | `neurite_soma`                                                      |

Two types offer a real choice: `spheroid` (five models) and `sperm` (two). The
other five have exactly one, so their picker is a single locked row. A new
`sperm` project starts on `sperm`; `sperm_2part` is used only when the owner
picks it.

`spheroid_disintegration` is deliberately **absent** from plain `spheroid`
projects: core detection is tied to its post-processing path, so anyone who
wants a Disintegration Index is nudged to mark the project invasive instead.

Note the naming asymmetry that has already caused one shipped bug: the project
type is the **plural** `microtubules` while the model id is the **singular**
`microtubule`. Use the `isMicrotubuleProject()` predicate from
`src/types/index.ts` rather than a bare string literal.

---

## Spheroid models

All five produce closed polygons with optional internal holes, from
bright-field or phase-contrast micrographs of cellular spheroids. They differ in
speed/accuracy trade-off and in robustness to unfamiliar optics.

### `hrnet` — HRNet (Balanced)

High-Resolution Network keeping a high-resolution branch throughout the
network instead of the usual encode-then-decode collapse, which preserves
boundary detail.

- Checkpoint: `weights/hrnet_best_model.pth`
- Best for: general spheroid work where you want one model and no thinking.

### `cbam_resunet` — CBAM-ResUNet (Precise)

Residual U-Net with Convolutional Block Attention Modules (channel + spatial
attention) at each stage. The most precise boundaries of the five, at roughly
double HRNet's cost.

- Checkpoint: `weights/cbam_resunet_new.pth`
- Best for: publication figures, small batches, difficult boundaries.

### `unet_spherohq` — UNet (Fastest)

Plain U-Net trained on the SpheroHQ dataset, optimised for throughput. The
fastest of the general spheroid models.

- Checkpoint: `weights/unet_spherohq_best.pth`
- Best for: large batches where turnaround matters more than the last percent
  of boundary accuracy.

### `segformer` — SegFormer

Transformer-based (SegFormer-B0, hierarchical MiT encoder with a lightweight
all-MLP decoder). Highest reported accuracy on bright-field spheroids (93 % IoU)
at ~13 ms of raw inference.

- Checkpoint: `weights/segformer_b0_spheroseg.pth`
- Built with the HuggingFace `transformers` library, but **nothing is fetched
  from the Hub**: the architecture comes from the vendored
  `models/segformer_config.json` (`SegformerConfig.from_dict`) and every weight
  from the checkpoint above. The ML container has no HuggingFace cache mount
  and no `HF_TOKEN`. Unavailable — the model simply does not appear — if
  `transformers` is missing from the image.

### `mamba_unet` — Mamba-UNet

U-Net with a bidirectional Mamba (state-space) bottleneck. Chosen specifically
for **out-of-distribution robustness**: external labs, unknown optics,
drug-treated or unusual morphologies, where the CNNs degrade first.

- Checkpoint: `weights/mamba_unet_spheroseg.pth`
- Requires the `mamba_ssm` + `causal-conv1d` CUDA kernels, which are source-built
  against a pinned torch. If those imports fail the model is silently absent
  from the catalogue rather than erroring at inference time — if Mamba-UNet
  vanishes from the picker after a dependency change, that is why.

---

## `spheroid_disintegration` — Spheroid Disintegration

For `spheroid_invasive` projects: spheroids dispersing into the surrounding
matrix, where the quantity of interest is how much has left the dense core.

- Architecture: **UNet++ with an EfficientNet-B5 encoder, 3 classes** —
  `0 = background`, `1 = corona (dispersing cells)`, `2 = dense core`. The
  per-pixel class is `argmax` over the three logits.
- Checkpoint: `weights/spheroid_disintegration_unetpp_effb5_3class.pth` — the
  spheroid-disintegration paper's deposited production replicate **`prod_s42`**,
  SHA-256 `d47d28ad338de2e7424969e8da1dc39df2663bcf1777e681647caffa1f49ea15`,
  123 609 986 bytes (Zenodo 10.5281/zenodo.22295117, a draft until the paper is
  published, so it is staged by hand; `scripts/download_weights.py --verify-only`
  refuses any other file — the checkpoint served before 2026-09-24 has the same
  size and a different hash). It is ONE of the paper's five replicates; the
  paper's numbers are five-replicate means unless a replicate is named.
- **No threshold.** The decision is an argmax; the registry carries a neutral
  `0.5`, the API echoes whatever is sent and reports `threshold_applies: false`.
  (The 0.2 this page used to list was never a tuned value.)
- Inference follows the paper's released `predict.py`: grey level replicated to
  three channels, CLAHE (8 × 8 tiles, clip limit **2.0**) + ImageNet
  normalisation, one full-frame pass, bfloat16 autocast on a CUDA card with bf16
  (fp32 otherwise), no TTA, no sliding window. The clip limit is pinned at 2.0 in
  both (`CLAHE_CLIP_LIMIT` in `models/disintegration.py`; paper
  `paper/PREREG_F_CLAHE_PIN.md`, 2026-09-28): training drew it from
  Uniform[1, 3] per image, because albumentations reads a scalar
  `A.CLAHE(clip_limit=3.0)` as the range (1, 3), and the earlier `predict.py`
  inherited that random draw at inference — the paper's run-to-run jitter. 2.0
  is the midpoint of the training range. (Until 2026-09-28 the app pinned 3.0
  instead.) The app normalises with the same float32 look-up table as
  `A.Normalize`, so its preprocessed tensor is bit-identical to `predict.py`'s,
  and on CPU fp32 with `prod_s42` its mask equals the paper's bit for bit on one
  0 h and one 48 h image; two predictions of the same image are identical
  (`segmentation_cpu_tests/test_disintegration_preprocessing.py`). Across clip
  limits 1–3 the 48 h image's DI moved from 0.733 to 0.783 (0.758 at 2.0). Sources:
  `spheroid_rozpad/analysis/review_fixes/hub_clahe_stochastic_check.json`,
  `spheroid_rozpad/analysis/review_fixes/v7/hub_clahe_pin_parity.json`.
  Determinism is not correctness: a predicted core that splits (the paper's
  intact spheroid `251201_0 (20)`, flagged `core_fragmented`) now splits every
  time.
- The per-image read-out (DI, Index B, reach, fragments, core diagnostics,
  regime flags) is computed from the **raster** argmax mask at inference time by
  `api/disintegration_metrics.py`, a verbatim port of the paper's
  `compute_di.py`, and returned as `image_metrics`; `warnings` carries the
  input-scale check (validated: 2048 × 2048 px at ~1.28 µm/px).
- The core is **predicted directly**, not derived by thresholding intensity
  inside the outer boundary. That matters: the previous binary model inferred
  the core heuristically and mis-scaled it at 0 h, which biased every
  Disintegration Index computed from it.
- Requires `segmentation_models_pytorch` + `timm`; absent from the catalogue if
  either is missing.

Disintegration Index and the rest of the per-image measurements are described
in [Metrics](metrics.md#disintegration-index-di) and
[Invasive spheroid projects](../guides/project-types/spheroid-invasive.md).

---

## `wound` — Wound Healing (Scratch Assay)

Binary segmentation of the open wound area in scratch-assay time-lapses.

- Architecture: U-Net with a **MiT-B5 (SegFormer) encoder**.
- Checkpoint: `weights/wound_mitb5.ckpt`
- Pre-processing: PIL → grayscale → resize to **256 × 256** bilinear →
  normalise to `[−0.5, 0.5]`. Post-processing: sigmoid → bilinear upsample back
  to the native resolution → threshold → `{0, 255}` mask → contours.
- ~32 ms on an A5000; 90 % IoU on an external test set.
- The 256 × 256 working resolution is the model's training resolution. It is why
  wound is by far the fastest model here, and also why very fine wound-edge
  detail is smoothed — the mask is upsampled from 256².

---

## `sperm` — Sperm Morphology

Multi-class instance segmentation of individual spermatozoa with per-part
geometry.

- Produces, per detected cell, **three parts**: `head`, `midpiece`, `tail`.
  Parts are emitted as polylines natively (skeleton extraction → BFS ordering →
  RDP simplification), not as thresholded blobs.
- Every emitted shape carries `partClass` (`head` / `midpiece` / `tail`) and an
  `instanceId` grouping the parts belonging to one cell.
- Architecture: Mask2Former with a DINOv3 ConvNeXt-L backbone, followed by a
  graph assembly that keeps only complete cells along the chain
  head → midpiece → tail.
- Checkpoint: `sperm_final/best_model.pth`.
- This is the **default** for `sperm` projects
  (`DEFAULT_MODEL_BY_PROJECT_TYPE.sperm`).

See [Sperm projects](../guides/project-types/sperm.md) for the editor and export
behaviour built on those fields.

---

## `sperm_2part` — Sperm Morphology (head + tail)

The second model for `sperm` projects (added 2026-09-28, PR #566), for material
that is annotated and measured as **two parts only: head and tail**, with no
separate midpiece.

- Architecture: the same as `sperm` — Mask2Former with a DINOv3 ConvNeXt-L
  backbone — **fine-tuned from the deployed `sperm` checkpoint**. It is one
  wrapper class with a part count: `SpermModel(num_parts=2)` here,
  `SpermModel(num_parts=3)` for `sperm` (`SPERM_MODELS` in
  `ml/model_loader.py`).
- Produces, per detected cell, **two parts**: `head` and `tail`, as polylines.
  The graph assembly runs the two-part chain head → tail (`TWO_PART` in
  `sperm_final/inference/graph_assembly.py`), and the post-processing welds the
  head to the tail by their closest endpoints, since there is no midpiece to
  join them.
- Every emitted shape carries `partClass` (`head` / `tail` — never `midpiece`)
  and an `instanceId`, exactly as for `sperm`.
- Checkpoint: `weights/sperm_2part.pth`.
- Like `sperm`, it ignores the request's threshold: the `/segment` route passes
  none, and the pipeline applies its own mask and score thresholds.
- Trained on one dataset of 80 images / 115 annotated sperm (see the design
  spec). **No accuracy figure is quoted here**: the spec defines the evaluation
  but records no result.
- The registry's timing for it (0.30 s, p95 0.45 s) is **copied from `sperm`**,
  not measured separately.

### When to use it instead of `sperm`

The two models do not differ only in whether a midpiece is reported — they put
the **head/tail boundary in different places**. In the two-part annotation the
"head" is the whole helical part, which the three-part model splits between
head and midpiece. Measured on the two-part dataset, the three-part model with
its midpiece folded into the tail gave a head shorter than the annotation in
97 % of matched sperm (median −21 %) and a tail longer (median +47 %) — so
merging parts after the fact does not reproduce a head + tail measurement, and
the boundary had to be learned. (Source:
[design spec](../superpowers/specs/2026-09-26-sperm-2part-design.md).)

- Measuring head, midpiece and tail separately → `sperm`.
- Measuring head and tail only, with the head taken as the whole helical part →
  `sperm_2part`.

Switching the model does not convert existing segmentations; resegment the
images to get the other model's parts.

---

## `microtubule` — Microtubule SPARSE35 ep040

> Swapped 2026-09-19 (v5H → SPARSE35 ep040): same ResEnc-M topology, network now at NATIVE
> resolution, derived instancer vector (`min_length` 15 at 1.5×), cut 0.98. Everything the model is,
> scores and how it was verified: `backend/segmentation/models/microtubule/MODEL_CARD.md`. The
> threshold evidence table below was measured on v5H at 0.97 and is kept as the record of why the
> cut is not a setting.

The most specialised model in the platform, and the only one producing **open
polylines**. Read this section before running a microtubule project — several
of its properties are deliberate and surprising.

- Architecture: **nnU-Net ResEnc-M** (~140 M parameters) predicting the filament
  foreground, followed by a pure-NumPy **curvature-bounded instancer** that cuts
  the foreground into individual centerlines. Every crossing is resolved by
  min-cost matching under a hard **0.25 rad/px** curvature bound.
- Checkpoint: `weights/microtubule_sparse35_ep040.pth` (~535 MB). It is a complete
  `state_dict` with no frozen backbone, so **nothing is downloaded at
  inference time** — no HuggingFace token, no network access, and the first call
  is no slower than the rest.
- Trained **entirely on synthetic frames**. No human annotation at any stage.
- Peak GPU: ~0.73 GiB. Runtime ~4.0–4.4 s for a 1024² frame carrying 65
  microtubules on an A5000 — dominated by the _instancer_, so it scales with
  microtubule count, not just with frame size.

### It is IRM-only

The model was trained on **Interference Reflection Microscopy** frames. On a
TIRF frame it still emits plenty of confident-looking polylines, but they do
not track image content. Measured by sampling background-flattened contrast
along each detected centerline against the same curve translated elsewhere (a
real microtubule in IRM is _darker_ than its surround):

| Input      | Threshold | Detections | Contrast separation |
| ---------- | --------- | ---------- | ------------------- |
| IRM frame  | 0.97      | 128        | **−1.73 SD**        |
| IRM frame  | 0.35      | 155        | −1.44 SD            |
| TIRF frame | any       | many       | **≈ −0.02 SD**      |

More detections at a lower threshold means _worse_ evidence, and on TIRF the
output does not correlate with the image at all. The symptom of feeding it TIRF
is exactly that: many plausible polylines with no contrast underneath them.
Check the project's channel configuration. A channel is typed `irm` only on
positive evidence — a label-free name (`IRM`, `BF`, `DIC`, `TL`, `BRIGHTFIELD`,
`TRANSMITTED`) or an emission wavelength of exactly zero — and is `fluorescent`
otherwise; an unknown wavelength is no longer taken as evidence.

**Known hazard: when no channel qualifies, nothing stops the model running on
the wrong one.** No channel is _marked_ as the segmentation source, but every
consumer resolves the source as "the marked channel, else **channel 0**"
(`resolveSegmentationSource` in `backend/src/services/video/types.ts`), and each
frame's stored path already points at channel 0. That is the normal outcome for
a multi-page TIFF, which carries no wavelength and often no meaningful channel
names. What follows from it:

- **In the interface a multi-channel video always goes through the channel
  picker**, on the project page (**Segment**) and in the editor
  (**Resegment**) alike. It preselects the channel marked as the segmentation
  source; when none is marked it preselects nothing and its confirm button
  stays disabled until the user chooses
  (`src/lib/segmentationChannelDefault.ts`). Until 2026-10-07 the project page
  preselected the alphabetically first channel name and ignored the mark, and
  both pickers fell back to the first channel.
- **A request that names no channel is segmented on channel 0 with no prompt
  at all**: any direct call to `POST /api/queue/batch`, `/api/segmentation/batch`
  or `/api/queue/images/:id` (which has no `channel` field), and any
  single-channel container, where the picker never opens.
- **Nothing in the interface can mark a source.** The editor's channel list
  shows the "● src" badge but offers no control to set it; only
  `PATCH /api/images/:id/channels` can, or adding a channel whose name is
  recognisably label-free to a container that has no source yet. The picker's
  choice is per batch and is not remembered.
- **Upload-time steps take channel 0 without asking**: stage-drift correction
  and the container thumbnail both run on the resolved source before any user
  has chosen anything.

So a stack whose first channel is TIRF is segmented on TIRF unless someone
deliberately picks another channel in the dialog, every time.

### Its threshold is not a user setting

The registry records a default of **0.98**, and the `/segment` route
deliberately passes **no threshold at all** for `microtubule`: the model applies
`prob_thr` from its own `params_sparse35.json`. Lowering it does not fix a low
detection count — the table above is the measurement that settled this. If you
are getting too few microtubules, the input channel is the thing to check.

### Cross-frame identity is geometric

Since v5H the model emits **no embeddings**. `/api/v1/track` matches microtubules
between frames on **symmetric curve distance**, with common-mode stage drift
removed by a normal-flow least-squares fit. A `trackId` problem is therefore a
_geometry_ problem, not a decode problem.

There is **no hard rejection gate**. The old `GATE_MAX_SHIFT` was removed in the
same series that introduced the geometry — as a hard gate it fragmented tracks
3.14× — and is now `CURVE_SCALE_PX`, a saturation _scale_: a distant pair is
expensive, never impossible. The only surviving infinite cost is a centerline
too degenerate to compare (fewer than two points), where a distance of zero
would otherwise read as a perfect match.

`GATE_MIN_OVERLAP`, `OVERLAP_TOL` and `overlap_fraction` still exist in
`api/mt_geometry_cost.py` and are still tested, but **the tracker does not
import them**. Tuning them changes nothing about matching; they are kept as a
geometry primitive for possible future use.

The request body still accepts `embedding` and `emb_template_alpha` fields —
they are accepted and ignored, because rows written by the previous model
version still carry an `_embedding` and strict validation would otherwise
reject them.

More in [Microtubule projects](../guides/project-types/microtubules.md).

---

## `microcapsule` — Microcapsule

Instance segmentation of round microcapsules in bright-field microscopy.

- Architecture: a compact U-Net with a **MobileNetV3-Small** encoder (~14.5 MB),
  **distilled from Meta SAM 3**, followed by an h-maxima-seeded **watershed** on
  a per-instance distance map to separate touching capsules.
- Checkpoint: `weights/microcapsule_unet.pt`
- Boundaries are simplified with Douglas–Peucker (`approxPolyDP`); the epsilon
  is load-bearing for the output's shape, not a cosmetic setting.
- Capsules whose mask reaches the image border are flagged `complete: false` and
  **excluded from metrics** (area, perimeter, compactness) — a clipped capsule
  would otherwise drag every distribution down.
- Requires `segmentation-models-pytorch` and `scikit-image`.

---

## `neurite_soma` — Neurite / Soma

Two-class semantic segmentation of cultured neurons in fluorescence microscopy:
**neurite** (the processes) and **soma** (the cell body), read from the tubulin
channel alone.

- Architecture: **nnU-Net v2 ResEnc-M**, 2D `ResidualEncoderUNet`, 8 stages,
  features 32 → 512. Patch 512 × 512, sliding window at step 0.5 with Gaussian
  tile weighting and mirroring TTA; **3 folds averaged in logit space**.
- Loss: Dice + cross-entropy + a **clDice** topology term on the neurite class,
  which is what keeps thin processes connected rather than beaded.
- Checkpoint: `weights/neurite_soma/` (`fold_0.pth`, `fold_1.pth`, `fold_2.pth`
  plus `plans.json` and `dataset.json`; the network is rebuilt from the plans).
  Staged by `scripts/download-neurite-soma-weights.sh`. Nothing is downloaded at
  run time and no `HF_TOKEN` is involved.
- Does **not** require `nnunetv2`: the network definition is nnU-Net's own,
  vendored unmodified, while normalisation, the sliding window, the tile
  weighting, the TTA and the fold ensemble are reimplemented. Verified against
  `nnUNetv2_predict` on the same weights: 99.9999 % identical pixels, neurite
  IoU 0.999943, soma IoU 0.999965.
- Held-out accuracy (grouped leave-one-condition-out over 9 annotated frames):
  **Dice 0.832 neurite / 0.915 soma**.

### Its threshold does not exist

The decision is a **3-class argmax** over averaged logits (0 background,
1 neurite, 2 soma). There is no probability cut to move. The registry carries a
neutral `0.5` and the API echoes whatever you send, but
`predict_neurite_soma()` ignores it — exactly as the held-out Dice was measured.
No value you can send changes the output; if detections are wrong, the input
channel or the pixel size is the thing to look at.

### Input is the tubulin channel, and the stretch is part of the input

The wrapper applies a **1–99.5 percentile stretch, then a z-score**, because the
training polygons were drawn on frames that had already been through that
stretch. Native bit depth is preserved on the way in — a 16-bit frame is read as
16-bit rather than quantised to 8-bit first — so the stretch lands where it was
fitted. A genuinely multi-channel frame is rejected rather than averaged into a
mixture the model never saw.

### Runtime scales with area, and it is slow

Cost is a sliding window over the frame, so it grows with pixel count, not with
the number of cells: roughly **3–4 s at 1024², 12–15 s at 2048², and ~150 s** on
the 6657 × 6664 confocal frames the model was trained on. The spread is card
load — the two in-repo measurements were taken at different loads, and a warm
1400² request measured 7.9 s while the live service held the same GPU.
Inference is serialised behind a lock in the ML service, so a large frame stalls
that worker — including its health endpoint — for the duration.

### Known limits

- **Pixel size.** Trained at ~0.180 µm/px. On ~0.090 µm/px data each soma tends
  to come back split into roughly two pieces — measured, not suspected. Validate
  soma counts before trusting them at a different pixel size.
- **One microscope.** Leica confocal, one run, nine annotated frames. It has
  never seen spinning-disk or widefield data.
- **Faint processes may be missed**; treat unusually low neurite coverage as a
  flag rather than a result.
- **Soma area runs slightly generous** against expert ground truth.

More in [Neurite and soma projects](../guides/project-types/neurite.md).

---

## How a model gets chosen at run time

Rewritten 2026-09-20 (PRs #553/#554). It used to start from a per-user
`Profile.preferredModel` chosen in Settings; that column, that
setting and its screen are all gone, because one global model had no relationship to the project being
segmented and was wrong by construction on six of the seven project types.

1. **The project holds it** — `projects.segmentationModel`, nullable. `NULL`
   means "follow the type's default" and is deliberately never backfilled.
2. **Resolution** — `resolveProjectModel(type, stored)` returns the stored
   model when it is still compatible with the project's type, and
   `DEFAULT_MODEL_BY_PROJECT_TYPE[type]` otherwise. The default is the most
   ACCURATE compatible model, not the fastest: `spheroid` → `segformer`
   (93 % IoU). The same function exists on both sides, and the default map's
   two copies are kept in step by `scripts/verify-shared-types.cjs` (`make ci`
   step 9, the `frontend` CI job, and lint-staged).
3. **Who may change it** — the project's owner only. A shared annotator sees a
   read-only label, and a `model` in their request body is ignored in favour of
   the project's.
4. **Threshold** — not a choice at all. It is derived read-only from the
   registry entry for the resolved model: 0.98 for `microtubule`, 0.5 for every
   other model. Five models never read the value they are sent: `microtubule`
   applies `prob_thr` from its own parameter file, `sperm` and `sperm_2part`
   their own cut-offs, and `spheroid_disintegration` and `neurite_soma` decide
   by argmax and have no threshold at all.
5. **Hole detection** — offered only on `spheroid` and `wound`
   (`PROJECT_TYPES_WITH_HOLE_DETECTION`). Everywhere else the request carries
   the default `true`, normalised on both sides by `resolveDetectHoles`.
6. **Enqueue** — the resolved values are stored on the `SegmentationQueue` row
   (`model`, `threshold`, `detectHoles`, and for multi-channel video frames
   `channel`). A request that omits `model` is resolved from the project by the
   controller, never from a hard-coded fallback.
7. **Worker** — compatibility is still enforced in the queue worker. The
   interface can no longer produce a mismatch, since the model is resolved from
   the type; the check remains as defence in depth for direct API callers.

## Adding a model

Adding one touches files across the whole stack — the five places listed at
the top of this page, the Python wrapper and its `ModelLoader` entry, the weights download
script, and the `settings.modelSelection.models.<key>.{name,description}`
translation keys in all six locales. `scripts/check-model-parity.cjs`, the
backend type check and `scripts/check-i18n.cjs` will tell you what you missed —
all three run in `make ci` and in the required CI jobs. The parity script
compares model **ids** across the four lists and nothing else: a wrong
threshold, checkpoint path or compatibility entry passes it. If the new model
changes a project type's default, `scripts/verify-shared-types.cjs` fails until
both copies of `DEFAULT_MODEL_BY_PROJECT_TYPE` agree.

Neither script covers the documentation, which is how `sperm_2part` shipped
undescribed. By hand: this page (count, catalogue, compatibility matrix, a
section), the project type's guide, the counts in both READMEs, and the in-app
Documentation page — a `docs.modelSelection.models.<key>` entry in all six
locales **plus** the key in the explicit list in
`src/pages/documentation/docsContent.ts`; a key that is not listed there
renders nowhere. The public API keeps its own per-model table in
`backend/src/api/v1/models.ts`.

Checkpoints are not in the repository. See
[Model weights setup](../MODEL_WEIGHTS_SETUP.md) and `make check-weights`.

## See also

- [ML service architecture](../architecture/ml-service.md) — how models are
  loaded, cached and unloaded
- [ML service API](../api/ml-service.md) — the HTTP surface
- [Metrics](metrics.md) — what is measured from each model's output
