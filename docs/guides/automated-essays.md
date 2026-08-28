# Automated Essays

Batch microtubule assay over a folder of Nikon `.nd2` well recordings. Upload
the folder, wait, download one ZIP containing a per-microtubule CSV, QC overlays
and polyline JSON. No project, no editor, no manual annotation.

**Route:** `/automated-essays` — reached from the **user profile dropdown**
(flask icon) in the header. Requires sign-in.

---

## What it does

One `.nd2` file is one **well**. Each file contains several **positions** (fields
of view) and three named channels:

| Channel role        | Used for                                                          |
| ------------------- | ----------------------------------------------------------------- |
| **IRM**             | **Segmented** — the microtubule centerlines come from here        |
| **TIRF**            | **Measured** — fluorescence is integrated along those centerlines |
| **488 in solution** | Per-position median, a proxy for solution concentration           |

Channels are resolved **by name substring**, case-insensitively, so physical
channel order does not matter. Defaults: `irm`, `tirf`, and
`insol` / `in sol` / `solution`.

> **Why IRM is segmented and TIRF is only measured.** The v5H model was trained
> on IRM. On TIRF it still emits confident-looking polylines that do not track
> image content at all. Until August 2026 this module read TIRF for
> segmentation — **every run produced before then is invalid**, not merely
> noisier. A file with no IRM channel is failed outright rather than quietly
> segmented from something else.

---

## Uploading

Two ways to hand over a folder:

- **Drag the folder** onto the drop area.
- **"Select folder"** button — the drop area itself is not clickable, the button
  is the only click path.

Files are found recursively, so a flat folder and a nested one both work.
Non-`.nd2` files are dropped client-side; you get an info toast naming how many
were kept. macOS AppleDouble `._*` sidecars are skipped.

**Limits:** 100 GB per file, **512 files per upload**, `.nd2` extension only.
Uploads stream to disk and are never buffered in memory, and nginx allows an
hour of body transfer — a large folder is slow, not rejected.

The **well id** is parsed from each filename with `Well\s*([A-Za-z]\d+)`, so
`WellD04_something.nd2` becomes `D04`. Without a match the file stem is used.

The **run name** is the dragged folder's name. If the browser gives no folder
information the run is named `essays_YYYY-MM-DD`.

> **Known browser quirk (handled).** The folder path arrives on
> `webkitRelativePath` for the button path but on `path` for the drag path — and
> for a dragged folder that `path` starts with a slash. Reading only one of them
> silently lost every dragged folder's name in 2026-07. Both are read now; a
> single loose file still never names a run.

---

## Watching a job

The job list polls every 3 s while anything is queued or running, then stops.

**Statuses:** `Queued` → `Processing` → `Completed` / `Failed`.

Progress caps at **99 %** while running and only reaches 100 on completion —
99 % is not a stall.

### The device badge

| Badge                     | Meaning                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `CUDA`                    | Ran on the GPU. Normal.                                                                                  |
| `CPU`                     | Ran on the CPU because no GPU is configured.                                                             |
| **CPU (GPU busy)**        | The GPU was occupied, so it ran on the CPU. **Nothing is wrong** — no need to report it.                 |
| **CPU (GPU unavailable)** | The GPU exists but the worker could not reach it. Far slower than it should be — **please report this.** |

The GPU→CPU penalty is large. One measured pair: a 180-well job took **1 h 20 m
on GPU** and **36 h on CPU**.

### Completed with a warning

A job can finish `Completed` and still show an **amber** message such as
_"3 well/position failure(s) — these wells are missing from `results.csv`.
`failures.csv` in the download names each one and why it failed."_ That is a
**partial run**: the wells that worked are in the CSV, the ones that did not are
enumerated. Read the whole message — it is scrollable, not truncated.

### Queueing and GPU budget

- **One job at a time.** A single worker thread drains an in-process queue; the
  202 response tells you your queue position. The queue is in-memory, so an
  essays-service restart loses queued (not running) work — a watchdog fails any
  job whose row has not advanced for an hour.
