"""Image preprocessing for kymograph analysis.

Vendored from upstream ``src/kymobutler/preprocessing.py`` (corresponds to
``isNegated`` / ``normlines`` in the Mathematica ``KymoButler.wl``), with ONE
change: upstream's ``load_and_preprocess(path)`` opened a file with PIL, and
this repo never has one — ``/kymograph`` samples the intensity matrix straight
out of the frame PNGs and holds it as a float32 ``(F, X)`` array. Round-tripping
that through an 8-bit PNG purely to satisfy a signature would quantise 16-bit
microscopy intensities to 256 levels before the net ever sees them.

``preprocess_array`` therefore takes the array and performs the identical
sequence upstream applied after its ``Image.open``: full-range rescale, polarity
detection, per-row mean normalisation.
"""

from __future__ import annotations

import numpy as np
from skimage.exposure import rescale_intensity
from skimage.transform import resize


def is_negated(img: np.ndarray) -> bool:
    """Detect if the kymograph has a white background (needs inversion).

    Binarizes at 0.5 and compares foreground pixel counts of original vs inverted.
    Corresponds to isNegated in KymoButler.wl line 39.
    """
    n1 = np.sum(img > 0.5)
    n2 = np.sum((1.0 - img) > 0.5)
    return bool(n1 >= n2)


def normalize_lines(img: np.ndarray) -> np.ndarray:
    """Normalize each row of the kymograph by its mean intensity.

    Rows with mean=0 are left unchanged.
    Corresponds to normlines in KymoButler.wl line 44.
    """
    means = img.mean(axis=1, keepdims=True)
    means = np.where(means > 0, means, 1.0)
    normalized = img / means
    return rescale_intensity(normalized.astype(np.float64), out_range=(0.0, 1.0)).astype(
        np.float32
    )


def resize_to_multiple_of_16(img: np.ndarray) -> np.ndarray:
    """Resize image so both dimensions are multiples of 16 (required by 4-level UNet).

    Corresponds to 16*Round@N[dim/16] in KymoButler.wl line 55.
    """
    h, w = img.shape[:2]
    new_h = max(16, 16 * round(h / 16))
    new_w = max(16, 16 * round(w / 16))
    if new_h == h and new_w == w:
        return img
    return resize(img, (new_h, new_w), anti_aliasing=True, preserve_range=True).astype(
        np.float32
    )


def preprocess_array(image: np.ndarray) -> tuple[np.ndarray, np.ndarray, bool]:
    """Preprocess an in-memory kymograph the way upstream preprocesses a file.

    Args:
        image: ``(F, X)`` intensity matrix at any scale and dtype — raw 16-bit
            camera counts are fine, ``rescale_intensity`` stretches whatever
            comes in to ``[0, 1]``.

    Returns:
        ``(preprocessed, raw, was_negated)`` — the same triple upstream's
        ``load_and_preprocess`` returned. ``preprocessed`` is row-normalised and
        polarity-corrected and is what the nets consume; ``raw`` is the
        full-range-rescaled input before either correction.
    """
    arr = np.asarray(image, dtype=np.float64)
    if arr.ndim != 2:
        raise ValueError(f"kymograph must be 2-D (F, X); got shape {arr.shape}")

    # ImageAdjust: rescale to full range. A constant image has no range to
    # stretch — rescale_intensity would emit NaN/inf, so short-circuit to zeros
    # (a flat field genuinely contains no tracks).
    lo, hi = float(arr.min()), float(arr.max())
    if hi <= lo:
        raw = np.zeros(arr.shape, dtype=np.float32)
    else:
        raw = rescale_intensity(arr, out_range=(0.0, 1.0)).astype(np.float32)

    negated = is_negated(raw)
    preprocessed = 1.0 - raw if negated else raw.copy()
    preprocessed = normalize_lines(preprocessed)

    return preprocessed, raw, negated
