# Glossary

Terms used across these docs and in the interface.

**Band** — the strip of pixels along a microtubule centerline whose intensity is
measured. Its width is the _thickness_ setting. Rasterised the way ImageJ's
`Roi.convertLineToArea` does, with butt caps.

**Background ring** — the region around a microtubule's band from which the
background is estimated. It excludes the band of _every_ microtubule in the
frame, so a neighbouring filament is never counted as background.

**Channel** — one imaging channel of a container (IRM, TIRF, a fluorescence
wavelength). Stored as one PNG per frame per channel. Exactly one channel per
container may be the **segmentation source**.

**Container** — the `Image` row representing an uploaded video, ND2 or TIFF
stack. It holds the frame count, calibration and channel list, is invisible in
the gallery, and is never segmented.

**Corona** — in a disintegrating spheroid, the dispersing cells outside the
dense core.

**Core** — in a disintegrating spheroid, the dense centre. Predicted directly by
the model, and **required** for a Disintegration Index.

**DI (Disintegration Index)** — a core-anchored measure in [0, 1) of how far
spheroid mass has dispersed from its core. See
[Metrics](metrics.md#disintegration-index-di).

**Feret diameter** — the distance between two parallel lines enclosing a shape.
"Max" is the largest such distance, "min" the smallest caliper width.

**Frame** — one time point of a container, stored as its own `Image` row with a
0-based `frameIndex`. Displayed 1-based.

**Hole / internal polygon** — a closed polygon inside another, subtracted from
its area.

**Instance** — one detected object. For sperm, an instance groups three part
polylines; for microtubules, one filament in one frame.

**`instanceId`** — the per-frame identifier grouping shapes that belong to one
object. Not stable across frames.

**IRM** — Interference Reflection Microscopy. The modality the microtubule model
was trained on, in which a microtubule appears _darker_ than its surround.

**Kymograph** — a space × time image built by sampling along a line in every
frame. Motion appears as a sloped trajectory whose slope is a velocity.

**`mtType`** — a user-assigned microtubule class from the project's own label
palette. Assigned per **track**, so it applies to every frame.

**ND2** — Nikon's microscopy container format. May hold multiple channels,
multiple time points and multiple stage **positions**.

**Playback proxy** — a small 8-bit WebP copy of a frame, generated lazily to
make scrubbing fast. Never used for measurement.

**Polyline** — an **open** path. Produced by the microtubule and sperm models.
Has a length but no area, and is not representable in YOLO.

**`polygonKey`** — `trackId ?? id`. The key that cross-frame UI state (hiding,
selection, colour) is stored under, because `id` is re-minted on every
inference.

**Position** — one stage location in a multi-position ND2. Each becomes its own
container.

**`partClass`** — which part of an object a shape is: `head`, `midpiece` or
`tail` for sperm, `core` for a disintegrating spheroid.

**Registration** — aligning a container's channels to the first one by a
whole-pixel translation, optionally applied at upload. Microtubule projects
only.

**Segmentation source** — the channel the model reads. If no channel is marked,
the platform falls back to channel 0, which may not be what you want.

**Static channel** — a channel added from a single image and stamped onto every
selected frame. Segmented once and projected, not segmented per frame.

**Threshold** — the confidence cut applied to a model's output. Adjustable for
most models; **fixed at 0.97 and not user-settable** for the microtubule model.

**TIRF** — Total Internal Reflection Fluorescence. Measured for microtubule
work, **never segmented** — the model does not track image content on it.

**`trackId`** — cross-frame identity written by the microtubule tracker. Stable
for the same filament across frames; the basis of colour, selection and
whole-track operations.

**Window / level** — the intensity range mapped to black and white when
displaying high-bit-depth data. **Per channel** in this app, and session-only.
