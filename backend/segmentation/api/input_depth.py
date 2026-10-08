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

`microtubule`, `neurite_soma` and `neurite_soma_classical` are deliberately NOT
routed through this: they read the native depth and apply their own
normalisation (a 1-99 and a 1-99.5 percentile stretch, and a per-channel
median/MAD respectively), and feeding them an 8-bit copy would throw away the precision they
were trained on.

An 8-bit image is returned untouched — the same object — so every result on
8-bit input is exactly what it was before this existed.
"""

from __future__ import annotations

import io
from typing import Optional

import numpy as np
from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError

#: Models that consume the native bit depth and must not be pre-converted.
NATIVE_DEPTH_MODELS = frozenset(
    {"microtubule", "neurite_soma", "neurite_soma_classical"}
)

#: Pillow modes that `convert('RGB')` / `convert('L')` clip rather than scale.
HIGH_DEPTH_MODES = frozenset({"I;16", "I;16L", "I;16B", "I;16N", "I", "F"})

LOW_PERCENTILE = 0.1
HIGH_PERCENTILE = 99.9


def _stretch_values(values: np.ndarray, low: float, high: float) -> np.ndarray:
    """Map `values` (float32, modified in place) from [low, high] to uint8."""
    values -= np.float32(low)
    values *= np.float32(255.0 / (high - low))
    # NaN/inf (float TIFFs) have no meaningful grey; they become black.
    np.nan_to_num(values, copy=False, nan=0.0, posinf=255.0, neginf=0.0)
    values += np.float32(0.5)
    np.clip(values, 0, 255, out=values)
    return values.astype(np.uint8)


def _stretch(pixels: np.ndarray, low: float, high: float) -> np.ndarray:
    """The stretch, without a frame-sized floating-point copy where possible.

    MEMORY is the reason this is not one line. The first version made a
    float64 copy of the frame and three more full-size temporaries; measured
    with tracemalloc on a 4.8 Mpx uint16 frame it peaked at 26.0 bytes per
    pixel. The app's queue sends frames up to 498 Mpx, in the process that
    serves everyone, so that was a 13 GB spike waiting for the first large
    16-bit upload.

    A 16-bit frame has only 65 536 possible values, so it is mapped through a
    lookup table: the arithmetic runs on 65 536 numbers, not on the frame, and
    the only frame-sized allocation is the 1-byte result. Other depths (32-bit
    integer, float) take one float32 working copy, every step in place - 11.0
    bytes per pixel at peak on the same measurement.

    Both paths apply the identical arithmetic to each value, so a pixel maps
    to the same grey whichever path it took.
    """
    if pixels.dtype.kind == "u" and pixels.dtype.itemsize == 2:
        table = _stretch_values(np.arange(65536, dtype=np.float32), low, high)
        return table[pixels]
    return _stretch_values(pixels.astype(np.float32), low, high)


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
        out = _stretch(pixels, low, high)
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



def open_image_page(data: bytes, page: int = 0) -> tuple[Image.Image, int]:
    """Open `data` positioned on `page`; return the image and its page count.

    Bytes that are not an image answer 400 here. It used to be a 500: the
    route validated the filename's extension and nothing else, so anything
    else surfaced as an unhandled `UnidentifiedImageError` with a correlation
    id, as if the service had broken.

    A multi-page TIFF used to be segmented on page 0, silently, whatever was
    in the rest of it. Page 0 is still the default, but it is now a choice the
    caller can make and the page count comes back with the result.
    """
    try:
        image = Image.open(io.BytesIO(data))
        page_count = int(getattr(image, "n_frames", 1) or 1)
        if page >= page_count:
            raise HTTPException(
                status_code=400,
                detail=f"page {page} is out of range: the image has {page_count} page(s)",
            )
        if page:
            image.seek(page)
        # Deliberately NOT `image.load()`. This runs on the event loop of an
        # `async def` route; the pixels are decoded later, inside the model's
        # preprocessing, which is on the single-slot executor and under the
        # inference lock. Decoding here would stall /health for the duration
        # on a 498 Mpx frame and let four concurrent requests each hold a
        # decoded frame at once. The price is that a file TRUNCATED after a
        # valid header is still found late.
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, EOFError) as error:
        raise HTTPException(
            status_code=400,
            detail=f"The file could not be decoded as an image: {type(error).__name__}",
        ) from error
    return image, page_count


def decode_or_400(image) -> None:
    """Force the pixels to decode; a file that cannot is the caller's error.

    `open_image_page` only reads the header, so a file truncated after it gets
    this far. Decoding HERE - at the top of `_dispatch_inference`, on the
    single-slot executor - keeps that off the event loop, and turns what used
    to surface from inside a model's preprocessing as a 500 ("the service
    broke") into a 400 ("your file is damaged"). The public API answered 502
    for a truncated PNG before this.
    """
    load = getattr(image, "load", None)
    if load is None:
        return
    try:
        load()
    except (OSError, ValueError, EOFError, SyntaxError) as error:
        raise HTTPException(
            status_code=400,
            detail=f"The file could not be decoded as an image: {type(error).__name__}",
        ) from error
