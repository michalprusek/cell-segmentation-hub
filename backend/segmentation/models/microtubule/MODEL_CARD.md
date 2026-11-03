# Microtubule model card

**V16 DEB_S4 ep040** serves interactive segmentation, FRAP targets and the Automated Essays batch
since 2026-11-03 (§0). The batch follows the interactive model by the owner's rule, and
`backend/essays/tests/test_batch_follows_interactive.py` fails if they differ. **SPARSE35 ep040** is
loaded by no service any more; the rest of this card (§1–§12) is its record, unchanged except where
it says so.

## 0. V16 DEB_S4 ep040 (interactive and Essays, since 2026-11-03)

| | |
|---|---|
| Model | `V16 DEB_S4 ep040` — same nnU-Net ResEnc-M topology as SPARSE35 + instancer L+H, **no learned decoder** |
| Checkpoint | `weights/microtubule_v16_deb_s4_ep040.pth`, 560 307 978 bytes, sha256 `8fc22555737b2054f89c73db417314e5f4f89be0d4514bc60c6993508ec42f73` |
| Source of record | `kajman:/data2/prusek/mt_work/runs/DEB_S4/ep040.pth` (trained 2026-11-01, seed 20260907) |
| Parameters | `params_v16.json`: the derived graph constants of `params_sparse35.json`, the link score, reach 80, hysteresis 0.98 / 22.5 |
| Foreground cut | **0.995** (not a user setting) |
| Inference | native resolution, 512 px tiles, **stride 256, Gaussian mean of logits**, bf16 on CUDA, ×1.5 resampling, float16 rounding of the map |
| Annotation used | **none** in training — synthetic frames only |

**Training recipe.** 40 epochs of the project's synthetic generator with three changes over SPARSE35:
a mixture of correlated noise models, anti-aliased filament rendering, and compact debris (0–40
objects per 640 px crop) as unlabelled distractors. Calibration `calib_V16_debris.json`, research repo.

**Decoder.** `instance/instancer_lh.py`. Pixels above 0.98 near a junction join the mask only if they
connect at least two components at the cut (H). Every pair of arc ends within 80 px that does not break
the curvature bound gets a link score, a logistic fit on synthetic links only, on five hand features.
One max-weight matching over the frame then decides the chains (L). See the file's docstring for the
source of record.

**Scores.** Centerline F1, tol 5 px at the 1.5× frame, coverage 0.80 / 0.80, pooled micro, ep040.

| | roi303 v2 TEST (128 fr, 39 fields) | htw TEST (33 fr) |
|---|---|---|
| SPARSE35 seed 1 + instancer A, block's own cut | 0.640 (0.99) | 0.601 (0.995) |
| SPARSE35 seed 1 + instancer A, as it ran here (cut 0.98) | not measured | 0.565 |
| **DEB_S4 + L+H, reach 60, block's own cut** | **0.717** (0.995) | **0.715** (0.99) |
| V16 recipe, 4 seeds, reach 60, own cuts | 0.715 | 0.699 |

| VAL, as deployed unless stated | roi303 v2 (145 fr) | htw (33 fr) | MT-34 (17 fr) |
|---|---|---|---|
| DEB_S4 + L+H, reach 80, cut 0.995 | **0.741** | **0.751** | **0.681** |
| same at cut 0.99 | 0.732 | 0.754 | 0.675 |

What the TEST table does not cover, stated so that nobody reads more into it: reach 80 and the
single cut 0.995 were never read on TEST (at 0.995 the htw cell above would differ), the seed was chosen on VAL, and DEB_S4 is
the high outlier of its recipe on htw, so 0.699 is the sober htw figure. TEST was used three
times during development. The two models were measured on different hosts; the host of V16
reads about +0.007 higher on roi303. Match reach 80 missed its declared VAL line and was accepted by the
owner after the read. The MT-34 numbers of the research ledger were read under uniform fusion;
the table above is under Gaussian fusion, as deployed.

**Why 0.995.** DEB_S4's own VAL cuts differ by block (roi303 0.995, htw and MT-34 0.99) and production
carries one. The rule, declared before reading: higher block mean of htw and roi303 on VAL, ties to the higher
cut. It gives 0.7462 against 0.7427. MT-34, the block nearest to production frames by filament width,
is not in the rule and agrees under Gaussian fusion (0.681 against 0.675; the uniform maps of the
research ledger said the opposite, 0.666 against 0.686).

