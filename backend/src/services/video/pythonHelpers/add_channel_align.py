"""Align added-channel frames onto their target frame's segmentation source.

Driver for the "Add channel" feature (MT projects). Given a JSON manifest of
``{moving, reference, out}`` jobs, for each job it:

  1. loads the moving PNG (the newly added channel's raster for one frame) and
     the reference PNG (that frame's segmentation-source channel);
  2. estimates the integer translation that best overlays moving onto reference
     via phase correlation (``channel_registration.estimate_translation``);
  3. applies it losslessly (``channel_registration.shift_frame`` — no
     interpolation, so 16-bit intensity survives untouched);
  4. writes the aligned raster to ``out`` preserving bit depth.

Invoked by the backend as::

    python3 add_channel_align.py <manifest.json>

The manifest path is the sole argument. All paths inside are absolute and are
trusted (the backend builds them from validated storage segments). The script
prints exactly one JSON line on stdout::

    {"aligned": <count>, "shifts": [[dy, dx, confidence], ...]}

``shifts[i]`` corresponds to ``jobs[i]``; a ``[0, 0, 0.0]`` entry means the
estimate was rejected (implausible / low confidence) and the frame was copied
unshifted — a safe no-op, never a failure.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from channel_registration import estimate_translation, shift_frame


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
    shifts: list[list[float]] = []

    for job in jobs:
        moving_path = job["moving"]
        ref_path = job["reference"]
        out_path = job["out"]

        moving = np.asarray(Image.open(moving_path))
        moving2d = moving.mean(axis=2) if moving.ndim == 3 else moving
        reference = _load_array(ref_path)

        dy = dx = 0
        conf = 0.0
        if reference.shape == moving2d.shape and moving2d.ndim == 2:
            dy, dx, conf = estimate_translation(reference, moving2d)
        else:
            # Shape mismatch should never reach here (the backend validates
            # dimensions before extraction), but degrade to an unshifted copy
            # rather than aborting the whole batch.
            print(
                f"WARNING: shape mismatch ref {reference.shape} vs moving "
                f"{moving2d.shape} for {out_path}; writing unshifted",
                file=sys.stderr,
            )

        aligned = shift_frame(moving, dy, dx) if (dy or dx) else moving
        _save_array(aligned, out_path)
        shifts.append([int(dy), int(dx), float(conf)])

    print(json.dumps({"aligned": len(jobs), "shifts": shifts}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
