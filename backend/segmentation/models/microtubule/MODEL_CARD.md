# Microtubule model card — SPARSE35 ep040

Deployed to SpheroSeg on 2026-09-19, replacing v5H (deployed 2026-08-17). This is the
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
  count. VRAM peak can only be lower than v5H's 0.73 GiB (same tile, same topology).

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
| copied into `backend/segmentation/weights/` (uid 999) | |
| `make build-service SERVICE=ml` + `--force-recreate ml` | |
| `/health` | |
| container pinned to the commit (`md5sum /app/models/microtubule/wrapper.py`) | |
| `scripts/verify_microtubule_model.py` in the container | |
| browser check (test account, microtubule project, fixture upload, segmentation) | |
| v5H same-block read (§4) | ✅ 2026-09-19 14:25 CEST, `runs/V5Hread`, read with `read_arm.py` |

## 9. The Automated Essays worker

`backend/essays` imports this package and reads the same weights file name
(`_mt_package.WEIGHTS_NAME`). Its **code** changed in this commit so both consumers name
the same model; its **container** (`spheroseg-essays`) bakes the package at image build
and was **not** rebuilt in this deployment — it keeps running v5H until it is rebuilt
(`make build-essays` or the equivalent, then recreate). Until then the two consumers run
different models; rolling the `ml` service back (§11) restores agreement, rebuilding
`essays` moves both to SPARSE35. Reason: the essays outputs are a
running assay that collaborators consume, and `min_length` 44.74 → 15 changes what they
get; that is a decision, not a side effect. Recorded here so the "one package, two
consumers" trap is visible rather than silent.

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