**What users will notice.** Filaments keep their identity through crossings more often, and fewer
detections land on debris. Curves under 20 px are found less often than the recipe without
debris would find them: recall 0.54 / 0.70 (htw / roi303) for this seed against 0.53 / 0.74 for that
recipe's mean. Large frames take about twice the tiles.

**Verification, 2026-11-03.** On all 195 VAL frames (145 roi303, 33 htw, 17 MT-34): `instance_lh` on the research
maps gives the research polylines at 0.000000 px, 9 754 curves; a mutated reach (60) fails that comparison.
The whole wrapper on the same frames reproduces them within 1e-9 px on the research host, and its output after RDP keeps the counts:
roi303 0.7411, htw 0.7513, MT-34 0.6810. Inside the ML image, whose scipy, skimage and networkx differ, the decoder
is again identical on all 195. torch 2.6.0 against the research host's 2.5.1 moves the map by up to 0.04, which on the fixture and six real
frames keeps every curve count and moves no matched curve by more than 0.4 px (`verify_microtubule_model.py`, default tolerances; strict ones need the same torch).

**FRAP targets.** L+H links across gaps the network saw no filament in, and a spot in such a gap would bleach
empty glass with nothing to catch it on a field without a fluorescence page. `frap_select.split_unsupported` therefore cuts a polyline where the
map stays under 0.5 for more than 3 px, before selection. On the 195 VAL frames, at 0.11 µm/px, 2 of 1374 spots landed on such a stretch without it and none with it, and the spot count stays within 3.

**Time bound.** The matching is cubic at worst and runs under the service's one inference lock with no deadline. Beyond `max_arcs` (2000;
the densest VAL frame has 1224) a frame falls back to `instance_a` with a logged warning. That is a bound on garbage input, such as a non-IRM channel, not a measured operating point.

See §8b for the production record.

**Rollback.** The previous checkpoint stays on disk, and its file name selects its own pipeline. Point
`pretrained_path` and `finetuned_path` in `model_loader.py` back at `microtubule_sparse35_ep040.pth`, rebuild `ml` and recreate
it; the previous image is also tagged `cell-segmentation-hub-ml:pre-mt-v16` for an immediate switch.

### 8b. V16 deployment record

