# Disintegrated spheroid projects

**Type in the dialog:** _Disintegrated spheroids_ · internal key
`spheroid_invasive`

For spheroids dispersing into the surrounding matrix, where the question is not
"how big is it" but **how much mass has left the dense core**. The headline
number is the core-anchored **Disintegration Index**.

---

## Model

One model, forced: **Spheroid Disintegration** — UNet++ with an EfficientNet-B5
encoder, three classes: `background`, `corona` (dispersing cells) and `dense
core`.

The default threshold is **0.2**, not 0.5, because the corona is faint by
construction.

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

## The Disintegration Index

**It is computed at export time, not in the editor.** There is no DI panel on
the canvas.

Every foreground pixel's distance from the **core centroid** is normalised by the
core's effective radius, and the resulting distribution is compared against the
analytic distribution of a uniform filled disk by the 1-Wasserstein distance;
the index is `tanh` of that distance.

- An intact spheroid gives **DI ≈ 0**.
- As mass disperses, **DI → 1**.

> **A core is required, and there is deliberately no fallback.** Without a valid
> core polygon the index is undefined, and every DI-derived column is written as
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
`Disintegration Index`, `Radial Reach q95 (R_core)`, `Dispersed-Mass Fraction`,
`Fragment Count`, `Largest-Fragment Fraction`, `Solidity`, `Hole Count`,
`Core Equiv. Diameter`, `Whole Equiv. Diameter`.

Areas are still reported even when the index calculation fails; only the
index columns drop out in that case.

Annotation exports: COCO, YOLO and custom JSON, as for any polygon project.

## Related

- [Metrics](../../reference/metrics.md#disintegration-index-di)
- [Standard spheroid projects](spheroid.md)
- [Export](../export.md)
