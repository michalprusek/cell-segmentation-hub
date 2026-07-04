"""``_position_timestamps_s`` picks one position's per-frame timestamps out of
the flat ND2 event list, honouring the T/P loop-nesting order. This is the
subset both the per-position frame interval AND the per-position time-sort rely
on, so it is pinned directly.

The function itself is pure (lists only), but importing ``extract_nd2`` pulls
numpy, so run it where numpy is available (backend container / throwaway):

  python3 backend/src/services/video/pythonHelpers/tests/test_position_timestamps.py
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(__file__)
HELPERS_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HELPERS_DIR)

from extract_nd2 import _position_timestamps_s  # noqa: E402


def test_time_outer_strides_by_p_count():
    # T outer: [t0p0, t0p1, t1p0, t1p1]; position 0 -> t0p0,t1p0 (idx 0,2).
    ts = [10.0, 11.0, 20.0, 21.0]
    assert _position_timestamps_s(ts, 0, t_count=2, p_count=2, time_outer=True) == [10.0, 20.0]
    assert _position_timestamps_s(ts, 1, t_count=2, p_count=2, time_outer=True) == [11.0, 21.0]


def test_position_outer_is_contiguous_block():
    # P outer: [p0t0, p0t1, p1t0, p1t1]; position 1 -> p1t0,p1t1 (idx 2,3).
    ts = [10.0, 20.0, 11.0, 21.0]
    assert _position_timestamps_s(ts, 0, t_count=2, p_count=2, time_outer=False) == [10.0, 20.0]
    assert _position_timestamps_s(ts, 1, t_count=2, p_count=2, time_outer=False) == [11.0, 21.0]


def test_count_mismatch_returns_empty():
    # Event list not exactly T*P -> can't align, return empty (caller no-ops).
    assert _position_timestamps_s([1.0, 2.0, 3.0], 0, t_count=2, p_count=2, time_outer=True) == []


def test_unknown_nesting_returns_empty():
    assert _position_timestamps_s([1.0, 2.0, 3.0, 4.0], 0, t_count=2, p_count=2, time_outer=None) == []


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
