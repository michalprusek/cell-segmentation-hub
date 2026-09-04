"""The instancer speedups must be pure performance rewrites.

Each of them replaces work that was linear in the FRAME (or quadratic in the
arms) with work linear in what it actually touches, and each is only worth
anything if it is *exactly* equivalent — this is a measuring instrument and its
author reads the numbers. So every test compares against a literal
transcription of the code that was there before, not against a remembered
expectation.

Covered here:

* ``oracle_instance_masks`` — bbox dilation instead of a full-frame one;
* ``_group_coords_by_label`` — one grouped pass instead of a rescan per label;
* ``_dilate_sparse`` — scattering the structuring element onto the few set
  pixels instead of sweeping it over every pixel (2026-09-04);
* ``matching._candidate_pairs`` — a KD-tree superset instead of measuring all
  ``n(n-1)/2`` arm distances in Python (2026-09-04);
* ``instance_a(return_masks=False)`` — not building masks no caller reads
  (2026-09-04), including the assertion that ``wrapper.predict`` asks for that.

Run directly (``python3 test_instancer_perf_identity.py``) or under pytest.
``make test-ml`` collects this directory.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy import ndimage
from scipy.ndimage import binary_dilation

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from instance import matching as M  # noqa: E402
from instance import oracle as O  # noqa: E402
from instance.instancer_a import default_params, instance_a  # noqa: E402
from instance.skeleton_graph import (  # noqa: E402
    _disk,
    _dilate_sparse,
    _group_coords_by_label,
)


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


# --- _dilate_sparse ------------------------------------------------------------
#
# Junction pixels are a sliver of the frame — 93 of 6.4 M on a real production
# frame (container 4972cad8, frame 0 IRM at the 1.5x working scale) — and
# ``ndimage.binary_dilation`` costs the frame regardless. Measured there,
# interleaved in one process: 0.337 s dense against 0.012 s scattered (28x),
# a fifth to a third of the whole instancer depending on machine load — the
# single largest item in it. The scatter is the DEFINITION of dilation
# (the union of the element's offsets translated onto every set pixel), so the
# only way it can go wrong is in the bookkeeping: the origin, the border, or the
# fallback.

def _assert_dilation_identical(mask, structure, what):
    got = _dilate_sparse(mask, structure)
    want = ndimage.binary_dilation(mask, structure=structure)
    assert got.dtype == want.dtype, f"{what}: dtype {got.dtype} vs {want.dtype}"
    if not np.array_equal(got, want):
        raise AssertionError(f"{what}: differs in {int((got != want).sum())} pixel(s)")


def test_sparse_dilation_matches_scipy_on_edges_and_corners():
    # Where an origin or border mistake shows: a set pixel whose disk hangs off
    # each side. scipy's border_value=0 drops the overhang; so must the scatter.
    h, w = 31, 43
    disk = _disk(4.0)
    for y in (0, 1, 3, h // 2, h - 4, h - 2, h - 1):
        for x in (0, 1, 3, w // 2, w - 4, w - 2, w - 1):
            m = np.zeros((h, w), dtype=bool)
            m[y, x] = True
            _assert_dilation_identical(m, disk, f"single px ({y},{x})")


def test_sparse_dilation_matches_scipy_across_radii():
    # radius 0 -> a 1x1 structure (identity); the even/odd shapes of _disk's
    # 2r+1 side are all odd, but the radii between them change which cells are
    # set, and an off-centre origin is only visible for r >= 1.
    rng = np.random.default_rng(11)
    h, w = 40, 37
    m = np.zeros((h, w), dtype=bool)
    ys = rng.integers(0, h, 9)
    xs = rng.integers(0, w, 9)
    m[ys, xs] = True
    for radius in (0.0, 0.5, 1.0, 2.0, 3.0, 5.0, 7.5):
        _assert_dilation_identical(m, _disk(radius), f"radius {radius}")


def test_sparse_dilation_matches_scipy_on_an_asymmetric_structure():
    # _disk is symmetric, so a swapped or negated offset would still pass on it.
    # An L-shaped element pins that the offsets are applied in (row, col) with
    # the origin at shape // 2.
    structure = np.array(
        [[1, 0, 0],
         [1, 1, 0],
         [1, 1, 1]], dtype=bool,
    )
    h, w = 17, 19
    for y in (0, 1, 8, h - 2, h - 1):
        for x in (0, 1, 9, w - 2, w - 1):
            m = np.zeros((h, w), dtype=bool)
            m[y, x] = True
            _assert_dilation_identical(m, structure, f"L at ({y},{x})")


def test_sparse_dilation_handles_empty_and_full_masks():
    disk = _disk(3.0)
    _assert_dilation_identical(np.zeros((20, 25), dtype=bool), disk, "empty")
    _assert_dilation_identical(np.ones((20, 25), dtype=bool), disk, "full")
    # An all-False structure: scipy dilates to nothing, and so must the early
    # return that skips the scatter for it. `_disk` always sets its centre, so
    # this guard is defensive — which is exactly why it needs an assertion.
    empty_structure = np.zeros((3, 3), dtype=bool)
    _assert_dilation_identical(
        np.zeros((20, 25), dtype=bool), empty_structure, "empty mask + structure"
    )
    populated = np.zeros((20, 25), dtype=bool)
    populated[4, 5] = populated[17, 22] = True
    _assert_dilation_identical(populated, empty_structure, "empty structure")


def test_sparse_dilation_falls_back_when_the_mask_is_dense():
    """The scatter's index arrays are ``|set| * |structure|`` elements, so a
    dense mask must go back to scipy rather than allocate more than the frame.

    Asserts BOTH that the fallback is taken (scipy is actually called) and that
    it still returns the right answer — a fallback that silently produced the
    scatter's result would make the guard pointless."""
    h, w = 40, 40
    disk = _disk(3.0)                       # 29 cells; limit is 40*40 // 8 = 200
    dense = np.zeros((h, w), dtype=bool)
    dense[::2, ::2] = True                  # 400 set pixels -> 11 600 > 200
    calls = []
    real = ndimage.binary_dilation

    def spy(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)

    import instance.skeleton_graph as SG
    original = SG.ndimage.binary_dilation
    SG.ndimage.binary_dilation = spy
    try:
        got = _dilate_sparse(dense, disk)
    finally:
        SG.ndimage.binary_dilation = original
    assert calls, "dense mask must fall back to scipy, not build a huge index array"
    assert np.array_equal(got, real(dense, structure=disk))

    sparse = np.zeros((h, w), dtype=bool)
    sparse[5, 5] = sparse[20, 30] = True
    calls.clear()
    SG.ndimage.binary_dilation = spy
    try:
        _dilate_sparse(sparse, disk)
    finally:
        SG.ndimage.binary_dilation = original
    assert not calls, "a sparse mask must NOT go through scipy"


