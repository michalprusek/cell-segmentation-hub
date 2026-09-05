"""Competition between two fluorescent proteins along one microtubule.

The question this answers: given two labelled proteins imaged in two channels,
how much do they occupy DIFFERENT parts of the same microtubule? Two proteins
that compete for the same lattice sites end up spatially segregated; two that
bind independently end up distributed alike.

The measure is the **total variation distance** between the two intensity
profiles, each normalised to unit area along the filament::

    f = I_A / sum(I_A)          g = I_B / sum(I_B)      (unit-area densities)
    C = 0.5 * sum|f - g|  ==  1 - sum(min(f, g))        in [0, 1]

so ``C`` reads directly as **one minus the overlap** of the two distributions:
0 when they are distributed identically, 1 when their supports are disjoint.

Why unit AREA and not unit PEAK
-------------------------------
Both normalisations bound the result by 1, but only the area form is a named
distance with an overlap interpretation, and only the area form is robust:
``max()`` is an extreme-value statistic, so a single hot pixel would set the
scale for an entire profile and compress everything else toward zero. This
codebase already treats bright outliers as a thing worth flagging
(``flag_bright_outliers`` in the kymograph path).

Normalising each channel SEPARATELY is not a refinement, it is required.
``CLAUDE.md`` records the measurement: ``intensity_minus_bg`` runs 9-51 counts
on 488 nm and 93-228 on 640 nm of the SAME container, because subtracting the
background removes the offset and not the scale (dye, exposure, gain). A
cross-channel comparison of raw counts would mostly measure the dyes.

What this does NOT measure
--------------------------
``C`` is a distance between distributions, and a distance is not a mechanism.
It cannot separate "B displaces A" from "B simply binds elsewhere". The
worked case: protein A uniform along the filament, protein B in one spot. If
they compete, A dips under B and ``C`` is near 1; if they do not compete and A
stays flat, ``C`` is near ``1 - (spot width)``, still near 1. Both read high.

``profile_anticorrelation`` is provided beside it for exactly that reason: a
Pearson correlation of -1 says "A falls precisely where B rises", which IS
displacement, while +1 says colocalisation. Report the two together.

Noise biases ``C`` UPWARD. Two identical but noisy profiles do not cancel, so
a dim microtubule scores as more competitive than a bright one carrying the
same biology. Background subtraction removes the offset but not the variance,
so read ``C`` alongside SNR and treat short or dim filaments with suspicion.

Everything here is pure NumPy. Like ``mt_measure``, this module sits BESIDE the
``microtubule`` package rather than inside it: importing that package loads the
model wrapper and therefore torch, which comparing two profiles does not need.
"""

from __future__ import annotations

from typing import Optional, Tuple

import numpy as np

__all__ = [
    "normalize_profile",
    "competition_index",
    "profile_anticorrelation",
    "competition_pair",
]

# A profile shorter than this cannot support a distribution comparison: with one
# or two arc-length samples the "shape" is a point or a segment, and the metric
# degenerates to a brightness comparison. Returning None is deliberate — see the
# module note on failed measurements below.
MIN_PROFILE_SAMPLES = 3


def normalize_profile(
    profile: np.ndarray,
    background: float = 0.0,
) -> Optional[np.ndarray]:
    """Background-subtract, clamp at zero, and normalise to unit area.

    ``background`` is the scalar per-microtubule ring value the export already
    computes (``mt_measure.region_stats`` over ``vicinity_mask``), so this
    agrees with ``intensity_minus_background`` about what "background" means.

    **Negatives are clamped to zero, and that is a mathematical necessity, not
    a preference.** Unit-area normalisation divides by ``sum(I)``; with negative
    samples that sum can approach zero or change sign, which would blow the
    profile up or flip it. Pixels that read below the local background are
    noise, not negative protein.

    Returns ``None`` — never a zero profile — when the profile is too short, or
    when nothing survives the subtraction. A channel that is entirely at
    background carries no distribution to compare, and reporting 0.0 there
    would read as "perfectly co-distributed", which is the opposite of the
    truth. This follows the rule the kymograph intensity floor already uses: a
    failed measurement is not evidence.
    """
    arr = np.asarray(profile, dtype=np.float64).ravel()
    if arr.size < MIN_PROFILE_SAMPLES or not np.all(np.isfinite(arr)):
        return None

    signal = np.clip(arr - float(background), 0.0, None)
    total = float(signal.sum())
    if not np.isfinite(total) or total <= 0.0:
        return None
    return signal / total


def competition_index(f: np.ndarray, g: np.ndarray) -> float:
    """Total variation distance between two unit-area profiles, in [0, 1].

    ``1 - sum(min(f, g))`` rather than ``0.5 * sum|f - g|``: the two are
    algebraically identical for unit-area inputs, but the ``min`` form needs no
    factor of one half to land in [0, 1] and states the meaning — one minus the
    overlap — in the expression itself.
    """
    f = np.asarray(f, dtype=np.float64)
    g = np.asarray(g, dtype=np.float64)
    if f.shape != g.shape:
        raise ValueError(f"profile shapes differ: {f.shape} vs {g.shape}")

    overlap = float(np.minimum(f, g).sum())
    # Clip only against floating-point drift: both inputs sum to 1 by
    # construction, so the true value cannot leave [0, 1].
    return float(np.clip(1.0 - overlap, 0.0, 1.0))


def profile_anticorrelation(a: np.ndarray, b: np.ndarray) -> Optional[float]:
    """Pearson correlation between two profiles, in [-1, 1], or ``None``.

    ``-1`` means one protein falls exactly where the other rises, which is what
    displacement looks like; ``+1`` means they track each other. This is the
    companion ``competition_index`` needs, because a distribution distance
    cannot tell a dip caused by the other protein from a dip that was always
    there.

    Scale-invariant, so it may be given the background-subtracted profiles
    directly — normalising to unit area first would not change the answer.
    ``None`` when either profile is constant, since correlation with a constant
    is undefined rather than zero.
    """
    x = np.asarray(a, dtype=np.float64).ravel()
    y = np.asarray(b, dtype=np.float64).ravel()
    if x.shape != y.shape or x.size < MIN_PROFILE_SAMPLES:
        return None
    if not (np.all(np.isfinite(x)) and np.all(np.isfinite(y))):
        return None

    xc = x - x.mean()
    yc = y - y.mean()
    denom = float(np.sqrt(float(xc @ xc) * float(yc @ yc)))
    if denom <= 0.0:
        return None  # one profile is flat: correlation is undefined, not 0
    return float(np.clip(float(xc @ yc) / denom, -1.0, 1.0))


def competition_pair(
    profile_a: np.ndarray,
    profile_b: np.ndarray,
    background_a: float = 0.0,
    background_b: float = 0.0,
) -> Tuple[Optional[float], Optional[float]]:
    """``(competition, anticorrelation)`` for one microtubule, one frame.

    Both profiles must be sampled along the SAME polyline, so they share an
    arc-length grid and need no resampling against each other. Either value is
    ``None`` when it could not be measured; they fail independently, because
    the correlation survives cases the density comparison does not (a profile
    that is entirely below background has no density but may still correlate).
    """
    f = normalize_profile(profile_a, background_a)
    g = normalize_profile(profile_b, background_b)

    competition = None if (f is None or g is None) else competition_index(f, g)

    a = np.asarray(profile_a, dtype=np.float64).ravel() - float(background_a)
    b = np.asarray(profile_b, dtype=np.float64).ravel() - float(background_b)
    anticorr = profile_anticorrelation(a, b) if a.shape == b.shape else None

    return competition, anticorr
