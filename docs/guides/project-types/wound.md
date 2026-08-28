# Wound healing projects

**Type in the dialog:** _Wound healing_ · internal key `wound`

For scratch-assay time-lapses, where the measurement is the **open wound area as
a fraction of the field**, tracked over time until closure.

---

## Model

One model, forced: **Wound Healing (Scratch Assay)** — a U-Net with a MiT-B5
(SegFormer) encoder doing binary segmentation of the open wound.

By far the fastest model in the platform: ~32 ms per image on an A5000, 90 % IoU
on an external test set. Default threshold 0.5.

It works internally at **256 × 256** — its training resolution — and upsamples
the mask back to your image's native size. That is why it is so fast, and also
why very fine wound-edge detail is smoothed.

See [ML models](../../reference/ml-models.md#wound--wound-healing-scratch-assay).

---

## Input expectations

Phase-contrast or bright-field scratch-assay frames, as a **time series**. Both
a folder of still images and a video/stack work.

**Ordering matters.** The time series is built from the images' display order.
For a video that is the frame order; for a folder of stills, reorder them in the
project gallery if the filename order is not chronological.

---

## What you get

Closed polygons covering the open wound region, typed external, with holes typed
internal.

---

## In the editor

Nothing type-specific. Standard shape list and edit modes.

---

## Metrics and export

Three sheets:

- **`Polygon Metrics`** — the standard per-polygon shape statistics.
- **`Summary`** — counts and averages over external polygons.
- **`WoundTimeSeries`** — the closure curve: `Order`, `Image Name`,
  `Wound Area (%)`, `Polygons`, `Created At (UTC)`, with the chart embedded in
  the sheet.

Wound area percentage is

```
(Σ external area − Σ hole area) / (image width × height) × 100
```

clamped at zero. A polygon counts as a hole only if it is typed internal **and**
has a parent polygon.

The same chart is also written to the ZIP as
`wound_healing/wound_area_chart.png`. Its generation is non-fatal: if it fails,
the export still completes and reports a warning.

Annotation exports: COCO, YOLO and custom JSON.

## Related

- [Metrics → wound closure](../../reference/metrics.md#wound-closure)
- [Export](../export.md)
- [Uploading data](../uploading-data.md)