- **Start gate:** the job waits for at least **4 GB** free VRAM, polling every
  10 s for up to **30 minutes**, then runs on the CPU rather than blocking the
  queue forever.
- **Memory cap:** the worker is capped at 12 % of the card (~2.83 GiB). The
  measured v5H working set is **1.41 GiB reserved / 1.05 GiB allocated** and the
  results are byte-identical across caps from 1.92 to 17.99 GiB, so the cap
  costs nothing.
- **Speed:** ~43 s for 3 positions of a 2048² well containing 162 microtubules,
  including model load — roughly 10–14 s per position on GPU.
- **Retries:** a failed position is retried at 30 s / 120 s / 300 s (4 attempts),
  bounded by a one-hour run-wide stop-loss.

---

## Downloading and re-running

**Download** is a two-step handshake (a short-lived token, then a native browser
download) because a browser-initiated download cannot carry the session cookie.
The token lives **10 minutes**; if the download 403s, click Download again.
The file is `<run name>_results.zip`.

**Run again** re-processes the same uploaded files without re-uploading. It
reuses the same job row and id, so the **old result is replaced** — download it
first if you want to keep it (the confirmation dialog says so when a result
exists). No options are stored or replayed, so a re-run reproduces the original
exactly.

The button only appears when the inputs are still on disk. That is checked
against the filesystem, not guessed from the status.

### Retention

| Artifact               | Kept until                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Uploaded `.nd2` inputs | Deleted right after zipping **if the run finished cleanly**; otherwise kept for **7 days** (`ESSAYS_INPUT_RETENTION_DAYS`). |
| Result ZIP             | Until you delete the job.                                                                                                   |
| Job row                | Until you delete it. The list shows the newest 100.                                                                         |

Note the asymmetry, which is deliberate: a **partial** run is recorded as
`completed` _with_ an error, and its inputs are **kept** — that is precisely the
run you may want to repeat.

---

## What is in the ZIP

```
results.csv                                  one row per microtubule
failures.csv                                 one row per well/position that failed
overlays/<well>_pos<N>_irm.png               segmentation over its own input
overlays/<well>_pos<N>_tirf.png              measured band over the signal
annotations/<well>_pos<N>.json               polylines, points and lengths
```

`failures.csv` is written **always**, header-only when nothing failed — a
header-only file states "nothing was lost"; a missing file cannot. Its columns:
`well_id`, `position`, `source_file`, `stage` (`read` = the ND2 could not be
opened, so the whole well is gone; `segment` = one position raised), `attempts`
(more than 1 means the retry ran and the error outlived it), `error_type`,
`error_message`.

The two overlays per position are not redundant: the **IRM** overlay checks the
segmentation against the image it was derived from, the **TIRF** overlay checks
that the measured band sits on the signal being integrated.

### `results.csv` — every column

Column order is fixed. New columns are **appended, never inserted**, because
users index by position.

