# AutomatedEssaysModule — microtubule analysis of ND2 well recordings

Pull this repository, point it at a folder of `.nd2` well recordings, and run
one script. For every microtubule (MT) in every position of every well it
measures the solution concentration, the MT length, and the on-MT vs.
background TIRF intensity, and writes a single results table plus QC overlays.

It wraps a trained instance-segmentation model (**DINOv3-L → DPT → PySOAX**,
"microtubule v7") that detects each microtubule as an open centerline; the
measurement layer turns those centerlines into numbers.

---

## 1. What you get per microtubule

One row per MT in `results.csv`:

| Column | Meaning |
| ------ | ------- |
| `well_id`, `position`, `mt_id` | well (e.g. `D04`), 0-based field of view, MT index within that position |
| `solution_intensity_median` | **solution concentration** = median of the `488 InSol` channel for that position |
| `length_px`, `length_um` | MT length along its centerline (µm uses the ND2 pixel calibration) |
| `mt_mean_intensity`, `mt_std_intensity`, `mt_sum_intensity` | TIRF intensity over the **MT band** (a strip `--mt-width`, default 5 px, wide along the centerline) |
| `bg_mean_intensity`, `bg_median_intensity`, `bg_sum_intensity` | TIRF intensity over the **background ring** around the MT (see geometry below) |
| `net_mean_intensity` | `mt_mean_intensity − bg_mean_intensity` |
| `n_px_mt`, `n_px_bg` | number of pixels in each region |
| `source_file` | originating ND2 file name |

Also written: `overlays/<well>_pos<p>.png` (centerlines drawn on the TIRF
frame, for visual QC) and `annotations/<well>_pos<p>.json` (the centerlines as
polylines).

### Measurement geometry

```
   ...background ring...  gap  [====== MT band ======]  gap  ...background ring...
        (--bg-width)    (--bg-gap)   (--mt-width)     (--bg-gap)    (--bg-width)
```

* **MT band** — the model's centerline rasterised and dilated to `--mt-width`
  pixels across (default **5**).
* **Background ring** — pixels within `--bg-gap + --bg-width` of *this* MT but
  **not** within `--bg-gap` of *any* MT band. The gap (default **1** px)
  excludes point-spread-function bleed of the signal; excluding all bands stops
  a neighbouring filament from inflating the background. Ring width default
  **5** px.

---

## 2. Install (one-time)

Requires **Python 3.10–3.12**.

```bash
git clone https://github.com/michalprusek/AutomatedEssaysModule.git
cd AutomatedEssaysModule
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

All pinned packages have macOS arm64 and Linux x86-64 wheels — no compilation.

> **No HuggingFace token needed.** The bundled checkpoint already contains the
> DINOv3 backbone weights, so the backbone is rebuilt offline from the config
> in `config/dinov3_vitl16`. The pipeline runs with no network access.

The 1.2 GB checkpoint is **not** in git; it is downloaded once from this repo's
GitHub Release on first run via the GitHub CLI (`gh`). If you have `gh`
installed and authenticated (you already do if you cloned a private repo), it
just works. Otherwise download `microtubule_v7.pt` from the release page and
pass `--weights /path/to/microtubule_v7.pt`.

---

## 3. Run

```bash
# whole folder of wells -> results/results.csv  (+ overlays/, annotations/)
python evaluate.py --data /path/to/well_recordings --out results/

# quick smoke run on the first well only
python evaluate.py --data /path/to/well_recordings --out test/ --limit-wells 1

# a single file, no overlays, custom band/background widths
python evaluate.py --data WellD04_....nd2 --no-overlays \
    --mt-width 5 --bg-gap 1 --bg-width 5
```

### Options

| Flag | Default | Meaning |
| ---- | ------- | ------- |
| `--data` | *(required)* | Folder of `.nd2` files (searched recursively) or one `.nd2`. |
| `--out` | `results` | Output directory. |
| `--weights` | `weights/microtubule_v7.pt` | Checkpoint path (auto-downloaded if missing). |
| `--device` | `auto` | `auto` = CUDA if present else CPU. `cpu` / `cuda` / `mps`. |
| `--threshold` | `0.5` | Seed-probability threshold of the segmentation model. |
| `--mt-width` | `5` | On-MT band width across the centerline (px). |
| `--bg-gap` | `1` | Gap between MT band and background ring (px). |
| `--bg-width` | `5` | Background ring width (px). |
| `--tirf-name` | `tirf` | Substring identifying the TIRF (microtubule) channel. |
| `--solution-name` | `insol,in sol,solution` | Substrings identifying the solution channel. |
| `--no-overlays` / `--no-json` | off | Skip those outputs. |
| `--limit-wells` | `0` | Process at most N wells (0 = all). |
| `--online-backbone` | off | Download the gated DINOv3 backbone from HF instead of rebuilding offline (needs `HF_TOKEN`). Not normally needed. |

### Performance

The model is heavy (ViT-L). On a CUDA GPU a position is a few seconds; on a Mac
CPU it is ~25–30 s. A 180-well batch (5 positions each = 900 frames) is ~2 h on
a GPU, ~7 h on a Mac CPU. `results.csv` is flushed after every position, so an
interrupted run keeps its partial results.

---

## 4. Layout

```
evaluate.py                 # batch entry point (start here)
mt_pipeline/                # measurement layer
  nd2_io.py                 #   read ND2, pick channels by name, iterate positions
  measure.py                #   MT band / background ring masks + intensity stats
  report.py                 #   results.csv, overlays, annotation JSON
microtubule/                # the v7 segmentation model package (do not flatten)
config/dinov3_vitl16/       # bundled backbone config (enables offline, token-free)
scripts/download_weights.py # fetches microtubule_v7.pt from the GitHub Release
infer.py                    # single-frame segmentation CLI (optional/diagnostic)
weights/microtubule_v7.pt   # downloaded, not in git
```

`infer.py` (single frame → centerlines JSON) and the model internals are
documented in [`MODEL.md`](MODEL.md).
