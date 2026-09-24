"""Core-anchored Disintegration Index — a port of the paper's released ``compute_di.py``.

Source of truth: ``spheroid_seg/compute_di.py`` in the spheroid-disintegration
paper repository (GigaScience submission, released code DOI
10.5281/zenodo.22295119). The functions ``undefined_reason``,
``core_components``, ``disintegration_index`` and ``_convex_hull_area`` and the
constants above them are copied VERBATIM from that file (the CLI ``main`` is
not). ``ALGORITHM_SOURCE_SHA256`` is the SHA-256 of the exact file they were
copied from; ``tests/unit/test_disintegration_parity.py`` checks this port
against values that file computed on three synthetic masks, to 1e-9. When the
paper's file changes, re-copy the four functions, update the hash and
regenerate the fixtures (``tests/fixtures/di_parity/README.md`` says how) —
never edit the copied bodies here on their own, or the web app and the paper
stop computing the same number.

Why a port and not the previous endpoint code: that code re-rasterised the
stored polygons (which had passed a 50 px minimum-area filter and lost their
holes), used a 95th-percentile reach, counted fragments after a morphological
closing with a 30 px floor, and measured solidity against a polygon hull. Each
of those differs from the paper; on the 29 deposited LOBO prediction masks the
round trip alone moved DI by a median of -0.004 and by up to -0.039. The
authoritative read-out is therefore computed here from the RASTER argmax mask
at inference time (``raster_metrics``), and the polygon endpoint uses the same
function on its re-rasterised mask so that every definition agrees.

Everything below the ``--- hub additions ---`` line is this repository's own:
the JSON-safe wrapper and the input-scale check. None of it changes a number
the copied code returns.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

import numpy as np
from scipy import ndimage

# SHA-256 of the compute_di.py the functions below were copied from.
ALGORITHM_SOURCE = "spheroid_seg/compute_di.py"
ALGORITHM_SOURCE_SHA256 = "efdb7c3b6ea29b6b1381d8feece76d385aa414f1a14fcfb06c34564cdfa730db"

# ---------------------------------------------------------------------------
# VERBATIM from compute_di.py (constants and the four functions).
# ---------------------------------------------------------------------------
# Minimum core size. The smallest core among the 528 released expert masks is 16,048 px (2512011_48h (61); the
# smallest at 0 h is 23,081 px), an effective radius of 71 px (91 um at 1.28 um/px). The index was never validated on
# a smaller anchor, and below it R_C -> 0 drives DI -> 1 whatever the corona does, so a smaller core yields an
# undefined DI rather than a number. No production prediction behind the paper comes near it (smallest predicted
# core: 16,604 px over the 528 held-out images of run v6; 35,556 px over the 615 time-course images; 28,800 px over
# the 647 BLM images). Source: analysis/review_fixes/compute_di_guards.json.
MIN_CORE_PX = 16048
# Core fragmentation (8-connectivity). Among the 528 expert cores the largest component never holds less than
# 99.27 % of the core at 0 h, while 6 of 263 expert 48 h cores fall below 99 %; a core whose largest component holds
# less than CORE_LARGEST_MIN, or whose centroid is moved by more than CORE_SHIFT_MAX * R_C by the smaller pieces,
# is flagged. The flag marks a read-out to inspect; it does not change DI.
CORE_LARGEST_MIN = 0.99
CORE_SHIFT_MAX = 0.1
_S8 = np.ones((3, 3), dtype=int)
# No image in the released dataset has an outside-core fraction between these bounds: the two time
# points fall on either side of the gap. The core operator was therefore never exercised at an
# intermediate degree of dispersal, and a read-out landing there is flagged rather than returned as
# though it were as well supported as the rest.
UNVALIDATED_LO, UNVALIDATED_HI = 0.15, 0.30
# The pipeline reproduces the expert read-out on spheroids scoring above this and collapses a
# handful of mildly dispersed ones onto the intact mode below it, where an intact spheroid and a
# mildly dispersed one are not separable from the prediction alone. Below the floor DI is a screen,
# not a graded measurement. This is deliberately NOT the same kind of flag as unvalidated_regime:
# that one keys on the predicted outside-core fraction, which is near zero exactly when the model
# collapses, so it cannot mark these images however its bounds are set.
VALIDATED_DI_FLOOR = 0.6


def undefined_reason(mask: np.ndarray) -> str | None:
    """Why DI is undefined for this mask, or None if it is defined."""
    n_fg, n_core = int((mask > 0).sum()), int((mask == 2).sum())
    if n_fg == 0:
        return "no foreground: DI undefined"
    if n_core == 0:
        return "no core: DI undefined"
    if n_core < MIN_CORE_PX:
        return (f"core of {n_core} px is below the minimum core size ({MIN_CORE_PX} px, the smallest expert core "
                f"of the released dataset): DI undefined")
    return None


def core_components(core: np.ndarray) -> tuple[int, float, float]:
    """(number of 8-connected core components, largest component's share of the core, centroid shift in R_C)."""
    lbl, n = ndimage.label(core, structure=_S8)
    if n == 0:
        return 0, float("nan"), float("nan")
    sizes = np.bincount(lbl.ravel())[1:]
    k = int(np.argmax(sizes)) + 1
    cy, cx = np.nonzero(core)
    ly, lx = np.nonzero(lbl == k)
    r_c = np.sqrt(core.sum() / np.pi)
    shift = float(np.hypot(cx.mean() - lx.mean(), cy.mean() - ly.mean()) / r_c)
    return int(n), float(sizes.max() / sizes.sum()), shift


def disintegration_index(mask: np.ndarray) -> dict | None:
    """Every per-image quantity the pipeline reports. None if DI is undefined (see `undefined_reason`)."""
    if undefined_reason(mask) is not None:
        return None
    fg, core = mask > 0, mask == 2
    n_fg, n_core = int(fg.sum()), int(core.sum())

    cy, cx = np.nonzero(core)
    ccx, ccy = cx.mean(), cy.mean()
    r_c = np.sqrt(n_core / np.pi)

    fy, fx = np.nonzero(fg)
    d = np.hypot(fx - ccx, fy - ccy) / r_c                 # core-normalised distances
    x = np.sort(d)
    u = (np.arange(x.size) + 0.5) / x.size                 # midpoint quantiles
    w1 = float(np.mean(np.abs(x - np.sqrt(u))))            # F_ref^-1(u) = sqrt(u)

    # fragmentation of the dispersed mass, which DI's size-invariance deliberately abstracts away
    corona = fg & ~core
    lbl, n_frag = ndimage.label(corona)
    if n_frag:
        sizes = ndimage.sum(corona, lbl, range(1, n_frag + 1))
        largest = float(sizes.max() / sizes.sum())
    else:
        largest = 0.0

    index_b = (n_fg - n_core) / n_fg
    hull_area = _convex_hull_area(fg)
    n_cc, largest_cc, shift = core_components(core)
    return {
        "DI": float(np.tanh(w1)),
        "W1": w1,
        "index_B": index_b,                                # Lim et al.'s outside-core area fraction
        "reach_p90": float(np.percentile(d, 90)),
        "n_fragments": int(n_frag),
        "largest_fragment_frac": largest,
        "solidity": n_fg / hull_area if hull_area else float("nan"),
        "area_core_px": n_core,
        "area_corona_px": n_fg - n_core,
        "area_total_px": n_fg,
        "n_core_components": n_cc,
        "largest_core_component_frac": largest_cc,
        "core_centroid_shift": shift,
        "core_fragmented": int(largest_cc < CORE_LARGEST_MIN or shift > CORE_SHIFT_MAX),
        "unvalidated_regime": int(UNVALIDATED_LO <= index_b < UNVALIDATED_HI),
        "below_validated_regime": int(np.tanh(w1) < VALIDATED_DI_FLOOR),
        "note": "",
    }


def _convex_hull_area(fg: np.ndarray) -> float:
    try:
        from skimage.morphology import convex_hull_image
        return float(convex_hull_image(fg).sum())
    except Exception:                                       # skimage optional; solidity is not load-bearing
        return float("nan")


# ---------------------------------------------------------------------------
# --- hub additions (not in compute_di.py) ---
# ---------------------------------------------------------------------------

# The input regime the model and the index were validated on: full 2048 x 2048
# brightfield frames at ~1.28 um/px (5x objective). Nothing outside it was
# tested, so a read-out from another frame size or pixel size is returned with
# a warning rather than refused.
VALIDATED_FRAME_PX = (2048, 2048)  # (width, height)
VALIDATED_UM_PER_PX = 1.28
# Relative tolerance on the pixel size before the warning fires. A reporting
# band, not a validated limit: the paper corroborates 1.280 um/px and tested no
# other scale at inference.
UM_PER_PX_REL_TOL = 0.10

# The field order compute_di.py writes (its FIELDS minus image/note).
METRIC_FIELDS = (
    "DI", "W1", "index_B", "reach_p90", "n_fragments", "largest_fragment_frac",
    "solidity", "area_core_px", "area_corona_px", "area_total_px",
    "n_core_components", "largest_core_component_frac", "core_centroid_shift",
    "core_fragmented", "unvalidated_regime", "below_validated_regime",
)


def input_scale_warnings(
    width: Optional[int], height: Optional[int], um_per_px: Optional[float] = None
) -> List[str]:
    """Warnings for an input outside the validated 2048 x 2048 / ~1.28 um/px regime.

    ``um_per_px`` is optional: an image without calibration metadata (a plain
    BMP) has none, and then only the frame size can be checked.
    """
    warnings: List[str] = []
    vw, vh = VALIDATED_FRAME_PX
    if width is not None and height is not None and (int(width), int(height)) != (vw, vh):
        warnings.append(
            f"frame is {int(width)}x{int(height)} px; the model and the Disintegration Index were "
            f"validated only on {vw}x{vh} px brightfield frames at ~{VALIDATED_UM_PER_PX} um/px "
            f"(5x objective). The read-out is returned but was never tested at this size."
        )
    if um_per_px is not None and um_per_px > 0 and math.isfinite(um_per_px):
        if abs(um_per_px / VALIDATED_UM_PER_PX - 1.0) > UM_PER_PX_REL_TOL:
            warnings.append(
                f"pixel size is {um_per_px:.4g} um/px; the model and the Disintegration Index were "
                f"validated only at ~{VALIDATED_UM_PER_PX} um/px (2048x2048 px frames, 5x objective). "
                f"The read-out is returned but was never tested at this scale."
            )
    return warnings


def _json_safe(v: Any) -> Any:
    """NaN/inf -> None (JSON has no NaN); numpy scalars -> Python scalars."""
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        f = float(v)
        return f if math.isfinite(f) else None
    return v


def raster_metrics(
    mask: np.ndarray,
    width: Optional[int] = None,
    height: Optional[int] = None,
    um_per_px: Optional[float] = None,
) -> Dict[str, Any]:
    """JSON-safe per-image read-out from a 3-class raster (0 bg / 1 corona / 2 core).

    ``reference`` is ``'core'`` when DI is defined, otherwise the reason it is
    not: ``'none'`` (no foreground), ``'no_core'`` or ``'core_too_small'``
    (core below ``MIN_CORE_PX``). When undefined every metric field is None and
    only the areas and core-component diagnostics are filled — exactly the row
    compute_di.py writes for such a mask.
    """
    mask = np.asarray(mask)
    if width is None or height is None:
        height, width = int(mask.shape[0]), int(mask.shape[1])
    out: Dict[str, Any] = {
        "algorithm": ALGORITHM_SOURCE,
        "algorithm_sha256": ALGORITHM_SOURCE_SHA256,
        "source": "model_raster",
        "image_width": int(width),
        "image_height": int(height),
    }
    reason = undefined_reason(mask)
    if reason is None:
        r = disintegration_index(mask)
        out.update({k: _json_safe(r[k]) for k in METRIC_FIELDS})
        out["reference"] = "core"
        out["note"] = ""
    else:
        n_fg, n_core = int((mask > 0).sum()), int((mask == 2).sum())
        n_cc, largest_cc, shift = core_components(mask == 2)
        out.update({k: None for k in METRIC_FIELDS})
        out.update({
            "area_core_px": n_core, "area_corona_px": n_fg - n_core, "area_total_px": n_fg,
            "n_core_components": n_cc,
            "largest_core_component_frac": _json_safe(largest_cc),
            "core_centroid_shift": _json_safe(shift),
        })
        out["reference"] = ("none" if n_fg == 0 else "no_core" if n_core == 0
                            else "core_too_small")
        out["note"] = reason
    out["warnings"] = input_scale_warnings(width, height, um_per_px)
    return out
