# Sperm projects

**Type in the dialog:** _Sperm_ · internal key `sperm`

For spermatozoa morphology, where each cell is measured part by part with
per-part lengths: as **three parts** — head, midpiece and tail — with the
default model, or as **two parts** — head and tail — with the two-part model.

---

## Model

Two models; the project's owner picks one next to the project type at the top
of the project page.

| Model                              | Parts per cell       | Use it when                                                                |
| ---------------------------------- | -------------------- | -------------------------------------------------------------------------- |
| **Sperm Morphology** (default)     | head, midpiece, tail | you measure the midpiece separately                                        |
| **Sperm Morphology (head + tail)** | head, tail           | your material is annotated and measured as head and tail only, no midpiece |

Both are the same architecture and pipeline — multi-class instance segmentation
emitting **polylines natively** (skeleton extraction, breadth-first ordering,
then Douglas–Peucker simplification) rather than thresholded blobs. The
two-part model is fine-tuned from the three-part one on sperm annotated as head
and tail only.

The choice is not cosmetic. In the two-part convention the head is the whole
helical part, which the three-part model divides between head and midpiece — so
the two models place the head/tail boundary differently, and adding the
three-part model's midpiece to its tail does not give the two-part
measurement. Pick the model that matches how your lengths are defined, and do
not mix the two within one comparison.

A new sperm project starts on **Sperm Morphology**. Changing the model affects
only later runs; resegment existing images to get the other model's parts.

Registry threshold 0.5, which neither model reads — the pipeline applies its
own. See [ML models](../../reference/ml-models.md#sperm--sperm-morphology) and
[the two-part model](../../reference/ml-models.md#sperm_2part--sperm-morphology-head--tail).

---

## What you get

Open polylines. Each carries:

- **`partClass`** — `head`, `midpiece` or `tail` (the two-part model emits only
  `head` and `tail`);
- **`instanceId`** — `sperm_1`, `sperm_2`, … grouping the parts of one cell.

Parts are colour-coded consistently everywhere in the interface:

| Part     | Colour |
| -------- | ------ |
| Head     | green  |
| Midpiece | orange |
| Tail     | cyan   |

---

## In the editor

The sidebar shows the **Sperm Instances** panel.

### Drawing controls

At the top of the panel are the settings that decide what your _next_ drawn
polyline becomes:

- an **Instance** dropdown listing every `sperm_N`;
- a **+** button that mints the next instance and makes it active;
- a **Head / Midpiece / Tail** selector, colour-matched.

Draw with <kbd>P</kbd> (Create polyline) and the new polyline picks up the
active instance and part automatically.

### The instance list

One row per cell, showing three dots — coloured when that part exists, grey when
it is missing — so incomplete cells are visible at a glance. Hovering a dot says
which part it is and whether it has been drawn. Expanding a row lists the cell's
polylines with their lengths in pixels.

Polylines with no instance appear in an **Unassigned** section.

### Reclassifying

Right-click a polyline for:

- **Set as Head / Set as Midpiece / Set as Tail** — rewrites the part class;
- **Assign to** — move it to a different `sperm_N`.

### Joining polylines

In Add points mode you can join two polylines end to end — but only **within the
same part class**. You cannot join a head to a tail. See
[Segmentation editor → joining](../segmentation-editor.md#joining-two-polylines).

### On videos

Renames and part-class changes on a tracked polyline are mirrored to **every
frame of that track** when you save.

---

## Metrics and export

Metrics sheet **`Sperm Metrics`**, one row per cell:

`Image Name`, `Instance ID`, `Head Length`, `Midpiece Length`, `Tail Length`,
`Total Length`, `Pixel Size (µm/px)`.

Lengths are the sum of consecutive segment distances along each polyline (open
paths — the loop is not closed). **Each image is converted by its own pixel
size**, written on every row, taken from — in order:

1. **the file itself**, read at upload from Olympus cellSens metadata:
   - a **JPEG** carries it in the Exif MakerNote (a DP28 at 40x is 0.08625
     µm/px at 4104 × 2174 and 3840 × 2160);
   - a **TIFF** from cellSens XV carries it twice — in the Olympus SIS block and
     in the OME-XML description — and both must agree (2052 × 1086 is 0.1725
     µm/px: the same field at half the resolution).

   It is used only when the calibration was written for the image's actual
   pixel size, so a file resized after export is treated as uncalibrated rather
   than mis-scaled. TIFFs written by the older **analySIS** software carry only
   the SIS block, with nothing that ties it to the pixel size, and are not
   read.

2. **the pixel size entered at export,**
3. **the pixel size set on the project.**

Columns are in µm when any image has a pixel size and in px when none does. In
a µm export an image with no pixel size at all gets **empty** length cells and
is named in the export's warnings — a pixel count under a µm header would read
as a length about 12x too large.

Polylines with no `instanceId` are excluded as orphans. If a project has no
polyline data at all, the export falls back to the standard polygon report.

### Annotation exports

- **COCO** — polylines get category 2, named `sperm`, with `partClass`,
  `instanceId` and `length` in their attributes, and `area: 0`. A polyline with
  a missing or invalid `partClass` is dropped.
- **Custom JSON** — additionally builds a `spermInstances` array grouping
  head/midpiece/tail per cell with a total length. This is the sperm-friendliest
  format.
- **YOLO** — polylines are **not exported**; the format has no representation
  for them.

## Related

- [Segmentation editor](../segmentation-editor.md#sperm-projects)
- [Export](../export.md)