# --- matching._candidate_pairs -------------------------------------------------
#
# At the gap-linking call every free chain end in the frame is an arm, so the
# nested loops measured n(n-1)/2 distances to keep a few dozen: 14 365 pairs ->
# 44 kept on a real production frame. The KD-tree is a SUPERSET filter and the
# original comparison is then re-applied, so the surviving set is defined by the
# old expression rather than by scipy's rounding.

def _arms_at(points):
    return [
        M.ArmEnd(arc_idx=i, which="start", theta=0.0, kappa=0.0,
                 pos=np.asarray(p, dtype=float))
        for i, p in enumerate(points)
    ]


def _candidate_pairs_reference(arms, max_gap):
    """The pre-2026-09-04 enumeration, verbatim."""
    out = []
    n = len(arms)
    for i in range(n):
        for j in range(i + 1, n):
            if max_gap is not None:
                if float(np.linalg.norm(arms[i].pos - arms[j].pos)) > max_gap:
                    continue
            out.append((i, j))
    return out


def test_candidate_pairs_match_the_nested_loops_content_and_order():
    """Order is load-bearing: edge insertion order is what
    ``nx.max_weight_matching`` breaks exact ties on, so a permuted candidate
    list could return a different (equally optimal) matching."""
    rng = np.random.default_rng(77)
    for trial in range(30):
        n = int(rng.integers(2, 60))
        pts = rng.uniform(0, 120, size=(n, 2))
        arms = _arms_at(pts)
        for max_gap in (0.5, 5.0, 20.0, 1000.0):
            got = list(M._candidate_pairs(arms, max_gap))
            want = _candidate_pairs_reference(arms, max_gap)
            assert got == want, f"trial {trial} max_gap {max_gap}"


