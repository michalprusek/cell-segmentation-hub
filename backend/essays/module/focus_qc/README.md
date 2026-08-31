# focus_qc — out-of-focus frame detection for IRM + fluorescence

Flags a frame as out of focus when **any** channel falls below its calibrated
threshold. Built for two-channel IRM + TIRF acquisitions of in-vitro
microtubules, but the descriptor is not microtubule-specific.

## How it is used here (vendored 2026-08-31)

`mt_pipeline/nd2_io.judge_focus` calls `detect.score_frame` /
`detect.judge_frame` **in process**, on the raw `uint16` arrays
`iter_positions` already holds, and writes the verdict to `results.csv`
(`focus_*`), to `focus_qc.csv` (one row per position) and into each annotation
JSON. Nothing is gated on it — see `../README.md` §1 for the reasoning.

Three things about that integration are load-bearing:

- **The CLI cannot read essays wells, and that is correct.** `zstack.frame_axis`
  requires a `(frame, C, Y, X)` layout whose frame axis is `Z` or `T`, and
  refuses `P` by name because multipoint frames are unrelated stage positions,
  not a defocus series. Real wells are `(P, C, Y, X)`, so `focus_qc.cli detect`
  fails on every one of them by design. Shelling out would also re-read a 1.5 GB
  ND2 a second time. `cli.py` stays for **`calibrate`**, which is the documented
  remedy when `out_of_calibration` fires; point the worker at its output with
  `ESSAYS_FOCUS_CALIBRATION=/path/to/calibration.json`, no rebuild needed.
- **The 488 in-solution channel is never scored** — uniform dye, no structure;
  it measured 0.01 and 0.00 on two real positions, so the OR rule would flag
  every row of every well.
- **`predict.py` was dropped** in vendoring. It was a thin CLI shell over the
  same three functions, it could not read essays wells either, and it did a
  module-level `sys.path.insert` that has no place in a library import.
- **`requirements.txt` was dropped too.** Its four entries (`numpy>=1.24`,
  `scipy>=1.10`, `nd2>=0.10`, `tifffile>=2023.1`) are a strict subset of
  `../requirements.txt`, which already pins numpy 1.26.4 / scipy 1.15.3 / nd2 /
  tifffile — and nothing here is pip-installed anyway, since the essays image is
  built `FROM` the ml image. A second dependency file would be one more place
  for the pins to drift, which is precisely what CI's `pins` job exists to
  prevent.

`metrics.py` was rewritten for speed in the same change — bit-identically,
proven on every position and channel of two real wells at 1400² and 2048² plus
the golden frames. See its module docstring and
`tests/test_metrics.py::TestOptimisedFormsAreBitIdentical`.

**The "a few milliseconds per frame" below is wrong at production frame sizes.**
Measured in the essays image on real wells, min-of-9 back to back in one
process, per position (both channels):

| | 1400² | 2048² |
|---|---|---|
| before this change | 177 ms | 472 ms |
| bit-identical metrics | 163 ms | 425 ms |
| …plus scored concurrently | **95 ms** | **300 ms** |

The rewrite accounts for 7–10 %, and the same figure in CPU time (175 → 163 ms
and 469 → 420 ms), which is the contention-robust half of the claim. The rest is
`nd2_io.judge_focus` scoring the two channels concurrently — worth having only
while a second core is free; at load 30 on 4 cores it measured nothing at all.

## The idea

Ask how much of the frame is occupied by structure that rises above the frame's
**own** noise floor:

1. estimate a robust noise sigma from horizontal pixel differences (structure is
   correlated between neighbours, noise is not, so differencing isolates it);
2. subtract a local background (`uniform_filter`, `BG_SIZE = 31` px);
3. count the fraction of pixels past +5σ **in the signal-bearing tail**, in
   pixels per 10,000.

In focus, a microtubule's photons sit in a narrow line — roughly 3 px at this
pixel size, by the diffraction limit — that clears 5σ. Defocused, the *same*
photons spread over a wider profile and sink below it, so the count collapses.
IRM reads the **negative** tail (dark microtubules on a bright field),
fluorescence the **positive** tail (bright puncta on a dark field); `modality`
selects which. Only one tail is counted, not both.

Because the threshold is in units of the frame's own noise and measured against a
local background, the score is insensitive to camera gain, to a constant offset,
and to smooth illumination shading.

`BG_SIZE` is fixed in **pixels**, not micrometres — 31 px is ~2.2 µm at the
0.0722 µm/px of the reference acquisition. Nothing in the code enforces that
physical scale, so revisit it if the pixel size changes materially.

