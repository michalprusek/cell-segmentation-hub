"""Bring a high-bit-depth frame into the 8 bits most models were trained on.

Nine of the eleven model families here go through `PIL.Image.convert('RGB')`
or `convert('L')` on their way in. For a 16-bit, 32-bit or float image Pillow
does not rescale on that conversion — it CLIPS at 255. A camera frame whose
values sit at a few thousand counts therefore reached the model as a uniformly
white rectangle. Measured 2026-10-06 on every such still in production (three,
of 3 475 in the affected project types): what the model saw had 1, 1 and 5
distinct grey levels, and it returned zero polygons for all three.

The remedy is a display stretch, done once, before the model's own
preprocessing: map the [0.1st, 99.9th] percentile of the frame onto 0..255.

WHY PERCENTILES AND NOT MIN-MAX. Min-max is the textbook answer and is what
ImageJ's plain 8-bit conversion does with an untouched display range, but one
hot pixel sets its scale. On one of the three production frames the maximum is
51 586 against a 99.9th percentile of 16 851: min-max squeezed the whole image
into 125 dark levels and the disintegration model returned one blob (25
polygons) where the percentile stretch gave a normally exposed frame and a
core with a fragmented corona (198). The other two frames have no such outlier
and came out alike under either.

WHY 0.1 / 99.9 AND NOT 1 / 99. It saturates 0.2 % of pixels, close to ImageJ's
"Enhance Contrast" default of 0.35 %; 1 / 99 saturates 2 %, which on one frame
crushed the spheroid's interior to black for no gain in the segmentation.

That is three frames with no ground truth: "came out right" is a visual
judgement of the stretched frame and its outlines, not a measured accuracy.
Re-measure before moving either number.

`microtubule` and `neurite_soma` are deliberately NOT routed through this:
they read the native depth and apply their own percentile stretch (1-99 and
1-99.5), and feeding them an 8-bit copy would throw away the precision they
were trained on.

An 8-bit image is returned untouched — the same object — so every result on
8-bit input is exactly what it was before this existed.
"""

from __future__ import annotations

from typing import Optional

import numpy as np
from PIL import Image

#: Models that consume the native bit depth and must not be pre-converted.
NATIVE_DEPTH_MODELS = frozenset({"microtubule", "neurite_soma"})

#: Pillow modes that `convert('RGB')` / `convert('L')` clip rather than scale.
HIGH_DEPTH_MODES = frozenset({"I;16", "I;16L", "I;16B", "I;16N", "I", "F"})

LOW_PERCENTILE = 0.1
HIGH_PERCENTILE = 99.9


def stretch_to_uint8(image: Image.Image) -> tuple[Image.Image, Optional[dict]]:
    """Return an 8-bit version of `image` and a record of what was done.

    For an image that is already 8-bit (or anything that is not a
    single-channel high-depth frame) the SAME object comes back with `None`.
    """
    mode = getattr(image, "mode", None)
    if mode not in HIGH_DEPTH_MODES:
        return image, None

    pixels = np.asarray(image)
    finite = pixels[np.isfinite(pixels)] if mode == "F" else pixels
    if finite.size == 0:
        low = high = 0.0
    else:
        low, high = (
            float(v)
            for v in np.percentile(finite, [LOW_PERCENTILE, HIGH_PERCENTILE])
        )

    if high > low:
        scaled = (pixels.astype(np.float64) - low) / (high - low) * 255.0
        # NaN/inf (float TIFFs) have no meaningful grey; they become black.
        scaled = np.nan_to_num(scaled, nan=0.0, posinf=255.0, neginf=0.0)
        out = np.clip(scaled + 0.5, 0, 255).astype(np.uint8)
    else:
        # A flat frame. There is no contrast to preserve, and dividing by zero
        # would manufacture some; mid-grey says "nothing here" to any model.
        out = np.full(pixels.shape, 128, dtype=np.uint8)

    return Image.fromarray(out, mode="L"), {
        "from_mode": mode,
        "method": "percentile_stretch",
        "low_percentile": LOW_PERCENTILE,
        "high_percentile": HIGH_PERCENTILE,
        "low": low,
        "high": high,
    }


def prepare_for_model(
    image: Image.Image, model: str
) -> tuple[Image.Image, Optional[dict]]:
    """`stretch_to_uint8`, unless `model` reads the native depth itself."""
    if model in NATIVE_DEPTH_MODELS:
        return image, None
    return stretch_to_uint8(image)
