"""Unit tests for ``frame_time_order`` in ``frame_ordering.py``.

The frame extractors (ND2 / TIFF) used to write frames in the container's
internal sequence order (T-axis / page order) with no guarantee it matched
acquisition time. ``frame_time_order`` turns the per-frame acquisition
timestamps that the extractors already parse into a stable permutation, so the
on-disk ``frames/<rank>/`` order — and therefore the DB ``frameIndex`` — is the
true time rank. It is a pure correctness guarantee: it NEVER reorders when the
timestamps can't be trusted (absent, length-mismatched, or non-finite), so it
can only fix a genuinely out-of-order container, never corrupt a good one.

Pure function over Python lists — only ``math`` from the stdlib — so it runs
with a plain interpreter and no numpy/nd2/tifffile:

  python3 backend/src/services/video/pythonHelpers/tests/test_frame_ordering.py

It is also collectable by pytest (``python3 -m pytest .../tests/``).
"""
from __future__ import annotations

import math
import os
import sys

HERE = os.path.dirname(__file__)
HELPERS_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HELPERS_DIR)

from frame_ordering import frame_time_order  # noqa: E402


def test_no_timestamps_is_identity():
    # No acquisition timing available -> keep sequence order untouched.
    assert frame_time_order([], 3) == [0, 1, 2]


def test_monotonic_timestamps_is_noop():
    # Already in acquisition order -> stable sort is a no-op.
    assert frame_time_order([10.0, 20.0, 30.0], 3) == [0, 1, 2]


def test_shuffled_timestamps_restores_time_order():
    # Container stored frames out of time order -> permutation fixes it.
    # ts: idx0=30, idx1=10, idx2=20 -> ascending is idx1, idx2, idx0.
    assert frame_time_order([30.0, 10.0, 20.0], 3) == [1, 2, 0]


def test_equal_timestamps_are_stable():
    # Ties break by original index (stable), never arbitrarily.
    # ts: idx0=10, idx1=10, idx2=5 -> 5 first, then the two 10s in input order.
    assert frame_time_order([10.0, 10.0, 5.0], 3) == [2, 0, 1]


def test_non_finite_timestamp_skips_reorder():
    # A single NaN/inf means the timing is untrustworthy -> do not reorder.
    assert frame_time_order([10.0, math.nan, 5.0], 3) == [0, 1, 2]
    assert frame_time_order([10.0, math.inf, 5.0], 3) == [0, 1, 2]


def test_length_mismatch_skips_reorder():
    # Fewer/more timestamps than frames -> can't define a total order, no-op.
    assert frame_time_order([10.0, 20.0], 3) == [0, 1, 2]
    assert frame_time_order([10.0, 20.0, 30.0, 40.0], 3) == [0, 1, 2]


def test_permutation_is_valid():
    # Whatever it returns must be a permutation of range(n).
    order = frame_time_order([5.0, 1.0, 9.0, 3.0], 4)
    assert sorted(order) == [0, 1, 2, 3]


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
