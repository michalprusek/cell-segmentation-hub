# Two-part sperm model (`sperm_2part`) — design

Date: 2026-09-26. Requested by Michal Průšek after Jana Albrechtová prepared the
SpheroSeg folder **"Dva segmenty"** (her account, 2026-09-24) for retraining so
that sperm can be measured as **two segments only: head and tail**.

> **Superseded in two places (2026-10-10).** The head is no longer a 3-point
> polyline: the two-part head is traced by its bends, because the arc
> under-measures an S-shaped head. And the model was retrained on a second
> annotated folder. Both are described, with the measured accuracy, in
> [ML models](../../reference/ml-models.md#sperm_2part--sperm-morphology-head--tail).
> The text below is the design as it was agreed on 2026-09-26.

## Goal

A sperm project can pick "Sperm Morphology (head + tail)" in its model picker; the
model returns assembled sperm as a 3-point head polyline welded to a tail polyline,
with no midpiece, and measures head/tail length better than today's model does.

## Decisions (agreed with the user)

| Question              | Decision                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Training data         | Only "Dva segmenty" (80 images, 13 projects, 115 sperm)                                                 |
| Architecture          | Same as production `sperm` (Mask2Former + DINOv3 ConvNeXt-L), warm-started from the deployed checkpoint |
| Deployment            | New model id `sperm_2part` **beside** `sperm`; the three-part model and its projects are untouched      |
| Anomalous annotations | 3 sperm not labelled head+tail (2 with a midpiece, 1 doubled) become ignore regions, pending Jana       |
| Unannotated sperm     | Jana labelled only "nice" sperm (complete, untangled). They must not be learned as background           |

## Why a new model and not a relabelling of the old one

On the dataset the deployed model, with its midpiece folded into the tail, puts the
head/tail boundary in the wrong place: its head is shorter than Jana's in 97 % of
matched sperm (median −21 %) and its tail longer (median +47 %). Jana's "head" is the
whole helical part, which the three-part model splits across Head and Midpiece. So a
post-processing merge cannot reproduce her measurement; the boundary has to be learned.

## Data

- Export from the production DB (folder `aaba0d3e…`), converted to the training COCO
  schema. Images downscaled to a 2048 px long side — the resolution
  `SpermModel.MAX_INFERENCE_DIM` feeds the model in production.
- Class ids stay Head=1, Midpiece=2 (never used), Tail=3, so the full three-class
  checkpoint loads without re-initialising any head.
- Split by **project** (no project in two splits): train 8 projects / 53 images,
  val 3 / 13, test 2 / 14.

## Incomplete annotation → ignore regions

1. The deployed model is run on every image (score ≥ 0.5, all classes). Every instance
   not overlapping an annotated sperm is dilated 15 px into an ignore mask; annotated
   sperm (dilated) are carved back out so they are never ignored. Straight stripes
   lying on the sliding-window patch seams are v8 artefacts, not sperm, and are left
   as negatives.
2. Ignore regions ride through patching / augmentation as an `IGNORE_LABEL` instance;
   the criterion strips them before Hungarian matching and
   - excludes their pixels from BCE / Lovász / boundary loss,
   - gives **no "no-object" classification loss** to an unmatched query whose mask
     lies mostly (> 50 %) inside them.
3. Validation IoU excludes ignore pixels, so checkpoint selection does not reward
   suppressing real sperm.

"Nice sperm only" is therefore NOT learned; the assembly (complete head→tail only,
crossing guards) plays that role explicitly.

## Evaluation

Sperm-level, because that is what is measured: recall on annotated sperm; precision
counting only false positives outside ignore regions; on matched sperm the median
relative length error of head and tail, the head–tail junction error in px and part
IoU. Baseline = the deployed model with midpiece folded into tail. The model shipped
is the **final-epoch** EMA (not best-on-val), so val and test are both unbiased holdouts.

## Hub changes

- ML: `PartScheme` in `graph_assembly.py` (THREE_PART default = unchanged behaviour,
  TWO_PART = S→Head→Tail→T, elongated head); `connect_sperm_polylines` welds head to
  tail when there is no midpiece; `SpermModel(num_parts)`; `sperm_2part` in the model
  registry, route, enum and batch sizes. Weights at `weights/sperm_2part.pth`
  (bind-mounted, sha256 pinned in the model card).
- Backend / frontend: `sperm_2part` in both model registries (compatible with `sperm`
  projects; default for sperm projects stays `sperm`), i18n in 6 locales, preview tiles.

## Out of scope

Retraining the three-part model; physical calibration (µm/px) of the 4104×2174 and
3840×2160 cameras; relabelling Jana's anomalous sperm.