| step | result |
|---|---|
| checkpoint staged on cvat2, copied into `backend/segmentation/weights/` (uid 999) | ✅ 2026-11-03, sha256 `8fc22555…f73` verified on arrival and in the container, 560 307 978 B; SPARSE35 untouched beside it |
| built on top of `feat/neurite-soma-merged` `cc783e5c` (a concurrent deployment), local branch `deploy/mt-v16-on-neurite`, merge `2833871f` | ✅ `make build-service` ml, backend, frontend; rollback images tagged `:pre-mt-v16` |
| tests in the new image, with both real checkpoints | ✅ 157 passed, 0 skipped |
| `scripts/verify_microtubule_model.py` in the image, fixture + 6 real VAL frames | ✅ ALL OK at default tolerances: every curve count equal, median 0.000 px, max 0.397 px. `--strict` fails by design here: reference from torch 2.5.1, image torch 2.6.0, map max \|Δp\| 0.036, 0 flips outside the float16 band |
| recreate ml, backend, frontend, restart nginx | ✅ 2026-11-03 09:01 CET, queue empty; `/health` `production-healthy` |
| container pinned to the commit (`md5sum` of wrapper, params, instancer, loader, `frap_select`) | ✅ 5 of 5 match `HEAD`; `spheroseg-essays` was then still on its 2026-10-06 image, `wrapper.py` md5 `375135db`, SPARSE35 (moved at 10:33, below) |
| through the real queue, e2e account, project `5b9f24b4…`, 6 VAL frames, same frames before and after | ✅ curve counts equal to the research reference on all six, `threshold_used` 0.995 stored; pooled F1 0.681 before, 0.758 after (5 of 6 frames up; a small check, not a benchmark) |
| FRAP targets on the running service | ✅ 2 VAL frames, 6 and 1 spots |
| `neurite_soma_merged` survived the merge | ✅ the concurrent deployment's expected 19 polygons (12 neurite, 2 soma, 5 internal) |
| in-app Documentation and landing page, browser, signed out | ✅ `Microtubule (V16)`, 0.995, no page errors |
| browser check signed in (editor, overlay) | ⬜ not done: the sign-in needs the test account's password in a tool call |
| **Essays moved to V16** (owner's word 2026-11-03 10:19: "dělej to vždy"): `spheroseg-essays` recreated | ✅ 2026-11-03 10:33 CET, no job running; old image tagged `cell-segmentation-hub-essays:pre-mt-v16` |
| Essays through the real queue, e2e account, 4 VAL wells of the Alice recordings (060, 064, 066, 069), same files before and after | ✅ both jobs complete, empty `failures.csv`; `decoder` reads `lh` on all 4392 rows; curve counts equal to the research reference on all four (17, 25, 17, 13), p99 distance ≤ 0.43 px, max 1.32 px at 1.5×. Whole job 20.8 s before and after |
| The same four frames scored against the MT-34 GT (a small check, not a benchmark) | pooled F1 0.871 before, 0.887 after: 060 0.824 → 0.970, 064 0.958 → 0.917, 066 0.737 → 0.686, 069 0.963 → 1.000 |
| Essays GPU working set under V16, in the container | ✅ 1.22 GiB reserved, 0.93 allocated, the same at 1024² and 2048²; cap 2.88 GiB unchanged |
| Tests in the images: Essays module suite with the real V16 checkpoint; microtubule suites | ✅ 138 passed, 0 skipped; 45 passed |

The landing page's outlines (`src/components/landing/specimens.ts`) still predate this model, as they predated SPARSE35; regenerating them is open.

---

# SPARSE35 ep040

Deployed to SpheroSeg on 2026-09-19, replacing v5H (deployed 2026-08-17), and since 2026-11-03
loaded by no service. This is the
reference for what the model is, how it was measured, what it scores, how the deployment
was verified, and how to roll it back. Every number below has a source; none was re-typed
from memory.

| | |
|---|---|
| Model | `SPARSE35 ep040` — nnU-Net ResEnc-M (2D, 8 stages, binary head) + curvature-bounded instancer with **no learned weights** |
| Checkpoint | `weights/microtubule_sparse35_ep040.pth`, 560 307 978 bytes, sha256 `db78ec2d661c4f92557a02378f30b0f710c681c7609061e41828f92acd633531` |
| Source of record | `tulen:/disk2/prusek/mt_work/runs/SPARSE35/ep040.pth` (trained 2026-08-29) |
| Instancer params | `params_sparse35.json` — the DERIVED vector of the research repo's `src/instance/params_a_derived.json` (sha256 `98f2cc49…`) plus the production cut and the output RDP tolerance |
| Foreground cut | **0.98** (not a user setting) |
| Inference | native resolution, 512 px tiles, stride 387, bf16 on CUDA, probabilities resampled ×1.5 for the instancer |
| Modality | IRM (dark filaments on a bright interference background); TIRF appearance was in training but is unvalidated on real TIRF data |
| Annotation used | **none** — trained on synthetic frames only |

## 1. What the model is

A single 2D network predicts a foreground probability for "microtubule centerline band"
at every pixel; a geometric assembler turns the thresholded map into individual open
polylines, one per microtubule, resolving crossings by a min-cost matching of the arms
under a hard curvature bound. Nothing downstream is learned.

- **Network.** nnU-Net's ResEnc-M plan (`net.py`: 8 stages, features 32→512, blocks
  1/3/4/6/6/6/6/6, seven /2 downsamplings), 3 identical input channels (a grayscale frame
  repeated, ImageNet-normalised), one output channel. 1 364 tensors, same key set and
  shapes as v5H, so the checkpoints are drop-in for each other.
- **Training data.** 100 % synthetic: the project's IRM generator (stiff worm-like
  filament morphology, two-beam-interference photometry with polarity flips, real
  empty-field IRM backgrounds, a fitted heavy-tailed dirt model) rendered online during
  training, 40 epochs × 6 000 frames, 512 px crops of 640 px renders. 35 % of frames were
  rendered in the TIRF appearance with a sparse fluorophore label (the "SPARSE35" of the
  name). Calibration file `calib_V6_c070_narrow.json` with its `gen_overrides` (length
  prior fix, photometry fix, crossing height guard).
