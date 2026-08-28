# Export

Everything the platform can hand back: what is in the ZIP, what each option
does, and what every column means.

For the formulas behind the numbers see [Metrics](../reference/metrics.md).

---

## The export job

Open a project → **Export**. The dialog has three tabs; the export then runs
**asynchronously** on the server and downloads itself when finished.

- Progress arrives over a WebSocket _and_ is polled over HTTP every 2 s, so a
  dropped socket does not strand the dialog.
- **One export at a time per user.** Starting a second returns HTTP 429.
- **Cancel** is honoured between stages.
- The finished ZIP is fetched with a short-lived signed token (browsers cannot
  attach an authorization header to a download link). The token lives **10
  minutes** — if the download fails, re-request it from the history list.
- The archive is named after the project.

The progress bar is divided as 5 % setup, 90 % across the actual work, 95 % at
compression, 100 % on completion. Long stages (kymographs especially) are
counted, so a bar sitting at 95 % means compression, not a hang.

### Partial failures do not fail the export

The always-on microtubule exporters, and the wound time-series, are
**non-fatal**: if one fails the job still completes and the failure is reported
as a warning. Because a toast on a multi-hour export is easy to miss, a
degraded microtubule intensity run is _also_ recorded durably in
`metrics/metrics_status.json` and as a banner at the top of
`documentation/metrics_guide.md`. **Check those two files before trusting a
microtubule metrics sheet.**

---

## The dialog

### General

| Option                             | Default | Effect                                                              |
| ---------------------------------- | ------- | ------------------------------------------------------------------- |
| Include original images            | on      | `images/` gets the uploaded files                                   |
| Include visualizations             | on      | `visualizations/` gets rendered overlays with numbered shapes       |
| Include documentation and metadata | on      | `documentation/` gets a README, a metadata JSON and a metrics guide |
| **Pixel size (µm/pixel)**          | auto    | Converts every length and area to micrometres                       |
| Selected images                    | all     | Restrict the export to a subset                                     |

**The pixel size field is auto-filled** from the first image that carries a
calibration (ND2 voxel size, OME-TIFF `PhysicalSizeX`, ImageJ TIFF metadata),
and stops auto-filling once you type in it. Accepted range **0.001 – 1000**, and
it accepts any number of decimals — a real calibration like `0.072222` is not
rounded. An out-of-range or unparseable value falls back to **pixel units**
silently, so check the units in the header row of the result.

### Visualization

Numbering on/off, external polygon colour (default red `#FF0000`), internal
(hole) colour (default blue `#0000FF`), stroke width (2), font size (32) and
fill transparency (0.3).

### Formats

- **Annotation formats** — COCO and custom JSON are on by default, YOLO is off.
- **Metrics formats** — XLSX on by default; CSV and JSON available.

