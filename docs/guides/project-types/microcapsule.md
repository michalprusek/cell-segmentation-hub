# Microcapsule projects

**Type in the dialog:** _Microcapsules_ · internal key `microcapsule`

For round microcapsules in bright-field microscopy, where the measurement is one
clean boundary per capsule and the size/shape distribution across the field.

---

## Model

One model, forced: **Microcapsule** — a compact U-Net with a MobileNetV3-Small
encoder (~14.5 MB) **distilled from Meta SAM 3**, followed by an h-maxima-seeded
**watershed** on a per-instance distance map to separate touching capsules.

~0.3 s per image on an A5000, default threshold 0.5. See
[ML models](../../reference/ml-models.md#microcapsule--microcapsule).

---

## Input expectations

Bright-field micrographs of capsules. Touching capsules are handled — that is
what the watershed is for — but heavily overlapping ones may still merge.

---

## What you get

One closed polygon per capsule, full resolution, simplified with
Douglas–Peucker.

Each capsule additionally carries a **`complete`** flag. A capsule whose mask
reaches the image border is marked incomplete.

> **Border-cut capsules are excluded from every metric** — area, perimeter and
> compactness. A clipped capsule would otherwise drag every distribution down.
> They are still segmented and still visible in the editor; they just do not
> appear in the workbook.

---

## In the editor

Nothing type-specific. Standard shape list and edit modes.

---

## Metrics and export

Metrics sheet **`Microcapsule Metrics`**, one row per complete capsule:

`Image Name`, `Capsule ID`, `Area`, `Perimeter`, `Width`, `Height`, `Diameter`,
`Feret Max`, `Feret Min`, `Equivalent Diameter`, `Compactness`, `Ovality`,
`Confidence`.

Plus a **`Summary`** sheet: the count of complete capsules, and the average,
minimum and maximum of area and compactness, with averages of the remaining
size columns.

> **Two column names do not mean what they say.** The **`Compactness` column
> holds the circularity value** (4πA/P²), which is 1 for a perfect circle and
> falls below 1 as the shape becomes irregular — the opposite direction to the
> unbounded compactness used in the spheroid sheet. And **`Ovality` is the Feret
> aspect ratio** (max/min), which is 1 for a circle and grows with elongation.
>
> `Diameter` is the **mean** of the two Feret diameters, `(max + min) / 2`.

Annotation exports: COCO, YOLO and custom JSON, as for any polygon project.

## Related

- [ML models](../../reference/ml-models.md#microcapsule--microcapsule)
- [Metrics](../../reference/metrics.md)
- [Export](../export.md)
