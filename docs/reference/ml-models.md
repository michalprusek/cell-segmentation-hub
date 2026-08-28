# ML models reference

Every segmentation model the platform can run: what it is, what it was trained
on, what it outputs, how fast it is, and what it will not do.

There are **eleven** models. Each one is locked to one or more project types — the
model picker only offers compatible models, and the backend rejects an
incompatible pair with a 400 even if you post it directly.

> **Single source of truth.** The model set lives in three mirrored registries:
> `src/lib/models/modelRegistry.ts` (frontend, plus display metadata),
> `backend/src/constants/modelRegistry.ts` (backend, compatibility only), and
> `ModelLoader.AVAILABLE_MODELS` in `backend/segmentation/ml/model_loader.py`
> (Python, checkpoint paths). `scripts/check-model-parity.cjs` fails CI if they
> drift. **Add or remove a model in all three.**

---

## The catalogue at a glance

| Model id                  | Display name                       | Project type        | Output          | Default threshold | Typical time / image | Size bucket |
| ------------------------- | ---------------------------------- | ------------------- | --------------- | ----------------- | -------------------- | ----------- |
| `hrnet`                   | HRNet (Balanced)                   | `spheroid`          | Closed polygons | 0.5               | ~0.20 s (p95 0.31 s) | small       |
| `cbam_resunet`            | CBAM-ResUNet (Precise)             | `spheroid`          | Closed polygons | 0.5               | ~0.38 s (p95 0.48 s) | medium      |
| `unet_spherohq`           | UNet (Fastest)                     | `spheroid`          | Closed polygons | 0.5               | ~0.18 s (p95 0.29 s) | small       |
| `segformer`               | SegFormer                          | `spheroid`          | Closed polygons | 0.5               | ~0.20 s              | small       |
| `mamba_unet`              | Mamba-UNet                         | `spheroid`          | Closed polygons | 0.5               | ~0.24 s              | large       |
| `spheroid_disintegration` | Spheroid Disintegration            | `spheroid_invasive` | Core + corona   | 0.2               | ~0.70 s              | medium      |
| `wound`                   | Wound Healing (Scratch Assay)      | `wound`             | Closed polygons | 0.5               | ~0.03 s              | medium      |
| `sperm`                   | Sperm Morphology                   | `sperm`             | Part polylines  | 0.5               | ~0.30 s              | medium      |
| `microtubule`             | Microtubule (ResEnc-M + instancer) | `microtubules`      | **Polylines**   | 0.97 (fixed)      | ~4.5 s (p95 9 s)     | large       |
| `microcapsule`            | Microcapsule                       | `microcapsule`      | Closed polygons | 0.5               | ~0.30 s              | small       |
| `neurite_soma`            | Neurite / Soma                     | `neurite`           | Closed polygons | n/a (argmax)      | ~12 s at 2048²       | large       |

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
| `sperm`             | `sperm`                                                             |
| `microtubules`      | `microtubule`                                                       |
| `microcapsule`      | `microcapsule`                                                      |
| `neurite`           | `neurite_soma`                                                      |

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
boundary detail. The default recommendation and the platform-wide default
(`Profile.preferredModel` defaults to `hrnet`).

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
- Loads through HuggingFace `transformers`; the ML container needs its
  HuggingFace cache mount to be present (see
  [deployment](../deployment/README.md)). Unavailable — the model simply does
  not appear — if `transformers` is missing from the image.

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
- Checkpoint: `weights/spheroid_disintegration_unetpp_effb5_3class.pth`
- Default threshold **0.2**, not 0.5 — the corona is faint by construction.
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
- Checkpoint: `sperm_final/best_model.pth`.

See [Sperm projects](../guides/project-types/sperm.md) for the editor and export
behaviour built on those fields.

---

## `microtubule` — Microtubule v5H

The most specialised model in the platform, and the only one producing **open
polylines**. Read this section before running a microtubule project — several
of its properties are deliberate and surprising.

- Architecture: **nnU-Net ResEnc-M** (~140 M parameters) predicting the filament
  foreground, followed by a pure-NumPy **curvature-bounded instancer** that cuts
  the foreground into individual centerlines. Every crossing is resolved by
  min-cost matching under a hard **0.25 rad/px** curvature bound.
- Checkpoint: `weights/microtubule_v5h.pth` (~535 MB). It is a complete
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
Check the project's channel configuration — IRM auto-detection defaults every
channel to `type: "irm"`, so a TIRF-only recording can silently be marked as the
segmentation source.

### Its threshold is not a user setting

The registry records a default of **0.97**, and the `/segment` route
deliberately passes **no threshold at all** for `microtubule`: the model applies
`prob_thr` from its own `params_v5h.json`. Lowering it does not fix a low
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

1. **Default** — every user has `Profile.preferredModel` (defaults to `hrnet`)
   and `Profile.modelThreshold` (defaults to `0.5`), set in Settings.
2. **Per run** — the segmentation dialog offers only the models compatible with
   the project's type, pre-selecting the user default when it is compatible.
3. **Enqueue** — the choice is stored on the `SegmentationQueue` row (`model`,
   `threshold`, `detectHoles`, and for multi-channel video frames `channel`).
4. **Worker** — compatibility is enforced _in the queue worker_, not at enqueue.
   A `202 Accepted` therefore does not guarantee the item will run; an
   incompatible pair fails at dispatch.

## Adding a model

Adding one touches roughly nine files across the stack — the three registries
above, the Python wrapper and its `ModelLoader` entry, the weights download
script, and the `settings.modelSelection.models.<key>.{name,description}`
translation keys in all six locales. `scripts/check-model-parity.cjs` and
`scripts/check-i18n.cjs` will tell you what you missed.

Checkpoints are not in the repository. See
[Model weights setup](../MODEL_WEIGHTS_SETUP.md) and `make check-weights`.

## See also

- [ML service architecture](../architecture/ml-service.md) — how models are
  loaded, cached and unloaded
- [ML service API](../api/ml-service.md) — the HTTP surface
- [Metrics](metrics.md) — what is measured from each model's output