### The noise estimate is deliberately not a plain MAD

A median-absolute-deviation is robust but *quantised* on integer camera data: the
MAD of integer differences is an integer, so the estimate can only move in steps
of ~1.05 ADU. On a photon-starved channel one such step swings the 5σ pixel count
severalfold — larger than the in-focus margin at the tolerance edge. So the MAD is
used only to decide *which* differences are noise, and the estimate itself is the
standard deviation of those, which varies continuously. On the reference stacks
this turns a single repeated sigma value into 205 distinct ones.

## Why not variance of Laplacian

It is the standard autofocus operator and it does find the focal plane by argmax
over a stack. But its *absolute* value is meaningless, which is what this task
needs. Measured on the reference stacks by `reference/compare_alternatives.py`,
as the 5th percentile of in-focus scores over the 95th percentile of
out-of-focus scores:

| descriptor | IRM | TIRF 488 |
|---|---|---|
| structure area (this module) | **1.97×** | **5.01×** |
| variance of Laplacian | 0.83× | 0.92× |

Below 1.0× means the classes are ordered the wrong way round at the tails: no
absolute threshold separates them at all.

The IRM figure of 1.97× is the binding constraint on any change to the
descriptor — `test_in_focus_and_out_of_focus_scores_stay_separated` fails below
1.8×. There is not much headroom.

## Why not a CNN

