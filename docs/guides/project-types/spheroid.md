# Spheroid projects (standard)

**Type in the dialog:** _Spheroids (standard)_ · internal key `spheroid`

For cellular spheroids imaged in bright field or phase contrast, where the
quantity of interest is the outline of each spheroid and the shape statistics
derived from it. This is the platform's original use case and the only type that
offers a **choice of model**.

---

## Models

Five, all producing closed polygons with optional internal holes:

| Model                      | Pick it when                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HRNet (Balanced)**       | A balanced starting point when boundaries and speed both matter.                                                                                                 |
| **CBAM-ResUNet (Precise)** | Publication figures, difficult boundaries, small batches. Roughly 2× HRNet's cost.                                                                               |
| **UNet (Fastest)**         | Large batches where turnaround matters more than the last percent of boundary accuracy.                                                                          |
| **SegFormer**              | Highest reported accuracy on bright-field spheroids (93 % IoU), and very fast. **The default for this project type.**                                            |
| **Mamba-UNet**             | Images unlike the training data — an external lab, unknown optics, drug-treated or unusual morphologies. Chosen specifically for out-of-distribution robustness. |

The model is a property of the **project**: it sits at the top of the project
page, immediately right of the project type, and the picker offers only models
this type can run. A new project starts on SegFormer — the most accurate of the
five, not the fastest. Only the project's **owner** may change it; a shared
annotator sees it as a read-only label.

There is no Settings page for this and no per-run dialog: both were removed on
2026-09-20 (PRs #553/#554), because a single global model had no relationship
to the project being segmented.

The confidence threshold is **not** settable — each model applies the cut it
was validated with. Hole detection is settable here, since standard spheroids
are one of the two project types where an internal hole is structure rather
than noise (the other is wound healing).

`spheroid_disintegration` is deliberately **not** offered here. If you need a
Disintegration Index, create the project as
[Disintegrated spheroids](spheroid-invasive.md) instead.

Full details: [ML models](../../reference/ml-models.md#spheroid-models).

---

## Input expectations

Bright-field or phase-contrast micrographs of spheroids, one or many per image.
Good contrast between the spheroid and the background is the single biggest
factor in output quality.

Still images and videos are both supported; there is nothing spheroid-specific
about the video path.

---

## What you get

Closed polygons typed **external** (the spheroid outline) or **internal** (a hole
inside one). The editor draws external red and internal blue.

---

## In the editor

Nothing type-specific — the standard shape list, all seven edit modes, and the
per-polygon metrics panel. See [Segmentation editor](../segmentation-editor.md).

---

## Metrics and export

Metrics sheet **`Polygon Metrics`**, one row per polygon, plus a **`Summary`**
sheet of counts and averages over external polygons only.

Columns: area, perimeter, perimeter with holes, equivalent diameter,
circularity, the Feret family, major/minor axis, bounding box, extent,
compactness, convexity, solidity and sphericity. Every formula and its caveats
are in [Metrics](../../reference/metrics.md#shape-metrics) — in particular,
`Sphericity` is `circularity × 0.8` and `Major/Minor Axis Length` are the Feret
diameters, not fitted ellipse axes.

Annotation exports: **COCO**, **YOLO** and the platform's custom JSON.
See [Export](../export.md).

## Related

- [ML models](../../reference/ml-models.md)
- [Disintegrated spheroids](spheroid-invasive.md)