- **Recipe** (the launcher on tulen, verbatim flags): `--arch nnunet --head binary
  --epochs 40 --epoch-len 6000 --batch 8 --calib calib_V6_c070_narrow.json --seed
  20260827 --tirf-prob 0.35 --tirf-label-sparse --val-data data/real/mt34_htw_eval
  --val-n 16 --params src/instance/params_a_derived.json`; loss BCE (`pos_weight` 8) +
  Dice; nnU-Net's SGD schedule, 30 000 steps; EMA weights saved every 4 epochs.
- **Checkpoint rule.** ep040 — the last epoch, by a rule declared before any number was
  read. The trainer also writes `model.pth`, its own pick on a 16-frame real validation
  trace (epoch 36 for this run); that pick is worth 0.018–0.052 of apparent score and is
  **not** what is deployed or reported.
- **Instancer.** `instance/`: skeleton → arc graph → junction contraction (`merge_radius`
  5.0) → tangent fits over a window → min-cost perfect matching per junction with a priced
  "leave open" option → gap linking. Every join must satisfy κ ≤ 0.25 rad/px, a constant
  derived from the 0.239 rad/px maximum over 957 human-annotated microtubules at an 8 px
  baseline; it is never read from a file. `min_length` 15.0 (at the 1.5× scale) by the
  rule "3 × the metric's tolerance", declared before the numbers existed; the in-domain
  optimum was 20 and the rule was obeyed at a cost of 0.006.

## 2. How it is measured (the declared instrument)

Declared on 2026-09-15, before any of the numbers below were read:

- **Metric:** centerline-F1 at tolerance 5 px on the 1.5× frame, length-coverage and
  precision-coverage 0.80, **pooled micro** over frames as the primary (≥10-GT macro
  alongside); `instance.metrics.aggregate_benchmark`.
- **Threshold:** chosen per model on the block's own VAL split. SPARSE35's own sweep held
  9 nodes (0.90…0.999; every later arm 13, 0.50…0.999): optimum 0.98 on roi303 VAL (micro
  0.6558, with lower neighbours on both sides) and 0.995 on the htw VAL frames (0.6261).
  Production carries ONE value; 0.98 is the primary block's, and §3 gives htw at that cut.
- **Inference:** native scale, no field-of-view mask, empty frames included, derived
  instancer constants, ep040.
- **Test sets:** roi303 TEST (137 frames; the whole block is 276 frames and 14 012
  human-drawn curves after the 2026-09 repair, 14 123 before it; BIOCEV manual annotation)
  primary; htw TEST (33 frames, cross-lab, two annotators) secondary. Each was read once
  under this instrument; the research ledger counts earlier exposures of the same frames
  under the previous metrics.

## 3. What it scores

| block | SPARSE35 ep040, own cut | at the deployed cut 0.98 | oracle mask, same instancer |
|---|---|---|---|
| roi303 TEST (137) | **0.641 ± 0.006** (0.98) | 0.641 | 0.935 |
| htw TEST (33) | **0.601 ± 0.012** (0.995) | 0.565 | 0.871 |

± is the three-seed spread of the recipe on the primary reading. Production ships one cut,
so on the cross-lab block the deployed configuration scores 0.565, not 0.601; the htw
optimum (0.995) trades recall for precision (P 0.614 / R 0.589 against 0.528 / 0.607 at 0.98).

**Caveat that travels with every roi303 number:** the block's VAL and TEST splits share
fields — `roi_img_208` (VAL) is byte-identical to `roi_img_209` (TEST), and 94 sibling
pairs at correlation ≥ 0.99 straddle the split. The TEST figure is provisional until the
split is redone by field. It does not affect the choice of model: every alternative was
read on the same frames.

Where the remaining gap on roi303 goes (VAL, 0.27 below the oracle): stretches the
annotator drew through image that carries no ridge ≈ 0.07, unannotated filaments ≈ 0.05,
crossing erosion ≤ 0.03, field-stop edge ≈ 0.02, near-filament merging 0.01–0.02,
particles ≈ 0.02. Model-owned ≈ 0.06–0.07; the single-frame bound as annotated is
0.74–0.76. Six pre-declared training arms after this model (field stop, amodal head,
anti-aliased renderer, isotropic target, rotation augmentation, `pos_weight` 2/4) were all
null or negative under this instrument, which is why this checkpoint is the one deployed.