Microtubule projects replace the annotation checkboxes with a fixed note: they
export **ImageJ ROIs and CVAT instead**, always, with no toggle. See
[below](#microtubule-exports).

---

## What is in the ZIP

```
images/                     original images (optional)
visualizations/             <name>_viz.png, or <name>_frame_NNNN_viz.png for video frames
annotations/coco/           annotations.json
annotations/yolo/           <image>.txt, one per image
annotations/json/           segmentation_data.json
annotations/imagej/         <video>_RoiSet.zip          (microtubule projects)
annotations/cvat/           <video>.xml                 (microtubule projects)
metrics/                    metrics.xlsx / .csv / .json
kymographs/  or  profiles/  (microtubule projects, if enabled)
wound_healing/              wound_area_chart.png        (wound model present)
documentation/              README.md, metadata.json, metrics_guide.md
```

---

## Annotation formats

### COCO

`annotations/coco/annotations.json`, standard COCO layout with `info`, `images`,
`annotations`, `categories`, `licenses`.

- **Closed polygons** get `category_id: 1` (`cell`) and a flattened
  `[[x1,y1,x2,y2,…]]` segmentation. A polygon **with holes** is exported as COCO
  **RLE** with `iscrowd: 1` instead, and its `area` already has the hole areas
  subtracted.
- **Open polylines** get `category_id: 2`, `area: 0`, and an `attributes` block
  carrying `geometry: "polyline"`, the polyline `length`, and — for sperm —
  `partClass` and `instanceId`. The category is named after the project:
  `sperm`, `microtubule`, or `polyline`.
- Sperm polylines with a missing or invalid `partClass` are dropped, as are
  polylines with fewer than two points.

### YOLO

`annotations/yolo/<image>.txt`, one file per image, two lines per polygon:

```
0 <x_center> <y_center> <width> <height>
# Segmentation: 0 x1 y1 x2 y2 … xn yn
```

Coordinates are normalised to 0–1 with six decimals; the class id is always `0`.

> **Two things to know.** Open **polylines are never exported to YOLO** — the
> format has no representation for them, and they are skipped with a warning.
> And the polygon is written on a **comment line**: a standard YOLO-seg reader
> will see bounding boxes only.

### Custom JSON

`annotations/json/segmentation_data.json` — the platform's own richer format:
per image, external and internal polygons with pre-computed area, perimeter,
bounding box and centroid; a flat `polylines` array; and, **for sperm projects
only**, a `spermInstances` array grouping head/midpiece/tail per cell with a
total length. A `statistics` block counts everything, including orphan
polylines.

---

## Metrics workbooks

The sheet you get depends on the **project type**. Every header is English
regardless of interface language.

Units follow the pixel-size field: `px` / `px^2` without a scale, `um` / `um^2`
with one.

### Spheroid and wound — sheet `Polygon Metrics`

One row per polygon:

`Image Name`, `Polygon ID`, `Type`, `Area`, `Perimeter`, `Perimeter with Holes`,
`Equivalent Diameter`, `Circularity`, `Feret Diameter Max`, `Feret Diameter Min`,
`Feret Diameter Orthogonal`, `Feret Aspect Ratio`, `Major Axis Length`,
`Minor Axis Length`, `Bounding Box Width`, `Bounding Box Height`, `Extent`,
`Compactness`, `Convexity`, `Solidity`, `Sphericity`.

Plus a **`Summary`** sheet with counts and averages over **external polygons
only**.

**Wound** projects additionally get a **`WoundTimeSeries`** sheet — `Order`,
`Image Name`, `Wound Area (%)`, `Polygons`, `Created At (UTC)` — with the
closure chart embedded, and the same chart as
`wound_healing/wound_area_chart.png`. Wound area % is
`(external area − hole area) / (width × height) × 100`, clamped at zero.

### Invasive spheroid — sheet `Image Metrics`

**One row per image, not per polygon** — the quantity of interest is a whole-image
property:

`Image Name`, `Total Spheroid Area`, `Core Area`, `Invasion Area`,
**`Disintegration Index`**, `Radial Reach q95 (R_core)`,
`Dispersed-Mass Fraction`, `Fragment Count`, `Largest-Fragment Fraction`,
`Solidity`, `Hole Count`, `Core Equiv. Diameter`, `Whole Equiv. Diameter`.

Every one of those columns reads the literal string **`N/A`** when no valid core
was segmented. That is deliberate — the index is undefined without a core and is
never reported as a computed zero. Areas are still reported even if the index
calculation fails.

### Sperm — sheet `Sperm Metrics`

One row per cell: `Image Name`, `Instance ID`, `Head Length`, `Midpiece Length`,
`Tail Length`, `Total Length`. Polylines with no `instanceId` are excluded as
orphans. If there is no polyline data at all the export falls back to the
standard polygon report.

### Microcapsule — sheet `Microcapsule Metrics`

`Image Name`, `Capsule ID`, `Area`, `Perimeter`, `Width`, `Height`, `Diameter`,
`Feret Max`, `Feret Min`, `Equivalent Diameter`, `Compactness`, `Ovality`,
`Confidence`, plus a `Summary` sheet.

Capsules cut off by the image border are **excluded** — a clipped capsule would
drag every distribution down.

> Two column names do not mean what they say. **`Compactness` holds the
> circularity value** (4πA/P²), and **`Ovality` is the Feret aspect ratio**
> (max/min). `Diameter` is the mean of the two Feret diameters.

### Microtubule — sheets `Microtubule Metrics` + `Channel Totals`

The polygon report is skipped entirely (open polylines have no area).
`Microtubule Metrics` is long-format, one row per frame × polyline × channel,
with the field names as headers:

`frameIndex`, `imageName`, `label`, `mtType`, `instanceId`, `trackId`, `channel`,
`lengthPx`, `lengthUm`, `areaPx`, `areaUm2`, `pixelCount`, `sumIntensity`,
`meanIntensity`, `medianIntensity`, `stdIntensity`, `medianBackground`,
`meanBackground`, `signalMinusBackground`.

`label` is the per-frame badge (`MT1`, `MT2`, …); `mtType` is the class name from
your project palette; `trackId` is the cross-frame identity. Intensity columns
are empty on geometry-only rows.

Every channel of the container is measured, not only the segmentation source —
a two-channel container gives `frames × microtubules × 2` rows.

> **A negative `signalMinusBackground` on the IRM channel is expected.** A
> microtubule is _darker_ than its surround in interference reflection
> microscopy, so its band mean sits below the background median. The
> fluorescence channel of the same container comes out positive. The sign is
> telling you which modality the row belongs to; it is not an error.

`Channel Totals` is whole-image, whole-video per-channel totals independent of
any microtubule: `video`, `channel`, `totalIntensity`, `meanIntensity`,
`pixelCount`, `frames`.

### Exporting a single image from the editor

The editor has its own small export panel with three tabs — **metrics** (an
XLSX of the current image), **sperm** (per-instance lengths, shown when
polylines exist) and **coco**. Note that the in-editor workbook always reports
**pixels** and computes circularity, compactness and convexity from the
perimeter _including holes_, whereas the project ZIP uses the external
perimeter. For polygons with holes the two will differ.

---

## Microtubule exports

### ImageJ `RoiSet.zip` — always included

`annotations/imagej/<video>_RoiSet.zip`, one per video container, openable
directly in Fiji's ROI Manager as a stack.

- Each ROI is named `<mtLabel>__frame_NNNN.roi` and carries an ImageJ slice
  position, so the set loads aligned to the stack.
- `<mtLabel>` is `<typeName>_<counter>` — a per-class running counter in order
  of first appearance (`HeLa_1`, `HeLa_2`, `brain_1`, …), keyed on the
  **cross-frame `trackId`** so one microtubule keeps **one name on every slice**.
  Untyped microtubules land in an `untyped_<n>` bucket, and a name you set
  manually wins verbatim.
- **Stroke width** is the thickness you set in the export dialog (default 5 px).
- **Colour** is the class colour when the microtubule has a type label,
  otherwise the same per-track hue the editor draws — so an ROI's colour is its
  identity, matching what you saw on screen.
- Each polyline also gets a **`<mtLabel>_bg`** ROI: the exact background region
  its `medianBackground` was measured from — the vicinity ring **with every
  microtubule cut out**, as an ImageJ composite ROI. If that exact region could
  not be obtained, a plain wide band is drawn instead, which _overstates_ the
  background but keeps a visual indicator. Where the ring is empty or
  degenerate, **no `_bg` ROI is written at all** rather than a misleading one.

### CVAT 1.1 XML — always included

`annotations/cvat/<video>.xml`, one per video with at least one polyline.
Only polylines are exported; closed polygons are not. The label is the
microtubule's class name (or `microtubule` when untyped), every used label is
declared in the metadata block so it imports cleanly, and cross-frame identity
travels as a `track_id` attribute rather than as a CVAT track element.

### Intensity settings

Two integers in the dialog:

| Setting           | Default | Range | Meaning                                                    |
| ----------------- | ------- | ----- | ---------------------------------------------------------- |
| Thickness (px)    | 5       | 1–100 | Width of the measurement band along the centerline         |
| Background margin | 2       | 0–10  | Multiplier on thickness giving the background ring's reach |

There is no enable checkbox and no channel picker — **per-channel intensity is
always computed, for every channel**.

### Kymographs or intensity profiles

A checkbox (off by default) and a radio choice between two mutually exclusive
outputs:

| Mode                               | Produces                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Kymograph (space × time)**       | `kymographs/<video>__<polyline>__<channel>.png` with detected tracks drawn on, plus `kymographs/velocity_metrics.xlsx` |
| **Intensity profiles (per image)** | `profiles/<stem>.csv` (the raw intensity matrix) plus one plot per frame, `profiles/<stem>__fNNNN.png`                 |

A kymograph needs time, so the option is only offered when the project actually
has a multi-frame container. Otherwise the mode is forced to **profiles**.

`velocity_metrics.xlsx` has **one worksheet per source channel**, with columns
`video`, `microtubule`, `track`, `net_velocity_um_s`, `net_velocity_px_frame`,
`snr`, `total_run_length_um`, `total_run_time_s`, `intensity_signal`,
`intensity_background`, `intensity_minus_background`, `bright`, `edge_touch`,
`pixel_size_um`, `frame_interval_ms`.

Caps, always logged when hit: **60 microtubules per container** and **300
profile frames per microtubule × channel**.

### Where microtubule intensity comes from

This matters for reproducibility:

- **Metrics** (`metrics.xlsx`) are measured from the **original ND2/TIFF**, re-opened
  and read at full bit depth. The single exception is a channel **added after
  upload**, whose pixels exist only as per-frame PNGs.
- **Kymographs and profiles** are measured from the **per-frame channel PNGs**.
  Those PNGs are written losslessly for 8- and 16-bit sources, so for ordinary
  microscopy data both paths see the same values; only unusual float or 32-bit
  integer sources get a per-frame rescale on the PNG path.

Kymograph sampling is arc-length-uniform with **nearest-neighbour** interpolation
(no blending), reading 0 outside the frame, and blob detection runs on the raw
un-normalised matrix.

---

## Troubleshooting

| Symptom                                           | Cause                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Export returns 429                                | You already have an export running. One at a time.                                                     |
| Progress sits at 95 %                             | Compression. On a large project with kymographs this is genuinely slow.                                |
| Metrics are in pixels though you typed a scale    | The value was out of the 0.001–1000 range, or unparseable. Check the header units.                     |
| Microtubule sheet has geometry but no intensities | A degraded run. Read `metrics/metrics_status.json` and the banner in `documentation/metrics_guide.md`. |
| YOLO labels have no polygons                      | Expected — see above. Use COCO for segmentation masks.                                                 |
| Disintegration Index column is all `N/A`          | No valid core was segmented. The index is undefined without one.                                       |
| Download link 403s                                | The 10-minute token expired. Re-request the download.                                                  |

## Related

- [Metrics](../reference/metrics.md) — every formula and its caveats
- [Project types](project-types.md)
- [Automated Essays](automated-essays.md) — the batch path over the same measurement code
