"""Bring a spheroid-disintegration frame to the model's pixel size, and back.

The spheroid-disintegration model (UNet++ / EfficientNet-B5, model key
``spheroid_disintegration``) and the paper's read-out were validated on
2048 x 2048 brightfield frames at 1.28 um/px. When the pixel size of an upload
is known and differs from that, the GREY frame is resampled to 1.28 um/px
before the three-channel stack and CLAHE (so CLAHE's 8 x 8 tiles see the
frame at the scale they saw in training), the model runs there, the read-out
is computed there, and the mask is mapped back to the uploaded grid so the
polygons overlay the uploaded image.

Why: on the paper's held-out batch (B5, 37 images at 48 h, served replicate
``prod_s42``), frames simulated at 1.10 and 1.50 um/px and fed as acquired
moved the outside-core fraction by up to 0.028 (median 0.0069 / 0.0067);
resampled back to 1.28 um/px first, by at most 0.0051 (median 0.0016 / 0.0015).
Source: spheroid_rozpad ``analysis/review_fixes/final/scale2026/scale_summary.json``
(arms A and B of ``scale_and_timing.py``). Arm B resizes with the same
interpolations as ``frame_to_model_grid`` below.

Everything here is a pure function of numpy arrays: no torch, no network, no
model, so ``backend/segmentation_cpu_tests/test_disintegration_resample.py``
runs it in CI. It lives in ``api/`` beside ``disintegration_metrics`` rather
than in ``models/disintegration.py`` because that module imports torch at
module scope and ``models/__init__`` imports mamba_ssm -> Triton, which cannot
be imported without a CUDA driver; ``api/__init__`` imports nothing.

Behaviour without a usable pixel size, or within ``RESAMPLE_REL_TOL`` of
1.28 um/px, is the old behaviour exactly: no plan, no resize call at all.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

from api import disintegration_metrics as dm

#: The pixel size the model and the read-out were validated at, um/px.
MODEL_UM_PER_PX = dm.VALIDATED_UM_PER_PX
#: Within this relative distance of 1.28 um/px the frame is used as uploaded.
#: 2 % is ~41 px on a 2048 px frame edge; the scale study moved the read-out
#: by 0.0015 (median) even when resampling a 14 % mismatch, so a resize below
#: this costs an interpolation for a change smaller than the resize's own.
RESAMPLE_REL_TOL = 0.02
#: Resampling factors the module applies (``s = um_per_px / 1.28``). Outside
#: them the frame is used as uploaded, with a warning: a 2 % change of
#: magnification is a calibration question, a 40x one (an image at 0.032
#: um/px shrunk to a few dozen pixels) is not a spheroid frame of this kind,
#: and a bound on growth is a bound on GPU memory. Nothing outside 1.10-1.50
#: um/px was measured; the bounds are a guard rail, not a validated range.
FACTOR_MIN = 0.5
FACTOR_MAX = 2.0
#: The largest frame a resample may GROW to. 4096 x 4096 is the ceiling the
#: public API already applies to this model (``SYNC_MAX_PIXELS``, also its job
#: ceiling, ``backend/src/api/v1/jobs/limits.ts``), because it runs the whole
#: frame in one pass with no tiling. At 2048^2 the forward pass peaks at
#: 2.39 GB (bf16, L40S, scale_summary.json above); 4096^2 is ~4x that, an
#: estimate, not a measurement. Shrinking is never refused.
RESAMPLE_MAX_PIXELS = 4096 * 4096

# Back to the uploaded grid by nearest neighbour, so every pixel keeps a class
# label (0/1/2) and no new value appears. NEAREST_EXACT, not cv2.INTER_NEAREST:
# the latter samples floor(x * scale), which is not centred, and moved the
# centroid of a back-mapped disk by +0.37 / +0.38 / +0.42 px at factors 0.8 /
# 1.25 / 1.6, against -0.04 / 0.00 / -0.03 px with NEAREST_EXACT (measured
# 2026-11-08, opencv 5.0.0; both are off by 0.24 px, opposite signs, at exactly
# 2x, where every sample is a tie). Present since OpenCV 4.5; the ml image ships
# 4.11.
_NEAREST = getattr(cv2, "INTER_NEAREST_EXACT", cv2.INTER_NEAREST)


@dataclass(frozen=True)
class ResamplePlan:
    """How one frame is brought to the model's pixel size.

    ``factor`` is ``input_um_per_px / 1.28``: a frame with LARGER pixels than
    the model's (factor > 1) holds fewer pixels per micrometre and is enlarged;
    one with smaller pixels is shrunk. A 2048 px edge at 2.56 um/px becomes
    4096 px, at 0.64 um/px 1024 px.
    """

    input_um_per_px: float
    factor: float
    width: int
    height: int
    model_width: int
    model_height: int

    def info(self) -> Dict[str, Any]:
        """The ``resample`` block of the read-out (JSON-safe)."""
        return {
            "input_um_per_px": float(self.input_um_per_px),
            "model_um_per_px": float(MODEL_UM_PER_PX),
            "factor": float(self.factor),
            "model_w": int(self.model_width),
            "model_h": int(self.model_height),
        }


def plan_resample(
    width: int,
    height: int,
    um_per_px: Optional[float],
    max_pixels: Optional[int] = None,
) -> Tuple[Optional[ResamplePlan], List[str]]:
    """The resample for a ``width`` x ``height`` frame at ``um_per_px``, if any.

    Returns ``(None, [])`` when there is nothing to do: no usable pixel size
    (None, non-finite, <= 0) or one within ``RESAMPLE_REL_TOL`` of 1.28. Returns
    ``(None, [warning])`` when there is a pixel size but the module does not
    resample it: a factor outside ``[FACTOR_MIN, FACTOR_MAX]``, or a frame that
    would GROW past ``max_pixels`` (the caller's ceiling, if any) or
    ``RESAMPLE_MAX_PIXELS``. In both of those cases the frame is segmented as
    uploaded, exactly as it was before this module existed; an input that is
    accepted without a pixel size is never refused because one was given.
    """
    if um_per_px is None:
        return None, []
    try:
        um = float(um_per_px)
    except (TypeError, ValueError):
        return None, []
    if not math.isfinite(um) or um <= 0:
        return None, []
    s = um / MODEL_UM_PER_PX
    if abs(s - 1.0) <= RESAMPLE_REL_TOL:
        return None, []
    if not FACTOR_MIN <= s <= FACTOR_MAX:
        return None, [
            f"pixel size is {um:.4g} um/px, {s:.3g}x the model's {MODEL_UM_PER_PX} um/px; "
            f"the module resamples only factors {FACTOR_MIN}-{FACTOR_MAX}x "
            f"({FACTOR_MIN * MODEL_UM_PER_PX:.3g}-{FACTOR_MAX * MODEL_UM_PER_PX:.3g} um/px), "
            f"so the frame was segmented at its uploaded scale."
        ]
    w, h = int(width), int(height)
    mw = max(1, int(round(w * s)))
    mh = max(1, int(round(h * s)))
    ceiling = RESAMPLE_MAX_PIXELS if max_pixels is None else min(int(max_pixels), RESAMPLE_MAX_PIXELS)
    if mw * mh > w * h and mw * mh > ceiling:
        return None, [
            f"resampling to {MODEL_UM_PER_PX} um/px would grow the {w}x{h} px frame "
            f"(pixel size {um:.4g} um/px) to {mw}x{mh} px, more than the {ceiling} px "
            f"the module resamples to; the frame was segmented at its uploaded scale."
        ]
    return ResamplePlan(um, s, w, h, mw, mh), []


def frame_to_model_grid(gray: np.ndarray, plan: ResamplePlan) -> np.ndarray:
    """Resize a 2-D grey frame to the model grid.

    INTER_AREA when shrinking (an average over each output pixel's footprint,
    so no aliasing), INTER_LINEAR when enlarging; arm B of the scale study
    resized the same way.
    """
    interpolation = cv2.INTER_LINEAR if plan.factor > 1.0 else cv2.INTER_AREA
    return cv2.resize(
        gray, (plan.model_width, plan.model_height), interpolation=interpolation
    )


def mask_to_original_grid(mask: np.ndarray, plan: ResamplePlan) -> np.ndarray:
    """A class mask on the model grid, on the uploaded grid (nearest neighbour)."""
    return cv2.resize(mask, (plan.width, plan.height), interpolation=_NEAREST)


def mask_to_model_grid(mask: np.ndarray, plan: ResamplePlan) -> np.ndarray:
    """A class mask on the uploaded grid, on the model grid (nearest neighbour).

    The polygon fallback of ``/api/disintegration-index`` rasterises the stored
    polygons on the uploaded grid and scores them here, so an edited
    segmentation is scored at the scale a fresh one was.
    """
    return cv2.resize(mask, (plan.model_width, plan.model_height), interpolation=_NEAREST)


def predict_on_model_grid(
    gray: np.ndarray,
    plan: Optional[ResamplePlan],
    predict: Callable[[np.ndarray], np.ndarray],
) -> Tuple[np.ndarray, np.ndarray]:
    """Run ``predict`` on the frame at the model's scale.

    ``gray`` is the uint8 H x W grey frame; ``predict`` takes the uint8
    H x W x 3 stack (the grey level replicated, as the paper's ``predict.py``)
    and returns the 0/1/2 class mask. Returns ``(mask on the uploaded grid,
    mask on the model grid)``. Without a plan the stack is built exactly as it
    always was and both are the SAME array: nothing is resized.
    """
    if plan is None:
        rgb = np.ascontiguousarray(np.stack([gray] * 3, axis=2))
        mask = predict(rgb)
        return mask, mask
    model_gray = frame_to_model_grid(gray, plan)
    rgb = np.ascontiguousarray(np.stack([model_gray] * 3, axis=2))
    mask_model = predict(rgb)
    return mask_to_original_grid(mask_model, plan), mask_model


def read_out(
    mask_original: np.ndarray,
    mask_model: np.ndarray,
    plan: Optional[ResamplePlan],
    um_per_px: Optional[float] = None,
    extra_warnings: Sequence[str] = (),
) -> Dict[str, Any]:
    """The paper's per-image read-out, at the model's pixel size.

    Without a plan this is ``raster_metrics(mask_original, W, H, um_per_px)``
    unchanged, plus ``extra_warnings`` (normally none). With one:

    * every metric -- DI, the outside-core fraction (index_B), reach, fragments,
      the core diagnostics and the regime flags -- is computed on the MODEL-grid
      mask, because the paper defines them there: ``MIN_CORE_PX`` (16 048 px) is
      the smallest expert core AT 1.28 um/px, and fragment counts depend on the
      pixel size;
    * the input-scale check runs on the model grid at 1.28 um/px, so it does not
      warn about the very mismatch that was corrected;
    * ``area_core_px`` / ``area_corona_px`` / ``area_total_px`` and
      ``image_width`` / ``image_height`` describe the UPLOADED grid (the
      back-mapped mask), so the export's ``areas x (um/px)^2`` gives real square
      micrometres. ``(area_total - area_core) / area_total`` therefore need not
      equal ``index_B`` exactly: the two are counted on different grids;
    * a ``resample`` block records the factor and the model-grid size.
    """
    if plan is None:
        h, w = mask_original.shape[:2]
        out = dm.raster_metrics(mask_original, w, h, um_per_px)
    else:
        out = dm.raster_metrics(
            mask_model, plan.model_width, plan.model_height, MODEL_UM_PER_PX
        )
        out["warnings"] = [
            f"after resampling the {plan.width}x{plan.height} px frame from "
            f"{plan.input_um_per_px:.4g} to {MODEL_UM_PER_PX} um/px: {msg}"
            for msg in out["warnings"]
        ]
        n_fg = int((mask_original > 0).sum())
        n_core = int((mask_original == 2).sum())
        out["image_width"] = plan.width
        out["image_height"] = plan.height
        out["area_core_px"] = n_core
        out["area_corona_px"] = n_fg - n_core
        out["area_total_px"] = n_fg
        out["resample"] = plan.info()
    out["warnings"] = [*out["warnings"], *extra_warnings]
    return out
