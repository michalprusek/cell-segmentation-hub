# Sperm projects

**Type in the dialog:** _Sperm_ · internal key `sperm`

For spermatozoa morphology, where each cell is measured as **three parts** —
head, midpiece and tail — with per-part lengths.

---

## Model

One model, forced: **Sperm Morphology**. It performs multi-class instance
segmentation and emits **polylines natively** — skeleton extraction, breadth-first
ordering, then Douglas–Peucker simplification — rather than thresholded blobs.

Default threshold 0.5. See
[ML models](../../reference/ml-models.md#sperm--sperm-morphology).

---

## What you get

Open polylines. Each carries:

- **`partClass`** — `head`, `midpiece` or `tail`;
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
`Total Length`.

Lengths are the sum of consecutive segment distances along each polyline (open
paths — the loop is not closed), converted to micrometres when you supply a
pixel size at export.

Polylines with no `instanceId` are excluded as orphans. If a project has no
polyline data at all, the export falls back to the standard polygon report.

The editor also offers a per-image **sperm** export tab producing
`sperm_metrics_<image>_<date>.xlsx`; unlike the project export it lists pixel
columns and adds micrometre columns only when you enter a calibration.

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