| #   | Column                      | Meaning                                                                                                                                                                                                                                                   |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `well_id`                   | Well id from the filename, else the file stem                                                                                                                                                                                                             |
| 2   | `position`                  | 0-based field of view within the well                                                                                                                                                                                                                     |
| 3   | `mt_id`                     | 1-based microtubule index **within that position**                                                                                                                                                                                                        |
| 4   | `solution_intensity_median` | Median pixel of the 488-in-solution channel for the position (median, so bright filaments bleeding in do not move it)                                                                                                                                     |
| 5   | `length_px`                 | Arc length of the centerline polyline, 2 dp                                                                                                                                                                                                               |
| 6   | `length_um`                 | `length_px × pixel size`, 4 dp. **Blank** when the ND2 carries no voxel size                                                                                                                                                                              |
| 7   | `mt_mean_intensity`         | Mean TIRF over the microtubule band                                                                                                                                                                                                                       |
| 8   | `mt_std_intensity`          | **Sample** SD (`ddof = 1`, ImageJ convention); 0 for a single pixel                                                                                                                                                                                       |
| 9   | `mt_sum_intensity`          | Integrated TIRF over the band                                                                                                                                                                                                                             |
| 10  | `bg_mean_intensity`         | Mean TIRF over the background ring. **Blank if the ring is empty**                                                                                                                                                                                        |
| 11  | `bg_median_intensity`       | Ring median using ImageJ's histogram tie rule (`sorted[n//2]`, the upper of two central values — _not_ NumPy's mean-of-two)                                                                                                                               |
| 12  | `bg_sum_intensity`          | Integrated TIRF over the ring                                                                                                                                                                                                                             |
| 13  | `net_mean_intensity`        | mean(band) − **mean**(ring). Kept for continuity with runs before 2026-08-13                                                                                                                                                                              |
| 14  | `n_px_mt`                   | Pixels in the band                                                                                                                                                                                                                                        |
| 15  | `n_px_bg`                   | Pixels in the ring                                                                                                                                                                                                                                        |
| 16  | `source_file`               | Originating `.nd2` filename                                                                                                                                                                                                                               |
| 17  | `acquired_at`               | Acquisition time, ISO-8601 UTC, from the ND2's absolute Julian day. Falls back to the file's own date string **verbatim** (an acquisition PC's local wall clock in its own locale, so month/day order is not recoverable). Per **file**, not per position |
| 18  | `mt_median_intensity`       | The **band's** median (ImageJ tie rule)                                                                                                                                                                                                                   |
| 19  | `signal_minus_background`   | mean(band) − **median**(ring) — the platform's standard readout                                                                                                                                                                                           |

Three distinctions worth pinning down:

- `net_mean_intensity` is mean − **mean**; `signal_minus_background` is mean −
  **median**. A median background resists a neighbouring filament's halo where
  the mean does not.
- `mt_median_intensity` is the **band's** median, not the background's.
- An empty background ring leaves columns 10–13 and 19 **blank, never 0** — a
  zero would silently inflate the net signal by the whole signal.

### The measurement geometry

Defaults: microtubule width **5 px**, background margin **2.0 × width = 10 px**.

- The signal **band** is ImageJ's `Roi.convertLineToArea` offset polygon with
  butt caps — not a round-capped distance transform.
- The background **ring** reaches 10 px out from that band and **excludes the
  band of every microtubule in the frame**, so a neighbouring filament can never
  be counted as background.

Both come from one shared implementation, the same code the interactive project
export uses (`backend/segmentation/models/mt_measure.py`). See
[Metrics](../reference/metrics.md#microtubule-intensity).

> **Numbers from before 2026-08-13 are not comparable with later ones.** Until
> then the batch and the interactive export had separate implementations that
> had drifted: band area by −7.8 %…+26.5 %, ring area by 2.2×, and the **net
> signal by a median of +9.9 % (max +33.2 %)**. Only length agreed. The old
> `--bg-gap`/`--bg-width` ring (6 px with a 1 px guard) was replaced by
> `--bg-margin` in the same change.

---

## Troubleshooting

| Symptom                                             | Cause and fix                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| "No .nd2 files found"                               | The folder contained no `.nd2`. Nested folders are fine — check the extension.                            |
| Run named `essays_2026-08-28`                       | The browser gave no folder name (a loose file, or a drag the OS did not describe). Cosmetic only.         |
| Job stuck at 99 %                                   | Expected. Progress is capped until the ZIP is written.                                                    |
| Badge says **CPU (GPU unavailable)**                | The worker container lost its GPU. Report it — it is not a normal state.                                  |
| Completed, but wells are missing from `results.csv` | Read the amber message and `failures.csv`. Retry with **Run again**.                                      |
| `Download` gives 403                                | The 10-minute token expired. Click Download again.                                                        |
| Job failed with "Worker stopped reporting"          | The row did not advance for an hour. The essays service most likely restarted mid-run; use **Run again**. |

## Related

- [Microtubule projects](project-types/microtubules.md) — the interactive path
  over the same model
- [ML models: microtubule v5H](../reference/ml-models.md#microtubule--microtubule-v5h)
- [REST API](../api/README.md#automated-essays) — the endpoints behind this page
