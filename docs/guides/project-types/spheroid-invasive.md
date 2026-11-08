# Disintegrated spheroid projects

**Type in the dialog:** _Disintegrated spheroids_ · internal key
`spheroid_invasive`

For spheroids dispersing into the surrounding matrix, where the question is not
"how big is it" but **how much mass has left the dense core**. The headline
number is the **outside-core fraction** (Lim's Index B); the core-anchored
**Disintegration Index** is exported beside it.

---

## Model

One model, forced: **Spheroid Disintegration** — UNet++ with an EfficientNet-B5
encoder, three classes: `background`, `corona` (dispersing cells) and `dense
core`.

**There is no threshold.** Each pixel takes the class of highest score
(argmax), so the value the interface sends is echoed and never applied — the
response says `threshold_applies: false`. (Until 2026-09 this page claimed a
tuned default of 0.2; no such tuning exists.)

The served checkpoint is `prod_s42`, one of the five production replicates
deposited with the spheroid-disintegration paper (SHA-256
`d47d28ad338de2e7424969e8da1dc39df2663bcf1777e681647caffa1f49ea15`, Zenodo
10.5281/zenodo.22295117). The paper's numbers are five-replicate means unless a
replicate is named, so a single image scored here is one replicate's read-out.

The **core is predicted directly**, not derived by thresholding intensity inside
the outer boundary. That matters more than it sounds: the previous binary model
inferred the core heuristically and mis-scaled it at 0 h, which biased every
index computed from it. Numbers produced by that older model are not comparable.

See [ML models](../../reference/ml-models.md#spheroid_disintegration--spheroid-disintegration).

---

## Input expectations

Bright-field or phase-contrast images of spheroids at successive time points,
typically a 0 h control against later time points. Both the core and the
dispersing corona need to be visible.

> **Validated regime: 2048 × 2048 px frames at ~1.28 µm/px (5× objective).**
> Nothing else was tested. A frame whose pixel size is known is brought to
> 1.28 µm/px before the model sees it (next section). A frame of another size
> (after that resampling: more than 10 % off 2048 px), or one scored at its
> uploaded scale with a µm/px scale entered at export that differs from 1.28 by
> more than 10 %, is still scored, but the row carries an
> `Input-Scale Warning`. Cores smaller than 16 048 px at 1.28 µm/px — the
> smallest expert core in the paper's dataset — leave DI undefined, so a
> down-sampled frame of unknown pixel size will often read `N/A`.

### Pixel size

**Set it in the project header**: a disintegrated-spheroid project shows a
**Pixel size (µm/px)** box beside the model picker (owner only; empty = not
set). Frames taken at 1.28 µm/px, the 2048 × 2048 frames of the paper, need
nothing.

When a frame's pixel size is known and more than 2 % away from 1.28 µm/px, the
model **resamples the frame to 1.28 µm/px** before inference (shrinking with
area averaging, enlarging with bilinear interpolation, before CLAHE, as in
training), computes the read-out there, and maps the mask back to the uploaded
frame, so the polygons overlay your image as usual. On the paper's held-out
batch (37 images at 48 h), frames simulated at 1.10 and 1.50 µm/px changed the
outside-core fraction by up to 0.028 when fed as acquired, and by at most
0.0051 (median 0.0016 and 0.0015) when resampled first.

- **Which value is used**: the image's own calibration (a video frame's
  container, or an Olympus cellSens JPEG/TIFF that carries one), else the
  project's value.
- **Check a value set before.** From 7 to 13 September 2026 the header showed
  a µm/px box on every project, as a default for the export dialog, so a
  value typed there may still be stored. It is now read at segmentation and
  changes what the model sees: check the box of each disintegrated-spheroid
  project before re-segmenting.
- **What is computed where**: DI, the outside-core fraction, reach, fragment
  counts, the core-size minimum and the regime flags at 1.28 µm/px; the three
  areas on your frame's own pixels, converted with the export dialog's scale,
  so the export's µm² are real when that scale is the frame's pixel size. The
  `Note` column says `scored at 1.28 um/px: resampled from … um/px`. Such a
  row gets no pixel-size warning, because that mismatch was corrected, unless
  the scale entered at export differs from the one it was resampled from by
  more than 10 %; the warning then names both. Its frame size is checked at
  1.28 µm/px with the same 10 % band: a 2048 × 2048 frame at 1.35 µm/px
  becomes 2160 × 2160 px and is not warned about, one at 1.10 µm/px becomes
  1760 × 1760 px and is (as it was before, for its pixel size).
- **Limits**: only factors 0.5–2× (0.64–2.56 µm/px) are resampled, and a frame
  is never grown past 4096 × 4096 px. Outside that, the frame is scored at its
  uploaded scale and the row says why, once.
- **It applies to new segmentations.** Changing the value does not re-run the
  stored ones; re-segment the images for it to take effect. An edited
  segmentation is re-scored at export on the grid its own segmentation used:
  resampled from the same pixel size if that segmentation was resampled, at
  the uploaded scale otherwise (every segmentation made before the pixel size
  was read included). Neither a changed calibration nor the export's scale
  moves it to another grid; re-segment for that.

---

## What you get

Closed polygons. Those belonging to the dense core carry `partClass: "core"`;
everything else is the corona.

**In the editor the core is drawn green** with a translucent green fill, while
the corona and holes use the normal red and blue. That is the only
type-specific behaviour in the editor.

> There is **no core/corona assignment UI**. The class comes from the model. You
> can edit a core polygon's geometry, but you cannot re-classify a corona
> polygon as core from the interface.

---

## The read-outs

Two core-anchored read-outs are exported: the **outside-core fraction** (the
headline number) and the **Disintegration Index** (DI). **Both are computed from
the model's raster mask at segmentation time** and
stored with the segmentation; the export reads them. There is no DI panel on the
canvas. The polygons you see are for display and editing: they drop every
region under 50 px and every hole, which are exactly the far corona cells that
set the index's reach. **Once you edit a segmentation's polygons**, its stored
read-out no longer describes them, and the export scores the edited polygons
instead with the same algorithm — the `DI Source` column says `polygons` and
the `Note` column says why. Re-segment to get the raster read-out back.

The algorithm is a verbatim port of the paper's released `compute_di.py`, and a
test (`backend/segmentation_cpu_tests/test_disintegration_parity.py`) holds it
to that file's output to 1e-9.

Every foreground pixel's distance from the **core centroid** is normalised by the
core's effective radius, and the resulting distribution is compared against the
analytic distribution of a uniform filled disk by the 1-Wasserstein distance;
the index is `tanh` of that distance.

- An intact spheroid gives **DI ≈ 0**.
- As mass disperses, **DI → 1**.

> **A core is required, and there is deliberately no fallback.** Without a valid
> core — or with a core below 16 048 px — the index is undefined, and every DI-derived column is written as
> the literal string **`N/A`** — never as a computed zero. An earlier
> equivalent-disk fallback was removed because it produced plausible-looking
> numbers out of nothing.

The full definition, including the panel metrics beside it, is in
[Metrics → Disintegration Index](../../reference/metrics.md#disintegration-index-di).

---

## Metrics and export

The metrics workbook has a single sheet, **`Image Metrics`**, with **one row per
image** — not per polygon, because the index is a whole-image property:

`Image Name`, `Total Spheroid Area`, `Core Area`, `Invasion Area`,
`Outside-core Fraction (Index B)`, `Disintegration Index`, `W1`,
`Reach p90 (R_core)`, `Corona Fragments`, `Largest-Fragment Fraction`,
`Solidity`, `Core Components`, `Largest Core Component Fraction`,
`Core Centroid Shift (R_core)`, `Core Fragmented (0/1)`,
`Unvalidated Regime: Outside-core Fraction 0.08-0.47 (0/1)`,
`Below Validated Floor: Outside-core Fraction < 0.61 (0/1)`, `DI Source`, `Note`,
`Input-Scale Warning`.

The outside-core fraction (Lim's Index B: corona pixels over all foreground
pixels) is the paper's primary read-out and the first read-out column. DI, a
distance-weighted index, is reported beside it as the secondary one. See
[Metrics → Outside-core fraction](../../reference/metrics.md#outside-core-fraction-index-b).

Areas are still reported even when the index calculation fails; only the
index columns drop out in that case.

Annotation exports: COCO, YOLO and custom JSON, as for any polygon project.

## Related

- [Metrics](../../reference/metrics.md#disintegration-index-di)
- [Standard spheroid projects](spheroid.md)
- [Export](../export.md)
