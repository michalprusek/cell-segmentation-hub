"""The two instancer speedups must be pure performance rewrites.

Both replace an O(labels x frame) rescan with a single grouped pass, and both are
only worth anything if they are *exactly* equivalent — this is a measuring
instrument and its author reads the numbers. So each test compares against a
literal transcription of the code that was there before, not against a
remembered expectation.

Run directly (``python3 test_instancer_perf_identity.py``) or under pytest.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import binary_dilation

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from instance import oracle as O  # noqa: E402
from instance.skeleton_graph import _group_coords_by_label  # noqa: E402


# --- reference implementations, verbatim from before the change ----------------

def _oracle_instance_masks_reference(polylines, shape, half_width=1.0, up=1.5):
    out = []
    fp = O._footprint(half_width)
    for p in polylines:
        m = np.zeros(O._upscaled_shape(shape, up), dtype=bool)
        O._stamp_centerline(p, m, up)
        out.append(binary_dilation(m, structure=fp))
    return out


def _group_reference(lab, n_labels):
    return [np.empty((0, 2), dtype=np.intp)] + [
        np.argwhere(lab == i) for i in range(1, n_labels + 1)
    ]


# --- helpers -------------------------------------------------------------------

def _assert_masks_identical(polylines, shape, half_width, up, what):
    got = O.oracle_instance_masks(polylines, shape, half_width=half_width, up=up)
    want = _oracle_instance_masks_reference(polylines, shape, half_width=half_width, up=up)
    assert len(got) == len(want), f"{what}: {len(got)} masks vs {len(want)}"
    for i, (g, w) in enumerate(zip(got, want)):
        assert g.shape == w.shape, f"{what}: mask {i} shape {g.shape} vs {w.shape}"
        if not np.array_equal(g, w):
            diff = int((g != w).sum())
            raise AssertionError(f"{what}: mask {i} differs in {diff} pixel(s)")


# --- oracle_instance_masks -----------------------------------------------------

def test_bbox_matches_full_frame_on_ordinary_polylines():
    rng = np.random.default_rng(4)
    shape = (200, 240)
    polylines = []
    for _ in range(12):
        x0, y0 = rng.uniform(20, 180), rng.uniform(20, 150)
        t = np.linspace(0, 1, 40)
        polylines.append(np.stack([x0 + 45 * t, y0 + 30 * np.sin(3 * t)], axis=1))
    _assert_masks_identical(polylines, shape, 1.0, 1.0, "ordinary")


def test_bbox_matches_full_frame_for_polylines_running_off_the_edge():
    # Where a cropping bug hides: the reference clips every point onto the FRAME
    # border, so the crop has to end up on that same border rather than on its
    # own edge.
    shape = (80, 90)
    polylines = [
        np.stack([np.linspace(-40, 30, 50), np.linspace(-25, 40, 50)], axis=1),
        np.stack([np.linspace(60, 200, 50), np.linspace(50, 300, 50)], axis=1),
        np.stack([np.linspace(-30, 200, 60), np.full(60, 40.0)], axis=1),
        np.stack([np.full(60, 10.0), np.linspace(-50, 250, 60)], axis=1),
    ]
    _assert_masks_identical(polylines, shape, 1.0, 1.0, "off-edge")


def test_bbox_matches_full_frame_entirely_outside_the_frame():
    shape = (40, 40)
    polylines = [np.stack([np.linspace(300, 340, 20), np.linspace(300, 340, 20)], axis=1)]
    _assert_masks_identical(polylines, shape, 1.0, 1.0, "fully outside")


def test_bbox_matches_full_frame_across_half_widths_and_upscales():
    rng = np.random.default_rng(9)
    shape = (120, 130)
    polylines = [
        np.stack([rng.uniform(10, 100, 25).cumsum() / 6 + 5,
                  rng.uniform(10, 100, 25).cumsum() / 6 + 5], axis=1)
        for _ in range(4)
    ]
    for half_width in (0.5, 1.0, 2.0, 3.5):
        for up in (1.0, 1.5):
            _assert_masks_identical(polylines, shape, half_width, up,
                                    f"hw={half_width} up={up}")


def test_bbox_handles_degenerate_polylines():
    shape = (50, 50)
    polylines = [
        np.empty((0, 2)),                       # empty
        np.array([[25.0, 25.0]]),               # single point
        np.array([[10.0, 10.0], [10.0, 10.0]]), # zero length
    ]
    _assert_masks_identical(polylines, shape, 1.0, 1.0, "degenerate")


def test_padding_is_not_merely_incidental():
    # A dilation radius large enough that a too-tight crop would clip the halo.
    shape = (60, 60)
    polylines = [np.stack([np.linspace(20, 40, 30), np.full(30, 30.0)], axis=1)]
    _assert_masks_identical(polylines, shape, 5.0, 1.0, "wide footprint")


# --- _group_coords_by_label ----------------------------------------------------

def test_grouping_reproduces_argwhere_exactly():
    rng = np.random.default_rng(1)
    lab = rng.integers(0, 7, size=(60, 70)).astype(np.int32)
    got = _group_coords_by_label(lab, 6)
    want = _group_reference(lab, 6)
    for i in range(1, 7):
        assert np.array_equal(got[i], want[i]), f"label {i} differs"


def test_grouping_preserves_row_major_order():
    # Not just the same pixels — the same ORDER. `_component_path` numbers its
    # graph nodes by position, so a permuted group would silently change which
    # endpoint the double sweep starts from.
    lab = np.zeros((10, 10), dtype=np.int32)
    lab[7, 1] = lab[2, 8] = lab[2, 3] = lab[5, 5] = 1
    got = _group_coords_by_label(lab, 1)[1]
    assert np.array_equal(got, np.argwhere(lab == 1))
    assert np.array_equal(got, np.array([[2, 3], [2, 8], [5, 5], [7, 1]]))


def test_grouping_handles_empty_and_gappy_labels():
    lab = np.zeros((20, 20), dtype=np.int32)
    lab[3, 3] = 1
    lab[9, 9] = 3          # label 2 has no pixels at all
    got = _group_coords_by_label(lab, 4)
    assert len(got) == 5
    assert np.array_equal(got[1], np.array([[3, 3]]))
    assert got[2].shape == (0, 2)
    assert np.array_equal(got[3], np.array([[9, 9]]))
    assert got[4].shape == (0, 2)
    assert _group_coords_by_label(np.zeros((5, 5), np.int32), 3)[1].shape == (0, 2)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL {fn.__name__}: {exc}")
    print("OK" if not failed else f"{failed} FAILED")
    sys.exit(1 if failed else 0)
