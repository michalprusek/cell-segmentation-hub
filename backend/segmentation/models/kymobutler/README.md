# KymoButler (vendored)

Deep-learning kymograph trajectory extraction. Backs `POST /api/v1/kymograph`'s
`detect_velocity` path via `api/kymograph_velocity.detect_tracks`.

> Jakobs MAH, Dimitracopoulos A, Franze K. **KymoButler, a deep learning
> software for automated kymograph analysis.** *eLife* 2019;8:e42288.
> <https://doi.org/10.7554/eLife.42288>

## Provenance

| | |
|---|---|
| Upstream | <https://github.com/MaxJakobs/KymoButler> |
| Branch | `master` |
| Commit vendored | `be4aa20201faa5cbc104114fda8456e378931f5f` (2026) |
| Vendored on | 2026-08-31 |
| Licence | **MIT** — `LICENSE` beside this file, copied verbatim |
| Not on PyPI | `pip install kymobutler` 404s; source/vendor is the only route |

### Licence discrepancy — read this before reusing

The repository was **relicensed from GPL-3.0 to MIT** in commit `4709f8b`
("Change license from GPL-3.0 to MIT"). The `LICENSE` file at the vendored
commit is MIT and that is what governs this copy.

`pyproject.toml` at the same commit still declares
`license = "GPL-3.0-or-later"`. That is a **stale leftover of the relicensing**,
not a second licence: `4709f8b` rewrote `LICENSE` and did not touch the
metadata. It is recorded here so nobody re-derives the contradiction from the
package metadata and concludes this tree is GPL.

## What was vendored, and what was not

Kept (with the modifications noted):

| File | Change from upstream |
|---|---|
| `morphology.py` | imports made relative; dropped an unused `remove_small_objects` import |
| `graph_utils.py` | imports made relative |
| `vision_module.py` | imports made relative |
| `tracking.py` | imports made relative; `tqdm` progress bar dropped (not a dependency of this repo, and a server has nobody to show a bar to); a discarded `KDTree` build removed — see below |
| `preprocessing.py` | `load_and_preprocess(path)` → `preprocess_array(ndarray)`; see below |
| `segmentation.py` | takes the preprocessed array instead of a path, so the caller preprocesses once and reuses it |
| `config.py` | `.pt` filenames and `MODEL_NAMES` dropped with the `.pt` path; thresholds recalibrated with the measurement recorded in the file |
| `models/weights.py` | ONNX path only; process-wide model cache added |

**`preprocess_array` instead of a file path.** `/kymograph` samples its
intensity matrix straight out of the frame PNGs and holds it as a float32
`(F, X)` array. Round-tripping that through an 8-bit PNG purely to satisfy
upstream's signature would quantise 16-bit microscopy intensities to 256 levels
before the net ever sees them. The function performs the identical sequence
upstream applied after its `Image.open`: full-range rescale, polarity detection,
per-row mean normalisation.

Dropped entirely:

| File | Why |
|---|---|
| `scripts/convert_weights.py`, `models/unet.py`, `models/vision_net.py`, `models/classnet.py`, the `.pt` loader | **The `.pt` path is silently, catastrophically broken — see below.** |
| `cli.py`, `__main__.py`, `io_utils.py` | Click CLI + CSV/JSON/overlay writers; this repo renders its own overlay and returns JSON over the wire |
| `postprocessing.py` | Its statistics are not the ones this repo reports; `_segment_runs` in `kymograph_velocity.py` produces the run totals the wire contract carries |
| `wavelet.py`, `benchmarking.py` | Wavelet mode needs `PyWavelets`, which this image does not ship; benchmarking is for upstream's own validation scripts |
| `legacy/` (Mathematica `.wl` / `.nb`) | Not runnable here |

### The straddler pass builds a KDTree it never uses

In `track_bidirectional`'s straddler-recovery loop upstream builds
`KDTree(remaining_yx)` over every still-untracked pixel and then calls
`_make_track` with the **original full-skeleton** tree instead — up to
`STRADDLER_MAX_ITERATIONS = 500` discarded builds per kymograph.

The build is deleted here, not wired up. Wiring it would change what the
straddler pass searches (remainder-only rather than the whole skeleton), which
is a real behaviour change, and the thresholds in `config.py` were calibrated
against upstream's published reference counts with this pass behaving as it
does. Verified output-neutral on three real production kymographs (7, 12 and 16
trajectories): every velocity, SNR and point count byte-identical with the build
present and absent.

### Never use `scripts/convert_weights.py` or a `.pt` checkpoint

