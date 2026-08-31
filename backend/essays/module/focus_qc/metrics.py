"""Per-frame focus descriptors for IRM and fluorescence microscopy.

The descriptor answers one question: *how much of the frame is occupied by
structure that rises above the frame's own noise floor?*  In focus, a
microtubule's photons are concentrated into a narrow line -- roughly 3 px at the
reference pixel size, by the diffraction limit -- that clears the threshold;
defocused, the same photons spread over a wider profile and sink below it.
Because the threshold is expressed in units of the frame's own noise and
measured against a local background, the descriptor is insensitive to camera
gain, to a constant offset, and to smooth illumination shading.

A frame whose noise cannot be measured is refused rather than scored.  Dividing
by a near-zero sigma multiplies the residual enough that every pixel clears the
cut, which would report a blank or saturated frame as maximally in focus -- the
one failure this module exists to prevent.

COST, and why parts of this file are written the long way round
---------------------------------------------------------------
The deployment README claimed "a few milliseconds per frame".  Measured
2026-08-31 inside the essays image on real wells, one channel took **91 ms at
1400x1400 and 213 ms at 2048x2048** -- so a two-channel position paid 191 ms and
460 ms, which is 11 % of a 1400x1400 position's ~1.7 s and 3.3 % of a 2048x2048
position's ~14 s.  A 180-well production batch is 900 positions, so the
difference is minutes, not milliseconds.

The rewrite below removes **8-12 % of the CPU work** (min-of-9 ``process_time``
over both channels: 190 -> 174 ms at 1400x1400, 496 -> 436 ms at 2048x2048).
CPU time rather than wall clock on purpose -- this host is shared and its wall
clock swings by 2.5x with the neighbours' load, while the work actually done
does not.  The other half of the saving is not here: ``nd2_io.judge_focus``
scores the two channels concurrently, which is worth ~2x wall clock when a
second core is free and nothing at all when one is not.

Everything below that looks like hand-rolled numpy is there for that reason and
is **bit-identical** to the obvious expression it replaced, verified on every
position and channel of two real wells at both frame sizes plus the golden
frames (see ``tests/test_metrics.py::TestOptimisedFormsAreBitIdentical``):

* the noise differences are subtracted straight into float64 instead of
  upcasting the whole frame first (one 33 MB array instead of three);
* ``|d - centre|`` is computed once and reused for both the MAD and the clip
  mask, where it used to be built twice;
* the two medians of that finite data skip numpy's extra NaN-check partition
  pass (``_median_of_finite``);
* the tail is counted with ``count_nonzero`` on a one-sided comparison instead
  of materialising ``polarity * residual``;
* the gradient magnitude is evaluated only on the structure pixels
  (``hypot(gx[mask], gy[mask])``, ~1 % of the frame) instead of on all of them
  and then discarded -- ``hypot`` is a libm call, so this was the single largest
  saving in the sharpness path.

What was NOT done, because it would trade separation for speed: subsampling the
frame, a cumsum box filter in place of ``uniform_filter`` (different rounding),
or dropping to float32 in the noise estimate.  The IRM in-focus/out-of-focus
margin is only 1.97x (see ``README.md``), and
``test_in_focus_and_out_of_focus_scores_stay_separated`` fails below 1.8x --
there is no headroom to spend.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage as ndi

#: Which tail of the background-subtracted residual carries the signal.
POLARITY = {"irm": -1, "fluor": +1}

#: Local-background window, in pixels. Fixed in pixels, not micrometres: 31 px is
#: ~2.2 um at the 0.0722 um/px of the reference acquisition. Revisit if the pixel
#: size changes materially -- nothing in the code enforces the physical scale.
BG_SIZE = 31

K_SIGMA = 5.0       # how far above the noise a pixel must sit to count as structure
GRAD_SIGMA = 4.0    # looser cut used when measuring structure sharpness
MIN_STRUCTURE_PX = 50   # below this there is nothing to measure sharpness on

#: Differences further than this many robust sigmas from the median are structure
#: edges, not noise, and are excluded before the continuous estimate.
NOISE_CLIP_SIGMAS = 4.0


class UnscoreableFrame(ValueError):
    """Raised when a frame's noise floor cannot be measured, so no score is meaningful."""


def _median_of_finite(values: np.ndarray) -> float:
    """``np.median`` for a 1-D array the caller has already proved finite.

    Identical result, one partition target fewer: ``np.median`` appends ``-1``
    to its ``kth`` list on any inexact dtype so it can inspect the maximum for a
    NaN afterwards.  Every caller here has just run ``np.isfinite(...).all()``
    over the same data (or over the data it was derived from), so that pass buys
    nothing and costs a selection over 33 MB.

    Do not reach for this on data whose finiteness is merely *likely*: a NaN
    would sort to the end and be silently ignored, which is exactly the failure
    ``UnscoreableFrame`` exists to prevent.
    """
    n = values.size
    half = n // 2
    if n % 2:
        # np.median takes kth=[(n-1)//2] == [n//2] here and means the single
        # element; its mean() over a one-element slice returns that element.
        return float(np.partition(values, half)[half])
    part = np.partition(values, (half - 1, half))
    # np.median averages the two central order statistics with mean(), which for
    # two float64 elements is exactly (a + b) / 2.
    return float((part[half - 1] + part[half]) / 2)