def test_candidate_pairs_without_a_gap_is_every_pair_in_row_major_order():
    arms = _arms_at(np.array([[0.0, 0.0], [1.0, 0.0], [2.0, 0.0], [3.0, 0.0]]))
    assert list(M._candidate_pairs(arms, None)) == _candidate_pairs_reference(arms, None)
    assert list(M._candidate_pairs(arms, None)) == [
        (0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)
    ]


def test_candidate_pairs_keeps_a_pair_sitting_exactly_on_the_gap():
    """``> max_gap`` is a strict comparison, so a distance EQUAL to the gate is
    kept. The KD query is widened by 1e-9 relative precisely so scipy cannot
    drop such a pair before the exact test sees it."""
    arms = _arms_at(np.array([[0.0, 0.0], [3.0, 4.0]]))   # distance exactly 5.0
    assert list(M._candidate_pairs(arms, 5.0)) == [(0, 1)]
    assert list(M._candidate_pairs(arms, 4.999999)) == []


def test_candidate_pairs_handles_duplicate_positions():
    # Coincident arms are a real shape (two chains ending on the same pixel) and
    # query_pairs returns them at distance 0.
    arms = _arms_at(np.array([[7.0, 7.0], [7.0, 7.0], [7.0, 7.0], [99.0, 99.0]]))
    assert list(M._candidate_pairs(arms, 1.0)) == _candidate_pairs_reference(arms, 1.0)
    assert list(M._candidate_pairs(arms, 1.0)) == [(0, 1), (0, 2), (1, 2)]


# --- instance_a(return_masks=False) --------------------------------------------

def _cross_mask(h=90, w=90):
    m = np.zeros((h, w), dtype=bool)
    m[44:47, 10:80] = True
    m[10:80, 44:47] = True
    return m


def test_return_masks_false_changes_nothing_but_the_masks():
    mask = _cross_mask()
    params = default_params()
    with_masks = instance_a(mask, 0.239, params)
    without = instance_a(mask, 0.239, params, return_masks=False)
    assert len(with_masks[0]) == len(without[0]) >= 1
    for a, b in zip(with_masks[0], without[0]):
        assert np.array_equal(a, b)
    assert without[1] == []
    assert len(with_masks[1]) == len(with_masks[0])


def test_wrapper_asks_for_no_masks():
    """Test the WIRING, not just the flag: the production path is
    ``wrapper.predict`` and both callers (interactive segmentation and the
    essays batch) reach the instancer only through it. A default that stays
    True while nobody passes False would build 0.38 GB of masks per real frame
    and this file would still be green."""
    import instance.instancer_a as IA
    import wrapper as W

    seen = {}
    real = IA.instance_a

    def spy(*args, **kwargs):
        seen.update(kwargs)
        return real(*args, **kwargs)

    model = W.MicrotubuleModel()
    model._model = object()                    # predict() only checks it is not None
    model._channels = lambda img01: np.zeros((1,) + img01.shape, dtype=np.float32)
    IA.instance_a = spy
    try:
        out = model.predict(np.zeros((64, 64), dtype=np.float32))
    finally:
        IA.instance_a = real
    assert seen.get("return_masks") is False, (
        "wrapper.predict must ask instance_a NOT to build masks it discards; "
        f"got {seen!r}"
    )
    assert out["centerlines_rc"] == []


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