Upstream's converter maps Mathematica parameters onto its hand-written
`nn.Module` definitions **by matching shape and sequential order**, and when a
parameter finds no match it keeps the *randomly initialised* tensor and prints a
warning. Measured on these four graphs:

| model | tensors unmatched |
|---|---|
| bidirectional | 112 / 136 |
| unidirectional | 109 / 138 |
| decision | 107 / 136 |
| classifier | 34 / 46 |

Output correlation ONNX-vs-`.pt` is **0.016**, and the `.pt` models segment the
entire image as track. The conversion never fails loudly — it prints and
continues. That is why the whole `.pt` branch is absent from this tree rather
than merely unused.

## Weights

Three of upstream's four ONNX graphs, staged by
`scripts/download-kymobutler-weights.sh` into
`backend/segmentation/weights/kymobutler` (bind-mounted read-only at
`/app/weights` by `docker-compose.production.yml`). They are Git-LFS objects
upstream, but **git-lfs is not required** — GitHub serves them anonymously from
`media.githubusercontent.com`, and the script verifies each SHA256 against the
LFS object id at the vendored commit.

| file | bytes | role |
|---|---|---|
| `bidirectional_seg.onnx` | 22,667,877 | BiNet — single trackness map |
| `unidirectional_seg.onnx` | 124,206,164 | UniNet — two heads, `ant` / `ret` |
| `decision_module.onnx` | 124,209,198 | DecNet — resolves crossings, `(B,3,48,48)` |

`classifier.onnx` is **not** staged. It is meant to pick unidirectional vs
bidirectional automatically, and nothing calls it — not this repo (the mode is a
request field defaulting to bidirectional) and not upstream, whose
`legacy/packages/KymoButler.wl` loads it into an association at line 25 and
never reads it back.

All carry `producer_name="Wolfram Language"`, opset 18 — genuine exports of the
2019 networks, not re-trainings.

### `onnx2torch` is load-bearing, not a convenience

The graphs declare a **static `[1, 1, 256, 256]` input**, so `onnxruntime`
rejects a 300x200 kymograph outright. `onnx2torch` rebuilds the graph as an
ordinary shape-agnostic torch `nn.Module`, which is the only reason arbitrary
sizes run at all. Its pin, and the `ml_dtypes==0.5.4` pin that stops onnx from
dragging numpy to 2.x, are explained in `requirements.txt`.

## BiNet weight variants (2026-11-18)

`config.BINET_WEIGHTS` names the BiNet files; the decision module and UniNet
have no variants. A variant is upstream's `bidirectional_seg.onnx` with **only
its initializers replaced** — same nodes, opset and I/O names — so it loads
through the ONNX path above and the no-`.pt` rule still holds. Every one of the
116 trainable tensors is written, and the re-loaded graph reproduces the
fine-tuned module exactly (max |diff| 0.0 at 144x320).

| variant | file | sha256 | origin |
|---|---|---|---|
| `stock` | `bidirectional_seg.onnx` | `6446b8c2…` | upstream, 2019 |
| `alica_ft` | `bidirectional_seg_alica_ft.onnx` | `33bfa65f…` (full value in `config.py`) | fine-tuned 2026-11-18 |

**Which one runs.** A request may name one (`kymobutler_weights`); otherwise
`KYMOBUTLER_DEFAULT_WEIGHTS` in the ml environment decides, and the code default
is `stock`. The response's `kymobutler_weights` names the variant that produced
`tracks`. An unknown name raises (reported as `velocity_error`); a variant file
with another SHA256 refuses to load.

**`alica_ft` — what it is.** BiNet fine-tuned on 50 kymographs (758 traces) of
kinesin motors on microtubules in vitro, TIRF 488 nm, 5 movies from 2 days,
**one annotator** who drew a sparse sample of the visible traces as two-click
straight segments. Inputs built the way `/kymograph` builds them (1 px arc
steps, widths 1/3/5, mean). The labels are positive-unlabelled: annotated pixels
are positives, dark pixels away from any annotation are negatives, and on every
other pixel the loss pulls towards the stock map. BatchNorm frozen; 600 steps,
Adam 1e-5. Training code and data live in the private trackfit project
(`src/kymobutler_ft/kb.py`); the weights derive from unpublished lab data and
are **not downloadable** — stage the file by hand into
`backend/segmentation/weights/kymobutler/` and check its SHA256.

**Measured** (bidirectional, `min_size`/`min_frames` 10/10 as in production,
zero-fill fix on for both arms; trace recall = share of annotated traces that
one detected track covers on >= 50 % of its rows within 3 columns):

