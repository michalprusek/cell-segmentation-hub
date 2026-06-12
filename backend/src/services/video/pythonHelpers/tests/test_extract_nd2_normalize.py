"""Unit tests for ``normalize_to_tcyx`` in ``extract_nd2.py``.

The ND2 frame extractor used to handle only ``TCYX/CYX/YX/TYX``. A position
(``P``) axis from well-plate / multipoint acquisitions made the array 5-D and
crashed the transpose, so the upload failed with ``extraction_failed`` and an
orphaned container (this hit a real user's WellE03-E07 / WellD05 uploads).
``normalize_to_tcyx`` now squeezes singleton loop axes (a length-1 ``P`` from
per-field NIS exports), max-projects ``Z``, inserts a missing ``T``/``C``, and
*rejects* a genuine multi-position file (``P`` > 1) with a user-facing message
instead of silently exporting only one position.

These cases pin that contract: a refactor of the squeeze / insert / transpose
order would otherwise silently corrupt frame extraction for whole classes of
ND2 files with no compile-time signal.

Pure function over numpy arrays — ``nd2`` is lazy-imported inside ``main()`` so
it is not needed here, and there is no pytest dependency, so this runs in the
backend container with a plain interpreter:

  docker exec spheroseg-backend python3 \
    backend/src/services/video/pythonHelpers/tests/test_extract_nd2_normalize.py

It is also collectable by pytest (``python3 -m pytest .../tests/``) where the
``test_*`` functions are discovered normally.
"""
from __future__ import annotations

import os
import sys

import numpy as np

HERE = os.path.dirname(__file__)
HELPERS_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HELPERS_DIR)

from extract_nd2 import (  # noqa: E402
    normalize_to_tcyx,
    position_axis,
    select_position,
    UnsupportedND2,
)


def _mk(shape):
    return np.arange(int(np.prod(shape)), dtype=np.uint16).reshape(shape)


def _expect_unsupported(axes, shape):
    try:
        normalize_to_tcyx(_mk(shape), axes)
    except UnsupportedND2:
        return
    raise AssertionError(
        f"expected UnsupportedND2 for axes={axes!r} shape={shape}"
    )


def test_canonical_passthrough():
    assert normalize_to_tcyx(_mk((2, 2, 4, 5)), "TCYX").shape == (2, 2, 4, 5)


def test_singleton_position_squeezed():
    # The regression: per-field NIS exports carry a length-1 P axis.
    assert normalize_to_tcyx(_mk((1, 2, 3, 4, 5)), "PTCYX").shape == (2, 3, 4, 5)
    assert normalize_to_tcyx(_mk((2, 1, 2, 4, 5)), "TPCYX").shape == (2, 2, 4, 5)
    assert normalize_to_tcyx(_mk((1, 3, 4, 5)), "PCYX").shape == (1, 3, 4, 5)


def test_missing_dims_inserted():
    assert normalize_to_tcyx(_mk((3, 4, 5)), "CYX").shape == (1, 3, 4, 5)
    assert normalize_to_tcyx(_mk((4, 5)), "YX").shape == (1, 1, 4, 5)
    assert normalize_to_tcyx(_mk((2, 4, 5)), "TYX").shape == (2, 1, 4, 5)


def test_z_is_max_projected_not_first_slice():
    # TZCYX, Z=3; the brightest pixel is only on the last Z slice.
    arr = np.zeros((1, 3, 1, 2, 2), dtype=np.uint16)
    arr[0, 2, 0] = 9
    out = normalize_to_tcyx(arr, "TZCYX")
    assert out.shape == (1, 1, 2, 2)
    assert out.max() == 9  # max projection, not arr[:, 0]


def test_singleton_z_squeezed():
    assert normalize_to_tcyx(_mk((2, 1, 2, 4, 5)), "TZCYX").shape == (2, 2, 4, 5)


def test_multiposition_rejected_by_normalize():
    # normalize_to_tcyx is the single-position normalizer; an unsplit P>1
    # array is a programming error and must still be rejected (callers split
    # with select_position first).
    _expect_unsupported("PTCYX", (3, 2, 4, 5))
    _expect_unsupported("PCYX", (4, 3, 4, 5))


def test_position_axis_detection():
    assert position_axis("PTCYX") == "P"
    assert position_axis("TCYX") is None
    assert position_axis("SCYX") == "S"  # series/scene fallback
    assert position_axis("TPCYX") == "P"  # P preferred over a later axis


def test_select_position_slices_p_axis():
    # PTCYX, P=3 → each selection drops P and yields a TCYX single position.
    arr = _mk((3, 2, 4, 5, 6))  # P T C Y X
    sub, sub_axes = select_position(arr, "PTCYX", 1)
    assert sub_axes == "TCYX"
    assert sub.shape == (2, 4, 5, 6)
    # The slice must equal direct numpy indexing on the P axis.
    assert np.array_equal(sub, arr[1])
    # And normalizing the slice gives canonical TCYX unchanged.
    assert normalize_to_tcyx(sub, sub_axes).shape == (2, 4, 5, 6)


def test_select_position_snapshot_no_time_axis():
    # WellD03 shape: PCYX (no T) → each position is a single multi-channel
    # frame; normalize then inserts the missing T as length-1.
    arr = _mk((3, 2, 8, 8))  # P C Y X
    sub, sub_axes = select_position(arr, "PCYX", 2)
    assert sub_axes == "CYX"
    assert sub.shape == (2, 8, 8)
    assert normalize_to_tcyx(sub, sub_axes).shape == (1, 2, 8, 8)


def test_select_position_p_in_middle():
    # TPCYX (T outer, P inner is a common NIS layout) — P is axis 1.
    arr = _mk((4, 3, 2, 5, 6))  # T P C Y X
    sub, sub_axes = select_position(arr, "TPCYX", 0)
    assert sub_axes == "TCYX"
    assert sub.shape == (4, 2, 5, 6)
    assert np.array_equal(sub, arr[:, 0])


def test_select_position_out_of_range_rejected():
    arr = _mk((3, 2, 4, 5))  # PCYX, P=3
    for bad in (-1, 3, 99):
        try:
            select_position(arr, "PCYX", bad)
        except UnsupportedND2:
            continue
        raise AssertionError(f"expected UnsupportedND2 for position {bad}")


def test_select_position_no_position_axis_rejected():
    arr = _mk((2, 3, 4, 5))  # TCYX — nothing to select
    try:
        select_position(arr, "TCYX", 0)
    except UnsupportedND2:
        return
    raise AssertionError("expected UnsupportedND2 when no P/S axis present")


def test_missing_yx_rejected():
    _expect_unsupported("TC", (2, 3))


def test_axes_ndim_mismatch_rejected():
    # 3-D array described by a 4-char axes string.
    _expect_unsupported("TCYX", (2, 4, 5))


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:  # noqa: BLE001 - report all, exit non-zero
                failures += 1
                print(f"FAIL {name}: {exc}")
    print(f"\n{'OK' if failures == 0 else f'{failures} FAILED'}")
    sys.exit(1 if failures else 0)
