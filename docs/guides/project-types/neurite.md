# Neurite and soma projects

**Type in the dialog:** _Neurites & somas_ · internal key `neurite`

For cultured neurons in fluorescence microscopy, where the measurement is not
"how much cell is there" but the split between the **cell body** and the
**processes** growing out of it.

---

## Models

Two models. The picker at the top of the project page offers both; only the
project's owner can change it.

| Model id                 | Name                       | Use it when                                                                                         |
| ------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------- |
| `neurite_soma` (default) | Neurite / Soma             | The cells are visible in ONE channel — tubulin. A trained network with a measured accuracy.         |
| `neurite_soma_classical` | Neurite / Soma (classical) | A cell is only visible when several channels are taken together. No network; you tick the channels. |

A new project starts on `neurite_soma`. The classical model is not a more
accurate replacement — it is for images the learned model cannot take.

### `neurite_soma` — the learned model (default)

**Neurite / Soma** — nnU-Net v2 **ResEnc-M**, 2D, a 3-fold
ensemble averaged in logit space with mirroring TTA and a **clDice** topology
term on the neurite class, which is what keeps thin processes connected instead
of beaded.

Held-out Dice **0.832 neurite / 0.915 soma**, from grouped
leave-one-condition-out cross-validation over the nine annotated training
frames. Roughly 12–15 s for a 2048 × 2048 frame on an A5000, scaling with pixel
count rather than with the number of cells. See
[ML models](../../reference/ml-models.md#neurite_soma--neurite--soma).

> **This model has no threshold.** The decision is a 3-class argmax
> (background / neurite / soma) over averaged logits, so there is no probability
> cut to move. A threshold value still rides along with every request — the queue
> row carries one and the API echoes it back — and this model ignores it, exactly
> as its accuracy was measured. If detections look wrong, the input channel or
> the pixel size is the thing to check, not a number.

### `neurite_soma_classical` — the classical model (merged channels)

**Neurite / Soma (classical)** — training-free: no neural network, no weights,
CPU only. About **1.3 s per 1024 × 1024 frame** (measured 1.13–1.46 s on four
production frames, 2026-10-08).

It is for fluorescence images where a cell is only visible when several
channels are taken together. What it does:

1. Each channel you ticked is normalised to its own background noise
   (median / MAD).
2. The channels are merged by pixel-wise maximum into ONE greyscale image, and
   that image is segmented.
3. Neurites come from a Meijering ridge filter (neuriteness, Meijering et al.
   2004), with a threshold relative to the image's own noise.
4. Short isolated fragments (under about 100 px) are discarded as background
   stains.
5. Somas are wide, compact structures with neurites leaving them.

`threshold` does not apply to this model either: its cut follows each image's
own noise and is not a setting. See
[ML models](../../reference/ml-models.md#neurite_soma_classical--neurite--soma-classical).

### Choosing the channels (classical model only)

With the classical model the channel picker shows **checkboxes** instead of
radio buttons. Tick one or more channels; nothing is ticked by default, and
**Confirm is disabled until at least one is ticked**.

The picker appears on the project page (**Segment**) and in the editor
(**Resegment**), and only when the image has more than one channel. A
single-channel image is segmented directly.

The channels you tick decide what is _segmented_. They do not limit what is
_measured_: the export's Intensity table covers every channel of the file.

---

## Input expectations

This section is about the learned `neurite_soma`. The classical model takes
whichever channels you tick, at their native bit depth, and refuses an image
over 64 megapixels.

The **tubulin channel**, single channel, fluorescence (confocal). The model
applies a 1–99.5 percentile stretch and then a z-score, because the training
polygons were drawn on frames that had already been through that stretch — it is
part of the input definition, not a display convenience.

Native bit depth is preserved on the way in, so a 16-bit frame keeps its dynamic
range until the stretch places it. A genuinely multi-channel frame is rejected
rather than averaged into a mixture the model never saw; on a multi-channel
video, mark the tubulin channel as the segmentation source.

Getting the channel wrong does not fail loudly. It produces confident-looking
polygons that do not follow the image, the same failure mode as pointing the
microtubule model at a fluorescence channel.

---

## What you get

**Closed polygons**, not polylines — a process is outlined, not centre-lined.
Neither class is nested inside the other, because a soma and a neurite are two
different biological objects rather than a whole and its part.

Each neurite or soma polygon carries a **`partClass`** of `neurite` or `soma` —
the same two classes from both models.

**Holes.** Crossing neurites close loops, and the background inside a loop is
not neurite. Both models report it: a hole is stored as its own polygon of
`type: 'internal'`, pointing at the region it belongs to through `parent_id`,
and it carries **no class**. The export subtracts it from its parent, so a loop
is measured as a ring rather than a filled disc. (The learned model emits holes
since 2026-10-08; a frame segmented with it before that has none until it is
segmented again.) Holes under 30 px² are closed rather than reported.

**Cutting a hole by hand.** Draw a polygon over the background and leave it
without a class. A polygon with no class that lies **wholly inside** a soma or
a neurite is read as a hole of the smallest region that contains it. A nested
polygon that _has_ a class is never a hole — a soma inside the outline of a
neurite network is a soma, a neurite island inside a loop is a neurite. A
classless polygon that only partly overlaps a region, or lies outside all of
them, is ignored. The consequence to keep in mind: a soma drawn on top of a
neurite and left without a class is subtracted from that neurite until you set
its class.

**Which soma a neurite belongs to.** A neurite can be assigned to one or more
somas; the assignment is stored on the neurite as **`somaIds`**, the ids of
those somas' polygons. (`somaId`, singular, is the older field: still read,
never written.) A neurite bridging two cells legitimately carries two. There is
no cross-frame track.

---

## In the editor

The two classes are drawn in the colours the model's own overlay uses, so an
editor screenshot and a `predict.py` overlay can be compared directly:

| Class     | Meaning                       | Colour                  |
| --------- | ----------------------------- | ----------------------- |
| `neurite` | Processes growing from a cell | **Cyan** (`#06b6d4`)    |
| `soma`    | The cell body                 | **Magenta** (`#d946ef`) |

The shape list shows each polygon's class with a matching dot. Everything else
is standard: the same seven edit modes, the same undo/redo, the same save.

Three controls exist only in neurite projects:

- **Assign neurites to cells** runs the assignment on the polygons as they are
  now, corrections included, and reports how many neurites could not be
  assigned to a cell.
- **Colour: Class / Cell** switches the canvas between colouring by class
  (every neurite cyan, every soma magenta) and by cell (a soma and every
  neurite assigned to it share one colour; a neurite shared by several somas is
  striped).
- **Assign neurites** is an edit mode for doing it by hand: click a neurite to
  pick it up, then click each soma it belongs to; clicking an assigned soma
  again removes it. A neurite's context menu also offers one "remove" entry per
  assigned soma.

With the classical model, **check the somas**: faint, diffuse somas are found
only some of the time (see Known limits), and everything the export measures is
measured on the polygons stored in the editor.

The class is written by the model, and you can set it yourself: right-click a
closed polygon and choose **Set as soma** or **Set as neurite**. That is how a
soma the model missed is added — draw the polygon, then give it its class —
and how a region filed under the wrong class is moved to the other.

> **A polygon with no class is not measured as a region.** A polygon you draw
> by hand starts with none and is drawn in the ordinary external red. The
> export keeps only polygons whose class is `neurite` or `soma` (`classOf` in
> `backend/src/services/export/neuriteMetricsExporter.ts`) as regions of the
> Neurites, Somas and Intensity tables; a classless one is either a hole (when
> it lies wholly inside a region — see **Cutting a hole by hand** above) or
> ignored. Reshaping an existing soma keeps its class; a soma drawn from
> scratch needs **Set as soma** before it counts.

---

## Metrics and export

A neurite project has a report of its own, written to **`neurite_metrics/`**
whenever metrics are requested. The generic `Polygon Metrics` + `Summary`
report that spheroid and wound projects get is **not** written for this type.
It is the same for both models.

| Table                               | Excel sheet      | CSV file        | Key in `neurite_metrics.json`  |
| ----------------------------------- | ---------------- | --------------- | ------------------------------ |
| One row per primary neurite         | `Neurites`       | `neurites.csv`  | `neurites`                     |
| One row per soma, with its stage    | `Somas`          | `somas.csv`     | `somas`                        |
| One row per frame × channel × class | `Intensity`      | `intensity.csv` | `intensity`                    |
| What to know before averaging       | `README`         | —               | —                              |
| Frames left out, and why            | `Skipped frames` | —               | `skipped`, `intensity_skipped` |

The workbook is `neurite_metrics.xlsx`. `Skipped frames` is present only when a
frame was skipped, and names the table it was skipped from.

**Neurites and Somas** come from assigning each neurite to a soma and staging
each cell. They **need a pixel size**: every staging threshold is in
micrometres, so a frame without one is skipped from these two tables. Read the
`README` sheet before averaging — a bridging neurite appears twice, and somas
the classifier rejected are kept with `soma_neuronal = 0`. Columns are listed
in [Metrics](../../reference/metrics.md#neurite-projects).

**Intensity** is the intensity of the soma and neurite classes, one row per
frame × channel × class (`soma`, `neurite`):

`frame, channel, class, area_px, mean_intensity, median_intensity,
std_intensity, sum_intensity, background_median, background_area_px,
mean_minus_background`

- The regions are the **union of all stored polygons** of the class — manual
  edits included — with holes subtracted. Where a soma and a neurite overlap,
  the pixel counts as soma.
- It is measured on **every channel of the file**, at native bit depth (raw
  camera counts), regardless of which channels were ticked for segmentation.
- `background_median` is the median of the pixels more than 5 px from any
  polygon; `mean_minus_background` is `mean_intensity` less that.
- It does **not** need a pixel size, so a frame skipped from Neurites / Somas
  for lacking one still gets its Intensity rows.
- A plain single-channel image (PNG / JPG) is measured as one channel named
  `image`. **To get per-protein intensities, upload a multi-channel TIFF or
  ND2** so each channel is stored on its own.

Annotation exports: COCO, YOLO and custom JSON — but **only COCO and the custom
JSON carry the class**.

> **In COCO the two classes are real categories, not attributes.** `neurite` is
> category **3** and `soma` is category **4**, alongside the generic `cell`
> category **1**, and only the classes actually present are emitted. A standard
> COCO consumer therefore reads a two-class dataset rather than one class named
> "cell". The category colours match the editor's.

> **YOLO flattens the two classes into one.** The YOLO writer emits a literal
> class id of `0` for every polygon, so a YOLO export of a neurite project is a
> single-class dataset in which soma and neurite are indistinguishable — the
> very split this project type exists to measure. Train from the COCO export
> instead.

---

## Known limits — read before trusting a number

The classical model:

- **Faint, diffuse somas are found only some of the time.** On three dim
  production frames it found 2 of 3, 1, and 0 somas. Check and correct the
  somas in the editor.
- **Images over 64 megapixels are refused.**

The learned model:

- **Pixel size.** The model was trained at ~0.180 µm/px. At ~0.090 µm/px each
  soma tends to come back split into roughly two pieces — measured, not
  suspected. Validate soma counts before trusting them at a different pixel
  size.
- **One microscope, one run, nine frames.** Leica confocal only; it has never
  seen spinning-disk or widefield data. The cross-validation is honest but the
  panel is small.
- **Faint processes may be under-detected.** Treat unusually low neurite
  coverage on new data as a flag, not a result.
- **Soma area runs slightly generous** against expert ground truth.

## Related

- [ML models](../../reference/ml-models.md#neurite_soma--neurite--soma)
- [ML models — the classical model](../../reference/ml-models.md#neurite_soma_classical--neurite--soma-classical)
- [Metrics](../../reference/metrics.md)
- [Export](../export.md)
