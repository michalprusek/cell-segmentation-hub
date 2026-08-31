# Automated Essays module

**Automated microtubule analysis of ND2 well recordings.** Point this tool at a
folder of `.nd2` files (one per well) and it detects every microtubule (MT) in
every position and writes one table row per microtubule with its length and its
on-MT vs. background fluorescence — plus the well's solution concentration.

It wraps a trained instance-segmentation model (**nnU-Net ResEnc-M → a
curvature-bounded instancer**, "microtubule v5H") that traces each microtubule
as an open centerline; a
measurement layer turns those centerlines into numbers.

The two imaging channels have separate jobs and are **not** interchangeable:

* **IRM** is the *segmentation* input — the channel the model was trained on.
* **TIRF** is the *readout* — the intensities integrated along the centerlines.

![Detected microtubule centerlines on a TIRF frame](docs/example_overlay.png)

*Each coloured line is one detected microtubule (well D04, position 0 — 70 MTs).*

---

## Contents

1. [What it measures](#1-what-it-measures)
2. [Quick start](#2-quick-start)
3. [Installation](#3-installation)
4. [The model weights](#4-the-model-weights)
5. [Running it](#5-running-it)
6. [Command-line options](#6-command-line-options)
7. [Input: what the ND2 files must contain](#7-input-what-the-nd2-files-must-contain)
8. [Output](#8-output)
9. [How the measurements are defined](#9-how-the-measurements-are-defined)
10. [Performance](#10-performance)
11. [Troubleshooting](#11-troubleshooting)
12. [FAQ](#12-faq)
13. [Repository layout](#13-repository-layout)

---

## 1. What it measures

For **every microtubule** in every position of every well, one row in
`results.csv`:

| Column | Meaning |
| ------ | ------- |
| `well_id` | well identifier parsed from the file name (e.g. `D04`) |
| `position` | 0-based field-of-view index within the well |
| `mt_id` | microtubule index within that position (1, 2, 3, …) |
| `solution_intensity_median` | **solution concentration proxy** = median of the `488 InSol` channel for that position |
| `length_px`, `length_um` | microtubule length along its centerline (µm uses the ND2 pixel calibration) |
| `mt_mean_intensity` | mean TIRF intensity over the **MT band** (strip `--mt-width`, default 5 px, wide) |
| `mt_std_intensity` | standard deviation of TIRF intensity over the MT band |
| `mt_sum_intensity` | summed (integrated) TIRF intensity over the MT band |
| `bg_mean_intensity` | mean TIRF intensity over the **background ring** around the MT |
| `bg_median_intensity` | median TIRF intensity over the background ring (robust to bright spots) |
| `bg_sum_intensity` | summed TIRF intensity over the background ring |
| `net_mean_intensity` | `mt_mean_intensity − bg_mean_intensity` (background-subtracted signal) |
| `n_px_mt`, `n_px_bg` | number of pixels in the band / ring |
| `source_file` | originating `.nd2` file name |
| `acquired_at` | when the well was recorded, **ISO-8601 UTC** (e.g. `2026-05-19T21:48:02Z`) — read from the ND2 itself, so it identifies the run no matter how the folder is named |
| `irm_tirf_dy`, `irm_tirf_dx` | **measured** offset between the IRM and TIRF channels of this position, in pixels — a diagnostic, never applied (see below) |
| `irm_tirf_quality` | peak dominance of that measurement: the winning correlation peak over its best rival |
| `irm_tirf_reason` | `ok` if the measurement is trustworthy; `implausible_shift` / `low_confidence` if the correlation was **refused**; `estimator_unavailable` or `error:<Type>` if the measurement **could not run** (a deployment problem, not a data one). Blank when the position carried no measurement |
| `focus_irm_score`, `focus_tirf_score` | **measured** out-of-focus descriptor for this position's IRM and TIRF frames: the area occupied by structure standing more than 5σ above the local background, in **pixels per 10,000**. Higher is sharper |
| `focus_flagged` | `1` if **either** channel scored below its threshold (7.640 for IRM, 0.184 for fluorescence), `0` if both cleared it. Advisory — nothing is excluded and no run fails because of it. Blank when nothing was measured |
| `focus_reason` | `ok`, or a `;`-joined list of `oof:<channel>` (below threshold), `unscoreable:<channel>` (no noise floor could be measured — blank / saturated), and `out_of_calibration:<channel>` (the acquisition drifted outside the calibrated domain, so the absolute threshold may not apply). `detector_unavailable` / `error:<Type>` mean the check **could not run** |

`irm_tirf_dy` / `irm_tirf_dx` are blank whenever `irm_tirf_reason` is not `ok`:
a refused estimate has no offset, and writing `0, 0` there would be
indistinguishable from a perfectly aligned pair. `irm_tirf_quality` is still
reported on a refusal — it is the number that says how badly — and blank only
when nothing ran at all.

The centerlines come from the **IRM** channel; every `mt_*` / `bg_*` intensity is
measured on the **TIRF** channel.

### Reading the channel-alignment columns

**`irm_tirf_reason` is a refusal — `implausible_shift` or `low_confidence` —
on most rows, and that is the expected, correct output, not a failed run.**
(`estimator_unavailable` and `error:<Type>` are different: they mean the code
did not run, and a whole batch reading one of those is a broken deployment.) IRM and TIRF do not share edges:
IRM is interference contrast off the coverslip surface, TIRF is fluorescence
from the filaments. The phase correlation the measurement relies on has no
common structure to lock onto, so its quality gate refuses.

Measured over 180 production wells (2026-08-30): the estimator recovers an
injected `(5, -3)` from IRM against *shifted IRM* 15/15 times at quality ~7000,
but from IRM against *shifted TIRF* it is accepted only 6/15 times and every
accepted answer is wrong by 1–2 px, at quality 0.5–2.9. The real offset measures
**0–1 px**.

These columns therefore exist to make a *genuinely* misaligned acquisition
visible — it would read `ok` with a quality well above 1 **and** a non-zero
offset — without any run's pixels or intensities changing. Nothing is shifted:
`net_mean_intensity` and its siblings mean exactly what they meant before this
column existed, and runs stay comparable across it.

One gap worth knowing: `results.csv` has one row per microtubule, so a position
where the model detects nothing carries no alignment row either — and a
zero-detection position is not a failure, so it is not in `failures.csv`. A
misaligned acquisition that yields no detections therefore leaves no record.

Applying a correction here was considered and rejected: on this data it would be
a no-op on ~60 % of positions and a demonstrably wrong 1–2 px shift on the rest,
which is the 2026-08 registration defect (a noise peak written into the data)
reproduced in the readout.

### Reading the out-of-focus columns

**`focus_flagged` is a label on a row, never a gate.** Nothing is excluded, no
row is withheld and the process exit code is unaffected. That is deliberate:
the descriptor counts *occupied area*, so it **conflates focus with field
density and fails permissive** — in the method's own validation one dense field
dropped only 15.0× → 11.6× under a 0.5 µm defocus, where the calibration fields
drop by 88 %. Bad data can pass. Good data is never thrown away.

The scores come from `focus_qc/` (vendored beside this module, pure NumPy/SciPy,
no weights and no GPU). They are computed on the **raw 16-bit ND2 frames** at
read time and nowhere else: the descriptor thresholds at 5σ of the frame's own
noise, and the 8-bit percentile-clipped PNGs the web app stores destroy exactly
that information — scores taken from those are meaningless, not merely noisier.

**`out_of_calibration:<channel>` is common and does not mean the frame is bad.**
The thresholds are absolute and only valid for the acquisition they were fitted
on. Measured 2026-08-31 on a 2048×2048 well: all three positions are comfortably
in focus on both channels, and all three read `out_of_calibration:TIRF 488`
(noise σ 27.8–33.1 against a fitted 5.79–5.89, background 296–347 against
110–111). It is advisory and never changes `focus_flagged`; what it says is
*recalibrate for this exposure* — one command, `python -m focus_qc.cli
calibrate` (see `focus_qc/README.md`), after which point the worker at the new
file with `ESSAYS_FOCUS_CALIBRATION=/path/to/calibration.json`. No rebuild.

The published accuracy — 0.959 balanced, IRM 0.953 / TIRF 0.967 — is
leave-one-**stack**-out inside a *single* acquisition session, and it validates
the threshold *value* out of fold, not the threshold rule, the descriptor
constants or the ±0.3 µm tolerance, all of which were chosen while looking at
those same five stacks. Treat the columns as triage, not as an acceptance test.

The **488 in-solution channel is deliberately not scored**: it is uniform dye
with no structure to resolve, and it measured 0.01 and 0.00 on two real
positions of `WellD04` — both below the 0.184 fluorescence cut. Folding it into
the verdict would flag every row of every well.

Unlike the alignment columns above, the focus verdict does **not** vanish on a
position where the model detects nothing: `focus_qc.csv` carries one row per
position that was *read*, including positions with zero microtubules and
positions whose segmentation later failed — which is where a badly defocused
field actually shows up. (The alignment gap is still open; it only lives in
`results.csv`.)

It also writes **two QC overlay PNGs** (one per channel) and a **polyline
annotation JSON** per position (toggle off with `--no-overlays` / `--no-json`),
and a **`focus_qc.csv`** with one row per position (never toggled off).

---

## 2. Quick start

In the app, this runs as the `essays` service and you drive it from the
**Automated Essays** page — nothing below is needed. The steps here are for
running the batch assay standalone, on a laptop:

```bash
cd backend/essays/module

python3 -m venv .venv
source .venv/bin/activate                 # Windows: .venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt

# stage the 535 MB checkpoint once (from the repo root)
../../../scripts/download-microtubule-weights.sh

python evaluate.py --data /path/to/well_recordings --out results/
```

Results land in `results/results.csv`, with `results/overlays/` and
`results/annotations/`.

> **Try one well first:** add `--limit-wells 1` for a ~2–3 minute smoke run
> before launching the whole batch.

---

## 3. Installation

**Requirements:** Python **3.10–3.12** and ~2 GB free disk (535 MB weights + the
dependencies).

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

All dependencies are version-pinned (`requirements.txt`) to exactly the
versions the model was trained/validated against — `torch 2.6.0`,
`transformers 4.57.1`, `numpy 1.26.4`, etc. — and ship as prebuilt wheels for
macOS arm64 and Linux x86-64, so nothing is compiled. **Use a virtual
environment**; installing these pins globally may clash with other projects.

A CUDA GPU is used automatically if present (much faster); otherwise it runs on
CPU.

---

## 4. The model weights

The 535 MB checkpoint `microtubule_v5h.pth` is **not** stored in git — it is the
same file the ML service uses, staged out-of-band from the repo root:

```bash
scripts/download-microtubule-weights.sh    # -> backend/segmentation/weights/microtubule_v5h.pth
```

`evaluate.py` finds it automatically, looking in this order: `$ESSAYS_WEIGHTS`,
`backend/segmentation/weights/`, then `/app/mt_weights/` (where the essays
container bind-mounts that same directory read-only). Pass
`--weights /path/to/microtubule_v5h.pth` to override.

> **No HuggingFace token or login is required.** The checkpoint is a complete
> `state_dict` with no frozen backbone to fetch — the pipeline runs with no network
> access once the weights are present. (See [`MODEL.md`](MODEL.md) for the
> optional online path.)

---

## 5. Running it

```bash
# a whole folder of wells (searched recursively)
python evaluate.py --data /data/260619_Consistency_2 --out results/

# a single file
python evaluate.py --data /data/WellD04_....nd2 --out results/

# fast smoke run: first well only, no overlay images
python evaluate.py --data /data/wells --limit-wells 1 --no-overlays

# custom band / background geometry and a higher detection threshold
python evaluate.py --data /data/wells --mt-width 5 --bg-gap 1 --bg-width 5 \
    --threshold 0.6

# force CPU (default on Mac); 'cuda' uses the GPU if available
python evaluate.py --data /data/wells --device cpu
```

`results.csv` is flushed after **every position**, so an interrupted batch
keeps its partial results.

---

## 6. Command-line options

| Flag | Default | Meaning |
| ---- | ------- | ------- |
| `--data` | *(required)* | Folder of `.nd2` files (recursive) or a single `.nd2`. |
| `--out` | `results` | Output directory (`results.csv`, `overlays/`, `annotations/`). |
| `--weights` | auto-detected (see §4) | Checkpoint path. |
| `--device` | `auto` | `auto` = CUDA if present else CPU. Also `cpu` / `cuda` / `mps`. |
| `--threshold` | `0.5` | Seed-probability threshold of the segmentation model. Higher = stricter (fewer, more confident MTs). |
| `--mt-width` | `5` | Width of the on-MT band across the centerline (px). |
| `--bg-gap` | `1` | Gap between the MT band and the background ring (px). |
| `--bg-width` | `5` | Width of the background ring (px). |
| `--irm-name` | `irm` | Substring identifying the IRM channel — the one that gets **segmented**. |
| `--tirf-name` | `tirf` | Substring identifying the TIRF channel — the one that gets **measured**. |
| `--solution-name` | `insol,in sol,solution` | Comma-separated substrings identifying the solution channel. |
| `--no-overlays` | off | Skip overlay PNGs. |
| `--no-json` | off | Skip annotation JSON. |
| `--limit-wells` | `0` | Process at most N wells (0 = all). |

---

## 7. Input: what the ND2 files must contain

* **One `.nd2` file per well**; the file name should contain `Well<id>` (e.g.
  `WellD04_Channel...nd2`) — `D04` becomes `well_id`. Files that don't match
  fall back to the file stem.
* Each file holds **several positions** (fields of view) and **three channels**,
  all three of which are required. Channels are matched **by name**, not by
  order, so acquisition-order changes don't matter. By default it looks for:
  * the **IRM** channel — name contains `IRM` — which is **segmented**,
  * the **TIRF** channel — name contains `TIRF` — on which the microtubule and
    background intensities are **measured**,
  * the **solution** channel — name contains `InSol` / `in sol` / `solution`.
  Override with `--irm-name` / `--tirf-name` / `--solution-name` if your channels
  are named differently.
* Pixel calibration is read from the ND2 (used for `length_um`); if it's
  missing, `length_um` is left blank and `length_px` is still reported.
* The acquisition timestamp is read from the ND2 and reported as `acquired_at`.

A file with no IRM channel is **skipped with a warning** and counted as a
failure, rather than segmented on some other channel: the checkpoint is
trained on IRM, and running it on TIRF yields confident but wrong centerlines
(this was the behaviour up to 2026-08 — see §12).

---

## 8. Output

```
results/
├── results.csv                 # one row per microtubule (see §1)
├── failures.csv                # one row per well/position the run could not
│                               #   produce, and why. Header-only = nothing lost
├── focus_qc.csv                # one row per position READ — the out-of-focus
│                               #   verdict, including positions with zero
│                               #   microtubules and positions that failed to
│                               #   segment, which results.csv cannot carry
├── overlays/
│   ├── D04_pos0_irm.png        # centerlines on the IRM frame — did segmentation
│   │                           #   match what the model was actually given?
│   ├── D04_pos0_tirf.png       # the same centerlines on the TIRF frame — does
│   │                           #   the measured band sit on the signal?
│   └── ...
└── annotations/
    ├── D04_pos0.json           # centerlines as polylines (points are x=col, y=row px)
    └── ...
```

Example `results.csv` rows:

```csv
well_id,position,mt_id,solution_intensity_median,length_px,length_um,mt_mean_intensity,mt_std_intensity,mt_sum_intensity,bg_mean_intensity,bg_median_intensity,bg_sum_intensity,net_mean_intensity,n_px_mt,n_px_bg,source_file,acquired_at,mt_median_intensity,signal_minus_background,irm_tirf_dy,irm_tirf_dx,irm_tirf_quality,irm_tirf_reason,focus_irm_score,focus_tirf_score,focus_flagged,focus_reason
D04,0,1,1775.0,93.92,6.7831,113.284,5.978,53923.0,113.713,113.0,242778.0,-0.43,476,2135,"WellD04_....nd2",2026-08-21T15:06:13Z,113.0,0.284,,,0.773,implausible_shift,679.2653,0.0,1,oof:TIRF 488
D04,0,2,1775.0,39.62,2.8612,112.665,6.998,23209.0,113.703,114.0,138263.0,-1.038,206,1216,"WellD04_....nd2",2026-08-21T15:06:13Z,113.0,-1.335,,,0.773,implausible_shift,679.2653,0.0,1,oof:TIRF 488
```

Those two rows are a real position and worth reading together: `focus_tirf_score`
is exactly **0.0** against a 0.184 cut — not one pixel of the TIRF frame stands
5σ above its local background — and sure enough every `signal_minus_background`
on that position is within ±1.4 of zero. The IRM channel it was segmented on is
fine (679 against a cut of 7.6), so the centerlines are real; there is simply no
fluorescence to measure along them. That is exactly the case the column exists
to make visible, and the other four positions of the same well read `ok` with
TIRF scores of 64–82.

And the per-position file, which is where a zero-microtubule position turns up:

```csv
well_id,position,source_file,acquired_at,flagged,reason,irm_channel,irm_score,irm_flag,irm_threshold,irm_noise_sigma,irm_background,tirf_channel,tirf_score,tirf_flag,tirf_threshold,tirf_noise_sigma,tirf_background
D04,0,"WellD04_....nd2",2026-08-21T15:06:13Z,1,oof:TIRF 488,IRM,679.2653,0,7.64036346269919,196.26,14399.0,TIRF 488,0.0,1,0.18441848619596696,6.792,116.0
D04,1,"WellD04_....nd2",2026-08-21T15:06:13Z,0,ok,IRM,761.5714,0,7.64036346269919,205.211,14461.0,TIRF 488,64.2092,0,0.18441848619596696,7.587,119.0
```

Read it in Python:

```python
import pandas as pd
df = pd.read_csv("results/results.csv")
df.groupby("well_id")["length_um"].describe()          # per-well length stats
df.groupby(["well_id", "position"])["mt_id"].count()   # MT count per position
```

The annotation JSON per position:

```jsonc
{
  "well_id": "D04", "position": 0,
  "image_size": { "width": 1024, "height": 1024 },
  "num_microtubules": 70,
  "polylines": [
    { "mt_id": 1, "class": "microtubule", "geometry": "polyline",
      "points": [ { "x": 12.0, "y": 34.0 }, ... ],
      "vertices_count": 57, "length_px": 95.83, "length_um": 6.9209 }
  ]
}
```

---

## 9. How the measurements are defined

**Solution concentration.** The median pixel value of the `488 InSol` channel
for that position. Median (not mean) is used so it is unaffected by the bright
microtubules bleeding into the channel.

**Microtubule length.** The arc length of the model's centerline polyline
(sum of segment lengths), in pixels and — using the ND2 calibration — microns.

**On-MT band vs. background ring.** The centerline is rasterised and dilated to
a fixed width to form the **MT band**; a strip *around* it (but outside it, and
outside every other MT) forms the **background ring**:

```
   ...background ring...  gap  [====== MT band ======]  gap  ...background ring...
        (--bg-width)    (--bg-gap)   (--mt-width)     (--bg-gap)    (--bg-width)
         5 px            1 px          5 px            1 px          5 px
```

* The **MT band** (`--mt-width`, default **5** px) is the set of pixels counted
  as "on the microtubule".
* The **background ring** is every pixel within `--bg-gap + --bg-width` of *this*
  microtubule but **not** within `--bg-gap` of *any* microtubule band. The gap
  (default **1** px) drops point-spread-function bleed of the signal; excluding
  *all* bands stops a neighbouring filament from inflating the background.

The image below shows the bands (red) and background rings (blue) on a real
crowded field — note the rings never cross onto a neighbouring filament:

![MT bands (red) and background rings (blue)](docs/example_bands.png)

`net_mean_intensity = mt_mean_intensity − bg_mean_intensity` is the
background-subtracted signal. All intensities are raw 16-bit camera counts (the
images are not pre-scaled).

---

## 10. Performance

The model is a ViT-L, so it is compute-heavy:

| Hardware | Per position | 180-well batch (900 positions) |
| -------- | ------------ | ------------------------------ |
| CUDA GPU | a few seconds | ~2 hours |
| Mac / CPU | ~25–35 s | ~7 hours |

`results.csv` is written incrementally, so long runs are safe to interrupt and
the partial table stays valid. Use `--device cpu` on a Mac (the default;
`mps` is experimental and may differ from CPU).

The two per-position CPU diagnostics ride along on top of that. Measured
2026-08-31 in the production image on real wells:

| Diagnostic | 1400×1400 | 2048×2048 |
| ---------- | --------- | --------- |
| IRM↔TIRF alignment | ~120 ms | ~270 ms |
| Out-of-focus check, both channels | **95 ms** | **300 ms** |
| …the same check before this change | 177 ms | 472 ms |

Neither uses the GPU. The focus check got there two ways: `focus_qc/metrics.py`
was rewritten bit-identically, worth 7–10 % (177 → 163 ms and 472 → 425 ms, and
the same in CPU time), and the two channels are now scored concurrently, which
numpy allows because it releases the GIL for the selection and filtering that
dominate the descriptor. The second half is wall clock and needs a spare core —
on a fully loaded machine the threaded form is no faster (measured 1230 ms vs
1014 ms at load 30 on 4 cores). The batch loop is sequential and GPU-bound, so a
core normally is free.

---

## 11. Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `microtubule v5H checkpoint not found` | Stage it with `scripts/download-microtubule-weights.sh` from the repo root, or pass `--weights /path/to/microtubule_v5h.pth`. The error lists every path that was searched. |
| `Could not locate the shared 'microtubule' package` | The model code lives in the ML service at `backend/segmentation/models/microtubule`. Run from a full checkout, or set `MT_PACKAGE_DIR` to the directory that *contains* the `microtubule` package. |
| `no .nd2 files found` | Check `--data`; the folder is searched recursively for `*.nd2`. |
| `no channel matching ('irm',)` | The well has no IRM channel under that name — pass `--irm-name <substring>`. Segmentation needs IRM; the well is skipped rather than segmented on another channel. |
| `no channel matching ('tirf',)` | Your TIRF channel is named differently — pass `--tirf-name <substring>` (likewise `--solution-name`). |
| `--irm-name and --tirf-name both resolve to channel ...` | Both roles landed on one channel, so segmentation and readout use the same image. Intentional only if you know your recording has a single usable channel. |
| `weights_only` load warning on startup | Expected; the checkpoint embeds a small config object and the loader falls back safely. Set `ALLOW_UNSAFE_WEIGHTS=0` to refuse. |
| Very slow on a Mac | Expected for a 140M-parameter network tiled over a large frame on CPU. Use a CUDA GPU for the full batch, or run overnight. |
| `ModuleNotFoundError: instance` / `dynamic_network_architectures` | The shared `microtubule/` package was moved or flattened — keep it intact at `backend/segmentation/models/microtubule`, or point `MT_PACKAGE_DIR` at its parent. |
| `focus_reason` is `out_of_calibration:<channel>` on many rows | Not a data problem. The focus thresholds are absolute and were fitted on one acquisition; this says yours differs in noise or background. Refit with `python -m focus_qc.cli calibrate` on a few annotated z-stacks and point the worker at the result with `ESSAYS_FOCUS_CALIBRATION=/path/to/calibration.json`. The verdict is unaffected either way. |
| `focus_reason` is `detector_unavailable` on **every** row | A deployment problem, not a data one: `focus_qc/` or its `reference/calibration.json` did not reach the image, or `ESSAYS_FOCUS_CALIBRATION` points at a file that is missing or malformed. The reason is printed once on stderr with the exception. The image build asserts against this (`docker/essays.Dockerfile`). |
| `focus_flagged` is `1` but the frame looks fine | Read `focus_reason`. `unscoreable:<channel>` means the noise floor could not be measured at all (a blank, saturated or sub-ADU frame) and the check fails safe by flagging. `oof:<channel>` on a sparse field is the descriptor's known weakness in the *strict* direction — it counts occupied area, so a field with genuinely little sample in it scores low. |

---

## 12. FAQ

**Do I need a HuggingFace account or token?** No. The weights are
self-contained; the backbone is rebuilt offline from the bundled config.

**Does it need a GPU?** No, but a GPU is ~10× faster. CPU works fine for a few
wells or an overnight batch.

**Can I change the band / background widths?** Yes — `--mt-width`, `--bg-gap`,
`--bg-width` (all in pixels). The defaults are 5 / 1 / 5.

**It found too few / too many microtubules.** Tune `--threshold` (default 0.5):
higher finds fewer, more confident MTs; lower finds more (and more noise).
Inspect `overlays/` to judge.

**Can I segment a single image (not a well recording)?** Yes — `infer.py`
handles one frame at a time and writes centerlines as JSON; see
[`MODEL.md`](MODEL.md).

**Which channel is segmented?** IRM. Up to 2026-08 this tool segmented **TIRF**
and ignored IRM entirely, which is wrong: the checkpoint is trained on IRM
frames. The failure was hard to spot because the QC overlay was drawn on TIRF
too, so a wrong centerline still looked like it followed a filament. **Results
produced before that change should be re-run** — the intensity columns were
measured along centerlines that came from the wrong image. `--irm-name` /
`--tirf-name` let you point either role at any channel name.

**How do I tell which run a row came from?** `acquired_at` — the recording's own
timestamp, in ISO-8601 UTC, read out of the ND2. It survives renaming or
re-uploading the folder, which a directory name does not. `source_file` gives the
individual well file.

---

## 13. Layout

This module lives at `backend/essays/module` inside the cell-segmentation-hub
repo. It was a separate repo until 2026-08-11.

```
evaluate.py                 # batch entry point — start here
mt_pipeline/                # measurement layer
  nd2_io.py                 #   read ND2, pick channels by name, iterate positions,
                            #   and measure the two per-position diagnostics
                            #   (IRM↔TIRF offset, out-of-focus verdict)
  measure.py                #   MT band / background ring masks + intensity stats
  report.py                 #   results.csv, failures.csv, focus_qc.csv, overlays,
                            #   annotation JSON
focus_qc/                   # out-of-focus detection (pure NumPy/SciPy, no weights,
                            #   no GPU, no network). Vendored 2026-08-31; see its
                            #   own README for the method and its limits
_mt_package.py              # locates the shared model package + the checkpoint
config/dinov3_vitl16/       # bundled backbone config (enables offline, token-free)
infer.py                    # single-frame segmentation CLI (diagnostic)
tests/                      # channel-role + checkpoint-portability tests
docs/                       # README images
MODEL.md                    # model internals + single-frame CLI reference
```

`focus_qc/` is the one thing here that is a **copy** rather than a shared import,
because it has no other caller in this repo. It carries its own 126-test suite,
which CI runs (`.github/workflows/ci.yml`, the `python-tests` job) — those tests
are the only thing pinning the descriptor constants and the 1.97× IRM separation
margin the method depends on.

**The model code is not here.** It lives once, in the ML service at
`backend/segmentation/models/microtubule`, and both this batch assay and the
app's interactive segmentation import that same package — so a fix to the
instancer or the checkpoint loader reaches both. `_mt_package.ensure_on_path()` finds it
(override with `MT_PACKAGE_DIR`).

The segmentation model and the single-frame CLI are documented in
[`MODEL.md`](MODEL.md).
