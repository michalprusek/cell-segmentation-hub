# Neurite and soma projects

**Type in the dialog:** _Neurites & somas_ · internal key `neurite`

For cultured neurons in fluorescence microscopy, where the measurement is not
"how much cell is there" but the split between the **cell body** and the
**processes** growing out of it.

---

## Model

One model, forced: **Neurite / Soma** — nnU-Net v2 **ResEnc-M**, 2D, a 3-fold
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

---

## Input expectations

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
Every polygon is `type: 'external'`; neither class is nested inside the other,
because a soma and a neurite are two different biological objects rather than a
whole and its part.

Each polygon carries a **`partClass`** of `neurite` or `soma`. That is the only
extra field: there is no instance id and no cross-frame track, so a soma and the
processes touching it are separate shapes with nothing linking them.

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

The class is written by the model and there is **no control for changing it**.
A polygon you draw by hand therefore has no class and is drawn in the ordinary
external red; correcting a misclassified shape means deleting it and
re-segmenting, not relabelling it.

---

## Metrics and export

Metrics sheets **`Polygon Metrics`** + **`Summary`** — the same comprehensive
per-polygon report standard spheroid and wound projects get. Neurite/soma output
is ordinary closed polygons with no extra per-instance fields, so it needs no
report of its own.

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
- [Metrics](../../reference/metrics.md)
- [Export](../export.md)
