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
> Nothing else was tested. A frame of another size, or a µm/px scale entered at
> export that differs from 1.28 by more than 10 %, is still scored, but the row
> carries an `Input-Scale Warning`. Cores smaller than 16 048 px — the smallest
> expert core in the paper's dataset — leave DI undefined, so a down-sampled
> frame will often read `N/A`.

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