def noise_sigma(img: np.ndarray) -> float:
    """Robust per-frame noise estimate, in the image's own units.

    Uses the horizontal pixel-to-pixel difference: real structure is correlated
    between neighbours, uncorrelated noise is not, so the difference isolates
    the noise.  The sqrt(2) undoes the variance doubling from differencing two
    noisy pixels.

    A plain median-absolute-deviation would be robust but *quantised* on integer
    camera data -- the MAD of integer differences is an integer, so the estimate
    can only move in steps of ~1.05 ADU.  On a photon-starved channel one such
    step swings the 5-sigma pixel count severalfold.  So the MAD is used only to
    identify which differences are noise, and the estimate itself is the standard
    deviation of those, which varies continuously.
    """
    a = np.asarray(img)
    # Differences straight into float64, rather than upcasting the whole frame
    # and then differencing it: same values (both operands are exact in float64),
    # one 33 MB allocation at 2048x2048 instead of three.
    d = np.subtract(a[:, 1:], a[:, :-1], dtype=np.float64).ravel()
    if d.size == 0 or not np.all(np.isfinite(d)):
        return float("nan")
    centre = _median_of_finite(d)
    # Built once and reused below for the clip mask. It used to be recomputed
    # there, which is a second full pass and a second 33 MB array for a value
    # that cannot have changed.
    deviation = np.abs(np.subtract(d, centre))
    coarse = 1.4826 * _median_of_finite(deviation)
    if coarse <= 0:
        return 0.0                      # too few distinct values to measure anything
    noise_only = d[deviation < NOISE_CLIP_SIGMAS * coarse]
    if noise_only.size < 2:
        return 0.0
    return float(noise_only.std() / np.sqrt(2))


def _residual(img: np.ndarray) -> tuple[np.ndarray, float, float]:
    """Background-subtracted image expressed in units of the frame's noise.

    Raises ``UnscoreableFrame`` when the noise floor is zero or undefined, rather
    than dividing by an epsilon and returning a hugely inflated score.
    """
    f = np.asarray(img, np.float32)
    sigma = noise_sigma(f)
    if not np.isfinite(sigma) or sigma <= 0:
        raise UnscoreableFrame(
            f"cannot measure a noise floor for this frame (estimated sigma = {sigma}). "
            "The frame is constant, saturated, quantised below one count, or contains "
            "non-finite pixels. Inspect it -- a focus verdict here would be meaningless."
        )
    background = ndi.uniform_filter(f, BG_SIZE)
    level = float(np.median(f))
    # Subtract into the background buffer instead of allocating a third frame.
    # `f` is untouched -- `background` is uniform_filter's own fresh array, and
    # `np.asarray(img, float32)` above may well have returned `img` itself.
    np.subtract(f, background, out=background)
    return background / sigma, sigma, level


def _tail_fraction(residual_norm: np.ndarray, polarity: int, k: float) -> float:
    """Fraction of pixels past ``k`` sigma in one tail, in pixels per 10,000.

    Counts a one-sided comparison rather than thresholding ``polarity *
    residual``: identical for the only two polarities that exist (negating a
    float is exact, so ``-x > k`` and ``x < -k`` agree on every value including
    NaN), and it skips a full-frame multiply and its temporary.
    """
    if polarity == 1:
        count = np.count_nonzero(residual_norm > k)
    elif polarity == -1:
        count = np.count_nonzero(residual_norm < -k)
    else:
        # The one-sided form above is only equivalent for a unit polarity, and
        # POLARITY holds nothing else. Refuse rather than quietly disagree with
        # what `polarity * residual > k` would have said.
        raise ValueError(f"polarity must be -1 or +1, got {polarity!r}")
    return float(count / residual_norm.size) * 1e4


def structure_area(img: np.ndarray, polarity: int, k: float = K_SIGMA) -> float:
    """Area occupied by significant structure, in pixels per 10,000.

    ``polarity`` selects the tail: -1 for dark structures on a bright field
    (IRM microtubules), +1 for bright structures on a dark field (fluorescence).
    Only that one tail is counted, not both.
    """
    rn, _, _ = _residual(img)
    return _tail_fraction(rn, polarity, k)


def structure_sharpness(img: np.ndarray) -> float:
    """Mean gradient magnitude restricted to structure pixels.

    Polarity-free, so it works on both modalities with one formula.  Returns NaN
    -- not zero -- when there is too little structure to measure, so "declined to
    measure" stays distinguishable from "measured, and it is low".
    """
    rn, _, _ = _residual(img)
    return _sharpness_of(rn)


def _sharpness_of(rn: np.ndarray) -> float:
    mask = np.abs(rn) > GRAD_SIGMA
    if np.count_nonzero(mask) < MIN_STRUCTURE_PX:
        return float("nan")
    gy, gx = np.gradient(rn)
    # hypot only where it is read. On a real 2048x2048 IRM frame the mask holds
    # ~1 % of the pixels, and hypot is a libm call, so evaluating it over the
    # whole frame and then discarding 99 % of it was the most expensive line in
    # the sharpness path. Gathering both gradients with the same C-order mask
    # yields the same sequence, so the pairwise-summed mean is unchanged.
    return float(np.hypot(gx[mask], gy[mask]).mean())


@dataclass(frozen=True)
class FrameStats:
    """Focus descriptors plus the acquisition statistics needed for a domain check."""

    score: float
    sharpness: float
    noise_sigma: float
    background: float


def focus_score(img: np.ndarray, modality: str) -> FrameStats:
    """Score one frame of one channel. ``modality`` is ``'irm'`` or ``'fluor'``.

    Shares one background/noise pass with the standalone descriptors above
    rather than repeating their formulas, so the two cannot drift apart.
    """
    if modality not in POLARITY:
        raise ValueError(f"unknown modality {modality!r}; expected one of {sorted(POLARITY)}")
    rn, sigma, background = _residual(img)
    return FrameStats(
        score=_tail_fraction(rn, POLARITY[modality], K_SIGMA),
        sharpness=_sharpness_of(rn),
        noise_sigma=sigma,
        background=background,
    )
