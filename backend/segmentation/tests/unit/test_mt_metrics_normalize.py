"""Unit tests for the axis normalizers in ``api/mt_metrics.py``.

These pin the (T, C, Y, X) contract the MT-metrics endpoint relies on. The
regression that motivated them: per-position originals split from a snapshot
(no-time) multipoint ND2 round-trip through tifffile with the singleton ``T``
squeezed, so they read back as ``CYX``. The old ``_normalize_axes_tiff`` had no
explicit ``CYX`` branch, so its "leading axis is time" heuristic would read the
C channels as T *timepoints* (silently giving wrong per-channel intensities).

Pure numpy functions — no GPU/torch needed. Runnable two ways:

  python3 backend/segmentation/tests/unit/test_mt_metrics_normalize.py
  python3 -m pytest backend/segmentation/tests/unit/test_mt_metrics_normalize.py
"""
from __future__ import annotations

import os
import sys

import numpy as np

# Import the pure normalizers from the api package.
HERE = os.path.dirname(__file__)
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from api.mt_metrics import (  # noqa: E402
    _normalize_axes_nd2,
    _normalize_axes_tiff,
)


def _mk(shape):
    return np.arange(int(np.prod(shape)), dtype=np.uint16).reshape(shape)


def test_tiff_cyx_is_single_timepoint_multichannel():
    # The regression: CYX (T=1 squeezed) must map to (1, C, Y, X), NOT be
    # misread as (C timepoints, 1 channel).
    arr = _mk((2, 8, 8))  # C=2, Y=8, X=8
    out = _normalize_axes_tiff(arr, "CYX")
    assert out.shape == (1, 2, 8, 8)
    # Channel 0/1 preserved as channels, not collapsed into time.
    assert np.array_equal(out[0, 0], arr[0])
    assert np.array_equal(out[0, 1], arr[1])


def test_tiff_tcyx_passthrough():
    arr = _mk((19, 3, 8, 8))
    assert _normalize_axes_tiff(arr, "TCYX").shape == (19, 3, 8, 8)


def test_tiff_tyx_and_yx():
    assert _normalize_axes_tiff(_mk((5, 8, 8)), "TYX").shape == (5, 1, 8, 8)
    assert _normalize_axes_tiff(_mk((8, 8)), "YX").shape == (1, 1, 8, 8)


def test_tiff_z_max_projected():
    arr = np.zeros((1, 3, 2, 4, 4), dtype=np.uint16)  # T Z C Y X
    arr[0, 2] = 7  # brightest on the last Z slice
    out = _normalize_axes_tiff(arr, "TZCYX")
    assert out.shape == (1, 2, 4, 4)
    assert out.max() == 7


def test_nd2_cyx_and_tcyx():
    assert _normalize_axes_nd2(_mk((2, 8, 8)), "CYX").shape == (1, 2, 8, 8)
    assert _normalize_axes_nd2(_mk((4, 2, 8, 8)), "TCYX").shape == (4, 2, 8, 8)


def test_nd2_multiposition_rejected_clearly():
    # A multi-position ND2 must never be read as one video; uploads split
    # these into per-position TIFF originals. Expect a clear 4xx, not a raw
    # numpy ValueError from the generic transpose.
    from fastapi import HTTPException

    for axes, shape in (("PTCYX", (3, 2, 1, 4, 4)), ("PCYX", (3, 2, 4, 4))):
        try:
            _normalize_axes_nd2(_mk(shape), axes)
        except HTTPException as exc:
            assert exc.status_code == 400
            continue
        raise AssertionError(f"expected HTTPException for axes={axes}")


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"FAIL {name}: {exc}")
    print(f"\n{'OK' if failures == 0 else f'{failures} FAILED'}")
    sys.exit(1 if failures else 0)
