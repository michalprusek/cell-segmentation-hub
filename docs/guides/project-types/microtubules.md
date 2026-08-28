# Microtubule projects

**Type in the dialog:** _Microtubules_ · internal key `microtubules`

The most specialised workflow in the platform: instance segmentation of
individual microtubule filaments in **IRM** time-lapses, tracked across frames,
measured per channel, and exported to ImageJ and CVAT.

Several things here behave differently from every other project type. Read the
[three things that surprise people](#three-things-that-surprise-people) before
your first run.

> Note the naming asymmetry, which has already caused one shipped bug: the
> project type is the **plural** `microtubules` while the model id is the
> **singular** `microtubule`.

---

## Model

One model, forced: **Microtubule v5H** — an nnU-Net ResEnc-M network (~140 M
parameters) predicting the filament foreground, followed by a curvature-bounded
instancer that separates it into individual centerlines, resolving every
crossing by min-cost matching under a hard 0.25 rad/px curvature bound.

Trained **entirely on synthetic frames** — no human annotation at any stage.
Nothing is downloaded at inference time.

Roughly 4.0–4.4 s for a 1024² frame carrying 65 microtubules on an A5000. The
cost is dominated by the _instancer_, so it scales with the number of
microtubules, not just with frame size — a dense field is slower than a large
empty one.

See [ML models](../../reference/ml-models.md#microtubule--microtubule-v5h).

---

## Three things that surprise people

### 1. The model is IRM-only

It was trained on Interference Reflection Microscopy. On a **TIRF** frame it
still emits plenty of confident-looking polylines, but they do not track image
content at all.

Measured by sampling background-flattened contrast along each detected
centerline against the same curve translated elsewhere (a real microtubule in
IRM is _darker_ than its surround):

| Input | Threshold | Detections | Contrast separation |
| ----- | --------- | ---------- | ------------------- |
| IRM   | 0.97      | 128        | **−1.73 SD**        |
| IRM   | 0.35      | 155        | −1.44 SD            |
| TIRF  | any       | many       | **≈ −0.02 SD**      |

The symptom of feeding it TIRF is exactly that: many plausible polylines with
no contrast underneath them.

**So: make sure the IRM channel is the segmentation source.** If no channel name
is recognisable and no wavelength is recorded, _no_ channel is marked as the
source and the platform silently falls back to channel 0 — which may well be
TIRF. Set it explicitly in the channel list, or in the picker that appears
before Segment All.

### 2. The threshold is not a user setting

The registry records 0.97, and the segmentation request deliberately passes **no
threshold at all** for this model — it applies its own. Lowering it does not fix
a low detection count; the table above is the measurement that settled this.
More detections at a lower threshold means _worse_ evidence, and on TIRF the
output does not track the image at any threshold.

If you are getting too few microtubules, check the **input channel**, not the
threshold.

### 3. Cross-frame identity is geometric

The model emits no embeddings. Matching between frames is done on **symmetric
curve distance**, with common-mode stage drift removed by a normal-flow
least-squares fit.

There is **no hard rejection gate**: a distant pair is expensive, never
impossible. So a tracking problem is a _geometry_ problem — a field of parallel
filaments, or badly estimated drift — not a decode problem.

---

## Input expectations

IRM time-lapses, typically ND2 or multi-page TIFF, often with additional
fluorescence channels for the protein being measured. 16-bit data is kept at 16
bits throughout. See [Videos, frames and channels](../videos-and-channels.md).

---

## Type-specific upload features

Two features exist only for this project type:

- **Channel registration at upload.** Dropping a video offers _"Register &
  upload"_, which corrects small shifts between channels by aligning each to the
  first (translation only, using gradient-magnitude phase correlation so it
  works across IRM/fluorescence). Lossless for 16-bit data.
- **Add channel.** Attach an extra channel to selected frames after the fact,
  either a single image stamped onto every frame or a video paired frame by
  frame, with optional alignment.

Both are documented in
[Videos, frames and channels](../videos-and-channels.md#channel-registration-align-at-upload).

---

## What you get

**Open polylines** — the only model in the platform producing them. Each carries:

| Field        | Meaning                                      |
| ------------ | -------------------------------------------- |
| `trackId`    | Cross-frame identity, written by the tracker |
| `mtType`     | Your assigned type-label class, if any       |
| `instanceId` | Per-frame instance id (`mt_…`)               |

---

## Cross-frame tracking

Tracking runs **automatically** once every frame of a container reaches a final
state. It is fire-and-forget: a timeout is logged and produces no assignments,
and a partial write-back can leave a container half-tracked.

**If some frames have consistent colours and others do not, the tracker needs
re-running** — that is not a model failure.

---

## In the editor

The generic shape list is replaced by the **Microtubule Instances** panel:

- rows sorted by track, so the order is stable across frames;
- a colour swatch, name, type-label chip and **length in pixels** per row;
- **Colour by: Instance | Label** — a stable per-track hue, or the assigned
  type's colour (grey when untyped). Remembered in your browser;
- bulk **Hide all / Show all**, and a select-all checkbox.

### Type (class) labels

There is **no built-in palette**. You create your own labels per project, each
with a name and colour, from the "Type labels" section at the bottom of the
panel. Names must be unique.

Assign with right-click → **Set type**. With two or more microtubules selected
(Shift-click) the item becomes _"Set type for N selected"_.

**Assignment is per track, not per frame** — the label is written to every frame
of each selected track. An untracked, hand-drawn polyline is still a valid
target; its label lives on that one frame only.

**Deleting a label clears it from every microtubule that used it.**

Because assignment writes to the whole track on the server but only the current
frame locally, **undo reverts only the current frame**.

### Track operations

| Right-click item                        | Effect                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Propagate to following frames**       | Stamps this polyline's exact current shape into every later frame. Confirmed; cannot be undone. |
| **Propagate selected microtubules (N)** | The same for a multi-selection, each keeping its own track.                                     |
| **Delete whole track**                  | Removes a tracked microtubule from all frames; the confirmation names the frame count.          |
| **Show kymograph**                      | Opens the kymograph modal.                                                                      |

### Kymographs in the editor

Pick a source channel, optionally enable velocity analysis, set the intensity
width (1–50 px). A badge says whether the line is **tracked across frames** or a
**static line**. Drag to pan, scroll to zoom.

With velocity analysis on, a table lists per trajectory: net velocity, run
length (µm), run time (s), intensity minus background, `bright` and `edge`
flags, and SNR. You can download the velocity CSV, the PNG and the raw CSV.

### Joining polylines

Two microtubules can be joined end to end in Add points mode, but only if they
have the **same type label** (two untyped ones match). The surviving polyline
keeps its track and name.

### Editing caveats

- **Deleting a tracked polyline and saving deletes it from every frame** of the
  video.
- Renames propagate across frames on save; geometry does not.
- Per-microtubule **intensity is not shown in the editor** — the only number
  there is length in pixels. Intensities are computed at export time.

---

## Metrics and export

Microtubule projects export **differently from every other type**.

### Always included, no toggle

- **`annotations/imagej/<video>_RoiSet.zip`** — opens directly in Fiji's ROI
  Manager as a stack. ROIs are named `<typeName>_<counter>` keyed on the track,
  so one microtubule keeps one name on every slice; stroke width is the band
  thickness you set; colour is the class colour, or the same per-track hue the
  editor drew. Each polyline also gets a **`<name>_bg`** ROI showing the exact
  background region its measurement used.
- **`annotations/cvat/<video>.xml`** — CVAT-for-images 1.1. Only polylines;
  cross-frame identity travels as a `track_id` attribute.

### Not available

**COCO, YOLO and custom JSON are deliberately not produced** — a flat category
does not represent per-instance polyline tracks. The dialog replaces those
checkboxes with a note.

### Metrics workbook

Two sheets. The standard polygon report is skipped entirely — open polylines
have no area.

**`Microtubule Metrics`** — long format, one row per frame × polyline × channel:
`frameIndex`, `imageName`, `label`, `mtType`, `instanceId`, `trackId`, `channel`,
`lengthPx`, `lengthUm`, `areaPx`, `areaUm2`, `pixelCount`, `sumIntensity`,
`meanIntensity`, `medianIntensity`, `stdIntensity`, `medianBackground`,
`meanBackground`, `signalMinusBackground`.

**`Channel Totals`** — whole-video per-channel totals independent of any
microtubule.

Per-channel intensity is **always computed, for every channel** — there is no
enable checkbox and no channel picker. The two settings are the band
**thickness** (default 5 px) and the background **margin multiplier** (default
2, giving a 10 px reach). The measurement geometry reproduces ImageJ's
`Roi.convertLineToArea`, and the background ring excludes the band of _every_
microtubule in the frame. See
[Metrics → microtubule intensity](../../reference/metrics.md#microtubule-intensity).

**Intensities come from the original ND2/TIFF at full bit depth**, not from
display images — except for channels added after upload, whose pixels only exist
as per-frame PNGs.

### Kymographs or profiles

An optional section offers exactly one of:

- **Kymograph (space × time)** — one PNG per microtubule × channel with detected
  tracks drawn on, plus `velocity_metrics.xlsx` with **one sheet per channel**.
- **Intensity profiles (per image)** — the raw intensity matrix as CSV plus one
  plot per frame.

A kymograph needs time, so the option is only offered when the project has a
multi-frame container; otherwise it is forced to profiles.

Caps, always logged when hit: **60 microtubules per container**, **300 profile
frames per microtubule × channel**.

---

## The batch alternative

For a _folder of ND2 wells_ rather than an interactive project, use
[Automated Essays](../automated-essays.md). It runs the same model and the same
measurement code, and returns one CSV row per microtubule.

## Related

- [ML models: microtubule v5H](../../reference/ml-models.md#microtubule--microtubule-v5h)
- [Videos, frames and channels](../videos-and-channels.md)
- [Metrics](../../reference/metrics.md#microtubule-intensity)
- [Export](../export.md#microtubule-exports)