| data | stock | alica_ft |
|---|---|---|
| the annotator's movies, leave-one-movie-out (5 folds) | 0.40 / 0.46 / 0.54 / 0.52 / 0.47 | 0.59 / 0.54 / 0.56 / 0.52 / 0.59 |
| another lab's annotations (DNA origami / kinesin, 4 kymograph sets) | 0.46 / 0.53 / 0.32 / 0.54 | 0.50 / 0.61 / 0.41 / 0.63 |
| in-cell lysosomes, 114 kymographs, no labels: tracks / median length / share of track points on signal | 7091 / 77 frames / 0.79 | 6588 / 61 frames / 0.86 |

Read it with the caveats: one training seed; part of the gain is more tracks
(at equal track density `alica_ft` is ahead on three of the five movies, level
on one and slightly behind on one; on the other lab's data level); the
share of track points on signal drops 0.03-0.06 on the annotator's own movies;
on in-cell data both variants draw spurious lines in empty regions, `stock`
mostly vertical, `alica_ft` mostly diagonal at the slope of its training motors.
Bidirectional tracking takes 0.3-0.7 s per kymograph on CPU with either.

**Length filter per variant (2026-11-19).** The bidirectional `min_size` /
`min_frames` default is bound to the variant (`BIDIRECTIONAL_MIN_SIZE_FRAMES`):
`stock` keeps 10/10, `alica_ft` uses 3/3, because 77 % of its training traces
span fewer than 10 rows. With `alica_ft`, 3/3 instead of 10/10:

| data | trace recall 10/10 -> 3/3 | tracks | share of track points on signal |
|---|---|---|---|
| annotator's movies, leave-one-movie-out | 0.52-0.59 -> 0.70-0.85 | +80 to +120 % | unchanged (0.53-0.62) |
| another lab's annotations | 0.41-0.63 -> 0.70-0.90 | +55 to +100 % | -0.02 to -0.06 |

The table above (the stock comparison) is at 10/10 for both variants.

**Changing the default, rollback included.** Set `KYMOBUTLER_DEFAULT_WEIGHTS`
in `.env.production`, recreate `ml`, and flush the backend's `kymograph`
response cache (or wait out its 30 min TTL) — its key cannot see the ml
environment. Rollback is `KYMOBUTLER_DEFAULT_WEIGHTS=stock`.

## Architecture (as exported)

Four customised U-Nets. The segmentation nets are 4-level, base n=64 → 1024
bottleneck; each block is `Conv2d(3x3, pad) → BatchNorm2d → LeakyReLU(0.1)`,
with `Dropout2d` 0.1/0.2, `MaxPool2d(2)` down, `ConvTranspose2d(2, stride 2)` up
plus skip concat, and `Conv2d(n→2, 1x1) + softmax`. **Input dimensions must be
multiples of 16** — `resize_to_multiple_of_16` enforces it.

## Performance

The bottleneck is **tracking, not segmentation**. Segmentation is a single
forward pass; tracking runs the 124 MB decision module on one 48x48 crop per
ambiguity per track per step, serially.

Measured 2026-08-31 on this repo's ML image (torch 2.6.0+cu124), on 10 real
production kymographs, **CPU only** — the host GPU driver was mismatched
(kernel 570.195.03 vs userspace 570.211.01) for the whole of this work, so the
GPU path is implemented and **not measured**. Cold start (converting both nets
through `onnx2torch`) is a one-off ~5 s per process, which is what the model
cache in `models/weights.py` exists to amortise.

Two caveats make the absolute numbers an upper bound, not a specification:

1. **The box was heavily contended** (load average 19 on 4 cores; three other
   agents were building). The same 10 kymographs took 36 s, 111 s and 399 s of
   bidirectional tracking across three runs that returned **identical
   trajectory counts** every time. Only the ordering is trustworthy.
2. **torch's default multi-threading is pathological for this workload.**
   Pinning `torch.set_num_threads(1)` cut three representative kymographs from
   33.4 / 63.4 / 131.7 s to **2.6 / 4.6 / 6.2 s** — 10-20x — with byte-identical
   output. That is what you would expect from 4 OpenMP threads being spun up
   and torn down around each 48x48 convolution. It is recorded rather than
   applied because `set_num_threads` is process-global and this service runs
   segmentation models on anyio's threadpool concurrently; whether 1 thread
   still wins on an *idle* box was not measurable here.

Ordering that does hold: unidirectional is roughly 5x cheaper than
bidirectional, and both are 1-3 orders of magnitude more expensive than the DoG
detector they replaced (0.03-0.2 s per kymograph).

`detect_tracks` picks the GPU whenever one is genuinely usable — and
`track_bidirectional` takes its **own** `device=` argument that must be passed
in addition to `load_models(device=...)`, or the first decision-module call
raises a device mismatch.
