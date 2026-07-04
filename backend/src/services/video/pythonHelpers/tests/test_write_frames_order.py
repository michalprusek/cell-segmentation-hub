"""``_write_frames`` must write source frame ``order[rank]`` into slot ``rank``.

This pins the wiring that turns the ``frame_time_order`` permutation into
on-disk ``frames/<rank>/`` directories. It monkeypatches ``_save_png`` so no
real PNG encoding / bit-depth handling is involved — it only asserts the
rank -> source-frame mapping. Needs numpy (to build the array) but not PIL:

  python3 backend/src/services/video/pythonHelpers/tests/test_write_frames_order.py
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = os.path.dirname(__file__)
HELPERS_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HELPERS_DIR)

import extract_nd2  # noqa: E402


def _run_write(order):
    """Return {rank: source_value} written by _write_frames for the given order.

    Frame ``t`` is a (C=1, Y=2, X=2) block filled with the scalar ``t``, so the
    value observed in a written slot reveals which source frame landed there.
    """
    arr = np.stack(
        [np.full((1, 2, 2), t, dtype=np.uint8) for t in range(3)]
    )  # (T=3, C=1, Y, X)
    saved: dict[int, int] = {}

    def fake_save(frame_2d, path):
        rank = int(Path(path).parent.name)
        saved[rank] = int(np.asarray(frame_2d).flat[0])

    original = extract_nd2._save_png
    extract_nd2._save_png = fake_save
    tmp = Path(tempfile.mkdtemp())
    try:
        extract_nd2._write_frames(arr, tmp, ["ch0"], order=order)
    finally:
        extract_nd2._save_png = original
        shutil.rmtree(tmp, ignore_errors=True)
    return saved


def test_write_frames_reorders_by_order():
    # order[rank] = source: slot0<-src2, slot1<-src0, slot2<-src1.
    assert _run_write([2, 0, 1]) == {0: 2, 1: 0, 2: 1}


def test_write_frames_default_order_is_identity():
    # No order -> sequence order preserved (backward compatible).
    assert _run_write(None) == {0: 0, 1: 1, 2: 2}


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