## 4. Why it replaces v5H

v5H and SPARSE35 are the same topology; v5H was trained 2026-08-17 on an earlier
calibration, ran the network on a 1.5×-upscaled image, and shipped an instancer vector
**fitted on real validation frames** with `min_length` 44.74. Two of those three are
measured, and one of them is a trade rather than a gain:

- **Native-scale inference** was worth +0.02 to +0.05 in every cell of the September 2×2
  factorial on roi303 VAL (its own paired test did not reach significance, p 0.23); the
  same-block read below carries the whole recipe difference, scale included.
- **The instancer vector.** The 44.74 filter drops short microtubules the network found.
  On the cross-lab htw TEST block (median filament 29 px) that costs an ORACLE mask 0.30
  of macro F1 (44.74 → 0.634, 20 → 0.874, 10 → 0.930, 5 → 0.947; oracle micro 0.614 →
  0.871 at 15) and this model 0.06 of micro F1 at 0.98 (0.505 → 0.565). On the primary
  roi303 block the oracle gains 0.03 (TEST micro 0.904 → 0.935) and **the model scores
  0.02 LOWER with 15 than with 44.74** (TEST micro at own cuts 0.665 → 0.644; recall
  +0.04, precision −0.06). The derived constant was chosen by a rule declared before any
  of these numbers were read, because a filter fitted on one block's validation frames
  is a fit to that block's filament-length distribution; the price on roi303 is paid
  knowingly.

**Same-block read of the deployed v5H weights under the declared instrument** (2026-09-19,
`runs/V5Hread` on tulen; the deployed `microtubule_v5h.pth` symlinked as `runs/V5H/ep040.pth`,
identical protocol to every arm: native inference, derived vector, own thresholds, so the
read isolates the weights + training recipe):

| block (VAL, own thresholds) | v5H | SPARSE35 ep040 | Δ micro | paired (≥ 10-GT frames) |
|---|---|---|---|---|
| roi303 VAL micro (139) | 0.6091 (0.99) | **0.6558** (0.98) | **+0.047** | SPARSE35 better on 76 / 107, Wilcoxon p 3e-7 |
| htw VAL micro (33) | 0.5695 (0.99) | **0.6261** (0.995) | **+0.057** | better on 18 / 26, p 0.20 |
| alice / 586 sources (6 / 11 frames) | 0.815 / 0.499 | 0.727 / 0.430 | −0.088 / −0.069 | inside the spread of sources this small |

At matched recall v5H's precision is 0.062 lower on roi303 and 0.131 lower on htw. v5H's
only previous numbers were on the old strict metric (MT-34 VAL 0.495, combined MT-34 + HTW
TEST 0.409) and are not comparable with the figures above.

## 5. What users will notice

- **Short microtubules appear.** `min_length` 15 instead of 44.74 (both at the 1.5× scale,
  i.e. ≈ 10 px instead of ≈ 30 px of the input frame). A frame that used to show only long
  filaments now shows the short ones the network always found.
- **The map is the frame.** The returned probability map is the network's own output at
  input resolution (no 1.5× round trip), and the instancer's polylines are mapped back
  from 1.5× as before. Coordinates, key set and the polyline contract are unchanged.
- **Cut 0.98 instead of 0.97.** Not user-adjustable; the `/segment` route passes none.
- **Faster.** 0.53 s per 1024×1024 frame (22 microtubules, synthetic) on the research
  host's A5000 for `predict()`; the container figure on a real 88-microtubule frame is in
  §8. v5H was measured at 4.0–4.4 s in the container for a 65-microtubule frame at 1.5×.
  The network now sees 2.25× fewer pixels; the instancer's cost scales with filament
  count. **VRAM peak went UP, not down** — 0.932 GiB peak allocated against v5H's 0.729,
  both measured in the production container on the same real frame (§8). The tile is 512
  either way, so native scale changes the tile COUNT and not the peak; the whole 0.203 GiB
  is the bf16 autocast weight cache, which holds a bf16 copy of the 0.524 GiB of fp32
  weights for the duration of the autocast region. Disabling autocast returns the figure
  to v5H's 0.205 GiB of activations exactly. Do not reason about this peak from pixel
  count.