Yang et al. 2018, *BMC Bioinformatics* 19:77 ([doi:10.1186/s12859-018-2087-4](https://doi.org/10.1186/s12859-018-2087-4))
is the reference method — a CNN trained on synthetically defocused images that
predicts an absolute focus measure from a single frame, shipped in Fiji and
CellProfiler. Retraining it for this data would need far more than the five
stacks available here, all from one acquisition session, so a network would learn
this exposure rather than defocus. The published model is also
fluorescence/pathology-trained, and IRM is out of its domain.

## Usage

Calibrate from annotated z-stacks (the annotation is the 1-based index of the
sharp plane):

```bash
python -m focus_qc.cli calibrate \
  --dataset focus_qc/reference/zstacks_oof_spec.json \
  --out calibration.json --report report.md --cache scores_cache.json \
  --tolerance-um 0.3 --guard-um 0.1
```

Then flag frames in a movie:

```bash
python -m focus_qc.cli detect \
  --calibration calibration.json --dataset focus_qc/reference/zstacks_oof_spec.json \
  --input movie.nd2 --out flags.csv
```

`flags.csv` carries a per-channel score and flag, the OR verdict, and the
`unscoreable` / `out_of_calibration` columns. `detect` exits **3** when either of
those fired on any frame, so a pipeline can stop on an untrustworthy result.

## Choosing the threshold

Not by maximising balanced accuracy. The two classes **overlap** — a handful of
out-of-focus planes outscore the dimmest in-focus ones — so the BA-argmax lands
wherever those few overlapping planes happen to fall, and moves several-fold
between leave-one-stack-out folds. The threshold is instead the **geometric
midpoint** between the 5th percentile of in-focus scores and the 95th percentile
of out-of-focus scores: equal *relative* headroom on both sides, which is what
survives exposure drift that scales everything at once.

Planes in a guard band just outside the tolerance are excluded from both classes.
The sharp plane is eyeballed, and at a 0.1 µm step that judgement is worth about
one plane; training on the boundary would fit annotation noise.

## The domain guard, and what it is for

The calibration records the noise sigma and background level it was fitted on.
`detect` marks any frame whose statistics drift more than 2× outside that range
as `out_of_calibration`, and reports the count on stderr. It is **advisory** — it
never changes the verdict.

This exists because an absolute threshold is only valid for the acquisition it
was calibrated on. **Recalibrate when the exposure, camera setting, or labelling
density changes.** Note what the guard does *not* watch: it tracks noise and
background only, so a change in labelling density or in how much sample is in the
field will not trip it.

A frame whose noise floor cannot be measured at all — constant, saturated,
quantised below one count, or containing non-finite pixels — is refused by
`focus_score` and reported as `unscoreable`, which flags the frame. This is the
fail-safe direction, and it matters: dividing by a near-zero sigma would multiply
the residual enough that every pixel clears the cut, reporting a blank frame as
maximally in focus.

## Results on the reference data

Five z-stacks, 41 planes × 2 channels, 0.1 µm step, tolerance ±0.3 µm,
leave-one-stack-out (a threshold fitted on four stacks, tested on the fifth):

| channel | mean balanced accuracy | worst fold |
|---|---|---|
| IRM | 0.953 | 0.913 |
| TIRF 488 | 0.967 | 0.929 |
| **OR (frame verdict)** | **0.959** | **0.929** |

Six planes out of 205 disagree with the annotation:

| stack | plane | distance from focus | kind |
|---|---|---|---|
| 002 | 17 | 0.3 µm | in focus, flagged |
| 003 | 10 | 0.3 µm | in focus, flagged |
| 004 | 32, 33 | 0.5, 0.6 µm | out of focus, kept |
| 005 | 29, 30 | 0.5, 0.6 µm | out of focus, kept |

The two at the tolerance edge are within annotation uncertainty. The four kept
frames at 0.5–0.6 µm are **genuine misses** — 0.6 µm is two planes past the guard
band, too far to explain as a one-plane annotation error.

Both channels place focus within one plane (0.1 µm) of each other in all five
stacks, so the OR rule is effectively one decision rather than two here. That may
not hold for other optical setups; the calibration report prints the per-channel
numbers so you can check.

### How much headroom the threshold actually has

| channel | worst in-focus plane | p5 | median |
|---|---|---|---|
| IRM | 0.49× threshold | 1.40× | 7.0× |
| TIRF 488 | 0.22× threshold | 2.24× | 20.9× |

The medians are comfortable; the tolerance-edge planes are not, and the worst
in-focus plane in each channel sits *below* threshold — those are the two
disagreements in the table above. Do not read the median as a safety margin.

### What the accuracy figures do and do not support

Leave-one-stack-out validates the threshold **value** out of fold. It does not
validate the threshold *rule*, the descriptor constants, or the 0.3/0.1 µm
tolerance and guard, all of which were chosen while looking at these same five
stacks — so 0.953/0.967 is optimistic. All five stacks also come from one
acquisition session, so the folds are not independent acquisitions and these
numbers do **not** support a cross-session transfer claim. That is exactly the
claim `detect` relies on, which is why the domain guard exists.

## ND2 layout

`iter_stack_planes` requires a file laid out `(frame, channel, Y, X)` and
`frame_axis` refuses anything else — a mis-identified axis would score the wrong
pixels and still return plausible numbers. The frame axis must be `Z` or `T`, so
the same loader reads the calibration stacks and a timelapse; a multipoint (`P`)
or series (`S`) axis is rejected by name, because its frames are unrelated stage
positions rather than a defocus series.

## Layout

| file | role |
|---|---|
| `metrics.py` | per-frame descriptors; no I/O, no thresholds |
| `calibration.py` | threshold selection, the calibration record, evaluation |
| `detect.py` | per-frame verdict: threshold each channel, combine by OR |
| `zstack.py` | labelling planes by defocus, reading and scoring ND2 stacks |
| `cli.py` | `calibrate` and `detect` commands |
| `reference/` | the five-stack spec, cached scores, fitted calibration, and the script behind the comparison table above |

## Tests

```bash
cd code/microtubules && python3 -m pytest focus_qc/tests -q
```

112 tests, all offline. Two layers, and the distinction matters:

- `TestGoldenFrame` pins `focus_score` against a deterministic synthetic frame,
  so a change to `BG_SIZE`, `K_SIGMA`, `GRAD_SIGMA` or the noise estimator fails
  the suite.
- `TestReferenceStacks` runs on the cached per-plane scores and pins the six
  published accuracy figures to ±0.001. It guards the threshold-fitting and
  labelling code over frozen inputs and **cannot** detect a descriptor change,
  which is why the golden-frame layer exists.

The suite was mutation tested by hand during development — the harness is not
committed, so treat the coverage claim as a record of what was checked, not
something you can re-run. Each of these was confirmed caught: dropping the noise
normalisation; swapping OR for AND; an off-by-one on the 1-based annotation;
arithmetic instead of geometric midpoint; skipping the ND2 layout guard;
indexing channels by spec order rather than file order; transposed image axes;
`BG_SIZE` 31→51; `GRAD_SIGMA` 4.0→3.0; `K_SIGMA` 5.0→4.5; papering over a zero
sigma with an epsilon; reverting to the quantised MAD; letting a NaN score pass
as in focus; reusing a cache without provenance; allowing two channels to share
one modality; truncating the output file on an empty result; accepting a
multipoint axis; accepting a zero-length frame axis; returning NaN metrics for an
empty class; accepting an inverted domain range; accepting a calibration whose
thresholds and domain disagree; accepting an unknown modality; and returning 0.0
instead of NaN for unmeasurable sharpness.
