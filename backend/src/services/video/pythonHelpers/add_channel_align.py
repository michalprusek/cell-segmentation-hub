"""Align added-channel frames onto their target frame's segmentation source.

Driver for the "Add channel" feature (MT projects). Given a JSON manifest of
``{moving, reference, out}`` jobs, for each job it:

  1. loads the moving PNG (the newly added channel's raster for one frame) and
     the reference PNG (that frame's segmentation-source channel);
  2. estimates the integer translation that best overlays moving onto reference
     via phase correlation
     (``channel_registration.estimate_translation_detailed``);
  3. applies it losslessly (``channel_registration.shift_frame`` — no
     interpolation, so 16-bit intensity survives untouched);
  4. writes the aligned raster to ``out`` preserving bit depth.

Invoked by the backend as::

    python3 add_channel_align.py <manifest.json>

The manifest path is the sole argument. All paths inside are absolute and are
trusted (the backend builds them from validated storage segments). The script
prints exactly one JSON line on stdout::

    {"aligned": <count>,
     "shifts": [[dy, dx, confidence, reason, peak_dy, peak_dx], ...]}

``shifts[i]`` corresponds to ``jobs[i]``. ``(dy, dx)`` is the shift that was
APPLIED — zero whenever ``reason`` is not ``"ok"``, in which case the frame was
copied unshifted (a safe no-op, never an abort). ``reason`` says WHY:

    ok                 estimate accepted (a ``(0, 0)`` here = already aligned)
    low_confidence     correlation peak too weak to trust
    implausible_shift  peak found but beyond the plausibility cap → discarded
    shape_mismatch     moving/reference rasters differ in shape; no estimate

Without ``reason``, ``ok`` at ``(0, 0)`` (a success) and ``implausible_shift``
(a silent failure) are the same row: both are a zero shift with a confidence
above the threshold.

``(peak_dy, peak_dx)`` is the raw correlation peak BEFORE the guards, so a
rejected estimate still says what it wanted to do. It equals ``(dy, dx)`` on an
``ok`` row and is ``(0, 0)`` for ``shape_mismatch`` (no correlation was run).

WIRE COMPATIBILITY: elements 3-5 are APPENDED to the historical
``[dy, dx, confidence]`` row, and no existing key changed meaning. A backend
that predates them destructures the first three entries and ignores the tail,
so it reads these rows exactly as it read the old ones.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from channel_registration import (
    REASON_SHAPE_MISMATCH,
    estimate_translation_detailed,
    shift_frame,
)
from drift_correction import DRIFT_MAX_SHIFT_PX


def _load_array(path: str) -> np.ndarray:
    """Load a PNG as a 2-D ndarray at native bit depth. Collapses an
    unexpected multi-channel raster to 2-D by averaging — only used so a
    stray RGB reference doesn't crash the correlation."""
    arr = np.asarray(Image.open(path))
    if arr.ndim == 3:
        arr = arr.mean(axis=2)
    return arr


def _save_array(arr: np.ndarray, path: str) -> None:
    Image.fromarray(arr).save(path, format="PNG", optimize=True)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: add_channel_align.py <manifest.json>", file=sys.stderr)
        return 2

    manifest = json.loads(Path(sys.argv[1]).read_text())
    jobs = manifest.get("jobs", [])
    shifts: list[list] = []

    for job in jobs:
        moving_path = job["moving"]
        ref_path = job["reference"]
        out_path = job["out"]

        moving = np.asarray(Image.open(moving_path))
        moving2d = moving.mean(axis=2) if moving.ndim == 3 else moving
        reference = _load_array(ref_path)

        dy = dx = 0
        conf = 0.0
        reason = REASON_SHAPE_MISMATCH
        peak_dy = peak_dx = 0
        if reference.shape == moving2d.shape and moving2d.ndim == 2:
            # The reference is the container's STORED frame, which since
            # 2026-08-29 may have been de-drifted (see `drift_correction`).
            # The shift needed to land on it is therefore the chromatic offset
            # PLUS that frame's accumulated drift, and the default 16 px window
            # is sized for the offset alone. Measured on a 90-frame stack
            # drifting 0.22 px/frame: alignment is exact to frame 60 and then
            # silently stops (`implausible_shift`, unshifted copy written) —
            # a PARTIAL failure, which is worse than a clean refusal because
            # the early frames look right. The budget must cover what drift
            # correction itself was allowed to apply.
            est = estimate_translation_detailed(
                reference, moving2d, max_shift_px=DRIFT_MAX_SHIFT_PX
            )
            dy, dx, conf = est.dy, est.dx, est.confidence
            reason, peak_dy, peak_dx = est.reason, est.peak_dy, est.peak_dx
        else:
            # Shape mismatch should never reach here (the backend validates
            # dimensions before extraction), but degrade to an unshifted copy
            # rather than aborting the whole batch. This is the one reason
            # estimate_translation_detailed cannot report — it raises instead —
            # so it is labelled here.
            print(
                f"WARNING: shape mismatch ref {reference.shape} vs moving "
                f"{moving2d.shape} for {out_path}; writing unshifted",
                file=sys.stderr,
            )

        aligned = shift_frame(moving, dy, dx) if (dy or dx) else moving
        _save_array(aligned, out_path)
        shifts.append(
            [int(dy), int(dx), float(conf), reason, int(peak_dy), int(peak_dx)]
        )

    print(json.dumps({"aligned": len(jobs), "shifts": shifts}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