## 6. Inference path, exactly

`wrapper.py` reproduces `eval_v5.py --infer-scale 1.0 --no-fov` step for step:

1. grayscale frame → whole-frame percentile stretch (1 %, 99 %) → [0, 1]
2. 512 × 512 tiles at stride 387 (`round(512 · 392 / 518)`), each repeated to 3 channels and
   ImageNet-normalised; overlapping tiles averaged; frames smaller than a tile are
   reflect-padded (the harness has no padding; every benchmark frame is ≥ 512 px, so the
   two paths are identical there); bf16 autocast on CUDA
3. probabilities resampled to `(round(1.5 H), round(1.5 W))` bilinearly (`mode="nearest"`
   at the border), the harness's own rounding
4. mask = p > 0.98 → `instance_a(mask, κ_max = 0.25, params_sparse35, channels = p, prob = p)`
5. polylines (x, y at 1.5×) → (row, col) / 1.5 → RDP simplification at 0.30 px (output
   formatting only: the measured path stores the dense polylines, production stores the
   simplified ones, which deviate from them by at most 0.30 input px by construction)

## 7. Verification

**Fixture** (`tests/fixtures/mt_sparse35/`): a 1024 × 1024 synthetic IRM frame from the
generator the model was trained on (calibration `calib_V6_c070_narrow.json`, seed
20260924, composited on the real empty-field background
`A_iris-open_50ms_006_f0230.tif`), saved as 16-bit PNG, with its **exact ground truth**
(32 filaments) and what the research harness emits for that PNG: the 1.5× probability map
(float16) and 22 polylines. Six candidate seeds were rendered and the one the model
resolves best was kept (F1 0.741 against the exact GT, tp 20 / fp 2 / fn 12; the other
five scored 0.22–0.66 and are listed in `manifest.json`) — the fixture is a fixture, not a
measurement, and the point of choosing a well-resolved frame is that a human looking at
the overlay sees a working model.

**What the check proves** (`reference_check.py`, run by `tests/test_microtubule_reference.py`
and by `scripts/verify_microtubule_model.py` in the container): two levels, kept apart on
purpose — the probability map (inference path) and the polyline set (instancer). A
single F1 could not say which half drifted.

**Results.**

| where | image | map max \|Δp\| | flips outside the float16 band | polylines |
|---|---|---|---|---|
| tulen A5000, torch 2.5.1 (the harness's own environment), strict | fixture | 0.0002 | 0 | 22 / 22 matched, 0.000 px |
| same | `training_img_114.tif` (a real 1024² IRM frame kept on the production host, not in git) | 0.0002 | 0 | 88 / 88 matched, 0.000 px |
| production container (`spheroseg-ml`, torch 2.6.0) | fixture + `training_img_114.tif` | _see §8_ | | |

The 0.0002 is the float16 storage of the reference map, not the model. A checkpoint-free
copy of level 2 runs in every test session (`test_vendored_instancer_reproduces_the_reference_from_the_committed_map`):
the committed map thresholded at 0.98 through the vendored instancer gives 22 / 22, and it
is discriminative (min_length 44.74 → 7 / 22, merge_radius 8.98 → 21 / 22).

## 8. Deployment record

Filled in as the deployment proceeds; a blank cell means the step has not happened. The
rows below the merge are filled by the follow-up commit that records the deployment.

| step | result |
|---|---|
| checkpoint staged on cvat2 (`/home/cvat/tmp/mt_sparse35/`), sha256 verified | ✅ 2026-09-19 13:31 CEST |
| copied into `backend/segmentation/weights/` (uid 999) | ✅ sha256 `db78ec2d…33531` re-verified in the container, 560 307 978 B |
| `make build-service SERVICE=ml` + `--force-recreate ml` | ✅ 2026-09-19 14:26 CEST |
| `/health` | ✅ `production-healthy`; ml `{"status":"healthy","models_loaded":5,"gpu_available":true}` |
| container pinned to the commit (`md5sum /app/models/microtubule/wrapper.py`) | ✅ all **56** files of `api/`, `ml/`, `config/` and `models/microtubule` match `HEAD` — 0 differ, 0 missing |
| `scripts/verify_microtubule_model.py` in the container | ✅ ALL OK. fixture 22/22 at 0.000 px median (max 0.081), map max \|Δp\| 0.0113 with 0 flips; `training_img_114.tif` 88/88 at 0.000 px (max 0.573), max \|Δp\| 0.0108, 13 flips (5.5e-6). Tolerance is `CUDA_TOL` (0.05 / 2e-4 / 1.0 px / 0.95 / ±1) |
| browser check (test account, microtubule project, fixture upload, segmentation) | ✅ 2026-09-19 17:52 CEST, `claude.e2e.export@example.com`, project "claude e2e SPARSE35 check". Upload → Segment All → editor: 22 polylines, 162 vertices, **0 console errors**. ML log: `Microtubule SPARSE35: 22 centerlines in 0.50s`, threshold 0.98 |
| v5H same-block read (§4) | ✅ 2026-09-19 14:25 CEST, `runs/V5Hread`, read with `read_arm.py` |

### Measured in the production container, 2026-09-19

`predict()` on the A5000, torch 2.6.0+cu124, three runs after a warm-up, against the
**same** frames through the v5H package imported from a scratch path (`git archive
0ec7f61d`) so the two are one measurement and not two:

| | v5H | SPARSE35 ep040 |
|---|---|---|
| `training_img_114.tif` 1024² | 0.83–0.84 s, 65 MT | **0.60–0.62 s, 88 MT** |
| 2048² | 3.66–3.74 s, 266 MT | **2.69–2.72 s, 345 MT** |
| 1924×1476 (the modal production MT frame, 1 800 of them) | — | **1.79–1.88 s, 256 MT** |
| weights resident on GPU | 0.524 GiB | 0.524 GiB |
| peak allocated, FLAT across 512² / 1024² / 2048² | 0.729 GiB | 0.932 GiB |
| peak reserved | 0.881 GiB | 1.043 GiB |

So the served `batch_sizes.json` figures are sound: `expected_throughput` 1.7 img/s against
1.6–1.7 measured, and `p95_latency_ms` 2000 against 1.88 s at the modal frame size carrying
256 microtubules — above the production p95 of 146 polylines per frame (4 031 microtubule
segmentations: p50 73, p95 146, max 311). `memory_limit_mb` 1500 still clears the measured
1.043 GiB peak reserved, but see §5: the REASON recorded for it was wrong.

The v5H entry's `expected_throughput` 0.22 img/s (p95 9 s) was not wrong when written on
2026-08-17 — it was stale. The instancer was made ~5× faster on 2026-09-04/05 (`23847736`,
`04a08463`), so the same v5H weights now measure 0.83 s where they measured 4.0–4.4 s.

**Does the derived vector actually earn its keep?** On the committed fixture, whose ground
truth is exact: 16 of the 22 polylines are shorter than the v5H filter (44.74 at 1.5× =
29.8 input px) and would have been dropped. **14 of those 16 lie 100 % on a true filament**;
2 are false positives. Ground-truth length covered goes from **0.438 with the long ones only
to 0.907 with all 22**. On a real production IRM frame (`denisa_test`, 1924×1476, the `IRM`
channel of a 3-channel ND2) the stored v5H result has 142 polylines and SPARSE35 finds 160;
sampling background-flattened contrast along each centerline against the same curve
translated elsewhere gives **−1.54 SD** overall and −1.18 SD for the 13 new short ones —
negative is a real IRM microtubule, so they carry evidence.

**Caveat the change makes louder.** A channel that is typed `irm` only because a multi-page
TIFF carries no wavelength is not IRM, and the length filter used to hide that. On
`20260429_CH2_DNA_origami…TEST_3frames.tif` (all three channels typed `irm`; the frame is
fluorescent puncta, no filaments at all) v5H emitted 7 polylines and SPARSE35 emits **36**,
at **+2.42 SD** — positive, i.e. sitting on pixels BRIGHTER than their surround, the
opposite of an IRM microtubule. Nothing regressed in the model; the wrong-channel symptom
simply got ~5× louder. Diagnose such a project by its `channels` JSON, not by the count.

## 9. The Automated Essays worker

`backend/essays` imports this package and reads the same weights file name
(`_mt_package.WEIGHTS_NAME`). Its **code** changed in the deploy commit so both consumers
name the same model; its **container** (`spheroseg-essays`) bakes the package at image
build and was deliberately left alone there, because `min_length` 44.74 → 15 changes
outputs collaborators already have — a decision, not a side effect.

**Resolved 2026-09-19 18:22 UTC: the owner chose to rebuild, and it is done.**
`make build-essays` + `--force-recreate essays`. Verified in the recreated container:
`wrapper.py`, `net.py` and `params_sparse35.json` all match `HEAD`,
`WEIGHTS_NAME = microtubule_sparse35_ep040.pth` resolves to `/app/mt_weights/`, the model
loads at `DEFAULT_SEED_THRESHOLD` 0.98 / `min_length` 15.0, and `/health` reports
`{"status":"ok","queued":0,"gpu":"ok"}`. The queue was empty at rebuild time (10 completed
jobs, 1 failed, newest 2026-08-25) so no run was interrupted. **Both consumers now run
SPARSE35 ep040**, and essays numbers from before this date are not comparable with later
ones for the same reason §4 gives.

Worth recording because it was not what the deploy notes assumed: the container had been
running the wrapper from `9d4cb6c4` (2026-08-26), not the v5H that was on `main` before
the swap — it was two wrapper-touching commits behind, missing `04a08463`. That commit is
a pure performance rewrite proven bit-identical by `test_instancer_perf_identity.py`, so
the assay's numbers were unaffected and only its speed was; but "the essays worker runs
what `main` ran" was not true, and a baked image is not pinned by the branch it was built
from. Pin it with `md5sum`, as §8 does for `ml`.

GPU budget re-checked after the rebuild rather than assumed: SPARSE35 measures 1.043 GiB
peak reserved / 0.932 allocated on a 2048² frame inside the essays container under the
production cap (`ESSAYS_GPU_MEM_FRACTION` 0.12 = 2.83 GiB). `GPU_WORKING_SET_GB` is left
at 1.41 — that constant came from a whole `evaluate.py` run over a real multi-position
well and is not the same quantity as a model-only peak, so lowering it on this evidence
would weaken a safety bound on weaker data than set it. All five invariants in
`tests/test_gpu_budget.py` still hold with room: cap 2.83 ≥ 1.41, cap ≥ 1.5× working set
(2.83 ≥ 2.12), gate 4 ≥ 1.41, gate ≥ cap + 0.4 (4 ≥ 3.23), cap ≤ working set + 2.0
(2.83 ≤ 3.41).

## 10. Limitations

- IRM only in practice. On a TIRF frame the v5H-era evidence showed the output does not
  track image content; nothing about that was re-measured for this model.
- The remaining gap is mostly the annotation's (§3): stretches without image evidence,
  unannotated filaments. The model cannot close those from a single frame.
- Grid anisotropy: on real frames, filaments running along the pixel axes lose 2.5–2.8×
  more stretches than oblique ones. Real, characterised, not fixable by three isotropy
  interventions that were tried.
- Dense, crossing-heavy fields remain harder; 84 % of crossing failures are a weak arm
  8–20 px from the crossing, not a wrong join.
- Per-frame confidence scale varies with density / SNR; one production cut cannot be
  optimal on every frame.

## 11. Rollback

Everything v5H needs is still in place: `weights/microtubule_v5h.pth` on the host,
`params_v5h.json` in this directory. To roll back, revert the commits of PR #551 (this
card, the wrapper, the UI name), rebuild and recreate the `ml` service and the `frontend`.
The v5H wrapper ran the network at 1.5×, so the revert must include `wrapper.py` and
`net.py`, not just the file names. If the `essays` image has been rebuilt onto SPARSE35 in
the meantime, rebuild it again after the revert, or the two consumers disagree.

## 12. Updating the model again

1. Read the candidate under the declared instrument on the research host; write the
   numbers here first.
2. Stage the checkpoint with a new versioned name; pin its sha256 in
   `scripts/download-microtubule-weights.sh`.
3. Regenerate the fixture references with the research harness on the committed PNG
   (`make_mt_fixture.py` — committed beside the fixture and as `scripts/make_mt_fixture.py`
   in the research repo — reads the PNG back, so the quantisation is shared).
4. Run `tests/test_microtubule_reference.py` with `MT_REF_STRICT=1` on the research host,
   then `scripts/verify_microtubule_model.py` in the container after the rebuild.
5. Update §3, §4, §7, §8 of this card and the `batch_sizes.json` note.
